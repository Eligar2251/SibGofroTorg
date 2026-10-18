// =========================================================
// FILE: src/components/admin/BulkPricesClient.tsx
// Массовое изменение цен: «Массовые цены» в разделе «Товары и категории».
//
// Как устроено (сверху вниз, как работает и взгляд пользователя):
//   1. «Выбранные товары» — всегда ПЕРВЫМИ: список тех товаров, которые
//      отмечены в каталоге. У каждой строки своя цена, закуп, накрутка и
//      маржа — можно поправить любую строку руками.
//   2. «Способ расчёта» — два режима:
//      • «Своя цена» — одна цена на все выбранные (массовое понижение:
//        в поле вводится цена, кнопками −5%/−10%… цена снижается от текущей);
//      • «Наценка от закупки» — цена считается как закуп × (1 + % / 100)
//        с округлением по выбранному правилу.
//   3. «Каталог» — выбор товаров: поиск, категория, фильтры. Выбранные
//      подсвечены и (по желанию) прячутся из списка.
//
// Проценты считает src/lib/price-calc.ts — те же формулы, что на складе
// в колонке «Разница»: маржа = (цена − закуп) / цена, накрутка =
// (цена − закуп) / закуп. Для товаров со скидкой отдельно показывается
// цена, которую видит покупатель (скидка вычитается).
// =========================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BadgePercent,
  Check,
  ChevronDown,
  Loader2,
  Percent,
  Save,
  Search,
  SlidersHorizontal,
  Tags,
  Wand2,
} from "lucide-react";
import { useWindowedList } from "@/hooks/use-windowed-list";
import {
  ROUNDING_MODES,
  applyRounding,
  effectivePrice,
  formatPercent,
  marginPercent,
  marginTone,
  markupPercent,
  parsePriceInput,
  priceFromDecrease,
  priceFromMarkup,
  profitPerUnit,
  round2,
  type RoundingMode,
} from "@/lib/price-calc";

export interface BulkPriceProduct {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  /** Базовая цена товара (products.price). */
  price: number | null;
  purchasePrice: number | null;
  /** У товара есть варианты: цена на сайте берётся из них. */
  hasVariants: boolean;
  variantCount: number;
  stockQty: number;
  isVisible: boolean;
  discountType: "percent" | "fixed" | null;
  discountValue: number | null;
}

type Mode = "manual" | "markup";

type Draft = {
  /** Новая цена строкой (пусто — ещё не задана). */
  price: string;
  /** Правка закупочной цены строкой (пусто — не трогаем). */
  purchase: string;
};

type SortKey = "name" | "margin_asc" | "margin_desc" | "price_asc" | "price_desc";

const PRESELECT_KEY = "bulk-prices:preselect";

const money = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;

const cellRight: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap" };

export function BulkPricesClient({
  products,
  categories,
  adminPath,
}: {
  products: BulkPriceProduct[];
  categories: { id: string; name: string }[];
  adminPath: string;
}) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const catName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  // Выбранные товары: id → черновик. Порядок ключей = порядок выбора,
  // поэтому в списке сверху товары идут ровно в том порядке, в каком их
  // отметили (плюс сортировка, см. sortKey).
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  // Что уже сохранено в этой сессии: после сохранения строка не должна
  // предлагать «сохранить ещё раз» то же самое, но при этом в таблице
  // остаются видны и исходная цена («Было»), и разница с ней.
  const [savedValues, setSavedValues] = useState<
    Record<string, { price: number; purchasePrice?: number | null }>
  >({});

  const [mode, setMode] = useState<Mode>("manual");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkMarkup, setBulkMarkup] = useState("");
  const [rounding, setRounding] = useState<RoundingMode>("none");
  const [keepAboveCost, setKeepAboveCost] = useState(true);
  const [savePurchase, setSavePurchase] = useState(false);
  const [clearDiscounts, setClearDiscounts] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [onlyWithPurchase, setOnlyWithPurchase] = useState(false);
  const [hideVariants, setHideVariants] = useState(true);
  const [onlyVisible, setOnlyVisible] = useState(false);
  const [hideSelectedInCatalog, setHideSelectedInCatalog] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  // Предвыбор из списка товаров: оттуда сюда приходит набор id
  // (sessionStorage — чтобы не тащить сотни id в адресной строке).
  const preselectedApplied = useRef(false);
  useEffect(() => {
    if (preselectedApplied.current || products.length === 0) return;
    preselectedApplied.current = true;
    let ids: string[] = [];
    try {
      const raw = sessionStorage.getItem(PRESELECT_KEY);
      if (raw) {
        ids = JSON.parse(raw);
        sessionStorage.removeItem(PRESELECT_KEY);
      }
    } catch {
      /* приватный режим — просто нет предвыбора */
    }
    if (!Array.isArray(ids) || ids.length === 0) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const product = byId.get(String(id));
        if (!product || next[product.id]) continue;
        next[product.id] = { price: product.price != null ? String(product.price) : "", purchase: "" };
      }
      return next;
    });
  }, [byId, products.length]);

  const selectProducts = useCallback(
    (ids: string[]) => {
      setDrafts((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          const product = byId.get(id);
          if (!product || next[id]) continue;
          next[id] = {
            price: product.price != null ? String(product.price) : "",
            purchase: "",
          };
        }
        return next;
      });
    },
    [byId]
  );

  const deselect = useCallback((ids: string[]) => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
  }, []);

  const selectedIds = useMemo(() => Object.keys(drafts), [drafts]);

  /** Текущие значения товара с учётом уже сохранённого в этой сессии. */
  const currentOf = useCallback(
    (product: BulkPriceProduct) => {
      const saved = savedValues[product.id];
      return {
        price: saved && saved.price !== undefined ? saved.price : product.price,
        purchasePrice:
          saved && saved.purchasePrice !== undefined ? saved.purchasePrice : product.purchasePrice,
      };
    },
    [savedValues]
  );

  /** Разбор строки: закуп, новая цена и все производные проценты. */
  const rowInfo = useCallback(
    (product: BulkPriceProduct, draft: Draft) => {
      const current = currentOf(product);
      const purchaseEdited = draft.purchase.trim() !== "";
      const purchaseParsed = purchaseEdited ? parsePriceInput(draft.purchase) : null;
      const purchase = purchaseEdited ? purchaseParsed : current.purchasePrice;

      const priceText = draft.price.trim();
      const newPrice = priceText === "" ? null : parsePriceInput(priceText);
      const priceInvalid = priceText !== "" && newPrice === null;

      const oldPrice = product.price;
      const diff = newPrice !== null && oldPrice !== null ? round2(newPrice - oldPrice) : null;
      const diffPercent =
        newPrice !== null && oldPrice !== null && oldPrice > 0
          ? round2(((newPrice - oldPrice) / oldPrice) * 100)
          : null;

      return {
        purchase,
        purchaseEdited,
        purchaseInvalid: purchaseEdited && purchaseParsed === null,
        newPrice,
        priceInvalid,
        oldPrice,
        /** Цена, записанная в базе сейчас (после сохранений в этой сессии). */
        currentPrice: current.price,
        currentPurchase: current.purchasePrice,
        diff,
        diffPercent,
        markup: newPrice !== null ? markupPercent(newPrice, purchase) : null,
        margin: newPrice !== null ? marginPercent(newPrice, purchase) : null,
        profit: newPrice !== null ? profitPerUnit(newPrice, purchase) : null,
        effective: newPrice !== null
          ? effectivePrice(newPrice, product.discountType, product.discountValue)
          : null,
        stockProfit:
          newPrice !== null && purchase != null
            ? round2((newPrice - purchase) * product.stockQty)
            : null,
      };
    },
    [currentOf]
  );

  const selectedProducts = useMemo(
    () => selectedIds.map((id) => byId.get(id)).filter(Boolean) as BulkPriceProduct[],
    [byId, selectedIds]
  );

  const selectedRows = useMemo(() => {
    const rows = selectedProducts.map((product) => ({
      product,
      info: rowInfo(product, drafts[product.id]),
    }));
    const sorted = [...rows];
    switch (sortKey) {
      case "margin_asc":
        sorted.sort((a, b) => (a.info.margin ?? 1e9) - (b.info.margin ?? 1e9));
        break;
      case "margin_desc":
        sorted.sort((a, b) => (b.info.margin ?? -1e9) - (a.info.margin ?? -1e9));
        break;
      case "price_asc":
        sorted.sort((a, b) => (a.info.oldPrice ?? 0) - (b.info.oldPrice ?? 0));
        break;
      case "price_desc":
        sorted.sort((a, b) => (b.info.oldPrice ?? 0) - (a.info.oldPrice ?? 0));
        break;
      default:
        sorted.sort((a, b) => a.product.name.localeCompare(b.product.name, "ru"));
    }
    return sorted;
  }, [drafts, rowInfo, selectedProducts, sortKey]);

  const summary = useMemo(() => {
    let withPrice = 0;
    let withoutPurchase = 0;
    let loss = 0;
    let oldSum = 0;
    let newSum = 0;
    let profitOnStock = 0;
    let marginSum = 0;
    let markupSum = 0;
    let marginCount = 0;
    let withVariants = 0;

    for (const { product, info } of selectedRows) {
      if (product.hasVariants) withVariants += 1;
      if (info.newPrice === null) continue;
      withPrice += 1;
      if (info.oldPrice !== null) oldSum += info.oldPrice;
      newSum += info.newPrice;
      if (info.purchase == null || info.purchase <= 0) withoutPurchase += 1;
      if (info.margin !== null) {
        marginSum += info.margin;
        marginCount += 1;
        if (info.margin < 0) loss += 1;
      }
      if (info.markup !== null) markupSum += info.markup;
      if (info.stockProfit !== null) profitOnStock += info.stockProfit;
    }

    return {
      total: selectedRows.length,
      withVariants,
      withPrice,
      withoutPrice: selectedRows.length - withPrice,
      withoutPurchase,
      loss,
      oldSum: round2(oldSum),
      newSum: round2(newSum),
      delta: round2(newSum - oldSum),
      deltaPercent: oldSum > 0 ? round2(((newSum - oldSum) / oldSum) * 100) : null,
      profitOnStock: round2(profitOnStock),
      avgMargin: marginCount > 0 ? round2(marginSum / marginCount) : null,
      avgMarkup: marginCount > 0 ? round2(markupSum / marginCount) : null,
    };
  }, [selectedRows]);

  // ── Массовые действия ─────────────────────────────────────

  /** Режим «Своя цена»: одна цена на все выбранные. */
  const applySinglePrice = useCallback(() => {
    const price = parsePriceInput(bulkPrice);
    if (price === null || price < 0) {
      setSaveError("Введите цену числом, например 1 290 или 1290,50");
      return;
    }
    setSaveError("");
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const product = byId.get(id);
        if (!product) continue;
        const purchase = product.purchasePrice;
        const finalPrice =
          keepAboveCost && purchase != null && price < purchase ? purchase : price;
        next[id] = { ...next[id], price: String(round2(finalPrice)) };
      }
      return next;
    });
    setSaveMessage(
      keepAboveCost
        ? "Цена проставлена всем выбранным (там, где она оказалась ниже закупки, поднята до закупочной)"
        : "Цена проставлена всем выбранным"
    );
  }, [bulkPrice, byId, keepAboveCost]);

  /**
   * Наценка от закупки для всех выбранных: цена = закуп × (1 + % / 100).
   * Одна функция и для кнопки «Рассчитать цены», и для кнопок-пресетов —
   * иначе два одинаковых расчёта рано или поздно разойдутся.
   */
  const applyMarkupPercent = useCallback(
    (percent: number) => {
      const updates: { id: string; price: number }[] = [];
      let skipped = 0;

      for (const id of Object.keys(drafts)) {
        const product = byId.get(id);
        if (!product) continue;
        const draft = drafts[id];
        const purchase =
          draft.purchase.trim() !== ""
            ? parsePriceInput(draft.purchase)
            : currentOf(product).purchasePrice;
        const price = priceFromMarkup(purchase, percent, rounding);
        if (price === null) {
          skipped += 1;
          continue;
        }
        updates.push({ id, price });
      }

      setSaveError("");
      setDrafts((prev) => {
        const next = { ...prev };
        for (const update of updates) {
          next[update.id] = { ...next[update.id], price: String(update.price) };
        }
        return next;
      });
      setSaveMessage(
        skipped > 0
          ? `Цены пересчитаны по наценке ${percent}%. Без закупочной цены: ${skipped} — им цена не задана`
          : `Цены пересчитаны по наценке ${percent}%`
      );
    },
    [byId, currentOf, drafts, rounding]
  );

  /** Кнопка «Рассчитать цены» в режиме «Наценка от закупки». */
  const applyMarkup = useCallback(() => {
    const percent = parsePriceInput(bulkMarkup);
    if (percent === null) {
      setSaveError("Введите наценку числом, например 35");
      return;
    }
    applyMarkupPercent(percent);
  }, [applyMarkupPercent, bulkMarkup]);

  /** Снижение от текущей цены строки (понижение цен на N%). */
  const decreaseBy = useCallback(
    (percent: number) => {
      setSaveError("");
      setDrafts((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next)) {
          const product = byId.get(id);
          if (!product) continue;
          const draft = next[id];
          const current = draft.price.trim() !== "" ? parsePriceInput(draft.price) : product.price;
          if (current === null) continue;
          const price = priceFromDecrease(current, percent, rounding);
          if (price === null) continue;
          const purchase =
            draft.purchase.trim() !== ""
              ? parsePriceInput(draft.purchase)
              : product.purchasePrice;
          const finalPrice =
            keepAboveCost && purchase != null && price < purchase ? round2(purchase) : price;
          next[id] = { ...draft, price: String(finalPrice) };
        }
        return next;
      });
      setSaveMessage(`Цены снижены на ${percent}% от текущих значений`);
    },
    [byId, keepAboveCost, rounding]
  );

  /** Округлить уже введённые цены выбранных товаров. */
  const roundSelected = useCallback(() => {
    setSaveError("");
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const draft = next[id];
        const price = parsePriceInput(draft.price);
        if (price === null) continue;
        next[id] = { ...draft, price: String(applyRounding(price, rounding)) };
      }
      return next;
    });
    setSaveMessage("Цены выбранных товаров округлены");
  }, [rounding]);

  const clearPrices = useCallback(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const product = byId.get(id);
        next[id] = {
          ...next[id],
          price: product?.price != null ? String(product.price) : "",
        };
      }
      return next;
    });
    setSaveMessage("Цены сброшены к текущим значениям товаров");
  }, [byId]);

  // ── Каталог ───────────────────────────────────────────────
  const searched = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryFilter !== "all" && (product.categoryId || "") !== categoryFilter) return false;
      if (onlyWithPurchase && !(product.purchasePrice != null && product.purchasePrice > 0)) return false;
      if (hideVariants && product.hasVariants) return false;
      if (onlyVisible && !product.isVisible) return false;
      if (hideSelectedInCatalog && drafts[product.id]) return false;
      if (query) {
        const haystack = `${product.name} ${product.sku || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [
    categoryFilter,
    drafts,
    hideSelectedInCatalog,
    hideVariants,
    onlyVisible,
    onlyWithPurchase,
    products,
    search,
  ]);

  const win = useWindowedList(searched, {
    min: 60,
    step: 60,
    resetKey: `${search}|${categoryFilter}|${onlyWithPurchase}|${hideVariants}|${onlyVisible}|${hideSelectedInCatalog}`,
  });

  const allSelected = searched.length > 0 && searched.every((p) => drafts[p.id]);

  // ── Сохранение ────────────────────────────────────────────
  const rowsToSave = useMemo(() => {
    const rows: {
      id: string;
      price: number;
      purchasePrice?: number;
      clearDiscount: boolean;
    }[] = [];
    for (const { product, info } of selectedRows) {
      if (info.newPrice === null) continue;
      const priceChanged = info.currentPrice === null || info.newPrice !== info.currentPrice;
      const purchaseChanged =
        savePurchase &&
        info.purchaseEdited &&
        !info.purchaseInvalid &&
        info.purchase !== info.currentPurchase;
      const wantsClearDiscount =
        clearDiscounts && product.discountType != null && product.discountValue != null;
      if (!priceChanged && !purchaseChanged && !wantsClearDiscount) continue;
      rows.push({
        id: product.id,
        price: info.newPrice,
        ...(purchaseChanged ? { purchasePrice: info.purchase ?? 0 } : {}),
        clearDiscount: wantsClearDiscount,
      });
    }
    return rows;
  }, [clearDiscounts, savePurchase, selectedRows]);

  const hasErrors = selectedRows.some(
    (row) => row.info.priceInvalid || (savePurchase && row.info.purchaseInvalid)
  );

  async function handleSave() {
    if (rowsToSave.length === 0) {
      setSaveError("Изменений нет: цены совпадают с текущими");
      return;
    }
    if (hasErrors) {
      setSaveError("В таблице есть незаполненные или некорректные значения — поправьте подсвеченные поля");
      return;
    }
    if (
      summary.loss > 0 &&
      !window.confirm(
        `У ${summary.loss} товар(ов) цена ниже закупочной — продажа в убыток.\n\nВсё равно сохранить ${rowsToSave.length} цен(ы)?`
      )
    ) {
      return;
    }

    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const response = await fetch("/api/admin/products/prices/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToSave }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || `Ошибка сохранения (${response.status})`);
      }

      const failedIds = new Set<string>(
        Array.isArray(body.failed) ? body.failed.map((item: { id: string }) => String(item.id)) : []
      );

      // Сохранённые значения становятся новыми «текущими»: строка больше
      // не предлагает сохранить то же самое, но исходная цена и разница
      // с ней остаются видны до обновления страницы.
      const savedPatch: Record<string, { price: number; purchasePrice?: number | null }> = {};
      for (const row of rowsToSave) {
        if (failedIds.has(row.id)) continue;
        savedPatch[row.id] = {
          price: row.price,
          ...(row.purchasePrice !== undefined ? { purchasePrice: row.purchasePrice } : {}),
        };
      }
      setDrafts((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(savedPatch)) {
          // Закупка из поля больше не «черновик» — она записана.
          next[id] = { ...next[id], purchase: "" };
        }
        return next;
      });
      setSavedValues((prev) => ({ ...prev, ...savedPatch }));

      setSaveMessage(
        `Сохранено: ${body.updated ?? rowsToSave.length} цен(ы)${body.purchaseUpdated ? `, закупочных цен: ${body.purchaseUpdated}` : ""}${body.discountsCleared ? `, снято скидок: ${body.discountsCleared}` : ""}`
      );
      if (failedIds.size > 0) {
        setSaveError(`Не сохранилось товаров: ${failedIds.size} — обновите страницу и повторите`);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить цены");
    } finally {
      setSaving(false);
    }
  }

  // ── Отрисовка ─────────────────────────────────────────────
  const percentInput: React.CSSProperties = { width: 110, textAlign: "right" };

  return (
    <div className="admin-stack">
      <div className="admin-filters">
        <Link href={`/${adminPath}/products`} className="admin-filter" prefetch={false}>
          <Tags size={13} /> К списку товаров
        </Link>
        <Link href={`/${adminPath}/products/bulk`} className="admin-filter" prefetch={false}>
          <SlidersHorizontal size={13} /> Массовое редактирование карточек
        </Link>
      </div>

      {/* ── 1. ВЫБРАННЫЕ ТОВАРЫ (всегда сверху) ─────────────── */}
      <div className="admin-card">
        <div className="admin-card__head">
          <h3 className="admin-card__title">
            <BadgePercent size={15} style={{ marginRight: 6 }} />
            Выбранные товары: {summary.total}
          </h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              className="admin-select"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              title="Порядок строк в таблице"
            >
              <option value="name">По названию</option>
              <option value="margin_asc">Маржа: сначала низкая</option>
              <option value="margin_desc">Маржа: сначала высокая</option>
              <option value="price_asc">Цена: сначала дешёвые</option>
              <option value="price_desc">Цена: сначала дорогие</option>
            </select>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => {
                setDrafts({});
                setSaveMessage("");
                setSaveError("");
              }}
              disabled={summary.total === 0}
            >
              Очистить выбор
            </button>
          </div>
        </div>

        <div className="admin-card__pad">
          {/* Способ расчёта */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <button
              type="button"
              className={`admin-filter${mode === "manual" ? " admin-filter--active" : ""}`}
              onClick={() => setMode("manual")}
            >
              <Tags size={13} /> Своя цена для всех
            </button>
            <button
              type="button"
              className={`admin-filter${mode === "markup" ? " admin-filter--active" : ""}`}
              onClick={() => setMode("markup")}
            >
              <Percent size={13} /> Наценка от закупки
            </button>
          </div>

          {mode === "manual" ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="admin-label">Цена для выбранных, ₽</span>
                <input
                  className="admin-input"
                  inputMode="decimal"
                  placeholder="например 1 290"
                  value={bulkPrice}
                  onChange={(event) => setBulkPrice(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applySinglePrice();
                  }}
                  style={{ width: 180 }}
                />
              </label>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={applySinglePrice}
                disabled={summary.total === 0}
              >
                <Check size={15} /> Поставить всем выбранным
              </button>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--adm-muted)" }}>Снизить от текущей:</span>
                {[3, 5, 10, 15, 20, 30].map((percent) => (
                  <button
                    key={percent}
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => decreaseBy(percent)}
                    disabled={summary.total === 0}
                    title={`Уменьшить цену каждого выбранного товара на ${percent}%`}
                  >
                    −{percent}%
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="admin-label">Наценка к закупке, %</span>
                <input
                  className="admin-input"
                  inputMode="decimal"
                  placeholder="например 35"
                  value={bulkMarkup}
                  onChange={(event) => setBulkMarkup(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyMarkup();
                  }}
                  style={percentInput}
                />
              </label>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={applyMarkup}
                disabled={summary.total === 0}
              >
                <Wand2 size={15} /> Рассчитать цены
              </button>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--adm-muted)" }}>Частые наценки:</span>
                {[20, 30, 40, 50, 100].map((percent) => (
                  <button
                    key={percent}
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => {
                      // Кнопка-пресет: пишем процент в поле и сразу считаем —
                      // ровно тем же кодом, что и основная кнопка.
                      setBulkMarkup(String(percent));
                      applyMarkupPercent(percent);
                    }}
                    disabled={summary.total === 0}
                  >
                    +{percent}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Округление и правила */}
          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--adm-border)",
            }}
          >
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <SlidersHorizontal size={13} />
              Округление:
              <select
                className="admin-select"
                value={rounding}
                onChange={(event) => setRounding(event.target.value as RoundingMode)}
              >
                {ROUNDING_MODES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={roundSelected}
              disabled={summary.total === 0}
              title="Применить выбранное округление к уже введённым ценам"
            >
              Округлить цены выбранных
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={clearPrices}
              disabled={summary.total === 0}
            >
              Сбросить к текущим ценам
            </button>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, fontSize: 13 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={keepAboveCost}
                onChange={(event) => setKeepAboveCost(event.target.checked)}
              />
              Не опускать ниже закупки
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={savePurchase}
                onChange={(event) => setSavePurchase(event.target.checked)}
              />
              Сохранять правки закупочной цены
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={clearDiscounts}
                onChange={(event) => setClearDiscounts(event.target.checked)}
              />
              Снять активные скидки у выбранных
            </label>
          </div>

          {/* Таблица выбранных */}
          {summary.total === 0 ? (
            <div
              style={{
                marginTop: 16,
                padding: 18,
                borderRadius: 12,
                background: "var(--adm-paper)",
                border: "1px dashed var(--adm-border-mid)",
                fontSize: 13,
                color: "var(--adm-muted)",
                lineHeight: 1.6,
              }}
            >
              Пока ничего не выбрано. Отметьте товары в каталоге ниже (или выберите их заранее в
              списке товаров и нажмите «Изменить цены») — они появятся здесь: с ценой, закупкой,
              накруткой и маржой по каждой строке.
            </div>
          ) : (
            <div className="admin-table-wrap" style={{ marginTop: 16 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>Товар</th>
                    <th style={cellRight}>Остаток</th>
                    <th style={cellRight}>Закуп, ₽</th>
                    <th style={cellRight}>Было, ₽</th>
                    <th style={cellRight}>Новая цена, ₽</th>
                    <th style={cellRight} title="(цена − закуп) / закуп">
                      Накрутка
                    </th>
                    <th style={cellRight} title="(цена − закуп) / цена — как «Разница» на складе">
                      Маржа
                    </th>
                    <th style={cellRight}>Разница, ₽</th>
                    <th style={cellRight} title="Изменение цены: было → стало">
                      Δ к текущей
                    </th>
                    <th style={cellRight} title="(новая цена − закуп) × остаток">
                      Прибыль на остаток
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.map(({ product, info }) => {
                    const tone = marginTone(info.margin);
                    const toneColor =
                      tone === "loss"
                        ? "var(--adm-rust)"
                        : tone === "thin"
                          ? "var(--adm-kraft)"
                          : tone === "ok"
                            ? "var(--adm-pine)"
                            : "var(--adm-muted)";
                    return (
                      <tr key={product.id}>
                        <td>
                          <button
                            type="button"
                            className="admin-btn admin-btn--icon"
                            title="Убрать из выбранных"
                            onClick={() => deselect([product.id])}
                          >
                            ×
                          </button>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{product.name}</div>
                          <div style={{ fontSize: 11, color: "var(--adm-muted)", display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {product.sku ? <span>арт. {product.sku}</span> : null}
                            {product.categoryId ? <span>{catName.get(product.categoryId) || ""}</span> : null}
                            {!product.isVisible ? (
                              <span className="admin-badge admin-badge--muted">скрыт</span>
                            ) : null}
                            {product.hasVariants ? (
                              <span
                                className="admin-badge admin-badge--amber"
                                title="У товара есть варианты: цена на сайте берётся из них, базовая цена может не действовать"
                              >
                                варианты: {product.variantCount}
                              </span>
                            ) : null}
                            {product.discountType ? (
                              <span
                                className="admin-badge admin-badge--red"
                                title={`У товара скидка ${
                                  product.discountType === "percent"
                                    ? `${product.discountValue}%`
                                    : `${product.discountValue} ₽`
                                } — покупатель видит ${money(info.effective)}`}
                              >
                                скидка · на сайте {money(info.effective)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td style={cellRight}>{product.stockQty}</td>
                        <td style={cellRight}>
                          <input
                            className="admin-input"
                            inputMode="decimal"
                            style={{ width: 110, textAlign: "right" }}
                            placeholder={product.purchasePrice != null ? String(product.purchasePrice) : "нет"}
                            value={drafts[product.id]?.purchase ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDrafts((prev) => ({
                                ...prev,
                                [product.id]: { ...prev[product.id], purchase: value },
                              }));
                            }}
                            title="Закупочная цена. Пусто — используем цену из карточки товара"
                          />
                          {savePurchase && info.purchaseEdited ? (
                            <div style={{ fontSize: 10, color: "var(--adm-kraft)" }}>будет сохранена</div>
                          ) : null}
                          {info.purchaseInvalid ? (
                            <div style={{ fontSize: 10, color: "var(--adm-rust)" }}>не число</div>
                          ) : null}
                        </td>
                        <td style={{ ...cellRight, color: "var(--adm-muted)" }}>{money(info.oldPrice)}</td>
                        <td style={cellRight}>
                          <input
                            className="admin-input"
                            inputMode="decimal"
                            style={{
                              width: 130,
                              textAlign: "right",
                              fontWeight: 700,
                              ...(info.priceInvalid ? { borderColor: "var(--adm-rust)" } : {}),
                            }}
                            placeholder="цена"
                            value={drafts[product.id]?.price ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDrafts((prev) => ({
                                ...prev,
                                [product.id]: { ...prev[product.id], price: value },
                              }));
                            }}
                          />
                          {info.priceInvalid ? (
                            <div style={{ fontSize: 10, color: "var(--adm-rust)" }}>не число</div>
                          ) : null}
                        </td>
                        <td style={{ ...cellRight, color: toneColor }}>
                          <input
                            className="admin-input"
                            inputMode="decimal"
                            style={{ width: 90, textAlign: "right" }}
                            placeholder="%"
                            value={info.markup === null ? "" : String(info.markup)}
                            disabled={info.newPrice === null || info.purchase == null || info.purchase <= 0}
                            onChange={(event) => {
                              // Накрутка правится «наоборот»: из процента считаем цену.
                              const percent = parsePriceInput(event.target.value);
                              if (percent === null) return;
                              const price = priceFromMarkup(info.purchase, percent, rounding);
                              if (price === null) return;
                              setDrafts((prev) => ({
                                ...prev,
                                [product.id]: { ...prev[product.id], price: String(price) },
                              }));
                            }}
                            title="Измените процент — цена пересчитается от закупки"
                          />
                        </td>
                        <td style={{ ...cellRight, color: toneColor }}>
                          <strong>{formatPercent(info.margin)}</strong>
                        </td>
                        <td style={{ ...cellRight, color: info.profit != null && info.profit < 0 ? "var(--adm-rust)" : undefined }}>
                          {info.profit === null ? "—" : `${info.profit >= 0 ? "+" : ""}${info.profit.toLocaleString("ru-RU")} ₽`}
                        </td>
                        <td style={cellRight}>
                          {info.diff === null ? (
                            "—"
                          ) : (
                            <span style={{ color: info.diff < 0 ? "var(--adm-pine)" : info.diff > 0 ? "var(--adm-kraft)" : "var(--adm-muted)" }}>
                              {info.diff > 0 ? "+" : ""}
                              {info.diff.toLocaleString("ru-RU")} ₽
                              <small style={{ display: "block", fontSize: 10, opacity: 0.8 }}>
                                {info.diffPercent === null
                                  ? ""
                                  : `${info.diffPercent > 0 ? "+" : ""}${formatPercent(info.diffPercent)}`}
                              </small>
                            </span>
                          )}
                        </td>
                        <td style={cellRight}>
                          {info.stockProfit === null ? (
                            "—"
                          ) : (
                            <span
                              style={{ color: info.stockProfit < 0 ? "var(--adm-rust)" : undefined }}
                              title="Прибыль по текущему остатку при новой цене"
                            >
                              {info.stockProfit.toLocaleString("ru-RU")} ₽
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Итоги и сохранение */}
          {summary.total > 0 ? (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 18,
                  flexWrap: "wrap",
                  marginTop: 14,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--adm-paper)",
                  border: "1px solid var(--adm-border)",
                  fontSize: 13,
                }}
              >
                <span>
                  С новой ценой: <strong>{summary.withPrice}</strong> из {summary.total}
                </span>
                <span>
                  Сумма цен: <strong>{money(summary.oldSum)}</strong> → <strong>{money(summary.newSum)}</strong>{" "}
                  <span style={{ color: summary.delta < 0 ? "var(--adm-pine)" : "var(--adm-kraft)" }}>
                    ({summary.delta > 0 ? "+" : ""}
                    {summary.delta.toLocaleString("ru-RU")} ₽
                    {summary.deltaPercent === null ? "" : `, ${summary.deltaPercent > 0 ? "+" : ""}${formatPercent(summary.deltaPercent)}`})
                  </span>
                </span>
                <span>
                  Средняя маржа: <strong>{formatPercent(summary.avgMargin)}</strong>
                </span>
                <span>
                  Средняя накрутка: <strong>{formatPercent(summary.avgMarkup)}</strong>
                </span>
                <span>
                  Прибыль на остаток: <strong>{money(summary.profitOnStock)}</strong>
                </span>
                {summary.loss > 0 ? (
                  <span style={{ color: "var(--adm-rust)" }}>
                    <AlertTriangle size={13} /> в убыток: <strong>{summary.loss}</strong>
                  </span>
                ) : null}
                {summary.withVariants > 0 ? (
                  <span style={{ color: "var(--adm-kraft)" }}>
                    <AlertTriangle size={13} /> с вариантами: <strong>{summary.withVariants}</strong> — цена
                    на сайте берётся из вариантов
                  </span>
                ) : null}
                {summary.withoutPurchase > 0 ? (
                  <span style={{ color: "var(--adm-kraft)" }}>
                    без закупочной цены: <strong>{summary.withoutPurchase}</strong> (накрутка и маржа не считаются)
                  </span>
                ) : null}
                {summary.withoutPrice > 0 ? (
                  <span style={{ color: "var(--adm-kraft)" }}>
                    без новой цены: <strong>{summary.withoutPrice}</strong>
                  </span>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  onClick={handleSave}
                  disabled={saving || rowsToSave.length === 0}
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving
                    ? "Сохраняю…"
                    : `Сохранить цены (${rowsToSave.length})`}
                </button>
                <span style={{ fontSize: 12, color: "var(--adm-muted)" }}>
                  Сохраняются только изменённые строки. Уведомление об изменении уйдёт и в журнал
                  действий админки.
                </span>
              </div>
            </>
          ) : null}

          {saveMessage ? (
            <div
              role="status"
              style={{
                marginTop: 12,
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                background: "var(--adm-ui-success-bg)",
                border: "1px solid var(--adm-ui-success-line)",
                color: "var(--adm-ui-success)",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <Check size={14} /> {saveMessage}
            </div>
          ) : null}

          {saveError ? (
            <div
              role="alert"
              style={{
                marginTop: 12,
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                background: "var(--adm-rust-pale)",
                border: "1px solid var(--adm-rust-line)",
                color: "var(--adm-rust)",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <AlertTriangle size={14} /> {saveError}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── 2. КАТАЛОГ ──────────────────────────────────────── */}
      <div className="admin-card">
        <div className="admin-card__head">
          <h3 className="admin-card__title">
            <Search size={15} style={{ marginRight: 6 }} />
            Каталог: выберите товары ({searched.length})
          </h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => selectProducts(searched.map((p) => p.id))}
              disabled={searched.length === 0}
            >
              Выбрать все найденные
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => deselect(searched.map((p) => p.id))}
              disabled={!allSelected}
            >
              Снять выбор со всех найденных
            </button>
          </div>
        </div>

        <div className="admin-card__pad">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="admin-input"
              placeholder="Поиск по названию или артикулу"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ minWidth: 240 }}
            />
            <select
              className="admin-select"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">Все категории</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={onlyWithPurchase}
                onChange={(event) => setOnlyWithPurchase(event.target.checked)}
              />
              только с закупочной ценой
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={hideVariants}
                onChange={(event) => setHideVariants(event.target.checked)}
              />
              без товаров с вариантами
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={onlyVisible}
                onChange={(event) => setOnlyVisible(event.target.checked)}
              />
              только видимые на сайте
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={hideSelectedInCatalog}
                onChange={(event) => setHideSelectedInCatalog(event.target.checked)}
              />
              скрывать уже выбранные
            </label>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 14 }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>Товар</th>
                  <th>Артикул</th>
                  <th>Категория</th>
                  <th style={cellRight}>Закуп, ₽</th>
                  <th style={cellRight}>Цена, ₽</th>
                  <th style={cellRight}>Маржа</th>
                  <th style={cellRight}>Остаток</th>
                </tr>
              </thead>
              <tbody>
                {win.visible.map((product) => {
                  const isSelected = Boolean(drafts[product.id]);
                  const margin = marginPercent(product.price, product.purchasePrice);
                  const tone = marginTone(margin);
                  return (
                    <tr
                      key={product.id}
                      onClick={() => (isSelected ? deselect([product.id]) : selectProducts([product.id]))}
                      style={{
                        cursor: "pointer",
                        background: isSelected ? "rgba(200,134,10,0.10)" : undefined,
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => (isSelected ? deselect([product.id]) : selectProducts([product.id]))}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </td>
                      <td>
                        <span style={{ fontWeight: isSelected ? 700 : 500 }}>{product.name}</span>
                        {product.hasVariants ? (
                          <span className="admin-badge admin-badge--amber" style={{ marginLeft: 6 }}>
                            варианты
                          </span>
                        ) : null}
                        {!product.isVisible ? (
                          <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>
                            скрыт
                          </span>
                        ) : null}
                      </td>
                      <td>{product.sku || "—"}</td>
                      <td>{product.categoryId ? catName.get(product.categoryId) || "—" : "—"}</td>
                      <td style={cellRight}>{money(product.purchasePrice)}</td>
                      <td style={cellRight}>
                        <strong>{money(product.price)}</strong>
                        {product.discountType ? (
                          <div style={{ fontSize: 10, color: "var(--adm-rust)" }}>
                            на сайте {money(effectivePrice(product.price, product.discountType, product.discountValue))}
                          </div>
                        ) : null}
                      </td>
                      <td
                        style={{
                          ...cellRight,
                          color:
                            tone === "loss"
                              ? "var(--adm-rust)"
                              : tone === "thin"
                                ? "var(--adm-kraft)"
                                : tone === "ok"
                                  ? "var(--adm-pine)"
                                  : "var(--adm-muted)",
                        }}
                      >
                        {formatPercent(margin)}
                      </td>
                      <td style={cellRight}>{product.stockQty}</td>
                    </tr>
                  );
                })}
                {searched.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "var(--adm-muted)", padding: 18 }}>
                      Ничего не нашлось — измените фильтры
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {win.hasMore ? (
            <div
              ref={(node) => {
                win.observeTail(node);
              }}
              style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 10 }}
            >
              <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={win.showAll}>
                <ChevronDown size={14} /> Показать все ({searched.length})
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
