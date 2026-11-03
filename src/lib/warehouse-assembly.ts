// =========================================================
// FILE: src/lib/warehouse-assembly.ts
// Комплектация / разукомплектация номенклатуры (как в 1С) +
// автоприход выпуска поставкой от «СибГофроТорг» по стандартной формуле:
//   цена_коробки = (цена_листа_из_последнего_прихода / коробок_с_листа) + 2 ₽
// с возможностью ручной корректировки цены пользователем.
//
// Модуль чистый (без server-only / React) — используется и в UI, и в API,
// и покрыт модульными тестами.
// =========================================================

export type AssemblyOperationKind = "assembly" | "disassembly";
export type AssemblyStatus = "posted" | "cancelled";

/** Поставщик автоприхода при комплектации собственной продукции. */
export const SELF_ASSEMBLY_SUPPLIER_NAME = "СибГофроТорг";

/** Стандартная надбавка переработки на 1 получаемую коробку (+2 ₽ сверху). */
export const DEFAULT_ASSEMBLY_SURCHARGE_RUB = 2;

export interface LatestSupplierReceiptPrice {
  productId: string;
  price: number;
  receiptId?: string | null;
  receiptNumber?: number | null;
  receiptDate?: string | null;
  supplier?: string | null;
  source: "receipt" | "card";
}

export interface AssemblyLineItem {
  productId: string;
  name: string;
  sku: string | null;
  quantity: number;
  /** Закупочная/приходная цена за 1 ед. (₽). */
  unitCost: number | null;
  /** Суммарная стоимость строки (₽). */
  lineCost: number;
  /** Была ли цена задана вручную пользователем (иначе рассчитана по формуле). */
  isManualPrice?: boolean;
  /** Номер последнего прихода поставщика, откуда взята цена сырья (если есть). */
  sourceReceiptNumber?: number | null;
  /** Поставщик последнего прихода сырья (если есть). */
  sourceSupplier?: string | null;
  /** Предыдущая закупочная цена карточки товара (для корректного сторно). */
  previousPurchasePrice?: number | null;
}

export interface WarehouseAssembly {
  id: string;
  number: number;
  /** Дата документа YYYY-MM-DD. */
  date: string;
  status: AssemblyStatus;
  kind: AssemblyOperationKind;
  /** Списанные со склада позиции (исходное сырьё / листы / комплектующие). */
  spentItems: AssemblyLineItem[];
  /** Оприходованные на склад позиции (получившаяся продукция / коробки). */
  producedItems: AssemblyLineItem[];
  /** Общая себестоимость потраченного сырья (₽, без надбавки). */
  totalCost: number;
  /** Итоговая сумма оприходования выпуска (₽, с учётом +2 ₽ или ручных цен). */
  producedTotalCost?: number;
  /** Выход изделий с 1 единицы сырья (например, коробок с 1 листа). */
  boxesPerSheet?: number | null;
  /** Надбавка на 1 ед. выхода (по умолчанию +2 ₽ для комплектации). */
  surchargeRub?: number | null;
  /** ID связанного приходного ордера ПО-… от «СибГофроТорг». */
  linkedReceiptId?: string | null;
  /** Номер связанного приходного ордера ПО-… от «СибГофроТорг». */
  linkedReceiptNumber?: number | null;
  /** Обновлялась ли закупочная цена выходной позиции при проведении. */
  updatePurchasePrice: boolean;
  comment: string | null;
  createdBy: string | null;
  createdAt: string;
  cancelledAt: string | null;
}

export interface AssemblyDraftLine {
  productId: string;
  quantity: number;
  /**
   * Пользовательская цена прихода за 1 ед. (₽).
   * Если не указана — рассчитывается автоматически по формуле
   * `(цена_листа_из_последнего_прихода / коробок_с_листа) + 2 ₽`.
   */
  unitPrice?: number | null;
}

export interface AssemblyProductSnapshot {
  id: string;
  name: string;
  sku: string | null;
  stockQty: number;
  purchasePrice: number | null;
  price?: number | null;
}

export interface AssemblyPreset {
  key: string;
  kind: AssemblyOperationKind;
  spentProductId: string;
  spentProductName: string;
  spentSku: string | null;
  producedProductId: string;
  producedProductName: string;
  producedSku: string | null;
  lastSpentQty: number;
  lastProducedQty: number;
  /** Сколько единиц выхода получается с 1 единицы расхода. */
  ratio: number;
  usesCount: number;
  lastDate: string;
}

export interface ProductAssemblyHistoryEvent {
  id: string;
  number: number;
  date: string;
  kind: AssemblyOperationKind;
  role: "spent" | "produced";
  /** Изменение остатка для данного товара: отрицательное при расходе, положительное при выпуске. */
  qtyChange: number;
  unitCost: number | null;
  /** Краткое описание второй стороны («→ Коробка 600×400×400 (+200 шт.)» или «← Гофролист Т-24 (−100 шт.)»). */
  counterpartLabel: string;
  linkedReceiptId?: string | null;
  linkedReceiptNumber?: number | null;
  comment: string | null;
}

export function roundQty(value: number): number {
  const n = Number(value) || 0;
  return Math.round(n * 1000) / 1000;
}

export function roundMoney(value: number): number {
  const n = Number(value) || 0;
  return Math.round(n * 100) / 100;
}

/**
 * Определяет, является ли поставщик собственным автоприходом «СибГофроТорг»
 * (чтобы при поиске последнего прихода листа брать именно закупку у внешнего поставщика).
 */
export function isSelfAssemblySupplierName(
  supplier: string | null | undefined
): boolean {
  const normalized = String(supplier || "")
    .toLowerCase()
    .replace(/[«»"'`.,()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    normalized.includes("сибгофроторг") || normalized.includes("sibgofrotorg")
  );
}

/**
 * Стандартная формула расчёта закупочной цены (себестоимости) коробки из листа:
 *   цена_коробки = (цена_листа / кол-во_коробок_с_1_листа) + 2 ₽
 */
export function computeStandardBoxUnitCost(params: {
  sheetPrice: number | null | undefined;
  boxesPerSheet: number | null | undefined;
  surchargeRub?: number;
}): number | null {
  const sheetPrice = Number(params.sheetPrice);
  const boxesPerSheet = Number(params.boxesPerSheet);
  if (
    !Number.isFinite(sheetPrice) ||
    sheetPrice <= 0 ||
    !Number.isFinite(boxesPerSheet) ||
    boxesPerSheet <= 0
  ) {
    return null;
  }
  const surcharge =
    params.surchargeRub !== undefined && Number.isFinite(Number(params.surchargeRub))
      ? Number(params.surchargeRub)
      : DEFAULT_ASSEMBLY_SURCHARGE_RUB;
  return roundMoney(sheetPrice / boxesPerSheet + surcharge);
}

interface NormalizedDraftLine {
  productId: string;
  quantity: number;
  unitPrice: number | null;
}

function normalizeDraftLines(lines: AssemblyDraftLine[]): NormalizedDraftLine[] {
  const merged = new Map<
    string,
    { quantity: number; unitPrice: number | null }
  >();
  for (const raw of Array.isArray(lines) ? lines : []) {
    const productId = String(raw?.productId || "").trim();
    const qty = roundQty(Number(raw?.quantity) || 0);
    if (!productId || qty <= 0) continue;
    const rawUnitPrice =
      raw?.unitPrice !== undefined &&
      raw?.unitPrice !== null &&
      String(raw.unitPrice).trim() !== "" &&
      Number.isFinite(Number(raw.unitPrice)) &&
      Number(raw.unitPrice) >= 0
        ? roundMoney(Number(raw.unitPrice))
        : null;
    const prev = merged.get(productId);
    merged.set(productId, {
      quantity: roundQty((prev?.quantity || 0) + qty),
      unitPrice: rawUnitPrice !== null ? rawUnitPrice : prev?.unitPrice ?? null,
    });
  }
  return [...merged.entries()].map(([productId, v]) => ({
    productId,
    quantity: v.quantity,
    unitPrice: v.unitPrice,
  }));
}

function lookupSupplierPrice(
  source:
    | Map<string, LatestSupplierReceiptPrice>
    | Record<string, LatestSupplierReceiptPrice>
    | undefined,
  productId: string
): LatestSupplierReceiptPrice | null {
  if (!source) return null;
  if (source instanceof Map) return source.get(productId) ?? null;
  return source[productId] ?? null;
}

export interface PreparedAssemblyPlan {
  kind: AssemblyOperationKind;
  date: string;
  spentItems: AssemblyLineItem[];
  producedItems: AssemblyLineItem[];
  /** Себестоимость потраченного сырья (листов) без надбавки. */
  totalCost: number;
  /** Суммарная стоимость оприходования выпуска (с учётом +2 ₽ или ручных цен). */
  producedTotalCost: number;
  boxesPerSheet: number | null;
  surchargeRub: number;
  updatePurchasePrice: boolean;
  allowNegativeStock: boolean;
  comment: string | null;
  /** Только списание исходного сырья (используется, когда приход выпуска проводит ПО-…). */
  spentStockDeltas: Array<{ productId: string; delta: number }>;
  /** Полные движения остатков (списание сырья + оприходование выпуска). */
  stockDeltas: Array<{ productId: string; delta: number }>;
}

/**
 * Проверяет входные данные комплектации, подтягивает цену листа из последнего
 * прихода поставщика (с фолбэком на закупочную цену карточки) и рассчитывает
 * приходную цену получаемых позиций по формуле `(цена_листа / выход_с_листа) + 2 ₽`
 * (либо берёт цену, явно указанную пользователем).
 */
export function prepareAssemblyPlan(params: {
  kind?: AssemblyOperationKind;
  date?: string | null;
  spent: AssemblyDraftLine[];
  produced: AssemblyDraftLine[];
  productsById: Map<string, AssemblyProductSnapshot>;
  latestSupplierPrices?:
    | Map<string, LatestSupplierReceiptPrice>
    | Record<string, LatestSupplierReceiptPrice>;
  surchargeRub?: number;
  updatePurchasePrice?: boolean;
  allowNegativeStock?: boolean;
  comment?: string | null;
  todayIso?: string;
}): PreparedAssemblyPlan {
  const kind: AssemblyOperationKind =
    params.kind === "disassembly" ? "disassembly" : "assembly";
  const fallbackDate =
    params.todayIso || new Date().toISOString().slice(0, 10);
  const rawDate = String(params.date || "").slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : fallbackDate;

  const spentDraft = normalizeDraftLines(params.spent);
  const producedDraft = normalizeDraftLines(params.produced);

  if (spentDraft.length === 0) {
    throw new Error(
      "Выберите исходный товар и укажите количество потраченного больше нуля"
    );
  }
  if (producedDraft.length === 0) {
    throw new Error(
      "Выберите получаемую позицию и укажите количество выхода больше нуля"
    );
  }

  const spentIds = new Set(spentDraft.map((item) => item.productId));
  for (const out of producedDraft) {
    if (spentIds.has(out.productId)) {
      const prod = params.productsById.get(out.productId);
      throw new Error(
        `Исходный и получаемый товар должны отличаться${
          prod ? ` («${prod.name}» выбран с обеих сторон)` : ""
        }`
      );
    }
  }

  const allowNegativeStock = params.allowNegativeStock === true;
  const effectiveSurcharge =
    params.surchargeRub !== undefined && Number.isFinite(Number(params.surchargeRub))
      ? roundMoney(Number(params.surchargeRub))
      : kind === "assembly"
        ? DEFAULT_ASSEMBLY_SURCHARGE_RUB
        : 0;

  const spentItems: AssemblyLineItem[] = [];

  for (const line of spentDraft) {
    const product = params.productsById.get(line.productId);
    if (!product) {
      throw new Error(`Исходный товар не найден (${line.productId})`);
    }
    const available = roundQty(Number(product.stockQty) || 0);
    if (!allowNegativeStock && available + 1e-6 < line.quantity) {
      throw new Error(
        `Недостаточно остатка «${product.name}»: на складе ${available} шт., требуется ${line.quantity} шт.`
      );
    }

    const latestReceipt = lookupSupplierPrice(
      params.latestSupplierPrices,
      product.id
    );
    const resolvedSheetPrice =
      latestReceipt && Number(latestReceipt.price) > 0
        ? roundMoney(Number(latestReceipt.price))
        : product.purchasePrice != null && Number(product.purchasePrice) > 0
          ? roundMoney(Number(product.purchasePrice))
          : null;

    const lineCost =
      resolvedSheetPrice != null
        ? roundMoney(resolvedSheetPrice * line.quantity)
        : 0;

    spentItems.push({
      productId: product.id,
      name: product.name,
      sku: product.sku ?? null,
      quantity: line.quantity,
      unitCost: resolvedSheetPrice,
      lineCost,
      ...(latestReceipt?.source === "receipt"
        ? {
            sourceReceiptNumber: latestReceipt.receiptNumber ?? null,
            sourceSupplier: latestReceipt.supplier ?? null,
          }
        : {}),
    });
  }

  const totalCost = roundMoney(
    spentItems.reduce((sum, item) => sum + item.lineCost, 0)
  );

  const producedSnapshots = producedDraft.map((line) => {
    const product = params.productsById.get(line.productId);
    if (!product) {
      throw new Error(`Получаемый товар не найден (${line.productId})`);
    }
    return { line, product };
  });

  const boxesPerSheet =
    spentItems.length === 1 &&
    producedSnapshots.length === 1 &&
    spentItems[0].quantity > 0
      ? Math.round(
          (producedSnapshots[0].line.quantity / spentItems[0].quantity) * 10000
        ) / 10000
      : null;

  const weights = producedSnapshots.map(({ line, product }) => {
    const salePrice = Number(product.price) || 0;
    return salePrice > 0 ? salePrice * line.quantity : 0;
  });
  const totalSaleWeight = weights.reduce((s, w) => s + w, 0);
  const totalOutQty = producedDraft.reduce((s, l) => s + l.quantity, 0);

  let allocatedRawSoFar = 0;
  const producedItems: AssemblyLineItem[] = producedSnapshots.map(
    ({ line, product }, idx) => {
      // 1. Базовая доля стоимости исходного сырья (листа) на эту строку
      let rawMaterialLineCost = 0;
      if (totalCost > 0) {
        if (idx === producedSnapshots.length - 1) {
          rawMaterialLineCost = Math.max(
            0,
            roundMoney(totalCost - allocatedRawSoFar)
          );
        } else {
          const share =
            totalSaleWeight > 0
              ? weights[idx] / totalSaleWeight
              : totalOutQty > 0
                ? line.quantity / totalOutQty
                : 0;
          rawMaterialLineCost = roundMoney(totalCost * share);
          allocatedRawSoFar = roundMoney(
            allocatedRawSoFar + rawMaterialLineCost
          );
        }
      }

      // 2. Если пользователь указал свою цену прихода — используем её;
      //    иначе считаем по стандартной формуле:
      //    (цена_листа / кол-во_коробок_с_листа) + 2 ₽.
      let unitCost: number | null = null;
      let lineCost = 0;
      let isManualPrice = false;

      if (line.unitPrice !== null && line.unitPrice >= 0) {
        unitCost = roundMoney(line.unitPrice);
        lineCost = roundMoney(unitCost * line.quantity);
        isManualPrice = true;
      } else if (
        spentItems.length === 1 &&
        producedSnapshots.length === 1 &&
        spentItems[0].unitCost != null &&
        boxesPerSheet != null &&
        boxesPerSheet > 0
      ) {
        unitCost = computeStandardBoxUnitCost({
          sheetPrice: spentItems[0].unitCost,
          boxesPerSheet,
          surchargeRub: effectiveSurcharge,
        });
        lineCost = unitCost != null ? roundMoney(unitCost * line.quantity) : 0;
      } else if (rawMaterialLineCost > 0 && line.quantity > 0) {
        const rawPerUnit = rawMaterialLineCost / line.quantity;
        unitCost = roundMoney(rawPerUnit + effectiveSurcharge);
        lineCost =
          effectiveSurcharge === 0
            ? rawMaterialLineCost
            : roundMoney(unitCost * line.quantity);
      }

      return {
        productId: product.id,
        name: product.name,
        sku: product.sku ?? null,
        quantity: line.quantity,
        unitCost,
        lineCost,
        isManualPrice,
        previousPurchasePrice:
          product.purchasePrice != null ? Number(product.purchasePrice) : null,
      };
    }
  );

  const producedTotalCost = roundMoney(
    producedItems.reduce((sum, item) => sum + item.lineCost, 0)
  );

  const spentStockDeltas: Array<{ productId: string; delta: number }> =
    spentItems.map((it) => ({
      productId: it.productId,
      delta: -roundQty(it.quantity),
    }));

  const stockDeltas: Array<{ productId: string; delta: number }> = [
    ...spentStockDeltas,
    ...producedItems.map((it) => ({
      productId: it.productId,
      delta: roundQty(it.quantity),
    })),
  ];

  const cleanComment = params.comment
    ? String(params.comment).trim().slice(0, 500) || null
    : null;

  const hasProducedPrice = producedItems.some(
    (it) => it.unitCost != null && it.unitCost > 0
  );

  return {
    kind,
    date,
    spentItems,
    producedItems,
    totalCost,
    producedTotalCost,
    boxesPerSheet,
    surchargeRub: effectiveSurcharge,
    updatePurchasePrice:
      params.updatePurchasePrice !== false && hasProducedPrice,
    allowNegativeStock,
    comment: cleanComment,
    spentStockDeltas,
    stockDeltas,
  };
}

/**
 * Возвращает движения остатков по документу комплектации.
 * `direction = 1` — проведение, `direction = -1` — сторно (отмена проведения).
 * Если у документа есть связанный приходный ордер `linkedReceiptId` и
 * `options.spentOnly = true`, возвращает только движение исходного сырья
 * (так как выпуск проведён/сторнируется через `ПО-…`).
 */
export function computeAssemblyStockDeltas(
  assembly: Pick<WarehouseAssembly, "spentItems" | "producedItems">,
  direction: 1 | -1 = 1,
  options?: { spentOnly?: boolean }
): Array<{ productId: string; delta: number }> {
  const byProduct = new Map<string, number>();
  for (const item of assembly.spentItems || []) {
    const qty = roundQty(Number(item.quantity) || 0);
    if (!item.productId || qty <= 0) continue;
    byProduct.set(
      item.productId,
      roundQty((byProduct.get(item.productId) || 0) - qty * direction)
    );
  }
  if (!options?.spentOnly) {
    for (const item of assembly.producedItems || []) {
      const qty = roundQty(Number(item.quantity) || 0);
      if (!item.productId || qty <= 0) continue;
      byProduct.set(
        item.productId,
        roundQty((byProduct.get(item.productId) || 0) + qty * direction)
      );
    }
  }
  return [...byProduct.entries()]
    .filter(([, delta]) => Math.abs(delta) > 1e-6)
    .map(([productId, delta]) => ({ productId, delta }));
}

function normalizeLineItem(raw: any): AssemblyLineItem | null {
  if (!raw || typeof raw !== "object") return null;
  const productId = String(raw.productId || raw.product_id || "").trim();
  const quantity = roundQty(Number(raw.quantity) || 0);
  if (!productId || quantity <= 0) return null;
  const unitCostRaw = raw.unitCost ?? raw.unit_cost;
  const unitCost =
    unitCostRaw != null &&
    Number.isFinite(Number(unitCostRaw)) &&
    Number(unitCostRaw) >= 0
      ? roundMoney(Number(unitCostRaw))
      : null;
  const lineCostRaw = raw.lineCost ?? raw.line_cost;
  const lineCost =
    lineCostRaw != null && Number.isFinite(Number(lineCostRaw))
      ? roundMoney(Math.max(0, Number(lineCostRaw)))
      : unitCost != null
        ? roundMoney(unitCost * quantity)
        : 0;
  const prevRaw = raw.previousPurchasePrice ?? raw.previous_purchase_price;
  const isManualRaw = raw.isManualPrice ?? raw.is_manual_price;
  const srcRecNoRaw = raw.sourceReceiptNumber ?? raw.source_receipt_number;
  const srcSuppRaw = raw.sourceSupplier ?? raw.source_supplier;
  return {
    productId,
    name: String(raw.name || "Товар"),
    sku: raw.sku ? String(raw.sku) : null,
    quantity,
    unitCost,
    lineCost,
    ...(isManualRaw !== undefined ? { isManualPrice: Boolean(isManualRaw) } : {}),
    ...(srcRecNoRaw != null && Number(srcRecNoRaw) > 0
      ? { sourceReceiptNumber: Number(srcRecNoRaw) }
      : {}),
    ...(srcSuppRaw ? { sourceSupplier: String(srcSuppRaw) } : {}),
    ...(prevRaw !== undefined
      ? {
          previousPurchasePrice:
            prevRaw != null && Number.isFinite(Number(prevRaw))
              ? Number(prevRaw)
              : null,
        }
      : {}),
  };
}

/** Нормализует сырую запись комплектации из таблицы БД или JSON-хранилища. */
export function normalizeWarehouseAssembly(raw: any): WarehouseAssembly | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  if (!id) return null;

  const spentRaw = Array.isArray(raw.spentItems ?? raw.spent_items)
    ? (raw.spentItems ?? raw.spent_items)
    : [];
  const producedRaw = Array.isArray(raw.producedItems ?? raw.produced_items)
    ? (raw.producedItems ?? raw.produced_items)
    : [];

  const spentItems = spentRaw
    .map(normalizeLineItem)
    .filter((x: AssemblyLineItem | null): x is AssemblyLineItem => x !== null);
  const producedItems = producedRaw
    .map(normalizeLineItem)
    .filter((x: AssemblyLineItem | null): x is AssemblyLineItem => x !== null);

  if (spentItems.length === 0 || producedItems.length === 0) return null;

  const totalCostRaw = raw.totalCost ?? raw.total_cost;
  const totalCost =
    totalCostRaw != null && Number.isFinite(Number(totalCostRaw))
      ? roundMoney(Math.max(0, Number(totalCostRaw)))
      : roundMoney(
          spentItems.reduce(
            (sum: number, it: AssemblyLineItem) => sum + it.lineCost,
            0
          )
        );

  const producedTotalCostRaw = raw.producedTotalCost ?? raw.produced_total_cost;
  const producedTotalCost =
    producedTotalCostRaw != null && Number.isFinite(Number(producedTotalCostRaw))
      ? roundMoney(Math.max(0, Number(producedTotalCostRaw)))
      : roundMoney(
          producedItems.reduce(
            (sum: number, it: AssemblyLineItem) => sum + it.lineCost,
            0
          )
        );

  const status: AssemblyStatus =
    raw.status === "cancelled" ? "cancelled" : "posted";
  const kind: AssemblyOperationKind =
    raw.kind === "disassembly" ? "disassembly" : "assembly";

  const linkedReceiptIdRaw = raw.linkedReceiptId ?? raw.linked_receipt_id;
  const linkedReceiptNumberRaw =
    raw.linkedReceiptNumber ?? raw.linked_receipt_number;
  const boxesPerSheetRaw = raw.boxesPerSheet ?? raw.boxes_per_sheet;
  const surchargeRubRaw = raw.surchargeRub ?? raw.surcharge_rub;

  return {
    id,
    number: Math.max(1, Math.floor(Number(raw.number) || 1)),
    date:
      String(raw.date || "").slice(0, 10) ||
      new Date().toISOString().slice(0, 10),
    status,
    kind,
    spentItems,
    producedItems,
    totalCost,
    producedTotalCost,
    boxesPerSheet:
      boxesPerSheetRaw != null && Number(boxesPerSheetRaw) > 0
        ? Number(boxesPerSheetRaw)
        : null,
    surchargeRub:
      surchargeRubRaw != null && Number.isFinite(Number(surchargeRubRaw))
        ? Number(surchargeRubRaw)
        : null,
    linkedReceiptId: linkedReceiptIdRaw ? String(linkedReceiptIdRaw) : null,
    linkedReceiptNumber:
      linkedReceiptNumberRaw != null && Number(linkedReceiptNumberRaw) > 0
        ? Math.floor(Number(linkedReceiptNumberRaw))
        : null,
    updatePurchasePrice: Boolean(
      raw.updatePurchasePrice ?? raw.update_purchase_price
    ),
    comment: raw.comment ? String(raw.comment) : null,
    createdBy:
      raw.createdBy || raw.created_by
        ? String(raw.createdBy || raw.created_by)
        : null,
    createdAt:
      raw.createdAt || raw.created_at
        ? String(raw.createdAt || raw.created_at)
        : new Date().toISOString(),
    cancelledAt:
      raw.cancelledAt || raw.cancelled_at
        ? String(raw.cancelledAt || raw.cancelled_at)
        : null,
  };
}

export function normalizeWarehouseAssemblies(raw: unknown): WarehouseAssembly[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: WarehouseAssembly[] = [];
  for (const entry of raw) {
    const doc = normalizeWarehouseAssembly(entry);
    if (!doc || seen.has(doc.id)) continue;
    seen.add(doc.id);
    result.push(doc);
  }
  return result.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.number - a.number;
  });
}

/**
 * Извлекает часто используемые связки («спецификации 1С») из истории
 * проведённых комплектаций для быстрого заполнения формы в 1 клик.
 */
export function extractAssemblyPresets(
  assemblies: WarehouseAssembly[],
  limit = 8
): AssemblyPreset[] {
  const map = new Map<string, AssemblyPreset>();
  const sorted = [...(assemblies || [])]
    .filter(
      (doc) =>
        doc.status === "posted" &&
        doc.spentItems.length === 1 &&
        doc.producedItems.length === 1
    )
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.number - a.number;
    });

  for (const doc of sorted) {
    const spent = doc.spentItems[0];
    const prod = doc.producedItems[0];
    const key = `${doc.kind}:${spent.productId}->${prod.productId}`;
    const existing = map.get(key);
    if (existing) {
      existing.usesCount += 1;
      continue;
    }
    const ratio =
      spent.quantity > 0
        ? Math.round((prod.quantity / spent.quantity) * 10000) / 10000
        : 1;
    map.set(key, {
      key,
      kind: doc.kind,
      spentProductId: spent.productId,
      spentProductName: spent.name,
      spentSku: spent.sku,
      producedProductId: prod.productId,
      producedProductName: prod.name,
      producedSku: prod.sku,
      lastSpentQty: spent.quantity,
      lastProducedQty: prod.quantity,
      ratio: ratio > 0 ? ratio : 1,
      usesCount: 1,
      lastDate: doc.date,
    });
  }

  return [...map.values()]
    .sort((a, b) => {
      if (b.usesCount !== a.usesCount) return b.usesCount - a.usesCount;
      return b.lastDate.localeCompare(a.lastDate);
    })
    .slice(0, limit);
}

/**
 * Собирает движения по конкретному товару из всех проведённых комплектаций
 * (для «Расширенной сводки» и честного расчёта ownStockQty).
 *
 * Важно: если выпуск комплектации оприходован связанной поставкой `ПО-…` от
 * «СибГофроТорг» (`doc.linkedReceiptId` заполнен), то приход готовой позиции
 * уже входит в `postedReceiptQty` складской сводки, поэтому в `netQty` для
 * формулы `ownStockQty` он повторно НЕ прибавляется (исключаем двойной счёт!).
 */
export function summarizeProductAssemblies(
  assemblies: WarehouseAssembly[],
  productId: string
): {
  events: ProductAssemblyHistoryEvent[];
  /** Суммарно оприходовано по комплектациям (+, включая связанные ПО-…). */
  assembledInQty: number;
  /** Суммарно списано в комплектациях (положительное число). */
  assembledOutQty: number;
  /**
   * Прямой вклад комплектаций в остаток СВЕРХ приходных ордеров `ПО-…`:
   * для документов со связанным `ПО-…` учитывается только списание сырья,
   * а приход выпуска уже учтён в `postedReceiptQty`.
   */
  netQty: number;
} {
  const id = String(productId || "").trim();
  const events: ProductAssemblyHistoryEvent[] = [];
  let assembledInQty = 0;
  let assembledOutQty = 0;
  let unreceiptedInQty = 0;

  for (const doc of assemblies || []) {
    if (doc.status !== "posted") continue;

    for (const spent of doc.spentItems) {
      if (spent.productId !== id) continue;
      assembledOutQty = roundQty(assembledOutQty + spent.quantity);
      const outSummary = doc.producedItems
        .map((p) => `${p.name} (+${p.quantity} шт.)`)
        .join(", ");
      events.push({
        id: doc.id,
        number: doc.number,
        date: doc.date,
        kind: doc.kind,
        role: "spent",
        qtyChange: -spent.quantity,
        unitCost: spent.unitCost,
        counterpartLabel: `→ ${outSummary}`,
        linkedReceiptId: doc.linkedReceiptId ?? null,
        linkedReceiptNumber: doc.linkedReceiptNumber ?? null,
        comment: doc.comment,
      });
    }

    for (const prod of doc.producedItems) {
      if (prod.productId !== id) continue;
      assembledInQty = roundQty(assembledInQty + prod.quantity);
      if (!doc.linkedReceiptId) {
        unreceiptedInQty = roundQty(unreceiptedInQty + prod.quantity);
      }
      const inSummary = doc.spentItems
        .map((s) => `${s.name} (−${s.quantity} шт.)`)
        .join(", ");
      const receiptSuffix = doc.linkedReceiptNumber
        ? ` · Приход ПО-${doc.linkedReceiptNumber} (${SELF_ASSEMBLY_SUPPLIER_NAME})`
        : "";
      events.push({
        id: doc.id,
        number: doc.number,
        date: doc.date,
        kind: doc.kind,
        role: "produced",
        qtyChange: prod.quantity,
        unitCost: prod.unitCost,
        counterpartLabel: `← ${inSummary}${receiptSuffix}`,
        linkedReceiptId: doc.linkedReceiptId ?? null,
        linkedReceiptNumber: doc.linkedReceiptNumber ?? null,
        comment: doc.comment,
      });
    }
  }

  return {
    events,
    assembledInQty,
    assembledOutQty,
    netQty: roundQty(unreceiptedInQty - assembledOutQty),
  };
}
