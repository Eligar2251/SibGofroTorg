"use client";

// =========================================================
// VariantsEditor — управление вариантами (цвет/размер/фасовка)
// на странице редактирования товара в админке.
//
// Хранение: POST /api/admin/products/[id]/variants — единым
// пакетом (создание/обновление/удаление в одном запросе).
// Это атомарно и без лишних round-trip'ов.
// =========================================================

import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  Save,
  Eye,
  EyeOff,
  X as XIcon,
  AlertCircle,
} from "lucide-react";

export interface AdminVariant {
  id?: string;
  name: string;
  optionType: string;
  colorHex?: string | null;
  sortOrder: number;
  price?: number | null;
  priceWholesale?: number | null;
  sku?: string | null;
  stockQty: number;
  stockWarnQty?: number | null;
  imageUrl?: string | null;
  isVisible: boolean;
}

interface VariantsEditorProps {
  productId: string;
  /** Базовая цена товара — для «своя цена?» тултипа. */
  basePrice?: number | null;
}

const OPTION_TYPES: { value: string; label: string }[] = [
  { value: "color", label: "Цвет" },
  { value: "size", label: "Размер" },
  { value: "pack", label: "Фасовка" },
  { value: "material", label: "Материал" },
  { value: "other", label: "Другое" },
];

function emptyVariant(): AdminVariant {
  return {
    name: "",
    optionType: "color",
    colorHex: null,
    sortOrder: 0,
    price: null,
    priceWholesale: null,
    sku: null,
    stockQty: 0,
    stockWarnQty: null,
    imageUrl: null,
    isVisible: true,
  };
}

export function VariantsEditor({ productId, basePrice }: VariantsEditorProps) {
  const [variants, setVariants] = useState<AdminVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // ── Загрузка ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/products/${productId}/variants`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Ошибка загрузки");
        if (cancelled) return;
        setVariants(
          (data.variants || []).map((v: any) => ({
            id: v.id,
            name: v.name || "",
            optionType: v.optionType || "color",
            colorHex: v.colorHex || null,
            sortOrder: Number(v.sortOrder || 0),
            price: v.price != null ? Number(v.price) : null,
            priceWholesale: v.priceWholesale != null ? Number(v.priceWholesale) : null,
            sku: v.sku || null,
            stockQty: Number(v.stockQty || 0),
            stockWarnQty: v.stockWarnQty != null ? Number(v.stockWarnQty) : null,
            imageUrl: v.imageUrl || null,
            isVisible: v.isVisible !== false,
          })),
        );
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Не удалось загрузить варианты");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // ── Локальные мутации ───────────────────────────────────
  function updateAt(idx: number, patch: Partial<AdminVariant>) {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  function removeAt(idx: number) {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  }
  function addNew() {
    setVariants((prev) => [
      ...prev,
      { ...emptyVariant(), sortOrder: prev.length },
    ]);
  }

  // ── Сохранение ──────────────────────────────────────────
  async function handleSave() {
    setError(null);
    setSaving(true);
    setSavedAt(null);
    try {
      // Валидация на клиенте: имена обязательны
      const cleaned = variants
        .filter((v) => v.name.trim() !== "")
        .map((v, idx) => ({
          id: v.id,
          name: v.name.trim(),
          optionType: (v.optionType || "other").trim(),
          colorHex: v.colorHex || null,
          sortOrder: typeof v.sortOrder === "number" ? v.sortOrder : idx,
          price: v.price != null && v.price > 0 ? Number(v.price) : null,
          priceWholesale:
            v.priceWholesale != null && v.priceWholesale > 0
              ? Number(v.priceWholesale)
              : null,
          sku: v.sku || null,
          stockQty: Math.max(0, Math.floor(Number(v.stockQty) || 0)),
          stockWarnQty:
            v.stockWarnQty != null && v.stockWarnQty > 0
              ? Number(v.stockWarnQty)
              : null,
          imageUrl: v.imageUrl || null,
          isVisible: v.isVisible !== false,
        }));
      const res = await fetch(`/api/admin/products/${productId}/variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Ошибка сохранения");
      // Перезагрузим список, чтобы получить id новых вариантов
      const reload = await fetch(`/api/admin/products/${productId}/variants`, {
        cache: "no-store",
      });
      const reloaded = await reload.json();
      if (reload.ok) {
        setVariants(
          (reloaded.variants || []).map((v: any) => ({
            id: v.id,
            name: v.name || "",
            optionType: v.optionType || "color",
            colorHex: v.colorHex || null,
            sortOrder: Number(v.sortOrder || 0),
            price: v.price != null ? Number(v.price) : null,
            priceWholesale:
              v.priceWholesale != null ? Number(v.priceWholesale) : null,
            sku: v.sku || null,
            stockQty: Number(v.stockQty || 0),
            stockWarnQty:
              v.stockWarnQty != null ? Number(v.stockWarnQty) : null,
            imageUrl: v.imageUrl || null,
            isVisible: v.isVisible !== false,
          })),
        );
      }
      setSavedAt(new Date().toLocaleTimeString("ru-RU"));
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  // ── Рендер ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="admin-block">
        <div className="admin-block__title">Варианты (цвет/размер/фасовка)</div>
        <div className="admin-loading">
          <Loader2 size={18} className="animate-spin" /> Загружаем варианты…
        </div>
      </div>
    );
  }

  return (
    <div className="admin-block">
      <div className="admin-block__title">
        Варианты (цвет/размер/фасовка)
        {basePrice != null && (
          <span className="admin-block__hint">
            · базовая цена товара {Number(basePrice).toLocaleString("ru-RU")} ₽
          </span>
        )}
      </div>
      <p className="admin-block__desc">
        У каждого варианта — своя цена, остаток и (опционально) артикул.
        Если у варианта цена пустая, на витрине используется цена товара.
      </p>

      {error && (
        <div className="admin-error">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {variants.length === 0 ? (
        <div className="admin-empty">
          <p>У этого товара пока нет вариантов.</p>
          <p className="admin-empty__hint">
            Добавьте варианты — например «красный», «XL», «пачка 50 шт.» — чтобы
            покупатель выбирал нужный на странице товара.
          </p>
        </div>
      ) : (
        <div className="ve-list">
          {variants.map((v, idx) => (
            <div
              key={v.id || `new-${idx}`}
              className={`ve-row${v.isVisible ? "" : " ve-row--hidden"}`}
            >
              <div className="ve-row__head">
                <div className="ve-row__type">
                  <select
                    className="ve-input ve-input--sm"
                    value={v.optionType}
                    onChange={(e) =>
                      updateAt(idx, { optionType: e.target.value })
                    }
                  >
                    {OPTION_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ve-row__name">
                  <input
                    className="ve-input"
                    placeholder={
                      v.optionType === "color"
                        ? "красный"
                        : v.optionType === "size"
                          ? "XL"
                          : v.optionType === "pack"
                            ? "пачка 50 шт."
                            : "название варианта"
                    }
                    value={v.name}
                    onChange={(e) => updateAt(idx, { name: e.target.value })}
                  />
                </div>
                {v.optionType === "color" && (
                  <div className="ve-row__color">
                    <input
                      type="color"
                      className="ve-color"
                      value={v.colorHex || "#cccccc"}
                      onChange={(e) =>
                        updateAt(idx, { colorHex: e.target.value })
                      }
                      title="Цвет в каталоге"
                    />
                  </div>
                )}
                <div className="ve-row__actions">
                  <button
                    type="button"
                    className="ve-icon-btn"
                    onClick={() => updateAt(idx, { isVisible: !v.isVisible })}
                    title={v.isVisible ? "Скрыть" : "Показать"}
                  >
                    {v.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    type="button"
                    className="ve-icon-btn ve-icon-btn--danger"
                    onClick={() => removeAt(idx)}
                    title="Удалить"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="ve-row__body">
                <label className="ve-field">
                  <span>Цена, ₽</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="ve-input"
                    placeholder="пусто = цена товара"
                    value={v.price ?? ""}
                    onChange={(e) =>
                      updateAt(idx, {
                        price:
                          e.target.value === ""
                            ? null
                            : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="ve-field">
                  <span>Опт, ₽</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="ve-input"
                    placeholder="оптовая"
                    value={v.priceWholesale ?? ""}
                    onChange={(e) =>
                      updateAt(idx, {
                        priceWholesale:
                          e.target.value === ""
                            ? null
                            : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="ve-field">
                  <span>Артикул</span>
                  <input
                    className="ve-input"
                    placeholder="SKU"
                    value={v.sku ?? ""}
                    onChange={(e) =>
                      updateAt(idx, { sku: e.target.value || null })
                    }
                  />
                </label>
                <label className="ve-field">
                  <span>Остаток</span>
                  <input
                    type="number"
                    min="0"
                    className="ve-input"
                    value={v.stockQty}
                    onChange={(e) =>
                      updateAt(idx, {
                        stockQty: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      })
                    }
                  />
                </label>
                <label className="ve-field">
                  <span>Картинка (URL)</span>
                  <input
                    className="ve-input"
                    placeholder="https://…"
                    value={v.imageUrl ?? ""}
                    onChange={(e) =>
                      updateAt(idx, { imageUrl: e.target.value || null })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ve-footer">
        <button
          type="button"
          className="admin-btn admin-btn--secondary"
          onClick={addNew}
        >
          <Plus size={16} /> Добавить вариант
        </button>
        <div className="ve-footer__right">
          {savedAt && (
            <span className="ve-saved">
              <Save size={14} /> Сохранено в {savedAt}
            </span>
          )}
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Сохраняем…
              </>
            ) : (
              <>
                <Save size={16} /> Сохранить варианты
              </>
            )}
          </button>
        </div>
      </div>

      <style jsx>{`
        .ve-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 12px;
        }
        .ve-row {
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 10px;
          padding: 12px;
          background: #fff;
        }
        .ve-row--hidden {
          opacity: 0.55;
        }
        .ve-row__head {
          display: grid;
          grid-template-columns: 130px 1fr 60px auto;
          gap: 8px;
          align-items: center;
        }
        .ve-row__name input {
          font-weight: 600;
        }
        .ve-color {
          width: 44px;
          height: 36px;
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 8px;
          padding: 2px;
          cursor: pointer;
        }
        .ve-row__actions {
          display: flex;
          gap: 4px;
        }
        .ve-icon-btn {
          background: #f5f5f5;
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 6px;
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .ve-icon-btn:hover {
          background: #ececec;
        }
        .ve-icon-btn--danger:hover {
          background: #fee;
          color: #c00;
        }
        .ve-row__body {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 8px;
          margin-top: 10px;
        }
        .ve-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: var(--ink-muted, #666);
        }
        .ve-field span {
          font-weight: 500;
        }
        .ve-input {
          height: 36px;
          padding: 0 10px;
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 6px;
          font: inherit;
          font-size: 14px;
          background: #fff;
        }
        .ve-input:focus {
          outline: none;
          border-color: var(--kraft, #d97706);
        }
        .ve-input--sm {
          height: 36px;
        }
        .ve-footer {
          margin-top: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .ve-footer__right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .ve-saved {
          color: #16a34a;
          font-size: 13px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .admin-empty {
          background: var(--bg-soft, #faf6ed);
          border: 1px dashed var(--kraft, #d97706);
          border-radius: 8px;
          padding: 16px;
          margin-top: 12px;
        }
        .admin-empty p {
          margin: 0 0 4px;
        }
        .admin-empty__hint {
          color: var(--ink-muted, #666);
          font-size: 13px;
        }
        .admin-loading {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--ink-muted, #666);
          font-size: 13px;
        }
        .admin-error {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #fff1f2;
          color: #b91c1c;
          padding: 6px 10px;
          border-radius: 6px;
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}
