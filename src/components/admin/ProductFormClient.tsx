// =========================================================
// FILE: src/components/admin/ProductFormClient.tsx
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, Trash2 } from "lucide-react";
import { ImageUploader } from "./ImageUploader";

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
  isVisible?: boolean | null;
  isFeatured?: boolean | null;
  images?: ProductImage[];
  imageUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export function ProductFormClient({
  categories,
  product,
}: {
  categories: Category[];
  product?: ProductData;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState<ProductImage[]>(product?.images || []);

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

    const body = {
      stockQty: data.get("stockQty") !== "" ? Number(data.get("stockQty")) : null,
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
      isVisible: data.get("isVisible") === "on",
      isFeatured: data.get("isFeatured") === "on",
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

      if (!res.ok) {
        const resBody = await res.json().catch(() => ({}));
        throw new Error(
          (resBody as Record<string, string>).error || "Ошибка сохранения"
        );
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
            <label className="admin-label">Описание</label>
            <textarea
              name="description"
              rows={3}
              defaultValue={product?.description || ""}
              className="admin-textarea"
            />
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
          <h2 className="admin-h2">Цены</h2>
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