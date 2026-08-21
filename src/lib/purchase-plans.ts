import "server-only";

import { randomUUID } from "crypto";
import { revalidateTag } from "next/cache";
import { getAdminDb } from "@/lib/supabase";
import { getWarehouseBusinessDate } from "@/lib/warehouse-shared";
import {
  fetchOzonProduct,
  normalizeOzonImageUrl,
  normalizeOzonProductUrl,
  type OzonProductSnapshot,
} from "@/lib/ozon-product";
import { mirrorPurchaseImage } from "@/lib/cloudinary-purchases";
import {
  purchaseSavedAmount,
  type PurchaseAccount,
  type PurchaseContribution,
  type PurchasePlan,
  type PurchaseSpendMode,
} from "@/lib/purchase-plans-shared";
import {
  SALARY_EXCLUDE_BALANCE_TAG,
  SALARY_YM_CARD_TAG,
} from "@/lib/warehouse-shared";

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

function normalizeImages(raw: unknown, fallbackUrl?: string | null, fallbackId?: string | null) {
  const out: { url: string; publicId: string }[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const url = cleanText((item as { url?: unknown }).url, 1500);
      if (!url) continue;
      out.push({
        url,
        publicId: cleanText((item as { publicId?: unknown }).publicId, 300),
      });
    }
  }
  if (out.length === 0 && fallbackUrl) {
    out.push({ url: fallbackUrl, publicId: fallbackId || "" });
  }
  return out.slice(0, 8);
}

function mapPlan(row: Record<string, any>): PurchasePlan {
  const contributions = normalizeContributions(row.contributions);
  const images = normalizeImages(
    row.images,
    row.ozon_image_url ? String(row.ozon_image_url) : null,
    row.ozon_image_public_id ? String(row.ozon_image_public_id) : null
  );
  return {
    id: String(row.id),
    productId: String(row.product_id || ""),
    productName: String(row.product_name || "Товар"),
    sku: row.sku ? String(row.sku) : null,
    images,
    ozonUrl: safeOzonUrl(row.ozon_url),
    ozonImageUrl: images[0]?.url || (row.ozon_image_url ? String(row.ozon_image_url) : null),
    ozonImagePublicId: row.ozon_image_public_id
      ? String(row.ozon_image_public_id)
      : null,
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
    spentSalaryId: row.spent_salary_id ? String(row.spent_salary_id) : null,
    spendMode:
      row.spend_mode === "salary" || row.spend_mode === "bank"
        ? (row.spend_mode as PurchaseSpendMode)
        : row.spent_salary_id
          ? "salary"
          : row.spent_payment_id
            ? "bank"
            : null,
    excludeFromBalance: row.exclude_from_balance === true,
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
  ozonTitle?: unknown;
  ozonPrice?: unknown;
  ozonImageUrl?: unknown;
  images?: unknown;
  targetAmount?: unknown;
  contributionAmount?: unknown;
  account?: unknown;
}): Promise<PurchasePlan> {
  const rawOzonUrl = cleanText(input.ozonUrl, 1500);
  const ozonUrl = rawOzonUrl ? normalizeOzonProductUrl(rawOzonUrl) : null;
  const suppliedOzonTitle = cleanText(input.ozonTitle, 300);
  const suppliedOzonPrice = Math.max(0, round2(input.ozonPrice));
  let ozonSnapshot: OzonProductSnapshot | null =
    ozonUrl && suppliedOzonTitle && suppliedOzonPrice > 0
      ? {
          url: ozonUrl,
          title: suppliedOzonTitle,
          price: suppliedOzonPrice,
          imageUrl: normalizeOzonImageUrl(input.ozonImageUrl),
          fetchedAt: new Date().toISOString(),
        }
      : null;
  let ozonLastError: string | null = null;
  // Если предпросмотр уже получил снимок, повторно Ozon не открываем.
  // Прямое создание только по URL всё ещё поддерживается.
  if (ozonUrl && !ozonSnapshot) {
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
  const planId = randomUUID();
  const db = getAdminDb();
  const now = new Date().toISOString();
  const currentOzonUrl = ozonSnapshot?.url || ozonUrl;
  const currentOzonPrice = ozonSnapshot?.price ?? null;
  const uploaded = normalizeImages(input.images, ozonSnapshot?.imageUrl || cleanText(input.ozonImageUrl, 1500) || null, null);
  let storedImageUrl = uploaded[0]?.url || ozonSnapshot?.imageUrl || null;
  let storedImagePublicId = uploaded[0]?.publicId || null;
  let storedImages = uploaded;
  if (storedImageUrl && !storedImagePublicId) {
    try {
      const mirrored = await mirrorPurchaseImage(storedImageUrl, planId);
      storedImageUrl = mirrored.url;
      storedImagePublicId = mirrored.publicId;
      storedImages = [{ url: mirrored.url, publicId: mirrored.publicId }, ...uploaded.slice(1)];
    } catch (error) {
      const imageWarning = cleanText(
        error instanceof Error ? error.message : "Не удалось сохранить фото в Cloudinary",
        300
      );
      ozonLastError = [ozonLastError, imageWarning].filter(Boolean).join(" · ");
    }
  }
  const row: Record<string, unknown> = {
    id: planId,
    product_id: productId,
    product_name: ozonSnapshot?.title || productName,
    sku: cleanText(input.sku, 80) || null,
    ozon_url: currentOzonUrl,
    ozon_image_url: storedImageUrl,
    ozon_image_public_id: storedImagePublicId,
    images: storedImages,
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
  let insert = await db.from("warehouse_purchase_plans").insert(row).select("*").single();
  if (insert.error && String(insert.error.message || "").includes("images")) {
    const { images: _images, ...withoutImages } = row;
    insert = await db.from("warehouse_purchase_plans").insert(withoutImages).select("*").single();
  }
  const { data, error } = insert;
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
    let imageUrl = existing.ozon_image_url || snapshot.imageUrl || null;
    let imagePublicId = existing.ozon_image_public_id || null;
    let imageWarning: string | null = null;
    if (snapshot.imageUrl) {
      try {
        const mirrored = await mirrorPurchaseImage(snapshot.imageUrl, id);
        imageUrl = mirrored.url;
        imagePublicId = mirrored.publicId;
      } catch (error) {
        imageWarning = cleanText(
          error instanceof Error ? error.message : "Не удалось обновить фото в Cloudinary",
          300
        );
      }
    }
    const { data, error } = await db
      .from("warehouse_purchase_plans")
      .update({
        product_name: snapshot.title || existing.product_name,
        ozon_url: snapshot.url,
        ozon_image_url: imageUrl,
        ozon_image_public_id: imagePublicId,
        ozon_price: snapshot.price,
        ozon_checked_at: checkedAt,
        ozon_price_updated_at: checkedAt,
        ozon_last_error: imageWarning,
        target_amount: snapshot.price,
        updated_at: checkedAt,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw migrationError(error);
    revalidateTag("purchase-plans", { expire: 0 });
    return { plan: mapPlan(data), warning: imageWarning };
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
  /** bank = исходящий платёж; salary = выплата в зарплатах. */
  spendMode?: unknown;
  /** true — не влияет на текущий банк/кассу («вне баланса»). */
  excludeFromBalance?: unknown;
  /** Для spendMode=salary — id сотрудника (необязательно). */
  employeeId?: unknown;
  employeeName?: unknown;
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
  if (
    existing.status === "completed" ||
    existing.spent_payment_id ||
    existing.spent_salary_id
  ) {
    throw new Error("Накопленная сумма уже списана");
  }

  const contributions = normalizeContributions(existing.contributions);
  const amount = purchaseSavedAmount(contributions);
  if (amount <= 0) throw new Error("Сначала добавьте накопления");
  const account = normalizeAccount(input.account ?? existing.account);
  const spendMode: PurchaseSpendMode =
    input.spendMode === "salary" ? "salary" : "bank";
  const excludeFromBalance = input.excludeFromBalance === true;
  const date = getWarehouseBusinessDate();
  const productLabel = String(existing.product_name || "товар");
  const now = new Date().toISOString();

  let spentPaymentId: string | null = null;
  let spentSalaryId: string | null = null;

  if (spendMode === "salary") {
    // Выплата в ЗП: source = cash | bank (ym_card кодируется тегом).
    const employeeName =
      cleanText(input.employeeName, 200) ||
      `Закупка — ${productLabel}`.slice(0, 200);
    const employeeId = cleanText(input.employeeId, 100) || null;
    const dbSource = account === "cash" ? "cash" : "bank";
    const tags: string[] = [];
    if (account === "ym_card") tags.push(SALARY_YM_CARD_TAG);
    if (excludeFromBalance) tags.push(SALARY_EXCLUDE_BALANCE_TAG);
    const comment = [
      ...tags,
      `Списание закупки «${productLabel}»`,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 500);

    const { data: salary, error: salaryError } = await db
      .from("salaries")
      .insert({
        employee_id: employeeId,
        employee_name: employeeName,
        amount,
        date,
        source: dbSource,
        is_paid: true,
        paid_at: date,
        comment,
      })
      .select("id")
      .single();
    if (salaryError || !salary) {
      throw salaryError || new Error("Не удалось создать выплату в ЗП");
    }
    spentSalaryId = String(salary.id);
  } else {
    const number = await nextPaymentNumber();
    const paymentType =
      account === "cash" ? "cash" : account === "ym_card" ? "ym_card" : "regular";
    const commentParts = [
      `Списание накоплений по плану закупки «${productLabel}»`,
      excludeFromBalance ? SALARY_EXCLUDE_BALANCE_TAG : null,
    ].filter(Boolean);
    const { data: payment, error: paymentError } = await db
      .from("bank_payments")
      .insert({
        number,
        date,
        direction: "outgoing",
        type: paymentType,
        cash_destination: null,
        counterparty: `Закупка — ${productLabel}`.slice(0, 200),
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
        exclude_from_balance: excludeFromBalance,
        comment: commentParts.join(" ").slice(0, 500),
      })
      .select("id")
      .single();
    if (paymentError || !payment) {
      throw paymentError || new Error("Не удалось создать списание");
    }
    spentPaymentId = String(payment.id);
  }

  const updatePayload: Record<string, unknown> = {
    account,
    status: "completed",
    spent_amount: amount,
    spent_payment_id: spentPaymentId,
    spent_at: now,
    updated_at: now,
  };
  // Новые колонки (миграция может быть не применена) — пишем мягко.
  updatePayload.spent_salary_id = spentSalaryId;
  updatePayload.spend_mode = spendMode;
  updatePayload.exclude_from_balance = excludeFromBalance;

  let update = await db
    .from("warehouse_purchase_plans")
    .update(updatePayload)
    .eq("id", id)
    .eq("status", "active")
    .select("*")
    .maybeSingle();

  if (
    update.error &&
    (String(update.error.message || "").includes("spent_salary") ||
      String(update.error.message || "").includes("spend_mode") ||
      String(update.error.message || "").includes("exclude_from_balance") ||
      update.error.code === "PGRST204" ||
      update.error.code === "42703")
  ) {
    // Без новых колонок — сохраняем минимум (как раньше).
    const minimal: Record<string, unknown> = {
      account,
      status: "completed",
      spent_amount: amount,
      spent_payment_id: spentPaymentId,
      spent_at: now,
      updated_at: now,
    };
    update = await db
      .from("warehouse_purchase_plans")
      .update(minimal)
      .eq("id", id)
      .eq("status", "active")
      .select("*")
      .maybeSingle();
  }

  if (update.error || !update.data) {
    if (spentPaymentId) {
      await db.from("bank_payments").delete().eq("id", spentPaymentId);
    }
    if (spentSalaryId) {
      await db.from("salaries").delete().eq("id", spentSalaryId);
    }
    throw update.error || new Error("План уже был списан");
  }

  revalidateTag("purchase-plans", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("warehouse-salaries", { expire: 0 });
  return mapPlan(update.data);
}

export async function updatePurchasePlan(input: {
  id: unknown;
  productName?: unknown;
  sku?: unknown;
  targetAmount?: unknown;
  contributionAmount?: unknown;
  account?: unknown;
  images?: unknown;
  status?: unknown;
}): Promise<PurchasePlan> {
  const id = cleanText(input.id, 100);
  if (!id) throw new Error("План не найден");
  const db = getAdminDb();
  const { data: existing, error: readError } = await db
    .from("warehouse_purchase_plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw migrationError(readError);
  if (!existing) throw new Error("План не найден");

  const images = input.images !== undefined
    ? normalizeImages(input.images, existing.ozon_image_url, existing.ozon_image_public_id)
    : normalizeImages(existing.images, existing.ozon_image_url, existing.ozon_image_public_id);

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    product_name: cleanText(input.productName, 300) || existing.product_name || "Товар",
    sku: input.sku !== undefined ? cleanText(input.sku, 80) || null : existing.sku,
    target_amount: input.targetAmount !== undefined ? Math.max(0, round2(input.targetAmount)) : existing.target_amount,
    contribution_amount: input.contributionAmount !== undefined
      ? Math.max(0.01, round2(input.contributionAmount) || 500)
      : existing.contribution_amount,
    account: input.account !== undefined ? normalizeAccount(input.account) : existing.account,
    ozon_image_url: images[0]?.url || null,
    ozon_image_public_id: images[0]?.publicId || null,
    images,
  };
  if (input.status === "active" || input.status === "completed") {
    payload.status = input.status;
    if (input.status === "active") {
      payload.spent_amount = 0;
      payload.spent_payment_id = null;
      payload.spent_salary_id = null;
      payload.spend_mode = null;
      payload.exclude_from_balance = false;
      payload.spent_at = null;
    }
  }

  let update = await db.from("warehouse_purchase_plans").update(payload).eq("id", id).select("*").single();
  if (update.error && String(update.error.message || "").includes("images")) {
    const { images: _images, ...withoutImages } = payload;
    update = await db.from("warehouse_purchase_plans").update(withoutImages).eq("id", id).select("*").single();
  }
  if (update.error) throw migrationError(update.error);
  revalidateTag("purchase-plans", { expire: 0 });
  return mapPlan(update.data);
}

export async function deletePurchasePlan(idValue: unknown): Promise<void> {
  const id = cleanText(idValue, 100);
  if (!id) throw new Error("План не найден");
  const db = getAdminDb();
  const { error } = await db.from("warehouse_purchase_plans").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("purchase-plans", { expire: 0 });
}
