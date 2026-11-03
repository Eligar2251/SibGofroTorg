// =========================================================
// FILE: src/lib/warehouse-assembly-store.ts
// Хранилище и проведение документов «Комплектация номенклатуры» (КМП-…).
//
// Особенности проведения:
//   1. Цена исходного листа автоматически подтягивается из последнего прихода
//      внешнего поставщика (`warehouse_receipts`, исключая собственные приходы
//      от «СибГофроТорг»), с фолбэком на `products.purchase_price`.
//   2. Цена получаемой позиции (коробки) рассчитывается по стандартной формуле
//      `(цена_листа / кол-во_коробок_с_листа) + 2 ₽`, либо берётся цена,
//      явно указанная пользователем.
//   3. Получаемые позиции автоматически ставятся на склад проведённой поставкой
//      `ПО-…` от «СибГофроТорг» (`noPayment = true`, без ложного долга в банке),
//      а исходные листы списываются со склада. При сторно/удалении комплектации
//      связанная поставка `ПО-…` автоматически отменяется и удаляется.
// =========================================================

import { randomUUID } from "crypto";
import { revalidateTag } from "next/cache";
import { getAdminDb } from "@/lib/supabase";
import { invalidateProductsCache } from "@/lib/supabase-queries";
import {
  SELF_ASSEMBLY_SUPPLIER_NAME,
  computeAssemblyStockDeltas,
  isSelfAssemblySupplierName,
  normalizeWarehouseAssemblies,
  normalizeWarehouseAssembly,
  prepareAssemblyPlan,
  roundMoney,
  roundQty,
  type AssemblyDraftLine,
  type AssemblyOperationKind,
  type AssemblyProductSnapshot,
  type LatestSupplierReceiptPrice,
  type WarehouseAssembly,
} from "./warehouse-assembly";

const TABLE = "warehouse_assemblies";
const SETTINGS_KEY = "warehouse_assemblies";

let tableMissingUntil = 0;

function isMissingTableError(
  error: { code?: string; message?: string; details?: string } | null
): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = String(error.message || error.details || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|schema cache|Could not find the table/i.test(msg)
  );
}

function isMissingColumnError(
  error: { code?: string; message?: string; details?: string } | null
): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = String(error.message || error.details || "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .* does not exist|Could not find the '.*' column/i.test(msg)
  );
}

function parseJsonValue(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw ?? null;
}

function safeRevalidate(tag: string): void {
  try {
    revalidateTag(tag, { expire: 0 });
  } catch {
    /* вне контекста Next-запроса (в модульных тестах) */
  }
}

async function readFromSettings(): Promise<WarehouseAssembly[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    console.error("[warehouse-assemblies] read settings fallback error:", error);
    return [];
  }
  return normalizeWarehouseAssemblies(parseJsonValue(data?.value));
}

async function writeToSettings(docs: WarehouseAssembly[]): Promise<void> {
  const db = getAdminDb();
  const normalized = normalizeWarehouseAssemblies(docs);
  const { error } = await db.from("settings").upsert({
    key: SETTINGS_KEY,
    value: JSON.stringify(normalized),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

function enrichProducedItemsWithReceiptMeta(doc: WarehouseAssembly) {
  if (!doc.linkedReceiptId && !doc.linkedReceiptNumber) {
    return doc.producedItems;
  }
  return doc.producedItems.map((it, idx) =>
    idx === 0
      ? {
          ...it,
          _linkedReceiptId: doc.linkedReceiptId ?? null,
          _linkedReceiptNumber: doc.linkedReceiptNumber ?? null,
          _boxesPerSheet: doc.boxesPerSheet ?? null,
          _surchargeRub: doc.surchargeRub ?? null,
        }
      : it
  );
}

function hydrateReceiptMetaFromRow(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  const prodArr = Array.isArray(raw.producedItems ?? raw.produced_items)
    ? (raw.producedItems ?? raw.produced_items)
    : [];
  const first = prodArr[0];
  if (!first || typeof first !== "object") return raw;
  return {
    ...raw,
    linked_receipt_id:
      raw.linked_receipt_id ??
      raw.linkedReceiptId ??
      first._linkedReceiptId ??
      null,
    linked_receipt_number:
      raw.linked_receipt_number ??
      raw.linkedReceiptNumber ??
      first._linkedReceiptNumber ??
      null,
    boxes_per_sheet:
      raw.boxes_per_sheet ??
      raw.boxesPerSheet ??
      first._boxesPerSheet ??
      null,
    surcharge_rub:
      raw.surcharge_rub ?? raw.surchargeRub ?? first._surchargeRub ?? null,
  };
}

function toLegacyTableRow(doc: WarehouseAssembly) {
  return {
    id: doc.id,
    number: doc.number,
    date: doc.date,
    status: doc.status,
    kind: doc.kind,
    spent_items: doc.spentItems,
    produced_items: enrichProducedItemsWithReceiptMeta(doc),
    total_cost: doc.totalCost,
    update_purchase_price: doc.updatePurchasePrice,
    comment: doc.comment,
    created_by: doc.createdBy,
    created_at: doc.createdAt,
    cancelled_at: doc.cancelledAt,
    updated_at: new Date().toISOString(),
  };
}

function toTableRow(doc: WarehouseAssembly) {
  return {
    ...toLegacyTableRow(doc),
    produced_total_cost: doc.producedTotalCost ?? 0,
    boxes_per_sheet: doc.boxesPerSheet ?? null,
    surcharge_rub: doc.surchargeRub ?? null,
    linked_receipt_id: doc.linkedReceiptId ?? null,
    linked_receipt_number: doc.linkedReceiptNumber ?? null,
  };
}

async function readAllAssemblies(): Promise<{
  docs: WarehouseAssembly[];
  usingTable: boolean;
}> {
  if (Date.now() < tableMissingUntil) {
    return { docs: await readFromSettings(), usingTable: false };
  }
  const db = getAdminDb();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .order("date", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      tableMissingUntil = Date.now() + 5 * 60_000;
      return { docs: await readFromSettings(), usingTable: false };
    }
    throw error;
  }

  const rows = Array.isArray(data) ? data.map(hydrateReceiptMetaFromRow) : [];
  if (rows.length === 0) {
    const fromSettings = await readFromSettings();
    if (fromSettings.length > 0) {
      let { error: seedErr } = await db
        .from(TABLE)
        .upsert(fromSettings.map(toTableRow));
      if (seedErr && isMissingColumnError(seedErr)) {
        const retry = await db
          .from(TABLE)
          .upsert(fromSettings.map(toLegacyTableRow));
        seedErr = retry.error;
      }
      if (!seedErr) {
        return { docs: fromSettings, usingTable: true };
      }
    }
    return { docs: fromSettings, usingTable: true };
  }

  return { docs: normalizeWarehouseAssemblies(rows), usingTable: true };
}

export async function getWarehouseAssemblies(): Promise<WarehouseAssembly[]> {
  const { docs } = await readAllAssemblies();
  return docs;
}

/**
 * Находит последнюю закупочную цену каждого товара по приходным ордерам
 * внешних поставщиков (`warehouse_receipts`), исключая собственные приходы
 * от «СибГофроТорг». Для товаров без поставок возвращает цену из карточки.
 */
export async function getLatestSupplierReceiptPrices(): Promise<
  Record<string, LatestSupplierReceiptPrice>
> {
  const db = getAdminDb();
  const map: Record<string, LatestSupplierReceiptPrice> = {};

  try {
    const { data: receipts } = await db
      .from("warehouse_receipts")
      .select("id, number, date, supplier, status, items")
      .order("date", { ascending: false })
      .order("number", { ascending: false });

    const sortedReceipts = [...(Array.isArray(receipts) ? receipts : [])].sort(
      (a: any, b: any) => {
        const da = String(a?.date || "");
        const dbDate = String(b?.date || "");
        if (da !== dbDate) return dbDate.localeCompare(da);
        return (Number(b?.number) || 0) - (Number(a?.number) || 0);
      }
    );

    for (const row of sortedReceipts) {
      if (!row || (row as any).status === "cancelled") continue;
      const supplier = String((row as any).supplier || "").trim();
      // Исключаем собственные автоприходы от «СибГофроТорг»
      if (isSelfAssemblySupplierName(supplier)) continue;

      const items = Array.isArray((row as any).items) ? (row as any).items : [];
      for (const item of items) {
        const productId = String(
          item?.productId || item?.product_id || ""
        ).trim();
        const price = roundMoney(Number(item?.price) || 0);
        if (!productId || price <= 0) continue;
        if (map[productId]) continue; // уже записали самый свежий приход
        map[productId] = {
          productId,
          price,
          receiptId: (row as any).id ? String((row as any).id) : null,
          receiptNumber:
            (row as any).number != null ? Number((row as any).number) : null,
          receiptDate: (row as any).date
            ? String((row as any).date).slice(0, 10)
            : null,
          supplier: supplier || null,
          source: "receipt",
        };
      }
    }
  } catch (e) {
    console.warn("[warehouse-assemblies] latest supplier receipts lookup:", e);
  }

  return map;
}

async function applyProductStockDeltas(
  deltas: Array<{ productId: string; delta: number }>
): Promise<void> {
  const db = getAdminDb();
  const now = new Date().toISOString();
  for (const { productId, delta } of deltas) {
    if (!productId || Math.abs(delta) < 1e-6) continue;
    const { data: prod, error: selErr } = await db
      .from("products")
      .select("id, name, stock_qty")
      .eq("id", productId)
      .maybeSingle();
    if (selErr) {
      throw new Error(
        `Не удалось прочитать остаток товара (${productId}): ${selErr.message}`
      );
    }
    if (!prod) {
      throw new Error(`Товар не найден (${productId})`);
    }
    const newQty = roundQty(Number(prod.stock_qty || 0) + delta);
    const { error: updErr } = await db
      .from("products")
      .update({
        stock_qty: newQty,
        in_stock: Math.floor(newQty) >= 1,
        updated_at: now,
      })
      .eq("id", productId);
    if (updErr) {
      throw new Error(
        `Не удалось обновить остаток товара «${prod.name || productId}»: ${updErr.message}`
      );
    }
  }
}

export interface CreateAssemblyInput {
  kind?: AssemblyOperationKind;
  date?: string | null;
  spent: AssemblyDraftLine[];
  produced: AssemblyDraftLine[];
  surchargeRub?: number;
  updatePurchasePrice?: boolean;
  allowNegativeStock?: boolean;
  /**
   * По умолчанию `true`: выпуск ставится на склад проведённым приходным
   * ордером `ПО-…` от «СибГофроТорг» (`noPayment = true`).
   */
  createSupplierReceipt?: boolean;
  comment?: string | null;
  createdBy?: string | null;
}

/**
 * Создаёт и проводит документ «Комплектация номенклатуры» (КМП-…):
 * 1) списывает потраченные листы/комплектующие со склада;
 * 2) создаёт и проводит поставку `ПО-…` от «СибГофроТорг» с рассчитанными
 *    или указанными пользователем ценами (без ложного долга поставщику);
 * 3) обновляет закупочную цену готовой позиции (если включено).
 */
export async function createWarehouseAssembly(
  input: CreateAssemblyInput
): Promise<WarehouseAssembly> {
  const db = getAdminDb();

  const allProductIds = [
    ...new Set(
      [...(input.spent || []), ...(input.produced || [])]
        .map((l) => String(l?.productId || "").trim())
        .filter(Boolean)
    ),
  ];
  if (allProductIds.length === 0) {
    throw new Error("Выберите исходный и получаемый товары");
  }

  const [{ data: productRows, error: prodErr }, latestSupplierPrices] =
    await Promise.all([
      db
        .from("products")
        .select("id, name, sku, stock_qty, purchase_price, price"),
      getLatestSupplierReceiptPrices(),
    ]);

  if (prodErr) {
    throw new Error(`Не удалось загрузить товары: ${prodErr.message}`);
  }

  const productsById = new Map<string, AssemblyProductSnapshot>();
  for (const row of productRows || []) {
    const id = String((row as any).id || "");
    if (!id) continue;
    const purchasePrice =
      (row as any).purchase_price != null
        ? Number((row as any).purchase_price)
        : null;
    productsById.set(id, {
      id,
      name: String((row as any).name || "Товар"),
      sku: (row as any).sku ? String((row as any).sku) : null,
      stockQty: Number((row as any).stock_qty || 0),
      purchasePrice,
      price: (row as any).price != null ? Number((row as any).price) : null,
    });
    if (!latestSupplierPrices[id] && purchasePrice != null && purchasePrice > 0) {
      latestSupplierPrices[id] = {
        productId: id,
        price: roundMoney(purchasePrice),
        source: "card",
      };
    }
  }

  const plan = prepareAssemblyPlan({
    kind: input.kind,
    date: input.date,
    spent: input.spent,
    produced: input.produced,
    productsById,
    latestSupplierPrices,
    surchargeRub: input.surchargeRub,
    updatePurchasePrice: input.updatePurchasePrice,
    allowNegativeStock: input.allowNegativeStock,
    comment: input.comment,
  });

  const { docs: existingDocs, usingTable } = await readAllAssemblies();
  const maxExistingNumber = existingDocs.reduce(
    (max, d) => Math.max(max, Number(d.number) || 0),
    0
  );
  const nextNumber = maxExistingNumber + 1;
  const now = new Date().toISOString();

  const shouldCreateReceipt = input.createSupplierReceipt !== false;
  let linkedReceiptId: string | null = null;
  let linkedReceiptNumber: number | null = null;

  if (shouldCreateReceipt) {
    // 1. Списываем со склада только исходное сырьё (листы),
    //    а приход коробок проведёт приходный ордер ПО-… от «СибГофроТорг».
    await applyProductStockDeltas(plan.spentStockDeltas);

    try {
      const { createReceipt, postReceipt } = await import("./warehouse");
      const spentDesc = plan.spentItems
        .map((s) => `${s.name} (${s.quantity} шт.)`)
        .join(", ");
      const receiptComment = [
        `Комплектация КМП-${nextNumber}: из ${spentDesc}`,
        plan.comment || null,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 500);

      const createdReceipt = await createReceipt({
        supplier: SELF_ASSEMBLY_SUPPLIER_NAME,
        date: plan.date,
        noPayment: true,
        comment: receiptComment,
        items: plan.producedItems.map((it) => ({
          productId: it.productId,
          name: it.name,
          sku: it.sku,
          quantity: it.quantity,
          price: it.unitCost != null && it.unitCost >= 0 ? it.unitCost : 0,
        })),
      });

      await postReceipt(createdReceipt.id);
      linkedReceiptId = createdReceipt.id;
      linkedReceiptNumber = createdReceipt.number;
    } catch (receiptErr) {
      // Откатываем списание сырья, чтобы остатки остались консистентными
      await applyProductStockDeltas(
        plan.spentStockDeltas.map((d) => ({
          productId: d.productId,
          delta: -d.delta,
        }))
      ).catch(() => {});
      throw receiptErr;
    }
  } else {
    await applyProductStockDeltas(plan.stockDeltas);
  }

  // 2. Обновляем закупочную цену готовой позиции (по умолчанию включено)
  if (plan.updatePurchasePrice) {
    for (const out of plan.producedItems) {
      if (out.unitCost != null && out.unitCost > 0) {
        await db
          .from("products")
          .update({ purchase_price: out.unitCost, updated_at: now })
          .eq("id", out.productId);
      }
    }
  }

  const createdDoc: WarehouseAssembly = {
    id: `asm_${randomUUID()}`,
    number: nextNumber,
    date: plan.date,
    status: "posted",
    kind: plan.kind,
    spentItems: plan.spentItems,
    producedItems: plan.producedItems,
    totalCost: plan.totalCost,
    producedTotalCost: plan.producedTotalCost,
    boxesPerSheet: plan.boxesPerSheet,
    surchargeRub: plan.surchargeRub,
    linkedReceiptId,
    linkedReceiptNumber,
    updatePurchasePrice: plan.updatePurchasePrice,
    comment: plan.comment,
    createdBy: input.createdBy ? String(input.createdBy).slice(0, 160) : null,
    createdAt: now,
    cancelledAt: null,
  };

  // 3. Сохраняем документ комплектации
  if (usingTable) {
    let { error: insErr } = await db
      .from(TABLE)
      .insert(toTableRow(createdDoc));
    if (insErr && isMissingColumnError(insErr)) {
      const retry = await db
        .from(TABLE)
        .insert(toLegacyTableRow(createdDoc));
      insErr = retry.error;
    }
    if (insErr) {
      if (isMissingTableError(insErr)) {
        tableMissingUntil = Date.now() + 5 * 60_000;
        await writeToSettings([createdDoc, ...existingDocs]);
      } else {
        throw insErr;
      }
    }
  } else {
    await writeToSettings([createdDoc, ...existingDocs]);
  }

  invalidateProductsCache();
  safeRevalidate("products");
  safeRevalidate("warehouse-receipts");
  safeRevalidate("warehouse-assemblies");

  return createdDoc;
}

/**
 * Отмена проведения документа комплектации (сторно как в 1С):
 * возвращает списанные комплектующие на склад и отменяет/удаляет
 * связанную поставку `ПО-…` от «СибГофроТорг» (либо списывает выпуск напрямую
 * для старых документов без `linkedReceiptId`).
 */
export async function cancelWarehouseAssembly(
  id: string
): Promise<WarehouseAssembly> {
  const cleanId = String(id || "").trim();
  if (!cleanId) throw new Error("Не указан документ комплектации");

  const { docs, usingTable } = await readAllAssemblies();
  const target = docs.find((d) => d.id === cleanId);
  if (!target) throw new Error("Документ комплектации не найден");
  if (target.status === "cancelled") {
    throw new Error("Комплектация уже отменена");
  }

  const db = getAdminDb();

  if (target.linkedReceiptId) {
    // 1. Возвращаем списанное сырьё (листы) на склад
    const reverseSpent = computeAssemblyStockDeltas(target, -1, {
      spentOnly: true,
    });
    await applyProductStockDeltas(reverseSpent);

    // 2. Сторнируем и удаляем связанную поставку ПО-… от «СибГофроТорг»
    const { data: existingReceipt } = await db
      .from("warehouse_receipts")
      .select("id, status, received_items")
      .eq("id", target.linkedReceiptId)
      .maybeSingle();

    if (existingReceipt) {
      const { cancelReceipt, deleteReceipt } = await import("./warehouse");
      const hasReceived =
        existingReceipt.status === "posted" ||
        (Array.isArray(existingReceipt.received_items) &&
          existingReceipt.received_items.some(
            (r: any) => Number(r?.receivedQty || 0) > 0
          ));
      if (hasReceived) {
        await cancelReceipt(target.linkedReceiptId);
      }
      // Удаляем служебные внебалансовые платежи без оплаты, чтобы deleteReceipt
      // чисто убрал черновик поставки ПО-…
      try {
        const { data: linkedPays } = await db
          .from("bank_payments")
          .select("id, receipt_ids, exclude_from_balance");
        for (const p of linkedPays || []) {
          if (
            (p as any).exclude_from_balance &&
            Array.isArray((p as any).receipt_ids) &&
            (p as any).receipt_ids.length === 1 &&
            (p as any).receipt_ids[0] === target.linkedReceiptId
          ) {
            await db.from("bank_payments").delete().eq("id", (p as any).id);
          }
        }
      } catch {
        /* ignore */
      }
      await deleteReceipt(target.linkedReceiptId).catch((e) => {
        console.warn("[warehouse-assemblies] deleteReceipt on cancel:", e);
      });
    }
  } else {
    const reverseDeltas = computeAssemblyStockDeltas(target, -1);
    await applyProductStockDeltas(reverseDeltas);
  }

  const now = new Date().toISOString();

  // Откатываем закупочную цену готовой позиции, если после этой комплектации
  // не было более свежих проведённых комплектаций по этому товару.
  if (target.updatePurchasePrice) {
    for (const out of target.producedItems) {
      if (out.previousPurchasePrice === undefined) continue;
      const hasNewerPosted = docs.some(
        (other) =>
          other.id !== target.id &&
          other.status === "posted" &&
          other.updatePurchasePrice &&
          other.number > target.number &&
          other.producedItems.some((p) => p.productId === out.productId)
      );
      if (!hasNewerPosted) {
        await db
          .from("products")
          .update({
            purchase_price: out.previousPurchasePrice,
            updated_at: now,
          })
          .eq("id", out.productId);
      }
    }
  }

  const updated: WarehouseAssembly = {
    ...target,
    status: "cancelled",
    cancelledAt: now,
  };

  if (usingTable) {
    const { error: updErr } = await db
      .from(TABLE)
      .update({
        status: "cancelled",
        cancelled_at: now,
        updated_at: now,
      })
      .eq("id", cleanId);
    if (updErr) throw updErr;
  } else {
    const nextDocs = docs.map((d) => (d.id === cleanId ? updated : d));
    await writeToSettings(nextDocs);
  }

  invalidateProductsCache();
  safeRevalidate("products");
  safeRevalidate("warehouse-receipts");
  safeRevalidate("warehouse-assemblies");

  return normalizeWarehouseAssembly(updated) || updated;
}

/**
 * Удаляет документ комплектации. Если он ещё проведён — сначала сторнирует склад
 * и связанную поставку `ПО-…`.
 */
export async function deleteWarehouseAssembly(id: string): Promise<void> {
  const cleanId = String(id || "").trim();
  if (!cleanId) throw new Error("Не указан документ комплектации");

  const { docs, usingTable } = await readAllAssemblies();
  const target = docs.find((d) => d.id === cleanId);
  if (!target) throw new Error("Документ комплектации не найден");

  if (target.status === "posted") {
    await cancelWarehouseAssembly(cleanId);
  }

  const db = getAdminDb();
  if (usingTable && Date.now() >= tableMissingUntil) {
    const { error: delErr } = await db.from(TABLE).delete().eq("id", cleanId);
    if (delErr && !isMissingTableError(delErr)) throw delErr;
  } else {
    const { docs: refreshed } = await readAllAssemblies();
    await writeToSettings(refreshed.filter((d) => d.id !== cleanId));
  }

  safeRevalidate("warehouse-assemblies");
}
