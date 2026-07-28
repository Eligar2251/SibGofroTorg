// =========================================================
// FILE: src/components/admin/ProductFormClient.tsx
// =========================================================

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Save,
  Loader2,
  Trash2,
  Bold,
  Italic,
  Heading3,
  List,
  ListOrdered,
  Link2,
  Quote,
} from "lucide-react";
import { ImageUploader } from "./ImageUploader";
import { MarkdownText } from "@/components/catalog/MarkdownText";
import { VariantsEditor } from "./VariantsEditor";

interface Category {
  id: string;
  name: string;
  slug: string;
  createdAt?: string | null;
}

interface ProductImage {
  url: string;
  publicId: string;
}

interface ProductData {
  id?: string;
  name?: string | null;
  sku?: string | null;
  categoryId?: string | null;
  description?: string | null;
  price?: number | null;
  priceWholesale?: number | null;
  minWholesaleQty?: number | null;
  stockQty?: number | null;
  stockWarnQty?: number | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  material?: string | null;
  packQty?: number | null;
  volume?: number | null;
  note?: string | null;
  inStock?: boolean | null;
  isPromo?: boolean | null;
  promoLabel?: string | null;
  madeToOrder?: boolean | null;
  discountType?: "percent" | "fixed" | null;
  discountValue?: number | null;
  discountBadge?: string | null;
  isVisible?: boolean | null;
  isFeatured?: boolean | null;
  featuredOrder?: number | null;
  images?: ProductImage[];
  imageUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

const FEATURED_ORDER_SETTING_KEY = "featured_products_order";

function normalizeFeaturedOrderIds(
  currentIds: string[],
  productId: string,
  isFeatured: boolean,
  requestedOrder: number | null,
): string[] {
  const clean = currentIds.filter((id) => id && id !== productId);
  if (!isFeatured) return clean;

  const insertAt =
    requestedOrder && Number.isFinite(requestedOrder) && requestedOrder > 0
      ? Math.min(clean.length, Math.max(0, requestedOrder - 1))
      : clean.length;

  clean.splice(insertAt, 0, productId);
  return [...new Set(clean)];
}

export function ProductFormClient({
  categories,
  product,
  featuredOrderIds = [],
}: {
  categories: Category[];
  product?: ProductData;
  featuredOrderIds?: string[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState<ProductImage[]>(product?.images || []);

  // Markdown-редактор описания
  const [descValue, setDescValue] = useState(product?.description || "");
  const [descPreview, setDescPreview] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  /* Оборачивает выделенный текст маркерами (**текст**, [текст](url)) */
  function descWrap(before: string, after: string, placeholder = "текст") {
    const ta = descRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const selected = value.slice(s, e) || placeholder;
    setDescValue(value.slice(0, s) + before + selected + after + value.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(
        s + before.length,
        s + before.length + selected.length
      );
    });
  }

  /* Добавляет префикс в начало текущей строки (списки, заголовок, цитата) */
  function descPrefix(prefix: string) {
    const ta = descRef.current;
    if (!ta) return;
    const { selectionStart: s, value } = ta;
    const lineStart = value.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    setDescValue(value.slice(0, lineStart) + prefix + value.slice(lineStart));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + prefix.length, s + prefix.length);
    });
  }

  const isEdit = !!product?.id;
  const adminPath =
    process.env.NEXT_PUBLIC_ADMIN_PATH ||
    process.env.ADMIN_SECRET_PATH ||
    "admin";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const form = e.currentTarget;
    const data = new FormData(form);

    const isFeatured = data.get("isFeatured") === "on";
    const featuredOrderRaw = String(data.get("featuredOrder") || "").trim();
    const featuredOrder = featuredOrderRaw ? Number(featuredOrderRaw) : null;

    const body = {
      stockQty: data.get("stockQty") !== "" ? Number(data.get("stockQty")) : null,
      stockWarnQty:
        data.get("stockWarnQty") !== "" ? Number(data.get("stockWarnQty")) : null,
      name: data.get("name"),
      sku: data.get("sku") || null,
      categoryId: data.get("categoryId") || null,
      description: data.get("description") || null,
      price: data.get("price") ? Number(data.get("price")) : null,
      priceWholesale: data.get("priceWholesale")
        ? Number(data.get("priceWholesale"))
        : null,
      minWholesaleQty: data.get("minWholesaleQty")
        ? Number(data.get("minWholesaleQty"))
        : null,
      dimensionLength: data.get("dimensionLength")
        ? Number(data.get("dimensionLength"))
        : null,
      dimensionWidth: data.get("dimensionWidth")
        ? Number(data.get("dimensionWidth"))
        : null,
      dimensionHeight: data.get("dimensionHeight")
        ? Number(data.get("dimensionHeight"))
        : null,
      dimensionUnit: data.get("dimensionUnit") || "мм",
      material: data.get("material") || null,
      packQty: data.get("packQty") ? Number(data.get("packQty")) : null,
      volume: data.get("volume") ? Number(data.get("volume")) : null,
      note: data.get("note") || null,
      inStock: data.get("inStock") === "on",
      isPromo: data.get("isPromo") === "on",
      promoLabel: data.get("promoLabel") || null,
      madeToOrder: data.get("madeToOrder") === "on",
      discountType: data.get("discountType") || null,
      discountValue: data.get("discountValue")
        ? Number(data.get("discountValue"))
        : null,
      discountBadge: data.get("discountBadge") || null,
      isVisible: data.get("isVisible") === "on",
      isFeatured,
      images,
      imageUrl: images[0]?.url || null,
    };

    try {
      const url = isEdit
        ? `/api/admin/products/${product.id}`
        : "/api/admin/products";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const resBody = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          (resBody as Record<string, string>).error || "Ошибка сохранения"
        );
      }

      const productId = product?.id || (resBody as Record<string, string>).id;
      if (productId) {
        const nextOrderIds = normalizeFeaturedOrderIds(
          featuredOrderIds,
          productId,
          isFeatured,
          Number.isFinite(featuredOrder ?? NaN) && (featuredOrder ?? 0) > 0
            ? featuredOrder
            : null
        );
        const settingsRes = await fetch("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [FEATURED_ORDER_SETTING_KEY]: JSON.stringify(nextOrderIds),
          }),
        });
        if (!settingsRes.ok) {
          throw new Error("Товар сохранён, но не удалось обновить порядок популярных товаров");
        }
      }

      router.push(`/${adminPath}/products`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Произошла ошибка");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!product?.id) return;
    if (!confirm("Удалить товар? Это действие необратимо.")) return;
    setDeleting(true);

    try {
      await fetch(`/api/admin/products/${product.id}`, { method: "DELETE" });
      router.push(`/${adminPath}/products`);
      router.refresh();
    } catch {
      setError("Ошибка удаления");
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="admin-form admin-form--wide admin-stack--lg">
      <div className="admin-card">
        <div className="admin-card__pad">
          <h2 className="admin-h2">Фотографии товара</h2>
          <ImageUploader images={images} onChange={setImages} />
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__pad admin-stack">
          <h2 className="admin-h2">Основная информация</h2>

          <div className="admin-grid-2">
            <div className="admin-field">
              <label className="admin-label">Название *</label>
              <input
                name="name"
                type="text"
                required
                defaultValue={product?.name || ""}
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Артикул / Номер</label>
              <input
                name="sku"
                type="text"
                defaultValue={product?.sku || ""}
                className="admin-input"
              />
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-label">Категория</label>
            <select
              name="categoryId"
              defaultValue={product?.categoryId || ""}
              className="admin-select"
            >
              <option value="">Без категории</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="admin-field">
            <div className="md-editor__head">
              <label className="admin-label" htmlFor="pf-description">
                Описание
              </label>
              <div className="md-tabs">
                <button
                  type="button"
                  className={`md-tab${!descPreview ? " md-tab--active" : ""}`}
                  onClick={() => setDescPreview(false)}
                >
                  Текст
                </button>
                <button
                  type="button"
                  className={`md-tab${descPreview ? " md-tab--active" : ""}`}
                  onClick={() => setDescPreview(true)}
                >
                  Предпросмотр
                </button>
              </div>
            </div>

            {descPreview ? (
              <div className="md-preview">
                {descValue.trim() ? (
                  <MarkdownText text={descValue} />
                ) : (
                  <span className="md-preview__empty">
                    Пусто — переключитесь на «Текст» и напишите описание
                  </span>
                )}
              </div>
            ) : (
              <>
                <div className="md-toolbar">
                  <button
                    type="button"
                    className="md-tool-btn"
                    title="Жирный"
                    onClick={() => descWrap("**", "**")}
                  >
                    <Bold size={13} />
                  </button>
                  <button
                    type="button"
                    className="md-tool-btn"
                    title="Курсив"
                    onClick={() => descWrap("*", "*")}
                  >
                    <Italic size={13} />
                  </button>
                  <button
                    type="button"
                    className="md-tool-btn"
                    title="Заголовок"
                    onClick={() => descPrefix("### ")}
                  >
                    <Heading3 size={13} />
                  </button>
                  <button
                    type="button"
                    className="md-tool-btn"
                    title="Список"
                    onClick={() => descPrefix("- ")}
                  >
                    <List size={13} />
                  </button>
                  <button
                    type="button"
                    className="md-tool-btn"
                    title="Нумерованный список"
                    onClick={() => descPrefix("1. ")}
                  >
                    <ListOrdered size={13} />
                  </button>
                  <button
                    type="button"
                    className="md-tool-btn"
                    title="Ссылка"
                    onClick={() => descWrap("[", "](https://)", "текст ссылки")}
                  >
                    <Link2 size={13} />
                  </button>
                  <button
                    type="button"
                    className="md-tool-btn"
                    title="Цитата"
                    onClick={() => descPrefix("> ")}
                  >
                    <Quote size={13} />
                  </button>
                </div>
                <textarea
                  id="pf-description"
                  ref={descRef}
                  name="description"
                  rows={6}
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  className="admin-textarea"
                  placeholder={
                    "Короб для переезда и хранения.\n\n- выдерживает до 20 кг\n- **5-слойный** картон\n- размер в сборе: 400×300×300 мм"
                  }
                />
                <div className="md-hint">
                  Поддерживается Markdown: **жирный**, *курсив*, ### заголовок,
                  - список, 1. нумерованный, [текст ссылки](https://)
                </div>
              </>
            )}
          </div>

          <div className="admin-field">
            <label className="admin-label">Примечание</label>
            <input
              name="note"
              type="text"
              defaultValue={product?.note || ""}
              placeholder='например: "под заказ", "двойные борта"'
              className="admin-input"
            />
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__pad admin-stack">
          <h2 className="admin-h2">Цены и Скидки</h2>
          <div className="admin-grid-3">
            <div className="admin-field">
              <label className="admin-label">Розничная цена, ₽</label>
              <input
                name="price"
                type="number"
                step="0.01"
                defaultValue={product?.price ?? ""}
                placeholder="0.00"
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Оптовая цена, ₽</label>
              <input
                name="priceWholesale"
                type="number"
                step="0.01"
                defaultValue={product?.priceWholesale ?? ""}
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Мин. опт (шт.)</label>
              <input
                name="minWholesaleQty"
                type="number"
                defaultValue={product?.minWholesaleQty ?? ""}
                className="admin-input"
              />
            </div>
          </div>

          <div className="admin-grid-3" style={{ marginTop: 12 }}>
            <div className="admin-field">
              <label className="admin-label">Тип скидки</label>
              <select
                name="discountType"
                defaultValue={product?.discountType || ""}
                className="admin-select"
              >
                <option value="">Без скидки</option>
                <option value="percent">Процент (%)</option>
                <option value="fixed">Сумма в рублях (₽)</option>
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-label">Величина скидки</label>
              <input
                name="discountValue"
                type="number"
                step="0.01"
                defaultValue={product?.discountValue ?? ""}
                placeholder="Напр. 15 или 500"
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Бейдж скидки (текст)</label>
              <input
                name="discountBadge"
                type="text"
                defaultValue={product?.discountBadge || ""}
                placeholder="Напр. -15% или Скидка"
                className="admin-input"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__pad admin-stack">
          <h2 className="admin-h2">Характеристики</h2>
          <div className="admin-grid-4">
            <div className="admin-field">
              <label className="admin-label">Длина, мм</label>
              <input
                name="dimensionLength"
                type="number"
                defaultValue={product?.dimensionLength ?? ""}
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Ширина, мм</label>
              <input
                name="dimensionWidth"
                type="number"
                defaultValue={product?.dimensionWidth ?? ""}
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Высота, мм</label>
              <input
                name="dimensionHeight"
                type="number"
                defaultValue={product?.dimensionHeight ?? ""}
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Объём, л</label>
              <input
                name="volume"
                type="number"
                step="0.1"
                defaultValue={product?.volume ?? ""}
                className="admin-input"
              />
            </div>
          </div>

          <div className="admin-grid-3">
            <div className="admin-field">
              <label className="admin-label">Материал</label>
              <input
                name="material"
                type="text"
                defaultValue={product?.material || ""}
                placeholder="Т23К, микрогофра..."
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Остаток на складе (шт.)</label>
              <input
                name="stockQty"
                type="number"
                defaultValue={product?.stockQty ?? ""}
                placeholder="Не ограничено"
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Предупреждать при остатке ≤</label>
              <input
                name="stockWarnQty"
                type="number"
                min={0}
                defaultValue={product?.stockWarnQty ?? ""}
                placeholder="Напр. 10"
                className="admin-input"
              />
              <span className="admin-hint">На дашборде появится «пополните» при этом остатке.</span>
            </div>
            <div className="admin-field">
              <label className="admin-label">В упаковке (шт.)</label>
              <input
                name="packQty"
                type="number"
                defaultValue={product?.packQty ?? ""}
                className="admin-input"
              />
            </div>
          </div>

          <div className="admin-field" style={{ maxWidth: 200 }}>
            <label className="admin-label">Ед. измерения</label>
            <select
              name="dimensionUnit"
              defaultValue={product?.dimensionUnit || "мм"}
              className="admin-select"
            >
              <option value="мм">мм</option>
              <option value="см">см</option>
              <option value="м">м</option>
            </select>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__pad">
          {isEdit ? (
            <VariantsEditor
              productId={product.id!}
              basePrice={product?.price ?? null}
            />
          ) : (
            <div className="admin-block">
              <div className="admin-block__title">
                Варианты (цвет/размер/фасовка)
              </div>
              <p className="admin-block__desc admin-block__desc--muted">
                Чтобы добавить варианты — сначала сохраните товар. Варианты
                позволяют покупателю выбирать конкретный цвет, размер или
                фасовку и хранят свою цену/остаток/артикул.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__pad admin-stack">
          <h2 className="admin-h2">Настройки</h2>
          <div className="admin-grid-2">
            {[
              {
                name: "inStock",
                label: "В наличии",
                defaultChecked: product?.inStock ?? true,
              },
              {
                name: "isVisible",
                label: "Показывать на сайте",
                defaultChecked: product?.isVisible ?? true,
              },
              {
                name: "isPromo",
                label: "Акционный товар",
                defaultChecked: product?.isPromo ?? false,
              },
              {
                name: "isFeatured",
                label: "Популярный товар",
                defaultChecked: product?.isFeatured ?? false,
              },
              {
                name: "madeToOrder",
                label: "Под заказ (без цены на сайте)",
                defaultChecked: product?.madeToOrder ?? false,
              },
            ].map((flag) => (
              <label key={flag.name} className="admin-check">
                <input
                  name={flag.name}
                  type="checkbox"
                  defaultChecked={flag.defaultChecked}
                />
                <span>{flag.label}</span>
              </label>
            ))}
          </div>
          <div className="admin-grid-2">
            <div className="admin-field">
              <label className="admin-label">Метка акции</label>
              <input
                name="promoLabel"
                type="text"
                defaultValue={product?.promoLabel || ""}
                placeholder='например: "Хит", "Акция"'
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Порядок в популярных</label>
              <input
                name="featuredOrder"
                type="number"
                min={1}
                step={1}
                defaultValue={product?.featuredOrder ?? ""}
                placeholder="1 — самый первый"
                className="admin-input"
              />
              <span className="admin-hint">
                Работает для товаров с флагом «Популярный товар». Если оставить пустым — товар будет добавлен в конец блока.
              </span>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-form-actions">
        <div className="admin-form-actions__left">
          <button
            type="submit"
            disabled={saving}
            className="admin-btn admin-btn--primary"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Сохранение...
              </>
            ) : (
              <>
                <Save size={16} /> {isEdit ? "Сохранить" : "Создать товар"}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="admin-btn admin-btn--ghost"
          >
            Отмена
          </button>
        </div>

        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="admin-btn admin-btn--danger"
          >
            {deleting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Trash2 size={16} />
            )}
            Удалить товар
          </button>
        )}
      </div>
    </form>
  );
}
