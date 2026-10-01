// =========================================================
// FILE: src/lib/rent.ts
// Управленческий учёт аренды — Supabase (PostgreSQL).
// Отдельный модуль: организации, арендаторы, начисления и
// банк аренды. НЕ связан со складским bank_payments.
// =========================================================

import { revalidateTag } from "next/cache";
import { getAdminDb } from "./supabase";
import {
  calcElectricityReading,
  composeElectricityInvoiceComment,
  DEFAULT_ELECTRICITY_TARIFF,
  electricityPeriodEndIso,
  isElectricityInvoice,
  normalizeElectricityPeriod,
  rentAccountOrgId,
  rentAddMonths,
  rentClampDay,
  rentDueDay,
  rentInvoiceDay,
  rentParseDate,
  rentTodayIso,
  rentToIso,
  roundMoney2,
  roundReading1,
  type RentInvoice,
  type RentMeterReading,
  type RentOrg,
  type RentPayment,
  type RentTenant,
} from "./rent-shared";

export const RENT_TAG = "rent";

function bumpRent() {
  revalidateTag(RENT_TAG, { expire: 0 });
}

function cleanText(value: unknown, max = 500): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ");
}

async function nextNumber(key: string): Promise<number> {
  const db = getAdminDb();
  const { data, error } = await db.rpc("fn_next_counter", { p_key: key });
  if (error) {
    const { data: counter } = await db
      .from("doc_counters")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const newVal = (counter?.value || 0) + 1;
    await db.from("doc_counters").upsert({ key, value: newVal });
    return newVal;
  }
  return Number(data);
}

// ── Организации ──────────────────────────────────────────

function mapOrg(row: any): RentOrg {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name || row.name,
    legalName: row.legal_name ?? null,
    inn: row.inn ?? null,
    bankAccount: row.bank_account ?? null,
    bankName: row.bank_name ?? null,
    bik: row.bik ?? null,
    correspondentAccount: row.correspondent_account ?? null,
    payDay: Number(row.pay_day) || 3,
    invoiceDay: Number(row.invoice_day) || 25,
    paysToOrgId: row.pays_to_org_id ?? null,
    comment: row.comment ?? null,
  };
}

export async function getRentOrgs(): Promise<RentOrg[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("rent_orgs").select("*").order("id");
  if (error) throw error;
  return (data || []).map(mapOrg);
}

export async function updateRentOrg(
  id: string,
  data: Partial<{
    name: string;
    shortName: string;
    legalName: string | null;
    inn: string | null;
    bankAccount: string | null;
    bankName: string | null;
    bik: string | null;
    correspondentAccount: string | null;
    payDay: number;
    invoiceDay: number;
    comment: string | null;
  }>
): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = {};
  if (data.name !== undefined) payload.name = String(data.name).trim();
  if (data.shortName !== undefined) payload.short_name = String(data.shortName).trim();
  if (data.legalName !== undefined) payload.legal_name = cleanText(data.legalName, 200);
  if (data.inn !== undefined) payload.inn = cleanText(data.inn, 40);
  if (data.bankAccount !== undefined) payload.bank_account = cleanText(data.bankAccount, 60);
  if (data.bankName !== undefined) payload.bank_name = cleanText(data.bankName, 200);
  if (data.bik !== undefined) payload.bik = cleanText(data.bik, 20);
  if (data.correspondentAccount !== undefined) payload.correspondent_account = cleanText(data.correspondentAccount, 60);
  if (data.payDay !== undefined) payload.pay_day = Math.min(31, Math.max(1, Number(data.payDay) || 3));
  if (data.invoiceDay !== undefined) payload.invoice_day = Math.min(31, Math.max(1, Number(data.invoiceDay) || 25));
  if (data.comment !== undefined) payload.comment = cleanText(data.comment);
  const { error } = await db.from("rent_orgs").update(payload).eq("id", id);
  if (error) throw error;
  bumpRent();
}

// ── Арендаторы ───────────────────────────────────────────

const ELECTRICITY_FALLBACK_SETTING_KEY = "rent_electricity_state";

interface ElectricityFallbackState {
  tariffs?: Record<string, number>;
  readings?: RentMeterReading[];
}

async function getElectricityFallbackState(): Promise<ElectricityFallbackState> {
  try {
    const db = getAdminDb();
    const { data, error } = await db
      .from("settings")
      .select("value")
      .eq("key", ELECTRICITY_FALLBACK_SETTING_KEY)
      .maybeSingle();
    if (error || !data?.value) return {};
    const parsed = JSON.parse(data.value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveElectricityFallbackState(
  next: ElectricityFallbackState
): Promise<void> {
  const db = getAdminDb();
  await db.from("settings").upsert(
    {
      key: ELECTRICITY_FALLBACK_SETTING_KEY,
      value: JSON.stringify(next),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
}

function isMissingColumnOrTableError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || err.details || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("electricity_tariff") ||
    msg.includes("rent_meter_readings") ||
    msg.includes("kind")
  );
}

function mapTenant(
  row: any,
  fallbackTariffs?: Record<string, number>
): RentTenant {
  const rawTariff =
    row.electricity_tariff != null
      ? Number(row.electricity_tariff)
      : fallbackTariffs?.[row.id] != null
        ? Number(fallbackTariffs[row.id])
        : DEFAULT_ELECTRICITY_TARIFF;
  const electricityTariff =
    Number.isFinite(rawTariff) && rawTariff > 0
      ? roundMoney2(rawTariff)
      : DEFAULT_ELECTRICITY_TARIFF;
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    office: row.office ?? null,
    contractNumber: row.contract_number ?? null,
    contractDate: row.contract_date ?? null,
    monthlyRent: Number(row.monthly_rent) || 0,
    electricityTariff,
    periodMonths: Number(row.period_months) || 1,
    dueDay: row.due_day != null ? Number(row.due_day) : null,
    invoiceDay: row.invoice_day != null ? Number(row.invoice_day) : null,
    deferralDays: Number(row.deferral_days) || 0,
    payMethod: row.pay_method === "bank" || row.pay_method === "cash" ? row.pay_method : "any",
    contactName: row.contact_name ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    inn: row.inn ?? null,
    comment: row.comment ?? null,
    status: row.status === "archived" ? "archived" : "active",
  };
}

export async function getRentTenants(): Promise<RentTenant[]> {
  const db = getAdminDb();
  const [{ data, error }, fallback] = await Promise.all([
    db.from("rent_tenants").select("*").order("name"),
    getElectricityFallbackState(),
  ]);
  if (error) throw error;
  return (data || []).map((row) => mapTenant(row, fallback.tariffs));
}

export interface RentTenantInput {
  orgId: string;
  name: string;
  office?: string | null;
  contractNumber?: string | null;
  contractDate?: string | null;
  monthlyRent?: number;
  electricityTariff?: number;
  periodMonths?: number;
  dueDay?: number | null;
  invoiceDay?: number | null;
  deferralDays?: number;
  payMethod?: "bank" | "cash" | "any";
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  inn?: string | null;
  comment?: string | null;
  status?: "active" | "archived";
}

function tenantPayload(
  d: RentTenantInput,
  includeElectricityTariff = true
): Record<string, any> {
  const name = String(d.name || "").trim();
  if (!name) throw new Error("Укажите название арендатора");
  const periodMonths = Math.max(1, Math.round(Number(d.periodMonths) || 1));
  const rawTariff =
    d.electricityTariff != null
      ? Number(d.electricityTariff)
      : DEFAULT_ELECTRICITY_TARIFF;
  const electricityTariff =
    Number.isFinite(rawTariff) && rawTariff > 0
      ? roundMoney2(rawTariff)
      : DEFAULT_ELECTRICITY_TARIFF;
  const payload: Record<string, any> = {
    org_id: String(d.orgId || "").trim() || "bau",
    name,
    normalized_name: normalizeName(name),
    office: cleanText(d.office, 200),
    contract_number: cleanText(d.contractNumber, 60),
    contract_date: d.contractDate ? String(d.contractDate).slice(0, 10) : null,
    monthly_rent: Math.max(0, Number(d.monthlyRent) || 0),
    period_months: periodMonths,
    due_day: d.dueDay != null && d.dueDay !== 0 ? Math.min(31, Math.max(1, Number(d.dueDay))) : null,
    invoice_day: d.invoiceDay != null && d.invoiceDay !== 0 ? Math.min(31, Math.max(1, Number(d.invoiceDay))) : null,
    deferral_days: Math.max(0, Math.round(Number(d.deferralDays) || 0)),
    pay_method: d.payMethod === "bank" || d.payMethod === "cash" ? d.payMethod : "any",
    contact_name: cleanText(d.contactName, 200),
    phone: cleanText(d.phone, 40),
    email: cleanText(d.email, 120),
    inn: cleanText(d.inn, 40),
    comment: cleanText(d.comment),
    status: d.status === "archived" ? "archived" : "active",
  };
  if (includeElectricityTariff) {
    payload.electricity_tariff = electricityTariff;
  }
  return payload;
}

export async function createRentTenant(data: RentTenantInput): Promise<{ id: string }> {
  const db = getAdminDb();
  let { data: result, error } = await db
    .from("rent_tenants")
    .insert(tenantPayload(data, true))
    .select("id")
    .single();
  if (error && isMissingColumnOrTableError(error)) {
    const retry = await db
      .from("rent_tenants")
      .insert(tenantPayload(data, false))
      .select("id")
      .single();
    result = retry.data;
    error = retry.error;
    if (!error && result?.id && data.electricityTariff != null) {
      const fb = await getElectricityFallbackState();
      await saveElectricityFallbackState({
        ...fb,
        tariffs: {
          ...(fb.tariffs || {}),
          [result.id]: roundMoney2(Number(data.electricityTariff) || DEFAULT_ELECTRICITY_TARIFF),
        },
      });
    }
  }
  if (error || !result) throw error || new Error("Не удалось создать арендатора");
  bumpRent();
  return { id: result.id };
}

export async function updateRentTenant(id: string, data: RentTenantInput): Promise<void> {
  const db = getAdminDb();
  let { error } = await db
    .from("rent_tenants")
    .update(tenantPayload(data, true))
    .eq("id", id);
  if (error && isMissingColumnOrTableError(error)) {
    const retry = await db
      .from("rent_tenants")
      .update(tenantPayload(data, false))
      .eq("id", id);
    error = retry.error;
    if (!error && data.electricityTariff != null) {
      const fb = await getElectricityFallbackState();
      await saveElectricityFallbackState({
        ...fb,
        tariffs: {
          ...(fb.tariffs || {}),
          [id]: roundMoney2(Number(data.electricityTariff) || DEFAULT_ELECTRICITY_TARIFF),
        },
      });
    }
  }
  if (error) throw error;
  bumpRent();
}

export async function updateTenantElectricityTariff(
  tenantId: string,
  tariff: number
): Promise<void> {
  const cleanTariff = roundMoney2(Number(tariff));
  if (!Number.isFinite(cleanTariff) || cleanTariff <= 0) {
    throw new Error("Тариф должен быть больше 0");
  }
  const db = getAdminDb();
  const { error } = await db
    .from("rent_tenants")
    .update({ electricity_tariff: cleanTariff })
    .eq("id", tenantId);
  if (error && isMissingColumnOrTableError(error)) {
    const fb = await getElectricityFallbackState();
    await saveElectricityFallbackState({
      ...fb,
      tariffs: { ...(fb.tariffs || {}), [tenantId]: cleanTariff },
    });
    bumpRent();
    return;
  }
  if (error) throw error;
  bumpRent();
}

export async function deleteRentTenant(id: string): Promise<void> {
  const db = getAdminDb();
  const { count, error: countError } = await db
    .from("rent_invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", id);
  if (countError) throw countError;
  if ((count || 0) > 0) {
    throw new Error(
      "По арендатору есть начисления — сначала отмените их или переведите арендатора в архив"
    );
  }
  const { error } = await db.from("rent_tenants").delete().eq("id", id);
  if (error) throw error;
  bumpRent();
}

// ── Начисления (счета) ───────────────────────────────────

function mapInvoice(row: any): RentInvoice {
  const comment = row.comment ?? null;
  const kind: "rent" | "electricity" =
    row.kind === "electricity" || isElectricityInvoice({ comment, kind: row.kind })
      ? "electricity"
      : "rent";
  return {
    id: row.id,
    number: Number(row.number) || 0,
    tenantId: row.tenant_id,
    orgId: row.org_id,
    accountOrgId: row.account_org_id,
    kind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    amount: Number(row.amount) || 0,
    status: row.status === "paid" || row.status === "cancelled" ? row.status : "awaiting",
    paidAt: row.paid_at ?? null,
    payMethod: row.pay_method === "bank" || row.pay_method === "cash" ? row.pay_method : null,
    comment,
  };
}

export async function getRentInvoices(): Promise<RentInvoice[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("rent_invoices")
    .select("*")
    .order("due_date", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapInvoice);
}

export interface RentInvoiceInput {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  issueDate?: string | null;
  dueDate?: string | null;
  amount: number;
  comment?: string | null;
}

/** Крайняя дата оплаты периода: день оплаты в месяце начала периода. */
export function defaultInvoiceDates(
  tenant: RentTenant,
  orgs: RentOrg[],
  periodStartIso: string
): { issueDate: string; dueDate: string } {
  const start = rentParseDate(periodStartIso);
  const dueDay = rentDueDay(tenant, orgs);
  const invDay = rentInvoiceDay(tenant, orgs);
  const dueDate = rentClampDay(start.getFullYear(), start.getMonth(), dueDay);
  // Счёт выставляем в предыдущем месяце (25.07 → оплата 03.08).
  const prev = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const issueDate = rentClampDay(prev.getFullYear(), prev.getMonth(), invDay);
  return { issueDate, dueDate };
}

export async function createRentInvoice(
  input: RentInvoiceInput
): Promise<{ id: string; number: number }> {
  const db = getAdminDb();
  const tenants = await getRentTenants();
  const orgs = await getRentOrgs();
  const tenant = tenants.find((t) => t.id === input.tenantId);
  if (!tenant) throw new Error("Арендатор не найден");

  const periodStart = String(input.periodStart || "").slice(0, 10);
  const periodEnd = String(input.periodEnd || "").slice(0, 10);
  if (!periodStart || !periodEnd || periodEnd < periodStart) {
    throw new Error("Укажите корректный период аренды");
  }
  const amount = Number(input.amount) || 0;
  if (amount <= 0) throw new Error("Укажите сумму начисления");

  const defaults = defaultInvoiceDates(tenant, orgs, periodStart);
  const number = await nextNumber("rent_invoice");
  const { data: result, error } = await db
    .from("rent_invoices")
    .insert({
      number,
      tenant_id: tenant.id,
      org_id: tenant.orgId,
      account_org_id: rentAccountOrgId(orgs.find((o) => o.id === tenant.orgId), orgs),
      period_start: periodStart,
      period_end: periodEnd,
      issue_date: input.issueDate ? String(input.issueDate).slice(0, 10) : defaults.issueDate,
      due_date: input.dueDate ? String(input.dueDate).slice(0, 10) : defaults.dueDate,
      amount,
      status: "awaiting",
      comment: cleanText(input.comment),
    })
    .select("id")
    .single();
  if (error) throw error;
  bumpRent();
  return { id: result.id, number };
}

export async function updateRentInvoice(
  id: string,
  data: Partial<{
    periodStart: string;
    periodEnd: string;
    issueDate: string;
    dueDate: string;
    amount: number;
    status: RentInvoice["status"];
    comment: string | null;
  }>
): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = {};
  const day = (v: string | null | undefined) =>
    v ? String(v).slice(0, 10) : null;
  if (data.periodStart !== undefined && day(data.periodStart)) payload.period_start = day(data.periodStart);
  if (data.periodEnd !== undefined && day(data.periodEnd)) payload.period_end = day(data.periodEnd);
  if (data.issueDate !== undefined && day(data.issueDate)) payload.issue_date = day(data.issueDate);
  if (data.dueDate !== undefined && day(data.dueDate)) payload.due_date = day(data.dueDate);
  if (data.amount !== undefined) payload.amount = Number(data.amount) || 0;
  if (data.comment !== undefined) payload.comment = cleanText(data.comment);
  if (data.status !== undefined) {
    payload.status = data.status;
    if (data.status === "paid") {
      payload.paid_at = payload.paid_at || rentTodayIso();
    } else {
      payload.paid_at = null;
      payload.pay_method = null;
    }
  }
  const { error } = await db.from("rent_invoices").update(payload).eq("id", id);
  if (error) throw error;
  bumpRent();
}

export async function deleteRentInvoice(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: invoice } = await db
    .from("rent_invoices")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) throw new Error("Начисление не найдено");
  if (invoice.status === "paid") {
    throw new Error("Нельзя удалить оплаченное начисление — отмените связанный платёж");
  }
  await db.from("rent_payments").update({ invoice_id: null }).eq("invoice_id", id);
  const { error } = await db.from("rent_invoices").delete().eq("id", id);
  if (error) throw error;
  bumpRent();
}

/**
 * Массовое выставление счетов за следующий период.
 * Для каждого активного арендатора берётся конец последнего
 * начисления и создаётся следующий период (с учётом его шага:
 * месяц/квартал/полгода/...). Даты оплаты и счёта считаются по
 * правилам арендатора (день оплаты, отсрочка не влияет на дату).
 */
export async function generateRentInvoices(): Promise<{
  created: number;
  skipped: number;
}> {
  const db = getAdminDb();
  const [tenants, invoices, orgs] = await Promise.all([
    getRentTenants(),
    getRentInvoices(),
    getRentOrgs(),
  ]);
  const today = rentTodayIso();
  let created = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    if (tenant.status !== "active" || tenant.monthlyRent <= 0) {
      skipped++;
      continue;
    }
    const own = invoices
      .filter(
        (i) =>
          i.tenantId === tenant.id &&
          i.status !== "cancelled" &&
          !isElectricityInvoice(i)
      )
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const last = own[own.length - 1];

    // Горизонт: выставляем счета только за периоды, которые начинаются
    // не позже начала следующего месяца (счёт 25.07 → период с 01.08).
    const horizon = new Date();
    horizon.setDate(1);
    horizon.setMonth(horizon.getMonth() + 1);
    const horizonIso = rentToIso(horizon);

    let startIso: string;
    if (last) {
      startIso = rentToIso(new Date(rentParseDate(last.periodEnd).getTime() + 86_400_000));
      if (startIso > horizonIso) {
        skipped++; // Период оплачен наперёд — выставлять ещё рано.
        continue;
      }
      if (own.some((i) => i.status === "awaiting" && i.periodStart === startIso)) {
        skipped++; // Счёт за этот период уже выставлен.
        continue;
      }
    } else if (tenant.contractDate && tenant.contractDate >= today) {
      startIso = tenant.contractDate;
    } else {
      // Первый счёт: с 1-го числа следующего месяца.
      startIso = horizonIso;
    }

    const endD = new Date(rentAddMonths(startIso, tenant.periodMonths).getTime() - 86_400_000);
    const dates = defaultInvoiceDates(tenant, orgs, startIso);
    const amount = tenant.monthlyRent * tenant.periodMonths;
    const number = await nextNumber("rent_invoice");
    const { error } = await db.from("rent_invoices").insert({
      number,
      tenant_id: tenant.id,
      org_id: tenant.orgId,
      account_org_id: rentAccountOrgId(orgs.find((o) => o.id === tenant.orgId), orgs),
      period_start: startIso,
      period_end: rentToIso(endD),
      issue_date: dates.issueDate,
      due_date: dates.dueDate,
      amount,
      status: "awaiting",
      comment: null,
    });
    if (error) throw error;
    created++;
  }
  bumpRent();
  return { created, skipped };
}

// ── Банк аренды (платежи) ────────────────────────────────

function mapPayment(row: any): RentPayment {
  return {
    id: row.id,
    number: Number(row.number) || 0,
    accountOrgId: row.account_org_id,
    tenantId: row.tenant_id ?? null,
    invoiceId: row.invoice_id ?? null,
    direction: row.direction === "outgoing" ? "outgoing" : "incoming",
    kind: row.kind || "rent",
    method: row.method === "cash" ? "cash" : "bank",
    counterparty: row.counterparty || "",
    amount: Number(row.amount) || 0,
    date: row.date || "",
    invoiceNumber: row.invoice_number ?? null,
    isPaid: !!row.is_paid,
    paidAt: row.paid_at ?? null,
    excludeFromBalance: !!row.exclude_from_balance,
    comment: row.comment ?? null,
  };
}

export async function getRentPayments(): Promise<RentPayment[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("rent_payments")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapPayment);
}

/**
 * Пересчёт статуса счёта по сумме проведённых входящих платежей,
 * привязанных к нему. Управленческий учёт: поддерживаются частичные
 * оплаты — счёт закрывается, только когда связанная сумма покрывает
 * его целиком; при развязке/отмене платежа возвращается в ожидание.
 */
async function recomputeInvoiceState(invoiceId: string | null): Promise<void> {
  if (!invoiceId) return;
  const db = getAdminDb();
  const { data: invoice } = await db
    .from("rent_invoices")
    .select("amount,status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return;

  const { data: linked } = await db
    .from("rent_payments")
    .select("amount,is_paid,direction,method,date")
    .eq("invoice_id", invoiceId);
  const posted = (linked || []).filter(
    (p) => p.is_paid && p.direction === "incoming"
  );
  const paidSum = posted.reduce((s, p) => s + Number(p.amount || 0), 0);

  if (paidSum + 0.009 >= Number(invoice.amount)) {
    // Оплачен: дата и способ — по последней привязанной оплате.
    const last = [...posted].sort((a, b) =>
      String(b.date).localeCompare(String(a.date))
    )[0];
    await db
      .from("rent_invoices")
      .update({
        status: "paid",
        paid_at: last?.date || rentTodayIso(),
        pay_method: last?.method || null,
      })
      .eq("id", invoiceId);
  } else if (invoice.status === "paid") {
    // Покрытие стало меньше суммы (отмена/удаление/частичная оплата).
    await db
      .from("rent_invoices")
      .update({ status: "awaiting", paid_at: null, pay_method: null })
      .eq("id", invoiceId);
  }
}

export interface RentPaymentInput {
  accountOrgId: string;
  direction: "incoming" | "outgoing";
  kind?: string;
  method?: "bank" | "cash";
  tenantId?: string | null;
  invoiceId?: string | null;
  counterparty?: string;
  amount: number;
  date: string;
  invoiceNumber?: string | null;
  isPaid?: boolean;
  excludeFromBalance?: boolean;
  comment?: string | null;
}

export async function createRentPayment(
  input: RentPaymentInput
): Promise<{ id: string; number: number }> {
  const db = getAdminDb();
  const amount = Number(input.amount) || 0;
  if (amount <= 0) throw new Error("Укажите сумму платежа");
  const date = String(input.date || "").slice(0, 10);
  if (!date) throw new Error("Укажите дату платежа");

  let counterparty = String(input.counterparty || "").trim();
  if (input.tenantId) {
    const tenants = await getRentTenants();
    const tenant = tenants.find((t) => t.id === input.tenantId);
    if (tenant) counterparty = tenant.name;
  }
  if (!counterparty) throw new Error("Укажите арендатора или контрагента");

  const isPaid = input.isPaid === true;
  const method = input.method === "cash" ? "cash" : "bank";
  const number = await nextNumber("rent_payment");
  const { data: result, error } = await db
    .from("rent_payments")
    .insert({
      number,
      account_org_id: String(input.accountOrgId || "bau"),
      tenant_id: input.tenantId || null,
      invoice_id: input.invoiceId || null,
      direction: input.direction === "outgoing" ? "outgoing" : "incoming",
      kind: input.kind || (input.direction === "outgoing" ? "expense_other" : "rent"),
      method,
      counterparty,
      amount,
      date,
      invoice_number: cleanText(input.invoiceNumber, 60),
      is_paid: isPaid,
      paid_at: isPaid ? date : null,
      exclude_from_balance: input.excludeFromBalance === true,
      comment: cleanText(input.comment),
    })
    .select("id")
    .single();
  if (error) throw error;

  // Проведённый входящий платёж, привязанный к счёту, может закрыть счёт
  // (полностью или в составе частичных оплат).
  if (isPaid && input.direction !== "outgoing" && input.invoiceId) {
    await recomputeInvoiceState(input.invoiceId);
  }
  bumpRent();
  return { id: result.id, number };
}

export async function updateRentPayment(
  id: string,
  data: Partial<RentPaymentInput>
): Promise<void> {
  const db = getAdminDb();
  const { data: existing } = await db
    .from("rent_payments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) throw new Error("Платёж не найден");

  const payload: Record<string, any> = {};
  if (data.accountOrgId !== undefined) payload.account_org_id = String(data.accountOrgId);
  if (data.kind !== undefined) payload.kind = String(data.kind);
  if (data.method !== undefined) payload.method = data.method === "cash" ? "cash" : "bank";
  if (data.amount !== undefined) {
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new Error("Сумма должна быть больше нуля");
    payload.amount = amount;
  }
  if (data.date !== undefined) payload.date = String(data.date).slice(0, 10);
  if (data.invoiceNumber !== undefined) payload.invoice_number = cleanText(data.invoiceNumber, 60);
  if (data.comment !== undefined) payload.comment = cleanText(data.comment);
  if (data.excludeFromBalance !== undefined) payload.exclude_from_balance = data.excludeFromBalance === true;
  if (data.counterparty !== undefined) payload.counterparty = String(data.counterparty).trim();
  if (data.tenantId !== undefined) {
    payload.tenant_id = data.tenantId || null;
    if (data.tenantId) {
      const tenants = await getRentTenants();
      const tenant = tenants.find((t) => t.id === data.tenantId);
      if (tenant) payload.counterparty = tenant.name;
    }
  }

  if (data.isPaid !== undefined) {
    payload.is_paid = data.isPaid === true;
    const date = payload.date || existing.date;
    payload.paid_at = payload.is_paid ? date : null;
    if (payload.is_paid && payload.date === undefined) payload.date = date;
  }

  // Перепривязка счёта: статусы обоих затронутых счетов пересчитываются
  // по сумме привязанных проведённых платежей (частичные оплаты учтены).
  const newInvoiceId =
    data.invoiceId !== undefined ? data.invoiceId || null : existing.invoice_id;

  const { error } = await db.from("rent_payments").update(payload).eq("id", id);
  if (error) throw error;

  const oldInvoiceId = existing.invoice_id;
  if (oldInvoiceId && oldInvoiceId !== newInvoiceId) {
    await recomputeInvoiceState(oldInvoiceId);
  }
  if (newInvoiceId) {
    await recomputeInvoiceState(newInvoiceId);
  }
  bumpRent();
}

export async function deleteRentPayment(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: existing } = await db
    .from("rent_payments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) throw new Error("Платёж не найден");
  await db.from("rent_payments").delete().eq("id", id);
  if (existing.invoice_id) {
    await recomputeInvoiceState(existing.invoice_id);
  }
  bumpRent();
}

// ── Сводка для дашборда ──────────────────────────────────

export interface RentSummary {
  balances: Record<string, { bankBalance: number; cashBalance: number; balance: number }>;
  activeTenants: number;
  totalDebt: number;
  overdueSum: number;
  overdueCount: number;
  upcomingCount: number;
}

export async function getRentSummary(): Promise<RentSummary> {
  const { computeRentBalances, computeTenantState } = await import("./rent-shared");
  const today = rentTodayIso();
  const [tenants, invoices, payments] = await Promise.all([
    getRentTenants(),
    getRentInvoices(),
    getRentPayments(),
  ]);
  const balancesRaw = computeRentBalances(payments, today);
  const balances: RentSummary["balances"] = {};
  for (const [orgId, b] of Object.entries(balancesRaw)) {
    balances[orgId] = { bankBalance: b.bankBalance, cashBalance: b.cashBalance, balance: b.balance };
  }
  let totalDebt = 0;
  let overdueSum = 0;
  let overdueCount = 0;
  let upcomingCount = 0;
  for (const t of tenants.filter((x) => x.status === "active")) {
    const st = computeTenantState(t, invoices, today);
    totalDebt += st.debt;
    if (st.overdue > 0) {
      overdueSum += st.overdue;
      overdueCount++;
    }
    if (st.nextDueDate && st.nextDueDate <= rentToIso(new Date(Date.now() + 7 * 86_400_000))) {
      upcomingCount++;
    }
  }
  return {
    balances,
    activeTenants: tenants.filter((x) => x.status === "active").length,
    totalDebt,
    overdueSum,
    overdueCount,
    upcomingCount,
  };
}

// ── Электроэнергия: показания счётчиков и счета за ЭЭ ────

function mapMeterReading(row: any): RentMeterReading {
  const period = normalizeElectricityPeriod(String(row.period || ""));
  const tariff =
    Number(row.tariff) > 0
      ? roundMoney2(Number(row.tariff))
      : DEFAULT_ELECTRICITY_TARIFF;
  const readingStart =
    row.reading_start != null && row.reading_start !== ""
      ? roundReading1(Number(row.reading_start))
      : row.readingStart != null && row.readingStart !== ""
        ? roundReading1(Number(row.readingStart))
        : null;
  const readingEnd =
    row.reading_end != null && row.reading_end !== ""
      ? roundReading1(Number(row.reading_end))
      : row.readingEnd != null && row.readingEnd !== ""
        ? roundReading1(Number(row.readingEnd))
        : null;
  const calc = calcElectricityReading(readingStart, readingEnd, tariff);
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id || row.tenantId),
    period,
    tariff,
    readingStart,
    readingEnd,
    consumption:
      readingStart != null && readingEnd != null
        ? calc.consumption
        : Number(row.consumption) || 0,
    amount:
      readingStart != null && readingEnd != null
        ? calc.amount
        : Number(row.amount) || 0,
    invoiceId: row.invoice_id ?? row.invoiceId ?? null,
    comment: row.comment ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

export async function getRentMeterReadings(
  periodFilter?: string
): Promise<RentMeterReading[]> {
  const db = getAdminDb();
  const normFilter = periodFilter
    ? normalizeElectricityPeriod(periodFilter)
    : null;

  let query = db
    .from("rent_meter_readings")
    .select("*")
    .order("period", { ascending: false });
  if (normFilter) {
    query = query.eq("period", normFilter);
  }
  const { data, error } = await query;

  if (error) {
    if (isMissingColumnOrTableError(error)) {
      const fb = await getElectricityFallbackState();
      const list = (fb.readings || []).map(mapMeterReading);
      return normFilter
        ? list.filter((r) => r.period === normFilter)
        : list.sort((a, b) => b.period.localeCompare(a.period));
    }
    throw error;
  }

  const dbRows = (data || []).map(mapMeterReading);
  // Если в fallback-хранилище были записи до миграции, объединяем их по (tenantId, period).
  const fb = await getElectricityFallbackState();
  if (fb.readings && fb.readings.length > 0) {
    const seen = new Set(dbRows.map((r) => `${r.tenantId}:${r.period}`));
    for (const raw of fb.readings) {
      const mapped = mapMeterReading(raw);
      if (normFilter && mapped.period !== normFilter) continue;
      if (!seen.has(`${mapped.tenantId}:${mapped.period}`)) {
        dbRows.push(mapped);
      }
    }
  }
  return dbRows.sort((a, b) => b.period.localeCompare(a.period));
}

export interface RentMeterReadingInput {
  id?: string;
  tenantId: string;
  period: string;
  tariff?: number;
  readingStart?: number | null;
  readingEnd?: number | null;
  comment?: string | null;
  /** Обновить ли базовый тариф арендатора при сохранении */
  updateTenantTariff?: boolean;
  /** Автоматически создать/обновить счёт за ЭЭ в rent_invoices (по умолчанию true) */
  syncInvoice?: boolean;
}

async function syncElectricityInvoiceForReading(opts: {
  tenant: RentTenant;
  orgs: RentOrg[];
  invoices: RentInvoice[];
  period: string;
  readingStart: number | null;
  readingEnd: number | null;
  tariff: number;
  consumption: number;
  amount: number;
  existingInvoiceId: string | null;
  comment: string | null;
}): Promise<{ invoiceId: string | null; created: boolean; updated: boolean }> {
  const db = getAdminDb();
  const {
    tenant,
    orgs,
    invoices,
    period,
    readingStart,
    readingEnd,
    tariff,
    consumption,
    amount,
    existingInvoiceId,
    comment,
  } = opts;

  const existing =
    (existingInvoiceId
      ? invoices.find((i) => i.id === existingInvoiceId)
      : null) ||
    invoices.find(
      (i) =>
        i.tenantId === tenant.id &&
        i.periodStart === period &&
        isElectricityInvoice(i) &&
        i.status !== "cancelled"
    ) ||
    null;

  if (readingStart == null || readingEnd == null || amount <= 0) {
    return {
      invoiceId: existing?.id ?? null,
      created: false,
      updated: false,
    };
  }

  const invComment = composeElectricityInvoiceComment({
    period,
    readingStart,
    readingEnd,
    consumption,
    tariff,
    extra: comment,
  });

  if (existing) {
    if (existing.status !== "paid") {
      const { error } = await db
        .from("rent_invoices")
        .update({
          amount,
          comment: invComment,
        })
        .eq("id", existing.id);
      if (error) throw error;
      return { invoiceId: existing.id, created: false, updated: true };
    }
    return { invoiceId: existing.id, created: false, updated: false };
  }

  const periodEnd = electricityPeriodEndIso(period);
  const today = rentTodayIso();
  const dueDay = rentDueDay(tenant, orgs);
  // Показания за месяц обычно снимаются в конце расчётного месяца или начале следующего:
  // ставим срок оплаты в следующем за расчётным месяце (или не раньше сегодняшнего дня).
  const nextMonthDate = rentAddMonths(period, 1);
  let dueDate = rentClampDay(
    nextMonthDate.getFullYear(),
    nextMonthDate.getMonth(),
    dueDay
  );
  if (dueDate < today) {
    const [ty, tm] = today.split("-").map(Number);
    const candidate = rentClampDay(ty, (tm || 1) - 1, dueDay);
    dueDate =
      candidate >= today
        ? candidate
        : rentToIso(new Date(Date.now() + 5 * 86_400_000));
  }

  const number = await nextNumber("rent_invoice");
  const baseInsert = {
    number,
    tenant_id: tenant.id,
    org_id: tenant.orgId,
    account_org_id: rentAccountOrgId(
      orgs.find((o) => o.id === tenant.orgId),
      orgs
    ),
    period_start: period,
    period_end: periodEnd,
    issue_date: today,
    due_date: dueDate,
    amount,
    status: "awaiting",
    comment: invComment,
  };

  let { data: createdRow, error } = await db
    .from("rent_invoices")
    .insert({ ...baseInsert, kind: "electricity" })
    .select("id")
    .single();
  if (error && isMissingColumnOrTableError(error)) {
    const retry = await db
      .from("rent_invoices")
      .insert(baseInsert)
      .select("id")
      .single();
    createdRow = retry.data;
    error = retry.error;
  }
  if (error || !createdRow) throw error || new Error("Не удалось создать счёт за ЭЭ");

  // Добавляем в локальный массив, чтобы при пакетном сохранении не создать дубликат
  invoices.push({
    id: createdRow.id,
    number,
    tenantId: tenant.id,
    orgId: tenant.orgId,
    accountOrgId: baseInsert.account_org_id,
    kind: "electricity",
    periodStart: period,
    periodEnd,
    issueDate: today,
    dueDate,
    amount,
    status: "awaiting",
    paidAt: null,
    payMethod: null,
    comment: invComment,
  });

  return { invoiceId: createdRow.id, created: true, updated: false };
}

export async function bulkUpsertRentMeterReadings(
  items: RentMeterReadingInput[]
): Promise<{
  readings: RentMeterReading[];
  invoicesCreated: number;
  invoicesUpdated: number;
}> {
  if (!Array.isArray(items) || items.length === 0) {
    return { readings: [], invoicesCreated: 0, invoicesUpdated: 0 };
  }

  const db = getAdminDb();
  const [tenants, orgs, invoices, allExistingReadings] = await Promise.all([
    getRentTenants(),
    getRentOrgs(),
    getRentInvoices(),
    getRentMeterReadings(),
  ]);
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const savedReadings: RentMeterReading[] = [];
  let invoicesCreated = 0;
  let invoicesUpdated = 0;

  for (const raw of items) {
    const tenant = tenantById.get(raw.tenantId);
    if (!tenant) {
      throw new Error(`Арендатор не найден (${raw.tenantId})`);
    }
    const period = normalizeElectricityPeriod(raw.period);
    const tariff =
      raw.tariff != null
        ? roundMoney2(Number(raw.tariff))
        : tenant.electricityTariff || DEFAULT_ELECTRICITY_TARIFF;
    if (!Number.isFinite(tariff) || tariff <= 0) {
      throw new Error(`Тариф для «${tenant.name}» должен быть больше 0`);
    }

    const existingReading = allExistingReadings.find(
      (r) => r.tenantId === tenant.id && r.period === period
    );

    // Автоматическая подстановка начального показания из предыдущего месяца,
    // если оно не передано явно
    let readingStart: number | null =
      raw.readingStart !== undefined
        ? raw.readingStart != null
          ? roundReading1(Number(raw.readingStart))
          : null
        : existingReading?.readingStart ?? null;

    if (readingStart == null && raw.readingStart === undefined) {
      const prev = allExistingReadings
        .filter(
          (r) =>
            r.tenantId === tenant.id &&
            r.period < period &&
            r.readingEnd != null
        )
        .sort((a, b) => b.period.localeCompare(a.period))[0];
      if (prev && prev.readingEnd != null) {
        readingStart = prev.readingEnd;
      }
    }

    const readingEnd: number | null =
      raw.readingEnd !== undefined
        ? raw.readingEnd != null
          ? roundReading1(Number(raw.readingEnd))
          : null
        : existingReading?.readingEnd ?? null;

    let consumption = 0;
    let amount = 0;
    if (readingStart != null && readingEnd != null) {
      if (readingEnd < readingStart) {
        throw new Error(
          `«${tenant.name}»: конечное показание (${readingEnd}) не может быть меньше начального (${readingStart})`
        );
      }
      const calc = calcElectricityReading(readingStart, readingEnd, tariff);
      consumption = calc.consumption;
      amount = calc.amount;
    }

    if (raw.updateTenantTariff !== false && tariff !== tenant.electricityTariff) {
      await updateTenantElectricityTariff(tenant.id, tariff);
      tenant.electricityTariff = tariff;
    }

    let invoiceId = existingReading?.invoiceId ?? null;
    if (raw.syncInvoice !== false && readingStart != null && readingEnd != null && amount > 0) {
      const invRes = await syncElectricityInvoiceForReading({
        tenant,
        orgs,
        invoices,
        period,
        readingStart,
        readingEnd,
        tariff,
        consumption,
        amount,
        existingInvoiceId: invoiceId,
        comment: raw.comment ?? existingReading?.comment ?? null,
      });
      invoiceId = invRes.invoiceId;
      if (invRes.created) invoicesCreated++;
      if (invRes.updated) invoicesUpdated++;
    }

    const comment =
      raw.comment !== undefined
        ? cleanText(raw.comment)
        : existingReading?.comment ?? null;

    const dbPayload = {
      tenant_id: tenant.id,
      period,
      tariff,
      reading_start: readingStart,
      reading_end: readingEnd,
      consumption,
      amount,
      invoice_id: invoiceId,
      comment,
    };

    const { data: upserted, error } = await db
      .from("rent_meter_readings")
      .upsert(dbPayload, { onConflict: "tenant_id,period" })
      .select("*")
      .single();

    if (error) {
      if (isMissingColumnOrTableError(error)) {
        const fb = await getElectricityFallbackState();
        const list = [...(fb.readings || [])];
        const nowIso = new Date().toISOString();
        const idx = list.findIndex(
          (r) =>
            r.tenantId === tenant.id &&
            normalizeElectricityPeriod(r.period) === period
        );
        const record: RentMeterReading = {
          id:
            idx >= 0
              ? list[idx].id
              : existingReading?.id ||
                `el-${tenant.id.slice(0, 8)}-${period.slice(0, 7)}`,
          tenantId: tenant.id,
          period,
          tariff,
          readingStart,
          readingEnd,
          consumption,
          amount,
          invoiceId,
          comment,
          createdAt: idx >= 0 ? list[idx].createdAt : nowIso,
          updatedAt: nowIso,
        };
        if (idx >= 0) list[idx] = record;
        else list.push(record);
        await saveElectricityFallbackState({ ...fb, readings: list });
        savedReadings.push(record);

        const memIdx = allExistingReadings.findIndex(
          (r) => r.tenantId === tenant.id && r.period === period
        );
        if (memIdx >= 0) allExistingReadings[memIdx] = record;
        else allExistingReadings.push(record);
        continue;
      }
      throw error;
    }

    const mapped = mapMeterReading(upserted);
    savedReadings.push(mapped);
    const memIdx = allExistingReadings.findIndex(
      (r) => r.tenantId === tenant.id && r.period === period
    );
    if (memIdx >= 0) allExistingReadings[memIdx] = mapped;
    else allExistingReadings.push(mapped);
  }

  bumpRent();
  return { readings: savedReadings, invoicesCreated, invoicesUpdated };
}

export async function updateRentMeterReadingById(
  id: string,
  patch: Partial<RentMeterReadingInput>
): Promise<RentMeterReading> {
  const all = await getRentMeterReadings();
  const existing = all.find((r) => r.id === id);
  if (!existing) {
    throw new Error("Запись показаний не найдена");
  }
  const { readings } = await bulkUpsertRentMeterReadings([
    {
      id: existing.id,
      tenantId: patch.tenantId || existing.tenantId,
      period: patch.period || existing.period,
      tariff: patch.tariff !== undefined ? patch.tariff : existing.tariff,
      readingStart:
        patch.readingStart !== undefined
          ? patch.readingStart
          : existing.readingStart,
      readingEnd:
        patch.readingEnd !== undefined
          ? patch.readingEnd
          : existing.readingEnd,
      comment:
        patch.comment !== undefined ? patch.comment : existing.comment,
      updateTenantTariff: patch.updateTenantTariff ?? false,
      syncInvoice: patch.syncInvoice ?? true,
    },
  ]);
  return readings[0];
}

export async function deleteRentMeterReading(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db
    .from("rent_meter_readings")
    .delete()
    .eq("id", id);
  if (error && !isMissingColumnOrTableError(error)) {
    throw error;
  }
  const fb = await getElectricityFallbackState();
  if (fb.readings?.some((r) => r.id === id)) {
    await saveElectricityFallbackState({
      ...fb,
      readings: fb.readings.filter((r) => r.id !== id),
    });
  }
  bumpRent();
}

