// =========================================================
// FILE: src/lib/wastepaper-account.ts
// Отдельный учёт макулатуры — серверный доступ к данным.
// Модуль полностью автономен: не связан с сайтом (orders) и
// товарным учётом (warehouse). Доступ к API — только у ролей
// admin и wastepaper (макулатурщик).
// =========================================================

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/supabase";
import { requireAdminApi, type AdminSession } from "@/lib/auth";
import { getWastepaperRates } from "@/lib/supabase-queries";
import { getSalaries } from "@/lib/warehouse";
import { isWastepaperSalary, type Salary } from "@/lib/warehouse-shared";
import type {
  WpAccount,
  WpBranch,
  WpCounterparty,
  WpDocItem,
  WpIntake,
  WpManualPayment,
  WpShipment,
  WpTransport,
  WpTransportItem,
  WpProduct,
} from "@/lib/wastepaper-account-shared";
import {
  WP_TRANSPORT_STATUS_LABELS,
  findWpBranchByAddress,
  normalizeWpBranches,
  normalizeWpDocItems,
  wpDocTotals,
  wpUid,
  type WpTransportStatus,
} from "@/lib/wastepaper-account-shared";

export const WP_TAG = "wastepaper-account";

function mapWpProduct(row: any): WpProduct {
  return { id: row.id, name: String(row.name || ""), pricePerKg: Number(row.price_per_kg) || 0, isActive: row.is_active !== false, createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at) };
}

export async function getWpProducts(): Promise<WpProduct[]> {
  const { data, error } = await getAdminDb().from("wp_products").select("*").order("name");
  if (error) throw error;
  return (data || []).map(mapWpProduct);
}

export async function upsertWpProduct(data: { id?: string; name: string; pricePerKg: number; isActive?: boolean }): Promise<WpProduct> {
  const name = String(data.name || "").trim().slice(0, 200);
  if (!name) throw new Error("Укажите вид макулатуры");
  const payload = { name, price_per_kg: Math.max(0, Number(data.pricePerKg) || 0), is_active: data.isActive !== false, updated_at: new Date().toISOString() };
  const db = getAdminDb();
  const result = data.id
    ? await db.from("wp_products").update(payload).eq("id", data.id).select("*").single()
    : await db.from("wp_products").insert(payload).select("*").single();
  if (result.error) throw result.error;
  bumpWpCaches();
  return mapWpProduct(result.data);
}

export async function deleteWpProduct(id: string): Promise<void> {
  const { error } = await getAdminDb().from("wp_products").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  bumpWpCaches();
}

// ── Доступ к модулю ──────────────────────────────────────

/** Единая проверка доступа к API модуля макулатуры. */
export async function requireWastepaperApi(): Promise<AdminSession | NextResponse> {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin" && auth.role !== "wastepaper") {
    return NextResponse.json(
      { error: "Недостаточно прав (модуль «Учёт макулатуры»)" },
      { status: 403 }
    );
  }
  return auth;
}

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

function toDateStr(raw: any): string {
  return String(raw || "").slice(0, 10);
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

function bumpWpCaches() {
  revalidateTag(WP_TAG, { expire: 0 });
}

// ── Контрагенты ──────────────────────────────────────────

/**
 * Точки контрагента: из JSONB branches; если их нет, но заполнены
 * старые одиночные адрес/телефон/контакт — синтезируем одну точку,
 * чтобы существующие записи не потеряли данные.
 */
function branchesFromRow(row: any): WpBranch[] {
  const parsed = normalizeWpBranches(row?.branches);
  if (parsed.length > 0) return parsed;
  const address = String(row?.address || "").trim();
  const phone = String(row?.phone || "").trim();
  const contactPerson = String(row?.contact_person || "").trim();
  if (!address && !phone && !contactPerson) return [];
  return [{ id: "br-legacy", label: "", address, contactPerson, phone }];
}

function mapCounterparty(row: any): WpCounterparty {
  const branches = branchesFromRow(row);
  const first = branches[0] || null;
  return {
    id: row.id,
    name: row.name || "",
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
    phone: first?.phone || row.phone || null,
    address: first?.address || row.address || null,
    contactPerson: first?.contactPerson || row.contact_person || null,
    branches,
    inn: row.inn || null,
    comment: row.comment || null,
    paymentDetails: row.payment_details || null,
    createdBy: row.created_by || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getWpCounterparties(): Promise<WpCounterparty[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("wp_counterparties")
    .select("*")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data || []).map(mapCounterparty);
}

/** Нормализует точку из произвольного входа формы. */
function cleanBranch(raw: Partial<WpBranch> | null | undefined): WpBranch | null {
  if (!raw) return null;
  const address = String(raw.address || "").trim().slice(0, 400);
  const phone = String(raw.phone || "").trim().slice(0, 60);
  const contactPerson = String(raw.contactPerson || "").trim().slice(0, 200);
  const label = String(raw.label || "").trim().slice(0, 120);
  if (!address && !phone && !contactPerson) return null;
  return { id: String(raw.id || wpUid("br")), label, address, contactPerson, phone };
}

function cleanBranches(raw: unknown): WpBranch[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WpBranch[] = [];
  for (const b of raw) {
    const branch = cleanBranch(b as Partial<WpBranch>);
    if (!branch) continue;
    // Убираем только полные дубли (адрес+телефон+контакт). Один адрес может
    // иметь несколько разных контактов — их сохраняем.
    const key = `${branch.address.trim().toLowerCase()}|${branch.phone
      .trim()
      .toLowerCase()}|${branch.contactPerson.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(branch);
  }
  return out;
}

/**
 * Поля контрагента для записи: список точек + «зеркало» первой точки
 * в одиночные колонки phone/address/contact_person (для совместимости
 * и быстрых подписей в списках).
 */
function counterpartyBranchPayload(branches: WpBranch[]) {
  const first = branches[0] || null;
  return {
    branches,
    phone: first?.phone || null,
    address: first?.address || null,
    contact_person: first?.contactPerson || null,
  };
}

/** Найти контрагента по имени или создать нового (роль дополняется). */
export async function ensureWpCounterparty(
  name: string,
  role: "supplier" | "enterprise",
  extra: {
    phone?: string;
    address?: string;
    contactPerson?: string;
    label?: string;
    branches?: WpBranch[];
  } = {}
): Promise<WpCounterparty> {
  const db = getAdminDb();
  const clean = String(name || "").trim().slice(0, 200);
  if (!clean) throw new Error("Укажите контрагента");
  // Точка из одиночных полей extra (если заданы).
  const extraBranch = cleanBranch({
    address: extra.address,
    phone: extra.phone,
    contactPerson: extra.contactPerson,
    label: extra.label,
  });
  const { data: found } = await db
    .from("wp_counterparties")
    .select("*")
    .ilike("name", clean)
    .limit(1)
    .maybeSingle();
  if (found) {
    const roles = new Set<string>(Array.isArray(found.roles) ? found.roles.map(String) : []);
    let branches = branchesFromRow(found);
    if (Array.isArray(extra.branches) && extra.branches.length > 0) {
      branches = cleanBranches(extra.branches);
    } else if (extraBranch && !findWpBranchByAddress(branches, extraBranch.address)) {
      branches = [...branches, extraBranch];
    }
    const patch: Record<string, any> = {
      updated_at: new Date().toISOString(),
      ...counterpartyBranchPayload(branches),
    };
    if (!roles.has(role)) {
      roles.add(role);
      patch.roles = [...roles];
    }
    await db.from("wp_counterparties").update(patch).eq("id", found.id);
    return mapCounterparty({ ...found, ...patch });
  }
  const branches = Array.isArray(extra.branches) && extra.branches.length > 0
    ? cleanBranches(extra.branches)
    : extraBranch
      ? [extraBranch]
      : [];
  const { data, error } = await db
    .from("wp_counterparties")
    .insert({
      name: clean,
      roles: [role],
      ...counterpartyBranchPayload(branches),
    })
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  return mapCounterparty(data);
}

/**
 * Добавить точку (филиал) контрагенту, если такого адреса ещё нет.
 * Используется при автосохранении нового адреса прямо из документа
 * (приём/сдача/остановка перевозки). Возвращает обновлённые точки.
 */
export async function ensureWpBranch(
  counterpartyId: string | null | undefined,
  branch: Partial<WpBranch> | null | undefined
): Promise<WpBranch[]> {
  if (!counterpartyId) return [];
  const clean = cleanBranch(branch);
  if (!clean || !clean.address) return [];
  const db = getAdminDb();
  const { data: found, error } = await db
    .from("wp_counterparties")
    .select("*")
    .eq("id", counterpartyId)
    .maybeSingle();
  if (error || !found) return [];
  const branches = branchesFromRow(found);
  const existing = findWpBranchByAddress(branches, clean.address);
  if (existing) {
    // Адрес уже есть — при необходимости дополняем телефон/контакт.
    let changed = false;
    const merged = { ...existing };
    if (clean.phone && !merged.phone) {
      merged.phone = clean.phone;
      changed = true;
    }
    if (clean.contactPerson && !merged.contactPerson) {
      merged.contactPerson = clean.contactPerson;
      changed = true;
    }
    if (!changed) return branches;
    const next = branches.map((b) => (b.id === merged.id ? merged : b));
    await db
      .from("wp_counterparties")
      .update({ ...counterpartyBranchPayload(next), updated_at: new Date().toISOString() })
      .eq("id", counterpartyId);
    bumpWpCaches();
    return next;
  }
  const next = [...branches, clean];
  await db
    .from("wp_counterparties")
    .update({ ...counterpartyBranchPayload(next), updated_at: new Date().toISOString() })
    .eq("id", counterpartyId);
  bumpWpCaches();
  return next;
}

export async function upsertWpCounterparty(data: {
  id?: string | null;
  name: string;
  roles: string[];
  phone?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  branches?: WpBranch[] | null;
  inn?: string | null;
  comment?: string | null;
  paymentDetails?: string | null;
  createdBy?: string | null;
}): Promise<WpCounterparty> {
  const db = getAdminDb();
  const name = String(data.name || "").trim().slice(0, 200);
  if (!name) throw new Error("Укажите название контрагента");
  const roles = ["supplier", "enterprise"].flatMap((r) =>
    (data.roles || []).includes(r) ? [r] : []
  );
  if (roles.length === 0) throw new Error("Укажите роль контрагента: сдаёт нам и/или принимает у нас");
  // Точки: если прислали список — берём его; иначе собираем одну из
  // одиночных полей (совместимость со старой формой).
  const branches = Array.isArray(data.branches)
    ? cleanBranches(data.branches)
    : cleanBranches([
        {
          id: "br-legacy",
          label: "",
          address: data.address,
          contactPerson: data.contactPerson,
          phone: data.phone,
        },
      ]);
  const payload = {
    name,
    roles,
    ...counterpartyBranchPayload(branches),
    inn: String(data.inn || "").trim().slice(0, 20) || null,
    comment: String(data.comment || "").trim().slice(0, 500) || null,
    payment_details: String(data.paymentDetails || "").trim().slice(0, 1000) || null,
    updated_at: new Date().toISOString(),
  };
  if (data.id) {
    const { data: row, error } = await db
      .from("wp_counterparties")
      .update(payload)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    bumpWpCaches();
    return mapCounterparty(row);
  }
  const { data: row, error } = await db
    .from("wp_counterparties")
    .insert({ ...payload, created_by: data.createdBy || null })
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  return mapCounterparty(row);
}

export async function deleteWpCounterparty(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("wp_counterparties").delete().eq("id", id);
  if (error) throw error;
  bumpWpCaches();
}

// ── Приём макулатуры ─────────────────────────────────────

/**
 * Позиции документа: из JSONB items; если их нет (старые записи) —
 * собираем одну позицию из одиночных вид/вес/цена.
 */
function docItemsFromRow(row: any): WpDocItem[] {
  const parsed = normalizeWpDocItems(row?.items);
  if (parsed.length > 0) return parsed;
  const weightKg = Number(row?.weight_kg) || 0;
  const pricePerKg = Number(row?.price_per_kg) || 0;
  if (weightKg <= 0 && pricePerKg <= 0) return [];
  return [
    {
      id: "it-legacy",
      wastepaperType: row?.wastepaper_type || "cardboard",
      weightKg,
      pricePerKg,
      total: Number(row?.total) || Math.round(weightKg * pricePerKg * 100) / 100,
    },
  ];
}

function mapIntake(row: any): WpIntake {
  const items = docItemsFromRow(row);
  const totals = wpDocTotals(items);
  const first = items[0] || null;
  return {
    id: row.id,
    number: Number(row.number) || 0,
    date: toDateStr(row.date),
    counterpartyId: row.counterparty_id || null,
    counterpartyName: row.counterparty_name || "",
    address: row.address || null,
    phone: row.phone || null,
    contactPerson: row.contact_person || null,
    items,
    wastepaperType: first?.wastepaperType || row.wastepaper_type || "cardboard",
    weightKg: items.length ? totals.weightKg : Number(row.weight_kg) || 0,
    acceptedWeightKg: Number(row.accepted_weight_kg) || (items.length ? totals.weightKg : 0),
    payableWeightKg: Number(row.payable_weight_kg) || 0,
    pricePerKg: first?.pricePerKg ?? (Number(row.price_per_kg) || 0),
    total: items.length ? totals.total : Number(row.total) || 0,
    account: (row.account === "bank" ? "bank" : "cash") as WpAccount,
    cashAmount: Number(row.cash_amount) || (row.account === "cash" ? (Number(row.total) || 0) : 0),
    bankAmount: Number(row.bank_amount) || (row.account === "bank" ? (Number(row.total) || 0) : 0),
    isPaid: Boolean(row.is_paid),
    paidAt: toIso(row.paid_at),
    transportId: row.transport_id || null,
    transportItemId: row.transport_item_id || null,
    needsTransport: Boolean(row.needs_transport),
    transportPlannedDate: row.transport_planned_date
      ? String(row.transport_planned_date).slice(0, 10)
      : null,
    awaitingWeight: Boolean(row.awaiting_weight),
    status: row.status === "cancelled" ? "cancelled" : "active",
    comment: row.comment || null,
    createdBy: row.created_by || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getWpIntakes(limit = 500): Promise<WpIntake[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("wp_intakes")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapIntake);
}

export interface WpIntakeInput {
  date: string;
  counterpartyId?: string | null;
  counterpartyName: string;
  address?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  /** Позиции документа (макулатура разных профилей). */
  items?: WpDocItem[];
  /** Одиночные поля — для совместимости / когда позиций нет. */
  wastepaperType?: string;
  weightKg?: number;
  acceptedWeightKg?: number;
  payableWeightKg?: number;
  pricePerKg?: number;
  account: WpAccount;
  cashAmount?: number;
  bankAmount?: number;
  isPaid?: boolean;
  paidAt?: string | null;
  transportId?: string | null;
  transportItemId?: string | null;
  /** TRUE — забрать нашей перевозкой (очередь перевозок учёта, «забор груза»). */
  needsTransport?: boolean;
  /** Желаемая дата вывоза (подсказка диспетчеру). */
  transportPlannedDate?: string | null;
  /**
   * Пометка «приёмка выполнена · ожидание взвешивания». Сохранение
   * карточки приёма с фактическим весом снимает её (false).
   */
  awaitingWeight?: boolean;
  comment?: string | null;
}

function cleanIntakeInput(data: WpIntakeInput) {
  const date = toDateStr(data.date);
  if (!date) throw new Error("Укажите дату приёма");
  const counterpartyName = String(data.counterpartyName || "").trim().slice(0, 200);
  if (!counterpartyName) throw new Error("Укажите, от кого приняли макулатуру");
  // Позиции: если прислали табличную часть — берём её; иначе собираем
  // одну позицию из одиночных вид/вес/цена (старая форма, транспорт).
  let items = Array.isArray(data.items) ? normalizeWpDocItems(data.items) : [];
  if (items.length === 0) {
    const weightKg = Math.max(0, Number(data.weightKg) || 0);
    const pricePerKg = Math.max(0, Number(data.pricePerKg) || 0);
    const wastepaperType =
      String(data.wastepaperType || "").trim().slice(0, 120) || "cardboard";
    if (weightKg > 0 || pricePerKg > 0) {
      items = [
        {
          id: wpUid("it"),
          wastepaperType,
          weightKg,
          pricePerKg,
          total: Math.round(weightKg * pricePerKg * 100) / 100,
        },
      ];
    }
  }
  const totals = wpDocTotals(items);
  // Вес и цена могут быть неизвестны при создании: документ заполняется
  // после фактического забора и взвешивания.
  const first = items[0];
  const address = String(data.address || "").trim().slice(0, 400) || null;
  const needsTransport = data.needsTransport === true;
  if (needsTransport && !address) {
    throw new Error("Для перевозки укажите адрес забора — куда ехать водителю");
  }
  return {
    date,
    counterparty_id: data.counterpartyId || null,
    counterparty_name: counterpartyName,
    address,
    phone: String(data.phone || "").trim().slice(0, 60) || null,
    contact_person: String(data.contactPerson || "").trim().slice(0, 200) || null,
    items,
    wastepaper_type: first?.wastepaperType || "cardboard",
    weight_kg: totals.weightKg,
    accepted_weight_kg: Math.max(0, Number(data.acceptedWeightKg) || totals.weightKg),
    payable_weight_kg: Math.max(0, Number(data.payableWeightKg) || 0),
    price_per_kg: first?.pricePerKg ?? 0,
    total: totals.total,
    account: data.account === "bank" ? "bank" : "cash",
    cash_amount: Math.max(0, Number(data.cashAmount) || (data.account === "cash" ? totals.total : 0)),
    bank_amount: Math.max(0, Number(data.bankAmount) || (data.account === "bank" ? totals.total : 0)),
    needs_transport: needsTransport,
    transport_planned_date: data.transportPlannedDate
      ? String(data.transportPlannedDate).slice(0, 10)
      : null,
    comment: String(data.comment || "").trim().slice(0, 500) || null,
  };
}

export async function createWpIntake(
  data: WpIntakeInput,
  createdBy: string
): Promise<WpIntake> {
  const db = getAdminDb();
  const fields = cleanIntakeInput(data);
  const number = await nextNumber("wp_intake");
  const isPaid = Boolean(data.isPaid);
  const { data: row, error } = await db
    .from("wp_intakes")
    .insert({
      ...fields,
      number,
      is_paid: isPaid,
      paid_at: isPaid ? data.paidAt || new Date().toISOString() : null,
      transport_id: data.transportId || null,
      transport_item_id: data.transportItemId || null,
      status: "active",
      created_by: createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  return mapIntake(row);
}

export async function updateWpIntake(
  id: string,
  data: Partial<WpIntakeInput> & { isPaid?: boolean }
): Promise<WpIntake> {
  const db = getAdminDb();
  const { data: existing, error: existErr } = await db
    .from("wp_intakes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (existErr || !existing) throw new Error("Приём не найден");
  const merged = cleanIntakeInput({
    date: data.date ?? toDateStr(existing.date),
    counterpartyId: data.counterpartyId !== undefined ? data.counterpartyId : existing.counterparty_id,
    counterpartyName: data.counterpartyName ?? existing.counterparty_name,
    address: data.address !== undefined ? data.address : existing.address,
    phone: data.phone !== undefined ? data.phone : existing.phone,
    contactPerson:
      data.contactPerson !== undefined ? data.contactPerson : existing.contact_person,
    items:
      data.items !== undefined
        ? data.items
        : (normalizeWpDocItems(existing.items) as WpDocItem[]),
    wastepaperType: data.wastepaperType ?? existing.wastepaper_type,
    weightKg: data.weightKg ?? (Number(existing.weight_kg) || 0),
    // Фактические веса («на склад» и «к оплате») обязательно пробрасываем:
    // иначе любое сохранение карточки — и даже простое переключение
    // «оплачен» / «в перевозку» — откатывало их к сумме позиций / нулю.
    acceptedWeightKg:
      data.acceptedWeightKg ?? (Number(existing.accepted_weight_kg) || 0),
    payableWeightKg:
      data.payableWeightKg ?? (Number(existing.payable_weight_kg) || 0),
    pricePerKg: data.pricePerKg ?? (Number(existing.price_per_kg) || 0),
    account: (data.account ?? (existing.account === "bank" ? "bank" : "cash")) as WpAccount,
    comment: data.comment !== undefined ? data.comment : existing.comment,
    needsTransport:
      data.needsTransport !== undefined
        ? data.needsTransport
        : Boolean(existing.needs_transport),
    transportPlannedDate:
      data.transportPlannedDate !== undefined
        ? data.transportPlannedDate
        : existing.transport_planned_date || null,
  });
  const isPaid = data.isPaid !== undefined ? Boolean(data.isPaid) : Boolean(existing.is_paid);
  // Пометка «ожидание взвешивания»: сохранение карточки приёма с весом
  // снимает её (форма всегда присылает awaitingWeight: false), а служебные
  // правки без поля — сохраняют как есть.
  const awaitingWeight =
    data.awaitingWeight !== undefined
      ? data.awaitingWeight === true
      : Boolean(existing.awaiting_weight);
  const { data: row, error } = await db
    .from("wp_intakes")
    .update({
      ...merged,
      is_paid: isPaid,
      paid_at: isPaid ? existing.paid_at || new Date().toISOString() : null,
      awaiting_weight: awaitingWeight,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  // Сняли пометку «в перевозку» — убираем приём из активных единых рейсов,
  // чтобы он не висел точкой в чужом путевом листе.
  if (Boolean(existing.needs_transport) && !merged.needs_transport) {
    await removeWpDocFromActiveTransports("intake", id);
  }
  return mapIntake(row);
}

export async function setWpIntakeCancelled(id: string, cancelled: boolean): Promise<void> {
  const db = getAdminDb();
  const { error } = await db
    .from("wp_intakes")
    .update({
      status: cancelled ? "cancelled" : "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
  bumpWpCaches();
  // Отменённый приём не едет: убираем из активных единых рейсов.
  // При восстановлении он сам вернётся в очередь (needs_transport сохранён).
  if (cancelled) await removeWpDocFromActiveTransports("intake", id);
}

export async function deleteWpIntake(id: string): Promise<void> {
  const db = getAdminDb();
  // Убираем из активных ЕДИНЫХ рейсов (transports учёта).
  await removeWpDocFromActiveTransports("intake", id);
  // Если приём создан перевозкой — отвязываем остановку, чтобы её можно
  // было оформить заново.
  const { data: intake } = await db
    .from("wp_intakes")
    .select("transport_id, transport_item_id")
    .eq("id", id)
    .maybeSingle();
  if (intake?.transport_id && intake.transport_item_id) {
    try {
      const { data: transport } = await db
        .from("wp_transports")
        .select("items")
        .eq("id", intake.transport_id)
        .maybeSingle();
      const items = normalizeTransportItems(transport?.items);
      items.forEach((item) => {
        if (item.id === intake.transport_item_id) item.intakeId = null;
      });
      await db
        .from("wp_transports")
        .update({ items, updated_at: new Date().toISOString() })
        .eq("id", intake.transport_id);
    } catch (e) {
      console.error("deleteWpIntake: отвязка от перевозки:", e);
    }
  }
  const { error } = await db.from("wp_intakes").delete().eq("id", id);
  if (error) throw error;
  bumpWpCaches();
}

// ── Сдача на предприятие ─────────────────────────────────

function mapShipment(row: any): WpShipment {
  const items = docItemsFromRow(row);
  const totals = wpDocTotals(items);
  const first = items[0] || null;
  return {
    id: row.id,
    number: Number(row.number) || 0,
    date: toDateStr(row.date),
    enterpriseId: row.enterprise_id || null,
    enterpriseName: row.enterprise_name || "",
    address: row.address || null,
    phone: row.phone || null,
    contactPerson: row.contact_person || null,
    items,
    wastepaperType: first?.wastepaperType || row.wastepaper_type || "cardboard",
    weightKg: items.length ? totals.weightKg : Number(row.weight_kg) || 0,
    shippedWeightKg: Number(row.shipped_weight_kg) || 0,
    acceptedWeightKg: Number(row.accepted_weight_kg) || 0,
    receivedAmount: Number(row.received_amount) || 0,
    bankPostedAt: toIso(row.bank_posted_at),
    pricePerKg: first?.pricePerKg ?? (Number(row.price_per_kg) || 0),
    total: items.length ? totals.total : Number(row.total) || 0,
    account: (row.account === "cash" ? "cash" : "bank") as WpAccount,
    isPaid: Boolean(row.is_paid),
    paidAt: toIso(row.paid_at),
    needsTransport: Boolean(row.needs_transport),
    transportPlannedDate: row.transport_planned_date
      ? String(row.transport_planned_date).slice(0, 10)
      : null,
    status: row.status === "cancelled" ? "cancelled" : "active",
    comment: row.comment || null,
    createdBy: row.created_by || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getWpShipments(limit = 500): Promise<WpShipment[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("wp_shipments")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapShipment);
}

export interface WpShipmentInput {
  date: string;
  enterpriseId?: string | null;
  enterpriseName: string;
  address?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  /** Позиции документа (макулатура разных профилей). */
  items?: WpDocItem[];
  /** Одиночные поля — для совместимости / когда позиций нет. */
  wastepaperType?: string;
  weightKg?: number;
  shippedWeightKg?: number;
  acceptedWeightKg?: number;
  receivedAmount?: number;
  pricePerKg?: number;
  account: WpAccount;
  isPaid?: boolean;
  paidAt?: string | null;
  /** TRUE — отвезти нашей перевозкой (очередь перевозок учёта, «сдача груза»). */
  needsTransport?: boolean;
  /** Желаемая дата вывоза (подсказка диспетчеру). */
  transportPlannedDate?: string | null;
  comment?: string | null;
}

function cleanShipmentInput(data: WpShipmentInput) {
  const date = toDateStr(data.date);
  if (!date) throw new Error("Укажите дату сдачи");
  const enterpriseName = String(data.enterpriseName || "").trim().slice(0, 200);
  if (!enterpriseName) throw new Error("Укажите предприятие-приёмщик");
  let items = Array.isArray(data.items) ? normalizeWpDocItems(data.items) : [];
  if (items.length === 0) {
    const weightKg = Math.max(0, Number(data.weightKg) || 0);
    const pricePerKg = Math.max(0, Number(data.pricePerKg) || 0);
    const wastepaperType =
      String(data.wastepaperType || "").trim().slice(0, 120) || "cardboard";
    if (weightKg > 0 || pricePerKg > 0) {
      items = [
        {
          id: wpUid("it"),
          wastepaperType,
          weightKg,
          pricePerKg,
          total: Math.round(weightKg * pricePerKg * 100) / 100,
        },
      ];
    }
  }
  const totals = wpDocTotals(items);
  // Вес и цена могут быть неизвестны при создании: документ заполняется
  // после фактического забора и взвешивания.
  const first = items[0];
  const address = String(data.address || "").trim().slice(0, 400) || null;
  const needsTransport = data.needsTransport === true;
  if (needsTransport && !address) {
    throw new Error("Для перевозки укажите адрес предприятия — куда везти");
  }
  return {
    date,
    enterprise_id: data.enterpriseId || null,
    enterprise_name: enterpriseName,
    address,
    phone: String(data.phone || "").trim().slice(0, 60) || null,
    contact_person: String(data.contactPerson || "").trim().slice(0, 200) || null,
    items,
    wastepaper_type: first?.wastepaperType || "cardboard",
    weight_kg: totals.weightKg,
    // Фактические веса и деньги сдачи («отгружено», «принято»,
    // «поступление») — раньше молча терялись при сохранении.
    shipped_weight_kg: Math.max(0, Number(data.shippedWeightKg) || 0),
    accepted_weight_kg: Math.max(0, Number(data.acceptedWeightKg) || 0),
    received_amount: Math.max(0, Number(data.receivedAmount) || 0),
    price_per_kg: first?.pricePerKg ?? 0,
    total: totals.total,
    account: data.account === "cash" ? "cash" : "bank",
    needs_transport: needsTransport,
    transport_planned_date: data.transportPlannedDate
      ? String(data.transportPlannedDate).slice(0, 10)
      : null,
    comment: String(data.comment || "").trim().slice(0, 500) || null,
  };
}

export async function createWpShipment(
  data: WpShipmentInput,
  createdBy: string
): Promise<WpShipment> {
  const db = getAdminDb();
  const fields = cleanShipmentInput(data);
  const number = await nextNumber("wp_shipment");
  const isPaid = Boolean(data.isPaid);
  const { data: row, error } = await db
    .from("wp_shipments")
    .insert({
      ...fields,
      number,
      is_paid: isPaid,
      paid_at: isPaid ? data.paidAt || new Date().toISOString() : null,
      status: "active",
      created_by: createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  return mapShipment(row);
}

export async function updateWpShipment(
  id: string,
  data: Partial<WpShipmentInput> & { isPaid?: boolean; bankPostedAt?: string | null }
): Promise<WpShipment> {
  const db = getAdminDb();
  const { data: existing, error: existErr } = await db
    .from("wp_shipments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (existErr || !existing) throw new Error("Сдача не найдена");
  const merged = cleanShipmentInput({
    date: data.date ?? toDateStr(existing.date),
    enterpriseId: data.enterpriseId !== undefined ? data.enterpriseId : existing.enterprise_id,
    enterpriseName: data.enterpriseName ?? existing.enterprise_name,
    address: data.address !== undefined ? data.address : existing.address,
    phone: data.phone !== undefined ? data.phone : existing.phone,
    contactPerson:
      data.contactPerson !== undefined ? data.contactPerson : existing.contact_person,
    items:
      data.items !== undefined
        ? data.items
        : (normalizeWpDocItems(existing.items) as WpDocItem[]),
    wastepaperType: data.wastepaperType ?? existing.wastepaper_type,
    weightKg: data.weightKg ?? (Number(existing.weight_kg) || 0),
    shippedWeightKg: data.shippedWeightKg ?? (Number(existing.shipped_weight_kg) || 0),
    acceptedWeightKg: data.acceptedWeightKg ?? (Number(existing.accepted_weight_kg) || 0),
    receivedAmount: data.receivedAmount ?? (Number(existing.received_amount) || 0),
    pricePerKg: data.pricePerKg ?? (Number(existing.price_per_kg) || 0),
    account:
      data.account !== undefined
        ? data.account
        : existing.account === "cash"
          ? "cash"
          : "bank",
    comment: data.comment !== undefined ? data.comment : existing.comment,
    needsTransport:
      data.needsTransport !== undefined
        ? data.needsTransport
        : Boolean(existing.needs_transport),
    transportPlannedDate:
      data.transportPlannedDate !== undefined
        ? data.transportPlannedDate
        : existing.transport_planned_date || null,
  });
  const isPaid = data.isPaid !== undefined ? Boolean(data.isPaid) : Boolean(existing.is_paid);
  const { data: row, error } = await db
    .from("wp_shipments")
    .update({
      ...merged,
      is_paid: isPaid,
      paid_at: isPaid ? existing.paid_at || new Date().toISOString() : null,
      ...(data.bankPostedAt !== undefined ? { bank_posted_at: data.bankPostedAt } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  // Сняли пометку «в перевозку» — убираем сдачу из активных единых рейсов.
  if (Boolean(existing.needs_transport) && !merged.needs_transport) {
    await removeWpDocFromActiveTransports("shipment", id);
  }
  return mapShipment(row);
}

export async function setWpShipmentCancelled(id: string, cancelled: boolean): Promise<void> {
  const db = getAdminDb();
  const { error } = await db
    .from("wp_shipments")
    .update({
      status: cancelled ? "cancelled" : "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
  bumpWpCaches();
  // Отменённая сдача не едет: убираем из активных единых рейсов.
  if (cancelled) await removeWpDocFromActiveTransports("shipment", id);
}

export async function deleteWpShipment(id: string): Promise<void> {
  const db = getAdminDb();
  await removeWpDocFromActiveTransports("shipment", id);
  const { error } = await db.from("wp_shipments").delete().eq("id", id);
  if (error) throw error;
  bumpWpCaches();
}

// ── Связь с ЕДИНЫМИ перевозками учёта (transports) ───────

/**
 * Убрать приём/сдачу макулатуры из всех активных единых рейсов.
 * Вызывается, когда с документа сняли пометку «в перевозку», отменили
 * или удалили его — точка не должна висеть в чужом путевом листе.
 * Опустевший рейс помечаем завершённым (та же логика, что у заказов ЗК).
 */
export async function removeWpDocFromActiveTransports(
  kind: "intake" | "shipment",
  id: string
): Promise<void> {
  const db = getAdminDb();
  try {
    const { data: rows, error } = await db
      .from("transports")
      .select("id, items, completed_at")
      .in("status", ["draft", "active"]);
    if (error || !rows) return;
    for (const row of rows) {
      const items = Array.isArray(row.items) ? row.items : [];
      const next = items.filter(
        (it: any) => !(it?.wpDocKind === kind && String(it?.wpDocId) === String(id))
      );
      if (next.length === items.length) continue;
      const totalItems = next.reduce((s: number, it: any) => {
        const lines = Array.isArray(it?.items) ? it.items : [];
        return (
          s +
          lines.reduce((s2: number, l: any) => s2 + (Number(l?.transportQty) || 0), 0)
        );
      }, 0);
      const payload: Record<string, any> = {
        items: next,
        total_items: totalItems,
        updated_at: new Date().toISOString(),
      };
      if (next.length === 0) {
        payload.status = "completed";
        payload.completed_at = row.completed_at || new Date().toISOString();
      }
      await db.from("transports").update(payload).eq("id", row.id);
    }
  } catch (e) {
    console.error("removeWpDocFromActiveTransports:", e);
  }
}

// ── Ручные платежи ───────────────────────────────────────

function mapManualPayment(row: any): WpManualPayment {
  return {
    id: row.id,
    number: Number(row.number) || 0,
    date: toDateStr(row.date),
    direction: row.direction === "outgoing" ? "outgoing" : "incoming",
    account: (row.account === "bank" ? "bank" : "cash") as WpAccount,
    counterpartyId: row.counterparty_id || null,
    counterpartyName: row.counterparty_name || "",
    amount: Number(row.amount) || 0,
    isPaid: Boolean(row.is_paid),
    paidAt: toIso(row.paid_at),
    comment: row.comment || null,
    createdBy: row.created_by || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getWpManualPayments(limit = 500): Promise<WpManualPayment[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("wp_payments")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapManualPayment);
}

export interface WpManualPaymentInput {
  date: string;
  direction: "incoming" | "outgoing";
  account: WpAccount;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
  amount: number;
  isPaid?: boolean;
  paidAt?: string | null;
  comment?: string | null;
}

function cleanManualPaymentInput(data: WpManualPaymentInput) {
  const date = toDateStr(data.date);
  if (!date) throw new Error("Укажите дату платежа");
  const amount = Math.max(0, Number(data.amount) || 0);
  if (amount <= 0) throw new Error("Укажите сумму платежа");
  return {
    date,
    direction: data.direction === "outgoing" ? "outgoing" : "incoming",
    account: data.account === "bank" ? "bank" : data.account === "third_party" ? "third_party" : "cash",
    counterparty_id: data.counterpartyId || null,
    counterparty_name: String(data.counterpartyName || "").trim().slice(0, 200),
    amount,
    comment: String(data.comment || "").trim().slice(0, 500) || null,
  };
}

export async function createWpManualPayment(
  data: WpManualPaymentInput,
  createdBy: string
): Promise<WpManualPayment> {
  const db = getAdminDb();
  const fields = cleanManualPaymentInput(data);
  const number = await nextNumber("wp_payment");
  const isPaid = data.isPaid !== undefined ? Boolean(data.isPaid) : true;
  const { data: row, error } = await db
    .from("wp_payments")
    .insert({
      ...fields,
      number,
      is_paid: isPaid,
      paid_at: isPaid ? data.paidAt || new Date().toISOString() : null,
      created_by: createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  return mapManualPayment(row);
}

export async function updateWpManualPayment(
  id: string,
  data: Partial<WpManualPaymentInput> & { isPaid?: boolean }
): Promise<WpManualPayment> {
  const db = getAdminDb();
  const { data: existing, error: existErr } = await db
    .from("wp_payments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (existErr || !existing) throw new Error("Платёж не найден");
  const merged = cleanManualPaymentInput({
    date: data.date ?? toDateStr(existing.date),
    direction: data.direction ?? existing.direction,
    account:
      data.account !== undefined
        ? data.account
        : existing.account === "bank"
          ? "bank"
          : existing.account === "third_party"
            ? "third_party"
            : "cash",
    counterpartyId:
      data.counterpartyId !== undefined ? data.counterpartyId : existing.counterparty_id,
    counterpartyName:
      data.counterpartyName !== undefined ? data.counterpartyName : existing.counterparty_name,
    amount: data.amount ?? (Number(existing.amount) || 0),
    comment: data.comment !== undefined ? data.comment : existing.comment,
  });
  const isPaid = data.isPaid !== undefined ? Boolean(data.isPaid) : Boolean(existing.is_paid);
  const { data: row, error } = await db
    .from("wp_payments")
    .update({
      ...merged,
      is_paid: isPaid,
      paid_at: isPaid ? existing.paid_at || new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  return mapManualPayment(row);
}

export async function deleteWpManualPayment(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("wp_payments").delete().eq("id", id);
  if (error) throw error;
  bumpWpCaches();
}

// ── Перевозки ────────────────────────────────────────────

export function normalizeTransportItems(raw: unknown): WpTransportItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any, idx: number) => ({
    id: String(item?.id || `stop-${idx + 1}`),
    counterpartyId: item?.counterpartyId ? String(item.counterpartyId) : null,
    counterpartyName: String(item?.counterpartyName || "").slice(0, 200),
    address: String(item?.address || "").slice(0, 400),
    phone: String(item?.phone || "").slice(0, 60),
    contactPerson: String(item?.contactPerson || "").slice(0, 200),
    approxTime: String(item?.approxTime || "").slice(0, 30),
    wastepaperType: String(item?.wastepaperType || "cardboard").slice(0, 120),
    pricePerKg: Math.max(0, Number(item?.pricePerKg) || 0),
    plannedKg: Math.max(0, Number(item?.plannedKg) || 0),
    actualKg:
      item?.actualKg == null || item?.actualKg === ""
        ? null
        : Math.max(0, Number(item.actualKg) || 0),
    cashAmount: Math.max(0, Number(item?.cashAmount) || 0),
    bankAmount: Math.max(0, Number(item?.bankAmount) || 0),
    note: String(item?.note || "").slice(0, 500),
    status: ["done", "skipped"].includes(item?.status) ? item.status : "pending",
    intakeId: item?.intakeId ? String(item.intakeId) : null,
  }));
}

function mapTransport(row: any): WpTransport {
  const items = normalizeTransportItems(row.items);
  return {
    id: row.id,
    number: Number(row.number) || 0,
    date: toDateStr(row.date),
    startTime: row.start_time || null,
    driverName: row.driver_name || null,
    driverPhone: row.driver_phone || null,
    vehicle: row.vehicle || null,
    status: (row.status in WP_TRANSPORT_STATUS_LABELS
      ? row.status
      : "planned") as WpTransportStatus,
    note: row.note || null,
    items,
    totalPlannedKg:
      Number(row.total_planned_kg) ||
      items.reduce((s, i) => s + (Number(i.plannedKg) || 0), 0),
    createdBy: row.created_by || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getWpTransports(limit = 200): Promise<WpTransport[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("wp_transports")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapTransport);
}

export interface WpTransportInput {
  date: string;
  startTime?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  vehicle?: string | null;
  note?: string | null;
  items?: WpTransportItem[];
  status?: WpTransportStatus;
}

function cleanTransportInput(data: WpTransportInput, existing?: any) {
  const date = toDateStr(data.date ?? (existing ? existing.date : ""));
  if (!date) throw new Error("Укажите дату перевозки");
  const items = normalizeTransportItems(
    data.items !== undefined ? data.items : existing?.items
  );
  return {
    date,
    start_time: String(data.startTime ?? existing?.start_time ?? "").trim().slice(0, 30) || null,
    driver_name:
      String(data.driverName ?? existing?.driver_name ?? "").trim().slice(0, 200) || null,
    driver_phone:
      String(data.driverPhone ?? existing?.driver_phone ?? "").trim().slice(0, 60) || null,
    vehicle: String(data.vehicle ?? existing?.vehicle ?? "").trim().slice(0, 200) || null,
    note: String(data.note ?? existing?.note ?? "").trim().slice(0, 1000) || null,
    items,
    total_planned_kg: items.reduce((s, i) => s + (Number(i.plannedKg) || 0), 0),
  };
}

/**
 * Автосохранение контрагентов/точек по остановкам перевозки: если в точке
 * указано имя — находим или создаём контрагента (роль «сдаёт нам») и
 * добавляем адрес как точку (филиал). Так новое отделение, вписанное прямо
 * в рейс, сразу попадает в справочник контрагентов.
 */
async function resolveTransportStopParties(
  items: WpTransportItem[]
): Promise<WpTransportItem[]> {
  const out: WpTransportItem[] = [];
  for (const it of items) {
    let counterpartyId = it.counterpartyId;
    const name = String(it.counterpartyName || "").trim();
    try {
      if (name) {
        const cp = await ensureWpCounterparty(name, "supplier", {
          address: it.address || undefined,
          phone: it.phone || undefined,
          contactPerson: it.contactPerson || undefined,
        });
        counterpartyId = cp.id;
      } else if (counterpartyId && it.address) {
        await ensureWpBranch(counterpartyId, {
          address: it.address,
          phone: it.phone || undefined,
          contactPerson: it.contactPerson || undefined,
        });
      }
    } catch (e) {
      console.error("resolveTransportStopParties:", e);
    }
    out.push({ ...it, counterpartyId });
  }
  return out;
}

export async function createWpTransport(
  data: WpTransportInput,
  createdBy: string
): Promise<WpTransport> {
  const db = getAdminDb();
  const cleaned = cleanTransportInput(data);
  const fields = { ...cleaned, items: await resolveTransportStopParties(cleaned.items) };
  const number = await nextNumber("wp_transport");
  const { data: row, error } = await db
    .from("wp_transports")
    .insert({
      ...fields,
      number,
      status: data.status === "active" ? "active" : "planned",
      created_by: createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  return mapTransport(row);
}

export async function updateWpTransport(
  id: string,
  data: WpTransportInput
): Promise<WpTransport> {
  const db = getAdminDb();
  const { data: existing, error: existErr } = await db
    .from("wp_transports")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (existErr || !existing) throw new Error("Перевозка не найдена");
  if (existing.status === "completed" || existing.status === "cancelled") {
    throw new Error("Завершённую/отменённую перевозку менять нельзя — создайте новую");
  }
  const cleaned = cleanTransportInput(data, existing);
  const fields = { ...cleaned, items: await resolveTransportStopParties(cleaned.items) };
  const status =
    data.status && data.status in WP_TRANSPORT_STATUS_LABELS
      ? data.status
      : existing.status === "active"
        ? "active"
        : "planned";
  const { data: row, error } = await db
    .from("wp_transports")
    .update({ ...fields, status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  return mapTransport(row);
}

export async function setWpTransportStatus(
  id: string,
  status: WpTransportStatus
): Promise<void> {
  const db = getAdminDb();
  if (!(status in WP_TRANSPORT_STATUS_LABELS)) throw new Error("Недопустимый статус");
  const { data: existing, error: existErr } = await db
    .from("wp_transports")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (existErr || !existing) throw new Error("Перевозка не найдена");
  const { error } = await db
    .from("wp_transports")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  bumpWpCaches();
}

export async function deleteWpTransport(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: existing, error: existErr } = await db
    .from("wp_transports")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (existErr || !existing) throw new Error("Перевозка не найдена");
  if (existing.status === "completed") {
    throw new Error("Завершённую перевозку нельзя удалить — только отменить");
  }
  const { error } = await db.from("wp_transports").delete().eq("id", id);
  if (error) throw error;
  bumpWpCaches();
}

/**
 * Оформить приёмы по остановкам перевозки, отмеченным «Забрано»:
 * для каждой done-остановки без приёма создаёт wp_intakes c фактическим
 * (или плановым) весом и привязывает к остановке.
 */
export async function createWpIntakesFromTransport(
  transportId: string,
  createdBy: string
): Promise<{ created: number; items: WpTransportItem[] }> {
  const db = getAdminDb();
  const { data: row, error } = await db
    .from("wp_transports")
    .select("*")
    .eq("id", transportId)
    .maybeSingle();
  if (error || !row) throw new Error("Перевозка не найдена");
  const items = normalizeTransportItems(row.items);
  // Тарифы из настроек (wp_rate_*) — чтобы цена в приёмах была сразу
  // актуальной, а не нулём; при недоступности настроек везём 0.
  const ratesMap = await getWastepaperRates().catch(() => null);
  let created = 0;
  for (const item of items) {
    if (item.status !== "done" || item.intakeId) continue;
    const weightKg = item.actualKg ?? item.plannedKg;
    if (weightKg <= 0) continue;
    const rate = ratesMap
      ? (ratesMap as Record<string, number>)[item.wastepaperType]
      : undefined;
    const intake = await createWpIntake(
      {
        date: toDateStr(row.date),
        counterpartyId: item.counterpartyId,
        counterpartyName: item.counterpartyName,
        address: item.address || null,
        phone: item.phone || null,
        contactPerson: item.contactPerson || null,
        wastepaperType: item.wastepaperType,
        weightKg,
        pricePerKg: item.pricePerKg || rate || 0,
        account: item.bankAmount > 0 && item.cashAmount <= 0 ? "bank" : "cash",
        cashAmount: item.cashAmount,
        bankAmount: item.bankAmount,
        isPaid: false,
        transportId,
        transportItemId: item.id,
        comment: item.note ? `Перевозка ТМ-${row.number}: ${item.note}` : `Перевозка ТМ-${row.number}`,
      },
      createdBy
    );
    item.intakeId = intake.id;
    created++;
  }
  if (created > 0) {
    const { error: updErr } = await db
      .from("wp_transports")
      .update({ items, updated_at: new Date().toISOString() })
      .eq("id", transportId);
    if (updErr) throw updErr;
    bumpWpCaches();
  }
  return { created, items };
}

// ── Зарплаты из кассы макулатуры ─────────────────────────

/**
 * Зарплаты с пометкой [Макулатура] (source=wastepaper): выплачены или
 * запланированы наличными из кассы макулатуры. Сама запись ведётся в
 * разделе «Зарплаты» учёта, здесь она только читается — как расход
 * «Наличка» в финансах модуля. При сбое (нет таблицы, нет прав) отдаём
 * пустой список: финансы макулатуры не должны падать из-за зарплат.
 */
export async function getWpSalaries(): Promise<Salary[]> {
  try {
    const all = await getSalaries();
    return all.filter((s) => isWastepaperSalary(s));
  } catch (error) {
    console.error("wastepaper-account: зарплаты из кассы макулатуры недоступны:", error);
    return [];
  }
}

// ── Сводка для дашборда ──────────────────────────────────

export interface WpDashboardData {
  counterparties: WpCounterparty[];
  intakes: WpIntake[];
  shipments: WpShipment[];
  manualPayments: WpManualPayment[];
  products: WpProduct[];
  /** Зарплаты, выплаченные/запланированные наличными из кассы макулатуры. */
  salaries: Salary[];
}

export async function getWpDashboardData(): Promise<WpDashboardData> {
  const [counterparties, intakes, shipments, manualPayments, products, salaries] =
    await Promise.all([
      getWpCounterparties(),
      getWpIntakes(500),
      getWpShipments(300),
      getWpManualPayments(500),
      getWpProducts(),
      getWpSalaries(),
    ]);
  // Отдельных перевозок макулатуры (ТМ-...) в интерфейсе больше нет:
  // вкладка «Перевозки» показывает единые перевозки учёта (ПЕР-...).
  return { counterparties, intakes, shipments, manualPayments, products, salaries };
}

/** Облегчённая выборка для финансовой карточки на главном дашборде. */
export async function getWpFinanceData(): Promise<{
  intakes: WpIntake[];
  shipments: WpShipment[];
  manualPayments: WpManualPayment[];
  salaries: Salary[];
}> {
  const [intakes, shipments, manualPayments, salaries] = await Promise.all([
    getWpIntakes(500),
    getWpShipments(300),
    getWpManualPayments(500),
    getWpSalaries(),
  ]);
  return { intakes, shipments, manualPayments, salaries };
}
