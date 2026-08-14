import "server-only";

import { randomUUID } from "crypto";
import { revalidateTag } from "next/cache";
import { getAdminDb } from "@/lib/supabase";
import { getWarehouseBusinessDate } from "@/lib/warehouse-shared";
import {
  fetchOzonProduct,
  normalizeOzonProductUrl,
} from "@/lib/ozon-product";
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

function safeOzonUrl(value: unknown): string | null {
  if (!value) return null;
  try {
    return normalizeOzonProductUrl(value);
  } catch {
    return null;
  }
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
    ozonUrl: safeOzonUrl(row.ozon_url),
    ozonImageUrl: row.ozon_image_url ? String(row.ozon_image_url) : null,
    ozonPrice: row.ozon_price != null ? Math.max(0, round2(row.ozon_price)) : null,
    ozonCheckedAt: row.ozon_checked_at ? String(row.ozon_checked_at) : null,
    ozonPriceUpdatedAt: row.ozon_price_updated_at ? String(row.ozon_price_updated_at) : null,
    ozonLastError: row.ozon_last_error ? String(row.ozon_last_error) : null,
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
  const message = String(error.message || "");
  if (
    message.includes("ozon_") &&
    (error.code === "PGRST204" || error.code === "42703" || message.includes("schema cache"))
  ) {
    return new Error("Примените миграцию migration_purchase_plan_ozon.sql");
  }
  if (error.code === "42P01" || message.includes("does not exist")) {
    return new Error("Примените миграцию migration_purchase_plans.sql");
  }
  return new Error(message || "Ошибка планов закупок");
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
  ozonUrl?: unknown;
  targetAmount?: unknown;
  contributionAmount?: unknown;
  account?: unknown;
}): Promise<PurchasePlan> {
  const rawOzonUrl = cleanText(input.ozonUrl, 1500);
  const ozonUrl = rawOzonUrl ? normalizeOzonProductUrl(rawOzonUrl) : null;
  let ozonSnapshot: Awaited<ReturnType<typeof fetchOzonProduct>> | null = null;
  let ozonLastError: string | null = null;
  if (ozonUrl) {
    try {
      ozonSnapshot = await fetchOzonProduct(ozonUrl);
    } catch (error) {
      ozonLastError = cleanText(
        error instanceof Error ? error.message : "Не удалось проверить Ozon",
        500
      );
    }
  }

  const productName = cleanText(input.productName, 300) || ozonSnapshot?.title || "";
  if (!productName) {
    throw new Error(
      ozonLastError || "Введите название товара или вставьте рабочую ссылку Ozon"
    );
  }
  // Связь с каталогом необязательна: для произвольного названия
  // сохраняем стабильный внутренний идентификатор без внешнего FK.
  const productId = cleanText(input.productId, 100) || `custom:${randomUUID()}`;
  const db = getAdminDb();
  const now = new Date().toISOString();
  const currentOzonUrl = ozonSnapshot?.url || ozonUrl;
  const currentOzonPrice = ozonSnapshot?.price ?? null;
  const row = {
    id: randomUUID(),
    product_id: productId,
    product_name: ozonSnapshot?.title || productName,
    sku: cleanText(input.sku, 80) || null,
    ozon_url: currentOzonUrl,
    ozon_image_url: ozonSnapshot?.imageUrl || null,
    ozon_price: currentOzonPrice,
    ozon_checked_at: ozonUrl ? now : null,
    ozon_price_updated_at: ozonSnapshot ? now : null,
    ozon_last_error: ozonLastError,
    target_amount: currentOzonPrice ?? Math.max(0, round2(input.targetAmount)),
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

export async function refreshPurchasePlanOzon(idValue: unknown): Promise<{
  plan: PurchasePlan;
  warning: string | null;
}> {
  const id = cleanText(idValue, 100);
  if (!id) throw new Error("План не найден");
  const db = getAdminDb();
  const { data: existing, error: readError } = await db
    .from("warehouse_purchase_plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw migrationError(readError);
  if (!existing) throw new Error("План не найден");
  if (!existing.ozon_url) throw new Error("У плана нет ссылки Ozon");

  const checkedAt = new Date().toISOString();
  try {
    const snapshot = await fetchOzonProduct(existing.ozon_url);
    const { data, error } = await db
      .from("warehouse_purchase_plans")
      .update({
        product_name: snapshot.title || existing.product_name,
        ozon_url: snapshot.url,
        ozon_image_url: snapshot.imageUrl || existing.ozon_image_url || null,
        ozon_price: snapshot.price,
        ozon_checked_at: checkedAt,
        ozon_price_updated_at: checkedAt,
        ozon_last_error: null,
        target_amount: snapshot.price,
        updated_at: checkedAt,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw migrationError(error);
    revalidateTag("purchase-plans", { expire: 0 });
    return { plan: mapPlan(data), warning: null };
  } catch (error) {
    const warning = cleanText(
      error instanceof Error ? error.message : "Не удалось обновить цену Ozon",
      500
    );
    const { data, error: updateError } = await db
      .from("warehouse_purchase_plans")
      .update({
        ozon_checked_at: checkedAt,
        ozon_last_error: warning,
        updated_at: checkedAt,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (updateError) throw migrationError(updateError);
    revalidateTag("purchase-plans", { expire: 0 });
    return { plan: mapPlan(data), warning };
  }
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
