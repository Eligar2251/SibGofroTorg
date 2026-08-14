import "server-only";

import { randomUUID } from "crypto";
import { revalidateTag } from "next/cache";
import { getAdminDb } from "@/lib/supabase";
import { getWarehouseBusinessDate } from "@/lib/warehouse-shared";
import {
  purchaseSavedAmount,
  type PurchaseAccount,
  type PurchaseContribution,
  type PurchasePlan,
} from "@/lib/purchase-plans-shared";

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function round2(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeAccount(value: unknown): PurchaseAccount {
  return value === "cash" || value === "ym_card" ? value : "bank";
}

function normalizeContributions(raw: unknown): PurchaseContribution[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    const amount = Math.max(0, round2(value.amount));
    if (amount <= 0) return [];
    const date = cleanText(value.date, 10);
    const createdAt = cleanText(value.createdAt, 40) || new Date().toISOString();
    return [{
      id: cleanText(value.id, 100) || randomUUID(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getWarehouseBusinessDate(),
      amount,
      note: cleanText(value.note, 300) || null,
      createdAt,
    }];
  });
}

function mapPlan(row: Record<string, any>): PurchasePlan {
  const contributions = normalizeContributions(row.contributions);
  return {
    id: String(row.id),
    productId: String(row.product_id || ""),
    productName: String(row.product_name || "Товар"),
    sku: row.sku ? String(row.sku) : null,
    targetAmount: Math.max(0, round2(row.target_amount)),
    contributionAmount: Math.max(0.01, round2(row.contribution_amount) || 500),
    account: normalizeAccount(row.account),
    status: row.status === "completed" ? "completed" : "active",
    contributions,
    savedAmount: purchaseSavedAmount(contributions),
    spentAmount: Math.max(0, round2(row.spent_amount)),
    spentPaymentId: row.spent_payment_id ? String(row.spent_payment_id) : null,
    spentAt: row.spent_at ? String(row.spent_at) : null,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || row.created_at || new Date().toISOString()),
  };
}

function migrationError(error: { code?: string; message?: string }): Error {
  if (error.code === "42P01" || String(error.message || "").includes("does not exist")) {
    return new Error("Примените миграцию migration_purchase_plans.sql");
  }
  return new Error(error.message || "Ошибка планов закупок");
}

export async function getPurchasePlans(): Promise<PurchasePlan[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("warehouse_purchase_plans")
    .select("*")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) {
    if (error.code === "42P01" || error.message.includes("does not exist")) return [];
    throw error;
  }
  return (data || []).map((row) => mapPlan(row));
}

export async function createPurchasePlan(input: {
  productId: unknown;
  productName: unknown;
  sku?: unknown;
  targetAmount?: unknown;
  contributionAmount?: unknown;
  account?: unknown;
}): Promise<PurchasePlan> {
  const productName = cleanText(input.productName, 300);
  if (!productName) throw new Error("Введите название товара");
  // Связь с каталогом необязательна: для произвольного названия
  // сохраняем стабильный внутренний идентификатор без внешнего FK.
  const productId = cleanText(input.productId, 100) || `custom:${randomUUID()}`;
  const db = getAdminDb();
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    product_id: productId,
    product_name: productName,
    sku: cleanText(input.sku, 80) || null,
    target_amount: Math.max(0, round2(input.targetAmount)),
    contribution_amount: Math.max(0.01, round2(input.contributionAmount) || 500),
    account: normalizeAccount(input.account),
    status: "active",
    contributions: [],
    spent_amount: 0,
    spent_payment_id: null,
    spent_at: null,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await db
    .from("warehouse_purchase_plans")
    .insert(row)
    .select("*")
    .single();
  if (error) throw migrationError(error);
  revalidateTag("purchase-plans", { expire: 0 });
  return mapPlan(data);
}

export async function addPurchaseContribution(input: {
  id: unknown;
  amount: unknown;
  date?: unknown;
  note?: unknown;
}): Promise<PurchasePlan> {
  const id = cleanText(input.id, 100);
  const amount = Math.max(0, round2(input.amount));
  if (!id) throw new Error("План не найден");
  if (amount <= 0) throw new Error("Сумма пополнения должна быть больше нуля");
  const db = getAdminDb();
  const { data: existing, error: readError } = await db
    .from("warehouse_purchase_plans")
    .select("*")
    .eq("id", id)
    .single();
  if (readError || !existing) throw migrationError(readError || { message: "План не найден" });
  if (existing.status === "completed") throw new Error("Закупка уже оплачена");

  const contributions = normalizeContributions(existing.contributions);
  const rawDate = cleanText(input.date, 10);
  contributions.push({
    id: randomUUID(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getWarehouseBusinessDate(),
    amount,
    note: cleanText(input.note, 300) || null,
    createdAt: new Date().toISOString(),
  });
  const { data, error } = await db
    .from("warehouse_purchase_plans")
    .update({ contributions, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  revalidateTag("purchase-plans", { expire: 0 });
  return mapPlan(data);
}

async function nextPaymentNumber(): Promise<number> {
  const db = getAdminDb();
  const { data, error } = await db.rpc("fn_next_counter", { p_key: "payment" });
  if (!error && data != null) return Number(data);
  const { data: counter } = await db
    .from("doc_counters")
    .select("value")
    .eq("key", "payment")
    .maybeSingle();
  const value = (Number(counter?.value) || 0) + 1;
  const { error: upsertError } = await db
    .from("doc_counters")
    .upsert({ key: "payment", value });
  if (upsertError) throw upsertError;
  return value;
}

export async function spendPurchasePlan(input: {
  id: unknown;
  account?: unknown;
}): Promise<PurchasePlan> {
  const id = cleanText(input.id, 100);
  if (!id) throw new Error("План не найден");
  const db = getAdminDb();
  const { data: existing, error: readError } = await db
    .from("warehouse_purchase_plans")
    .select("*")
    .eq("id", id)
    .single();
  if (readError || !existing) throw migrationError(readError || { message: "План не найден" });
  if (existing.status === "completed" || existing.spent_payment_id) {
    throw new Error("Накопленная сумма уже списана");
  }

  const contributions = normalizeContributions(existing.contributions);
  const amount = purchaseSavedAmount(contributions);
  if (amount <= 0) throw new Error("Сначала добавьте накопления");
  const account = normalizeAccount(input.account ?? existing.account);
  const number = await nextPaymentNumber();
  const date = getWarehouseBusinessDate();
  const paymentType = account === "cash" ? "cash" : account === "ym_card" ? "ym_card" : "regular";
  const { data: payment, error: paymentError } = await db
    .from("bank_payments")
    .insert({
      number,
      date,
      direction: "outgoing",
      type: paymentType,
      cash_destination: null,
      counterparty: `Закупка — ${String(existing.product_name || "товар")}`.slice(0, 200),
      counterparty_id: null,
      deal_ids: [],
      deal_numbers: [],
      receipt_ids: [],
      receipt_numbers: [],
      amount,
      invoice_number: null,
      vat_rate: 0,
      vat_amount: 0,
      is_paid: true,
      paid_at: date,
      exclude_from_balance: false,
      comment: `Списание накоплений по плану закупки «${String(existing.product_name || "товар")}»`,
    })
    .select("id")
    .single();
  if (paymentError || !payment) throw paymentError || new Error("Не удалось создать списание");

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("warehouse_purchase_plans")
    .update({
      account,
      status: "completed",
      spent_amount: amount,
      spent_payment_id: payment.id,
      spent_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .eq("status", "active")
    .select("*")
    .maybeSingle();
  if (error || !data) {
    await db.from("bank_payments").delete().eq("id", payment.id);
    throw error || new Error("План уже был списан");
  }

  revalidateTag("purchase-plans", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  return mapPlan(data);
}

export async function deletePurchasePlan(idValue: unknown): Promise<void> {
  const id = cleanText(idValue, 100);
  if (!id) throw new Error("План не найден");
  const db = getAdminDb();
  const { data: existing, error: readError } = await db
    .from("warehouse_purchase_plans")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw migrationError(readError);
  if (!existing) throw new Error("План не найден");
  if (existing.status === "completed") {
    throw new Error("Завершённый план с проведённым списанием удалять нельзя");
  }
  const { error } = await db.from("warehouse_purchase_plans").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("purchase-plans", { expire: 0 });
}
