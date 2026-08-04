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
import type {
  WpAccount,
  WpCounterparty,
  WpIntake,
  WpManualPayment,
  WpShipment,
  WpTransport,
  WpTransportItem,
} from "@/lib/wastepaper-account-shared";
import {
  WP_TRANSPORT_STATUS_LABELS,
  type WpTransportStatus,
} from "@/lib/wastepaper-account-shared";

export const WP_TAG = "wastepaper-account";

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

function mapCounterparty(row: any): WpCounterparty {
  return {
    id: row.id,
    name: row.name || "",
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
    phone: row.phone || null,
    address: row.address || null,
    contactPerson: row.contact_person || null,
    inn: row.inn || null,
    comment: row.comment || null,
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

/** Найти контрагента по имени или создать нового (роль дополняется). */
export async function ensureWpCounterparty(
  name: string,
  role: "supplier" | "enterprise",
  extra: { phone?: string; address?: string } = {}
): Promise<WpCounterparty> {
  const db = getAdminDb();
  const clean = String(name || "").trim().slice(0, 200);
  if (!clean) throw new Error("Укажите контрагента");
  const { data: found } = await db
    .from("wp_counterparties")
    .select("*")
    .ilike("name", clean)
    .limit(1)
    .maybeSingle();
  if (found) {
    const roles = new Set<string>(Array.isArray(found.roles) ? found.roles.map(String) : []);
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    let changed = false;
    if (!roles.has(role)) {
      roles.add(role);
      patch.roles = [...roles];
      changed = true;
    }
    if (extra.address && !found.address) {
      patch.address = String(extra.address).slice(0, 400);
      changed = true;
    }
    if (extra.phone && !found.phone) {
      patch.phone = String(extra.phone).slice(0, 60);
      changed = true;
    }
    if (changed) {
      await db.from("wp_counterparties").update(patch).eq("id", found.id);
    }
    return mapCounterparty({ ...found, ...patch });
  }
  const { data, error } = await db
    .from("wp_counterparties")
    .insert({
      name: clean,
      roles: [role],
      phone: extra.phone ? String(extra.phone).slice(0, 60) : null,
      address: extra.address ? String(extra.address).slice(0, 400) : null,
    })
    .select("*")
    .single();
  if (error) throw error;
  bumpWpCaches();
  return mapCounterparty(data);
}

export async function upsertWpCounterparty(data: {
  id?: string | null;
  name: string;
  roles: string[];
  phone?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  inn?: string | null;
  comment?: string | null;
  createdBy?: string | null;
}): Promise<WpCounterparty> {
  const db = getAdminDb();
  const name = String(data.name || "").trim().slice(0, 200);
  if (!name) throw new Error("Укажите название контрагента");
  const roles = ["supplier", "enterprise"].flatMap((r) =>
    (data.roles || []).includes(r) ? [r] : []
  );
  if (roles.length === 0) throw new Error("Укажите роль контрагента: сдаёт нам и/или принимает у нас");
  const payload = {
    name,
    roles,
    phone: String(data.phone || "").trim().slice(0, 60) || null,
    address: String(data.address || "").trim().slice(0, 400) || null,
    contact_person: String(data.contactPerson || "").trim().slice(0, 200) || null,
    inn: String(data.inn || "").trim().slice(0, 20) || null,
    comment: String(data.comment || "").trim().slice(0, 500) || null,
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

function mapIntake(row: any): WpIntake {
  return {
    id: row.id,
    number: Number(row.number) || 0,
    date: toDateStr(row.date),
    counterpartyId: row.counterparty_id || null,
    counterpartyName: row.counterparty_name || "",
    address: row.address || null,
    wastepaperType: row.wastepaper_type || "cardboard",
    weightKg: Number(row.weight_kg) || 0,
    pricePerKg: Number(row.price_per_kg) || 0,
    total: Number(row.total) || 0,
    account: (row.account === "bank" ? "bank" : "cash") as WpAccount,
    isPaid: Boolean(row.is_paid),
    paidAt: toIso(row.paid_at),
    transportId: row.transport_id || null,
    transportItemId: row.transport_item_id || null,
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
  wastepaperType: string;
  weightKg: number;
  pricePerKg: number;
  account: WpAccount;
  isPaid?: boolean;
  paidAt?: string | null;
  transportId?: string | null;
  transportItemId?: string | null;
  comment?: string | null;
}

function cleanIntakeInput(data: WpIntakeInput) {
  const date = toDateStr(data.date);
  if (!date) throw new Error("Укажите дату приёма");
  const counterpartyName = String(data.counterpartyName || "").trim().slice(0, 200);
  if (!counterpartyName) throw new Error("Укажите, от кого приняли макулатуру");
  const wastepaperType = String(data.wastepaperType || "").trim().slice(0, 120) || "cardboard";
  const weightKg = Math.max(0, Number(data.weightKg) || 0);
  if (weightKg <= 0) throw new Error("Укажите вес, кг");
  const pricePerKg = Math.max(0, Number(data.pricePerKg) || 0);
  const total = Math.round(weightKg * pricePerKg * 100) / 100;
  return {
    date,
    counterparty_id: data.counterpartyId || null,
    counterparty_name: counterpartyName,
    address: String(data.address || "").trim().slice(0, 400) || null,
    wastepaper_type: wastepaperType,
    weight_kg: weightKg,
    price_per_kg: pricePerKg,
    total,
    account: data.account === "bank" ? "bank" : "cash",
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
    wastepaperType: data.wastepaperType ?? existing.wastepaper_type,
    weightKg: data.weightKg ?? (Number(existing.weight_kg) || 0),
    pricePerKg: data.pricePerKg ?? (Number(existing.price_per_kg) || 0),
    account: (data.account ?? (existing.account === "bank" ? "bank" : "cash")) as WpAccount,
    comment: data.comment !== undefined ? data.comment : existing.comment,
  });
  const isPaid = data.isPaid !== undefined ? Boolean(data.isPaid) : Boolean(existing.is_paid);
  const { data: row, error } = await db
    .from("wp_intakes")
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
}

export async function deleteWpIntake(id: string): Promise<void> {
  const db = getAdminDb();
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
  return {
    id: row.id,
    number: Number(row.number) || 0,
    date: toDateStr(row.date),
    enterpriseId: row.enterprise_id || null,
    enterpriseName: row.enterprise_name || "",
    wastepaperType: row.wastepaper_type || "cardboard",
    weightKg: Number(row.weight_kg) || 0,
    pricePerKg: Number(row.price_per_kg) || 0,
    total: Number(row.total) || 0,
    account: (row.account === "cash" ? "cash" : "bank") as WpAccount,
    isPaid: Boolean(row.is_paid),
    paidAt: toIso(row.paid_at),
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
  wastepaperType: string;
  weightKg: number;
  pricePerKg: number;
  account: WpAccount;
  isPaid?: boolean;
  paidAt?: string | null;
  comment?: string | null;
}

function cleanShipmentInput(data: WpShipmentInput) {
  const date = toDateStr(data.date);
  if (!date) throw new Error("Укажите дату сдачи");
  const enterpriseName = String(data.enterpriseName || "").trim().slice(0, 200);
  if (!enterpriseName) throw new Error("Укажите предприятие-приёмщик");
  const wastepaperType = String(data.wastepaperType || "").trim().slice(0, 120) || "cardboard";
  const weightKg = Math.max(0, Number(data.weightKg) || 0);
  if (weightKg <= 0) throw new Error("Укажите вес, кг");
  const pricePerKg = Math.max(0, Number(data.pricePerKg) || 0);
  const total = Math.round(weightKg * pricePerKg * 100) / 100;
  return {
    date,
    enterprise_id: data.enterpriseId || null,
    enterprise_name: enterpriseName,
    wastepaper_type: wastepaperType,
    weight_kg: weightKg,
    price_per_kg: pricePerKg,
    total,
    account: data.account === "cash" ? "cash" : "bank",
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
  data: Partial<WpShipmentInput> & { isPaid?: boolean }
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
    wastepaperType: data.wastepaperType ?? existing.wastepaper_type,
    weightKg: data.weightKg ?? (Number(existing.weight_kg) || 0),
    pricePerKg: data.pricePerKg ?? (Number(existing.price_per_kg) || 0),
    account:
      data.account !== undefined
        ? data.account
        : existing.account === "cash"
          ? "cash"
          : "bank",
    comment: data.comment !== undefined ? data.comment : existing.comment,
  });
  const isPaid = data.isPaid !== undefined ? Boolean(data.isPaid) : Boolean(existing.is_paid);
  const { data: row, error } = await db
    .from("wp_shipments")
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
}

export async function deleteWpShipment(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("wp_shipments").delete().eq("id", id);
  if (error) throw error;
  bumpWpCaches();
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
    account: data.account === "bank" ? "bank" : "cash",
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
    approxTime: String(item?.approxTime || "").slice(0, 30),
    wastepaperType: String(item?.wastepaperType || "cardboard").slice(0, 120),
    plannedKg: Math.max(0, Number(item?.plannedKg) || 0),
    actualKg:
      item?.actualKg == null || item?.actualKg === ""
        ? null
        : Math.max(0, Number(item.actualKg) || 0),
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

export async function createWpTransport(
  data: WpTransportInput,
  createdBy: string
): Promise<WpTransport> {
  const db = getAdminDb();
  const fields = cleanTransportInput(data);
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
  const fields = cleanTransportInput(data, existing);
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
        wastepaperType: item.wastepaperType,
        weightKg,
        pricePerKg: rate ?? 0,
        account: "cash",
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

// ── Сводка для дашборда ──────────────────────────────────

export interface WpDashboardData {
  counterparties: WpCounterparty[];
  intakes: WpIntake[];
  shipments: WpShipment[];
  manualPayments: WpManualPayment[];
  transports: WpTransport[];
}

export async function getWpDashboardData(): Promise<WpDashboardData> {
  const [counterparties, intakes, shipments, manualPayments, transports] =
    await Promise.all([
      getWpCounterparties(),
      getWpIntakes(500),
      getWpShipments(300),
      getWpManualPayments(500),
      getWpTransports(200),
    ]);
  return { counterparties, intakes, shipments, manualPayments, transports };
}

/** Облегчённая выборка для финансовой карточки на главном дашборде. */
export async function getWpFinanceData(): Promise<{
  intakes: WpIntake[];
  shipments: WpShipment[];
  manualPayments: WpManualPayment[];
}> {
  const [intakes, shipments, manualPayments] = await Promise.all([
    getWpIntakes(500),
    getWpShipments(300),
    getWpManualPayments(500),
  ]);
  return { intakes, shipments, manualPayments };
}
