"use client";

import { useMemo, useState, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImageIcon,
  Loader2,
  PackageCheck,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
  WalletCards,
} from "lucide-react";
import Image from "next/image";

interface ImageEntry {
  url: string;
  publicId: string;
}

interface BulkProduct {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  price: number | null;
  priceWholesale: number | null;
  minWholesaleQty: number | null;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string;
  weight: number | null;
  material: string;
  packQty: number | null;
  volume: number | null;
  note: string;
  stockQty: number | null;
  inStock: boolean;
  isVisible: boolean;
  isPromo: boolean;
  isFeatured: boolean;
  promoLabel: string;
  images: ImageEntry[];
  imageUrl: string | null;
}

interface Category {
  id: string;
  name: string;
}

/* Порядок шагов:
   1. Товар и склад
   2. Цены
   3. Изображения  ← теперь ДО публикации
   4. Публикация
*/
type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { step: 1 as const, title: "Товар и склад", hint: "Название, остаток и пачка", icon: PackageCheck },
  { step: 2 as const, title: "Цены", hint: "Розница и оптовые условия", icon: WalletCards },
  { step: 3 as const, title: "Изображения", hint: "Фото для каждого товара", icon: ImageIcon },
  { step: 4 as const, title: "Публикация", hint: "Видимость, наличие и акции", icon: Check },
];

function numeric(value: string): number | null {
  return value === "" ? null : Number(value);
}

export function BulkProductEditor({
  products: initialProducts,
  categories,
}: {
  products: BulkProduct[];
  categories: Category[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [step, setStep] = useState<Step>(1);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  // ID товара, для которого сейчас идёт загрузка
  const [uploadingProductId, setUploadingProductId] = useState<string | null>(null);

  const visibleProducts = useMemo(() => {
    if (step > 1) return products.filter((product) => workingIds.has(product.id));
    const query = search.trim().toLocaleLowerCase("ru-RU");
    if (!query) return products;
    return products.filter(
      (product) =>
        product.name.toLocaleLowerCase("ru-RU").includes(query) ||
        product.sku.toLocaleLowerCase("ru-RU").includes(query)
    );
  }, [products, search, step, workingIds]);

  function update<K extends keyof BulkProduct>(
    id: string,
    field: K,
    value: BulkProduct[K]
  ) {
    setProducts((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]: value,
              ...(field === "stockQty"
                ? { inStock: (Number(value) || 0) > 0 }
                : {}),
            }
          : item
      )
    );
    setWorkingIds((ids) => new Set(ids).add(id));
    setDirtyIds((ids) => new Set(ids).add(id));
    setFinished(false);
  }

  /* ── Загрузка изображения для конкретного товара ── */
  async function uploadImageForProduct(productId: string, file: File) {
    setUploadingProductId(productId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Ошибка загрузки");
      const data = await res.json();
      const newImage: ImageEntry = { url: data.url, publicId: data.publicId };

      setProducts((items) =>
        items.map((item) => {
          if (item.id !== productId) return item;
          const merged = [...(item.images || []), newImage];
          return { ...item, images: merged, imageUrl: merged[0]?.url || item.imageUrl || null };
        })
      );
      setDirtyIds((ids) => new Set(ids).add(productId));
      setFinished(false);
    } catch {
      alert("Не удалось загрузить фото");
    }
    setUploadingProductId(null);
  }

  function removeImageFromProduct(productId: string, publicId: string) {
    setProducts((items) =>
      items.map((item) => {
        if (item.id !== productId) return item;
        const filtered = (item.images || []).filter((img) => img.publicId !== publicId);
        return { ...item, images: filtered, imageUrl: filtered[0]?.url || null };
      })
    );
    setDirtyIds((ids) => new Set(ids).add(productId));
  }

  function toggle(id: string) {
    setWorkingIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    const allSelected =
      visibleProducts.length > 0 &&
      visibleProducts.every((product) => workingIds.has(product.id));
    setWorkingIds((current) => {
      const next = new Set(current);
      for (const product of visibleProducts) {
        if (allSelected) next.delete(product.id);
        else next.add(product.id);
      }
      return next;
    });
  }

  async function deleteSelected() {
    if (workingIds.size === 0) return;
    if (
      !confirm(
        `Удалить выбранные товары (${workingIds.size})? Это действие необратимо.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/products/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...workingIds] }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Не удалось удалить товары");
      }
      setProducts((items) =>
        items.filter((product) => !workingIds.has(product.id))
      );
      setWorkingIds(new Set());
      setDirtyIds(new Set());
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Ошибка сети"
      );
    } finally {
      setDeleting(false);
    }
  }

  async function saveAndContinue() {
    if (workingIds.size === 0) {
      setError("Измените или отметьте хотя бы один товар");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const selected = products.filter((product) => workingIds.has(product.id));
      const response = await fetch("/api/admin/products/bulk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: selected }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить товары");
      setDirtyIds(new Set());
      if (step < 4) {
        setStep((step + 1) as Step);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setFinished(true);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setProducts(initialProducts);
    setWorkingIds(new Set());
    setDirtyIds(new Set());
    setStep(1);
    setSearch("");
    setError("");
    setFinished(false);
  }

  return (
    <div className="bulk-wizard">
      <div className="bulk-steps">
        {STEPS.map((item) => {
          const Icon = item.icon;
          const active = item.step === step;
          const done = item.step < step;
          return (
            <div
              key={item.step}
              className={`bulk-step${active ? " bulk-step--active" : ""}${
                done ? " bulk-step--done" : ""
              }`}
            >
              <span><Icon size={16} /></span>
              <div><strong>{item.step}. {item.title}</strong><small>{item.hint}</small></div>
            </div>
          );
        })}
      </div>

      <div className="bulk-toolbar">
        <div>
          <strong>{step === 1 ? "Выберите и отредактируйте товары" : `Товары в работе: ${workingIds.size}`}</strong>
          <span>
            {step === 1
              ? "Любое изменение автоматически добавляет товар в рабочую выборку"
              : "Показываются только товары, выбранные или изменённые на первом шаге"}
          </span>
        </div>
        {step === 1 && (
          <div className="bulk-search">
            <Search size={14} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название или артикул..." />
          </div>
        )}
        {step === 1 && workingIds.size > 0 && (
          <button
            className="admin-btn admin-btn--danger"
            onClick={deleteSelected}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            Удалить ({workingIds.size})
          </button>
        )}
        <button className="admin-btn admin-btn--ghost" onClick={reset}><RotateCcw size={14} /> Сбросить</button>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          {/* ── Шаг 1: Товар и склад ── */}
          {step === 1 && (
            <table className="admin-table bulk-table bulk-table--stock">
              <thead><tr>
                <th><input type="checkbox" checked={visibleProducts.length > 0 && visibleProducts.every((p) => workingIds.has(p.id))} onChange={toggleVisible} /></th>
                <th>Название</th><th>Артикул</th><th>Категория</th><th>Количество на складе</th><th>В пачке</th><th>Материал</th>
              </tr></thead>
              <tbody>{visibleProducts.map((product) => (
                <tr key={product.id} className={workingIds.has(product.id) ? "bulk-row--selected" : ""}>
                  <td><input type="checkbox" checked={workingIds.has(product.id)} onChange={() => toggle(product.id)} /></td>
                  <td><input className="admin-input" value={product.name} onChange={(e) => update(product.id, "name", e.target.value)} /></td>
                  <td><input className="admin-input" value={product.sku} onChange={(e) => update(product.id, "sku", e.target.value)} /></td>
                  <td><select className="admin-select" value={product.categoryId} onChange={(e) => update(product.id, "categoryId", e.target.value)}><option value="">—</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></td>
                  <td><input type="number" min={0} className="admin-input bulk-number" value={product.stockQty ?? ""} onChange={(e) => update(product.id, "stockQty", numeric(e.target.value))} /></td>
                  <td><input type="number" min={1} className="admin-input bulk-number" value={product.packQty ?? ""} onChange={(e) => update(product.id, "packQty", numeric(e.target.value))} /></td>
                  <td><input className="admin-input" value={product.material} onChange={(e) => update(product.id, "material", e.target.value)} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {/* ── Шаг 2: Цены ── */}
          {step === 2 && (
            <table className="admin-table bulk-table bulk-table--prices">
              <thead><tr><th>Товар</th><th>Цена, ₽</th><th>Оптовая цена, ₽</th><th>Опт от, шт.</th><th>Остаток</th><th>Пачка</th></tr></thead>
              <tbody>{visibleProducts.map((product) => (
                <tr key={product.id} className={dirtyIds.has(product.id) ? "bulk-row--dirty" : ""}>
                  <td><strong>{product.name}</strong><small className="bulk-sku">{product.sku || "без артикула"}</small></td>
                  <td><input type="number" min={0} step="0.01" className="admin-input" value={product.price ?? ""} onChange={(e) => update(product.id, "price", numeric(e.target.value))} /></td>
                  <td><input type="number" min={0} step="0.01" className="admin-input" value={product.priceWholesale ?? ""} onChange={(e) => update(product.id, "priceWholesale", numeric(e.target.value))} /></td>
                  <td><input type="number" min={1} className="admin-input" value={product.minWholesaleQty ?? ""} onChange={(e) => update(product.id, "minWholesaleQty", numeric(e.target.value))} /></td>
                  <td><span className="admin-stock-count">{product.stockQty ?? 0} шт.</span></td>
                  <td>{product.packQty ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {/* ── Шаг 3: Изображения (для каждого товара отдельно) ── */}
          {step === 3 && (
            <div className="bulk-images-list">
              {visibleProducts.map((product) => (
                <ProductImageRow
                  key={product.id}
                  product={product}
                  isUploading={uploadingProductId === product.id}
                  onUpload={(file) => uploadImageForProduct(product.id, file)}
                  onRemove={(publicId) => removeImageFromProduct(product.id, publicId)}
                />
              ))}
            </div>
          )}

          {/* ── Шаг 4: Публикация ── */}
          {step === 4 && (
            <table className="admin-table bulk-table bulk-table--publish">
              <thead><tr><th>Товар</th><th>Примечание</th><th>Метка акции</th><th>В наличии</th><th>Виден</th><th>Акция</th><th>На главной</th></tr></thead>
              <tbody>{visibleProducts.map((product) => (
                <tr key={product.id} className={dirtyIds.has(product.id) ? "bulk-row--dirty" : ""}>
                  <td><strong>{product.name}</strong><small className="bulk-sku">остаток: {product.stockQty ?? 0}</small></td>
                  <td><input className="admin-input" value={product.note} onChange={(e) => update(product.id, "note", e.target.value)} /></td>
                  <td><input className="admin-input" value={product.promoLabel} onChange={(e) => update(product.id, "promoLabel", e.target.value)} placeholder="Акция, Хит..." /></td>
                  <td><input type="checkbox" checked={product.inStock} onChange={(e) => update(product.id, "inStock", e.target.checked)} /></td>
                  <td><input type="checkbox" checked={product.isVisible} onChange={(e) => update(product.id, "isVisible", e.target.checked)} /></td>
                  <td><input type="checkbox" checked={product.isPromo} onChange={(e) => update(product.id, "isPromo", e.target.checked)} /></td>
                  <td><input type="checkbox" checked={product.isFeatured} onChange={(e) => update(product.id, "isFeatured", e.target.checked)} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      {visibleProducts.length === 0 && (
        <div className="admin-empty"><p>{step === 1 ? "Товары не найдены" : "На первом шаге не выбраны товары"}</p></div>
      )}
      {error && <div className="admin-error">{error}</div>}
      {finished && <div className="bulk-finished"><Check size={18} /> Изменения сохранены для {workingIds.size} товаров</div>}

      <div className="bulk-footer">
        {step > 1 ? (
          <button className="admin-btn admin-btn--ghost" onClick={() => setStep((step - 1) as Step)}><ArrowLeft size={15} /> Назад</button>
        ) : <span />}
        <div className="bulk-footer__summary">В работе: <strong>{workingIds.size}</strong> товаров</div>
        <button className="admin-btn admin-btn--primary" disabled={saving || workingIds.size === 0} onClick={saveAndContinue}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : step === 4 ? <Check size={15} /> : <ArrowRight size={15} />}
          {step === 4 ? "Сохранить и завершить" : step === 1 ? "Сохранить и перейти к ценам" : step === 2 ? "Сохранить и перейти к фото" : "Сохранить и перейти к публикации"}
        </button>
      </div>
    </div>
  );
}

/* ── Компонент: строка товара с загрузкой изображений ── */
function ProductImageRow({
  product,
  isUploading,
  onUpload,
  onRemove,
}: {
  product: BulkProduct;
  isUploading: boolean;
  onUpload: (file: File) => void;
  onRemove: (publicId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) onUpload(file);
    });
  }

  const existingCount = (product.images || []).length;

  return (
    <div
      className={`bulk-img-row${dragOver ? " bulk-img-row--drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
    >
      <div className="bulk-img-row__info">
        <strong className="bulk-img-row__name">{product.name}</strong>
        <small className="bulk-img-row__meta">
          {product.sku || "без артикула"} · {existingCount} фото{existingCount === 0 && " — добавьте фото"}
        </small>
      </div>

      <div className="bulk-img-row__preview">
        {(product.images || []).map((img) => (
          <div key={img.publicId} className="bulk-img-row__thumb">
            <Image
              src={img.url}
              alt=""
              width={56}
              height={56}
              style={{ objectFit: "cover", borderRadius: 4 }}
            />
            <button
              type="button"
              className="bulk-img-row__thumb-del"
              onClick={() => onRemove(img.publicId)}
              aria-label="Удалить"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      <div className="bulk-img-row__actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          className="admin-btn admin-btn--outline admin-btn--sm"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {isUploading ? "Загрузка..." : "Добавить фото"}
        </button>
      </div>
    </div>
  );
}
