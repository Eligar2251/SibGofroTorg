// =========================================================
// FILE: src/components/admin/ProductPicker.tsx
// Поиск и выбор позиции (товара или услуги) в формах учёта (комбобокс)
//
// onCreateItem — быстрое создание позиции прямо из окна поставки/заказа,
// по аналогии с контрагентами: название + цена + количество (и флаг
// «услуга»). Родительский компонент сохраняет карточку-черновик через
// /api/admin/products/quick, добавляет её в список и в позиции документа.
// =========================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { getCuttableStockBreakdown as getCuttableBreakdown } from "@/lib/types";

export interface PickerProduct {
  id: string;
  name: string;
  sku: string | null;
  /** Цена продажи (эффективная, со скидкой) */
  price: number | null;
  /** Оптовая цена — подсказка для закупки */
  priceWholesale: number | null;
  /** Закупочная цена товара (если задана в карточке) */
  purchasePrice?: number | null;
  stockQty: number;
  isCuttable?: boolean | null;
  cutMetersPerRoll?: number | null;
  cutPricePerMeter?: number | null;
  cutUnitName?: string | null;
  /** Услуга, а не складской товар: остаток не ведётся (lib/product-service.ts). */
  isService?: boolean | null;
}

/** Черновик новой позиции из формы пикера. */
export interface PickerCreateDraft {
  name: string;
  price: number | null;
  quantity: number;
  isService: boolean;
}

export type PickerCreateResult = { product: PickerProduct } | { error: string };

/**
 * Позиции, созданные прямо из документа, помним в рамках сессии: они должны
 * появляться в списке во всех пикерах, пока страницу не перезагрузили
 * (серверные props обновятся только с ней).
 */
const quickCreated = new Map<string, PickerProduct>();
const quickListeners = new Set<() => void>();

function rememberQuickProduct(product: PickerProduct) {
  quickCreated.set(product.id, product);
  for (const notify of quickListeners) notify();
}

function useQuickProducts(base: PickerProduct[]): PickerProduct[] {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const notify = () => setVersion((n) => n + 1);
    quickListeners.add(notify);
    return () => {
      quickListeners.delete(notify);
    };
  }, []);
  return useMemo(() => {
    if (quickCreated.size === 0) return base;
    const merged = [...base];
    for (const [id, product] of quickCreated) {
      if (!merged.some((p) => p.id === id)) merged.push(product);
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, version]);
}

/** Создание по умолчанию: черновик карточки через /api/admin/products/quick. */
async function quickCreateProduct(draft: PickerCreateDraft): Promise<PickerCreateResult> {
  try {
    const res = await fetch("/api/admin/products/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok || !data?.id) {
      return {
        error: String(
          data?.error || `Не удалось создать позицию (ошибка ${res.status})`
        ),
      };
    }
    const product: PickerProduct = {
      id: String(data.id),
      name: String(data.name || draft.name),
      sku: data.sku ?? null,
      price: data.price ?? draft.price,
      priceWholesale: data.priceWholesale ?? null,
      purchasePrice: data.purchasePrice ?? null,
      stockQty: Number(data.stockQty ?? 0),
      isService: data.isService === true,
    };
    rememberQuickProduct(product);
    return { product };
  } catch {
    return { error: "Нет связи с сервером — позицию создать не удалось" };
  }
}

const SERVICE_DEFAULT_KEY = "sgt_…vice";

function rememberServiceDefault(value: boolean) {
  try {
    window.localStorage.setItem(SERVICE_DEFAULT_KEY, value ? "1" : "0");
  } catch {
    /* приватный режим — просто не запоминаем */
  }
}

function parseNum(raw: string): number | null {
  const cleaned = String(raw || "").replace(/\s+/g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatStock(p: PickerProduct): string {
  if (p.isService) return "услуга · без склада";
  if (p.isCuttable && p.cutMetersPerRoll) {
    const bd = getCuttableBreakdown(p.stockQty, p.cutMetersPerRoll);
    if (bd.remainderMeters > 0.009) {
      return `${bd.fullRolls} рул. + ${bd.remainderMeters} м`;
    }
    return `${bd.fullRolls} рул.`;
  }
  const n = Number(p.stockQty) || 0;
  // показываем дробные рулоны как 5.9
  return Number.isInteger(n) ? `${n}` : `${n}`;
}

export function ProductPicker({
  products,
  onPick,
  placeholder = "Начните вводить название или артикул...",
  showPrice = true,
  onCreateItem,
  createLabel = "Новая позиция",
  /** false — скрыть быстрое создание (там, где список фиксирован). */
  allowCreate = true,
}: {
  products: PickerProduct[];
  /** quantity — количество из формы быстрого создания (для уже выбранного товара не передаётся). */
  onPick: (p: PickerProduct, quantity?: number) => void;
  placeholder?: string;
  showPrice?: boolean;
  /** Быстрое создание позиции (товара или услуги). Без него кнопки нет. */
  onCreateItem?: (draft: PickerCreateDraft) => Promise<PickerCreateResult>;
  createLabel?: string;
  allowCreate?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [draftQty, setDraftQty] = useState("1");
  // Значение по умолчанию — «товар» (безопаснее: услугу включают осознанно),
  // но последний выбор запоминаем: кто регулярно заводит услуги, тот не будет
  // щёлкать галочку каждый раз.
  const [draftService, setDraftService] = useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        window.localStorage.getItem(SERVICE_DEFAULT_KEY) === "1"
      );
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const list = useQuickProducts(products);
  const createItem = onCreateItem ?? quickCreateProduct;
  const q = query.trim().toLowerCase();
  const results = q
    ? list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q))
      )
    : list;

  function openCreate(prefill: string) {
    setDraftName(prefill);
    setError(null);
    setCreating(true);
    setOpen(true);
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }

  function closeCreate() {
    setCreating(false);
    setError(null);
  }

  async function submitCreate() {
    if (busy) return;
    const name = draftName.replace(/\s+/g, " ").trim();
    const price = parseNum(draftPrice);
    const rawQty = parseNum(draftQty);
    const quantity = rawQty == null || rawQty <= 0 ? 1 : rawQty;
    if (!name) {
      setError("Укажите название позиции");
      return;
    }
    rememberServiceDefault(draftService);
    setBusy(true);
    setError(null);
    try {
      const result = await createItem({ name, price, quantity, isService: draftService });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onPick(result.product, quantity);
      setQuery("");
      closeCreate();
      setOpen(false);
    } catch (err: any) {
      setError(err?.message ? String(err.message) : "Не удалось создать позицию");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wh-picker" ref={wrapRef}>
      <div className="wh-picker__input-wrap">
        <Search size={13} className="wh-picker__icon" />
        <input
          type="text"
          className="admin-input wh-picker__input"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onCreateItem && query.trim() && results.length === 0) {
              e.preventDefault();
              if (!creating) openCreate(query.trim());
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="wh-picker__clear"
            onClick={() => setQuery("")}
            aria-label="Очистить"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <div className={`wh-picker__list${creating ? " wh-picker__list--creating" : ""}`}>
          {results.length === 0 && !creating ? (
            <div className="wh-picker__empty">
              {q ? "Ничего не найдено" : "Список пуст"}
            </div>
          ) : (
            results.slice(0, 50).map((p) => (
              <button
                key={p.id}
                type="button"
                className="wh-picker__opt"
                onClick={() => {
                  onPick(p);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="wh-picker__opt-name">
                  {p.name}
                  {p.sku && <span className="wh-picker__opt-sku">{p.sku}</span>}
                  {p.isService && (
                    <span
                      className="admin-badge"
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        padding: "0 4px",
                        background: "rgba(16,122,87,0.12)",
                        border: "1px solid rgba(16,122,87,0.28)",
                      }}
                    >
                      услуга
                    </span>
                  )}
                  {p.isCuttable && (
                    <span
                      className="admin-badge"
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        padding: "0 4px",
                        background: "rgba(59,130,246,0.12)",
                        border: "1px solid rgba(59,130,246,0.25)",
                      }}
                    >
                      рулон/м
                    </span>
                  )}
                </span>
                <span className="wh-picker__opt-meta">
                  {formatStock(p)}
                  {showPrice && p.price != null && ` · ${p.price.toLocaleString("ru-RU")} ₽`}
                  {showPrice && p.isCuttable && p.cutPricePerMeter ? ` / ${p.cutPricePerMeter} ₽/м` : ""}
                </span>
              </button>
            ))
          )}

          {allowCreate && (
            <div className="wh-picker__create">
              {creating ? (
                <form
                  className="wh-picker__create-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitCreate();
                  }}
                >
                  <div className="wh-picker__create-row">
                    <input
                      ref={nameRef}
                      className="admin-input"
                      value={draftName}
                      placeholder="Название позиции"
                      onChange={(e) => setDraftName(e.target.value)}
                    />
                  </div>
                  <div className="wh-picker__create-row">
                    <label className="wh-picker__create-field">
                      <span>Цена, ₽</span>
                      <input
                        className="admin-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={draftPrice}
                        placeholder="0"
                        onChange={(e) => setDraftPrice(e.target.value)}
                      />
                    </label>
                    <label className="wh-picker__create-field">
                      <span>Количество</span>
                      <input
                        className="admin-input"
                        type="number"
                        min="0"
                        step="any"
                        value={draftQty}
                        onChange={(e) => setDraftQty(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="admin-check" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={draftService}
                      onChange={(e) => setDraftService(e.target.checked)}
                    />
                    Услуга — не складской товар: остаток, резерв и инвентаризация её не касаются
                  </label>
                  {error && <div className="wh-picker__create-error">{error}</div>}
                  <div className="wh-picker__create-actions">
                    <button
                      type="submit"
                      className="admin-btn admin-btn--sm admin-btn--primary"
                      disabled={busy}
                    >
                      {busy ? "Создаём..." : "Создать и добавить"}
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--sm admin-btn--ghost"
                      onClick={closeCreate}
                      disabled={busy}
                    >
                      Отмена
                    </button>
                    <span className="wh-picker__create-hint">
                      Карточка создастся черновиком: размеры и артикул дозаполните позже
                    </span>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="wh-picker__create-open"
                  onClick={() => openCreate(query.trim())}
                >
                  <Plus size={12} />
                  {createLabel}
                  {q ? ` «${query.trim().slice(0, 40)}»` : ""} — товар или услуга
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
