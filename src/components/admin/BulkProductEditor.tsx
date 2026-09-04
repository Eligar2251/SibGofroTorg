"use client";

import { useDeferredValue, useEffect, useMemo, useState, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImageIcon,
  Loader2,
  PackageCheck,
  RotateCcw,
  Search,
  Tags,
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
  description: string;
  note: string;
  price: number | null;
  purchasePrice: number | null;
  priceWholesale: number | null;
  minWholesaleQty: number | null;
  discountType: string;
  discountValue: number | null;
  discountBadge: string;
  stockQty: number | null;
  stockWarnQty: number | null;
  inStock: boolean;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string;
  weight: number | null;
  volume: number | null;
  material: string;
  packQty: number | null;
  isVisible: boolean;
  isPromo: boolean;
  isFeatured: boolean;
  isSale: boolean;
  promoLabel: string;
  promoLabelColor: string;
  promoLabelTextColor: string;
  tags: string[];
  madeToOrder: boolean;
  madeToOrderMinQty: number | null;
  isCuttable: boolean;
  cutMetersPerRoll: number | null;
  cutPricePerMeter: number | null;
  cutUnitName: string;
  barcode: string;
  images?: ImageEntry[];
  imageUrl?: string | null;
}

interface Category {
  id: string;
  name: string;
}

/* Порядок шагов (4 таба — paginated):
   1. Цена и склад
   2. Информация и размеры
   3. Метки и витрина
   4. Изображения
*/
type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { step: 1 as const, title: "Цена и склад", hint: "Цена, закупка, опт, остаток", icon: WalletCards },
  { step: 2 as const, title: "Информация", hint: "Название, описание, размеры, вес", icon: PackageCheck },
  { step: 3 as const, title: "Метки и витрина", hint: "Акции, метки, запуск, под заказ", icon: Tags },
  { step: 4 as const, title: "Изображения", hint: "Фото для каждого товара", icon: ImageIcon },
];

const INITIAL_RENDER_LIMIT = 60;
const RENDER_PAGE_SIZE = 60;

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
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});
  const deferredSearch = useDeferredValue(search);
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadedImageIds, setLoadedImageIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  // ID товара, для которого сейчас идёт загрузка
  const [uploadingProductId, setUploadingProductId] = useState<string | null>(null);

  const visibleProducts = useMemo(() => {
    if (step > 1) return products.filter((product) => workingIds.has(product.id));
    const query = deferredSearch.trim().toLocaleLowerCase("ru-RU");
    if (!query) return products;
    return products.filter(
      (product) =>
        product.name.toLocaleLowerCase("ru-RU").includes(query) ||
        product.sku.toLocaleLowerCase("ru-RU").includes(query)
    );
  }, [products, deferredSearch, step, workingIds]);

  const displayedProducts = useMemo(
    () => visibleProducts.slice(0, renderLimit),
    [renderLimit, visibleProducts]
  );
  const searchPending = search !== deferredSearch;

  useEffect(() => {
    setRenderLimit(INITIAL_RENDER_LIMIT);
  }, [deferredSearch, step]);

  useEffect(() => {
    if (step !== 4) return;
    const missingIds = displayedProducts
      .map((product) => product.id)
      .filter((id) => !loadedImageIds.has(id));
    if (missingIds.length === 0) return;

    let cancelled = false;
    setLoadingImages(true);
    setError("");
    void fetch("/api/admin/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load-images", ids: missingIds }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить фотографии");
        if (cancelled) return;
        const byId = new Map<string, { images: ImageEntry[]; imageUrl: string | null }>(
          (body.products || []).map((item: any) => [
            String(item.id),
            {
              images: Array.isArray(item.images) ? item.images : [],
              imageUrl: item.imageUrl || null,
            },
          ])
        );
        setProducts((items) =>
          items.map((item) => {
            const loaded = byId.get(item.id);
            return loaded ? { ...item, ...loaded } : item;
          })
        );
        setLoadedImageIds((current) => new Set([...current, ...missingIds]));
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Ошибка загрузки фотографий");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingImages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [step, displayedProducts, loadedImageIds]);

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

  // Удаляем конкретную запись по объекту (а не по publicId — у фото,
  // пришедших ссылкой из Excel, publicId пустой у всех, и фильтр по
  // publicId удалял бы их скопом).
  function removeImageFromProduct(productId: string, target: ImageEntry) {
    setProducts((items) =>
      items.map((item) => {
        if (item.id !== productId) return item;
        const filtered = (item.images || []).filter((img) => img !== target);
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
      displayedProducts.length > 0 &&
      displayedProducts.every((product) => workingIds.has(product.id));
    setWorkingIds((current) => {
      const next = new Set(current);
      for (const product of displayedProducts) {
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
    setTagInputs({});
    setStep(1);
    setSearch("");
    setRenderLimit(INITIAL_RENDER_LIMIT);
    setLoadedImageIds(new Set());
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
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Название или артикул..."
              autoComplete="off"
              aria-label="Поиск товара для массового редактирования"
            />
            <small>
              {searchPending
                ? "Ищем…"
                : `Найдено: ${visibleProducts.length}`}
            </small>
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
          {/* ── Шаг 1: Цена и склад ── */}
          {step === 1 && (
            <table className="admin-table bulk-table bulk-table--stock">
              <thead><tr>
                <th><input type="checkbox" checked={displayedProducts.length > 0 && displayedProducts.every((p) => workingIds.has(p.id))} onChange={toggleVisible} title="Выбрать показанные строки" /></th>
                <th>Название</th><th>SKU</th><th>Категория</th>
                <th>Цена, ₽</th><th>Закупка, ₽</th><th>Опт, ₽</th><th>Опт от</th>
                <th>Скидка</th><th>Скидка</th><th>Бейдж скидки</th>
                <th>Остаток</th><th>Порог остатка</th><th>В наличии</th><th>В пачке</th>
              </tr></thead>
              <tbody>{displayedProducts.map((product) => (
                <tr key={product.id} className={workingIds.has(product.id) ? "bulk-row--selected" : ""}>
                  <td><input type="checkbox" checked={workingIds.has(product.id)} onChange={() => toggle(product.id)} /></td>
                  <td><input className="admin-input" value={product.name} onChange={(e) => update(product.id, "name", e.target.value)} /></td>
                  <td><input className="admin-input" value={product.sku} onChange={(e) => update(product.id, "sku", e.target.value)} /></td>
                  <td><select className="admin-select" value={product.categoryId} onChange={(e) => update(product.id, "categoryId", e.target.value)}><option value="">—</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></td>
                  <td><input type="number" min={0} step="0.01" className="admin-input bulk-number" value={product.price ?? ""} onChange={(e) => update(product.id, "price", numeric(e.target.value))} /></td>
                  <td><input type="number" min={0} step="0.01" className="admin-input bulk-number" value={product.purchasePrice ?? ""} onChange={(e) => update(product.id, "purchasePrice", numeric(e.target.value))} /></td>
                  <td><input type="number" min={0} step="0.01" className="admin-input bulk-number" value={product.priceWholesale ?? ""} onChange={(e) => update(product.id, "priceWholesale", numeric(e.target.value))} /></td>
                  <td><input type="number" min={1} className="admin-input bulk-number" value={product.minWholesaleQty ?? ""} onChange={(e) => update(product.id, "minWholesaleQty", numeric(e.target.value))} /></td>
                  <td><select className="admin-select" value={product.discountType} onChange={(e) => update(product.id, "discountType", e.target.value as BulkProduct["discountType"])}><option value="">Без скидки</option><option value="percent">%</option><option value="fixed">−₽</option></select></td>
                  <td><input type="number" min={0} step="0.1" className="admin-input bulk-number" value={product.discountValue ?? ""} onChange={(e) => update(product.id, "discountValue", numeric(e.target.value))} /></td>
                  <td><input className="admin-input" value={product.discountBadge} onChange={(e) => update(product.id, "discountBadge", e.target.value)} placeholder="Скидка, Акция..." /></td>
                  <td><input type="number" min={0} className="admin-input bulk-number" value={product.stockQty ?? ""} onChange={(e) => update(product.id, "stockQty", numeric(e.target.value))} /></td>
                  <td><input type="number" min={0} className="admin-input bulk-number" value={product.stockWarnQty ?? ""} onChange={(e) => update(product.id, "stockWarnQty", numeric(e.target.value))} /></td>
                  <td><input type="checkbox" checked={product.inStock} onChange={(e) => update(product.id, "inStock", e.target.checked)} /></td>
                  <td><input type="number" min={1} className="admin-input bulk-number" value={product.packQty ?? ""} onChange={(e) => update(product.id, "packQty", numeric(e.target.value))} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {/* ── Шаг 2: Информация и размеры ── */}
          {step === 2 && (
            <table className="admin-table bulk-table bulk-table--info">
              <thead><tr>
                <th>Название</th><th>Артикул</th><th>Категория</th>
                <th>Описание</th><th>Комментарий</th><th>Материал</th>
                <th>Длина, мм</th><th>Ширина, мм</th><th>Высота, мм</th><th>Ед. длины</th>
                <th>Вес</th><th>Объём</th><th>Штрихкод</th>
              </tr></thead>
              <tbody>{displayedProducts.map((product) => (
                <tr key={product.id} className={dirtyIds.has(product.id) ? "bulk-row--dirty" : ""}>
                  <td><input className="admin-input" value={product.name} onChange={(e) => update(product.id, "name", e.target.value)} /></td>
                  <td><input className="admin-input" value={product.sku} onChange={(e) => update(product.id, "sku", e.target.value)} /></td>
                  <td><select className="admin-select" value={product.categoryId} onChange={(e) => update(product.id, "categoryId", e.target.value)}><option value="">—</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></td>
                  <td><textarea className="admin-input" rows={2} value={product.description} onChange={(e) => update(product.id, "description", e.target.value)} /></td>
                  <td><input className="admin-input" value={product.note} onChange={(e) => update(product.id, "note", e.target.value)} /></td>
                  <td><input className="admin-input" value={product.material} onChange={(e) => update(product.id, "material", e.target.value)} /></td>
                  <td><input type="number" min={0} className="admin-input bulk-number" value={product.dimensionLength ?? ""} onChange={(e) => update(product.id, "dimensionLength", numeric(e.target.value))} /></td>
                  <td><input type="number" min={0} className="admin-input bulk-number" value={product.dimensionWidth ?? ""} onChange={(e) => update(product.id, "dimensionWidth", numeric(e.target.value))} /></td>
                  <td><input type="number" min={0} className="admin-input bulk-number" value={product.dimensionHeight ?? ""} onChange={(e) => update(product.id, "dimensionHeight", numeric(e.target.value))} /></td>
                  <td><input className="admin-input" value={product.dimensionUnit} onChange={(e) => update(product.id, "dimensionUnit", e.target.value)} placeholder="мм" /></td>
                  <td><input type="number" min={0} step="0.01" className="admin-input bulk-number" value={product.weight ?? ""} onChange={(e) => update(product.id, "weight", numeric(e.target.value))} /></td>
                  <td><input type="number" min={0} step="0.01" className="admin-input bulk-number" value={product.volume ?? ""} onChange={(e) => update(product.id, "volume", numeric(e.target.value))} /></td>
                  <td><input className="admin-input" value={product.barcode} onChange={(e) => update(product.id, "barcode", e.target.value)} placeholder="EAN-13" /></td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {/* ── Шаг 3: Метки и витрина ── */}
          {step === 3 && (
            <table className="admin-table bulk-table bulk-table--marketing">
              <thead><tr>
                <th>Название</th><th>Метка акции</th><th>Цвет метки</th><th>Цвет текста</th>
                <th>Метки (через запятую)</th><th>Витрина</th><th>Промо</th><th>Популярные</th><th>Распродажа</th>
                <th>Под заказ</th><th>Мин. заказ</th><th>Рулон/резка</th><th>М в рулоне</th><th>Цена за м</th><th>Ед. назв.</th>
              </tr></thead>
              <tbody>{displayedProducts.map((product) => (
                <tr key={product.id} className={dirtyIds.has(product.id) ? "bulk-row--dirty" : ""}>
                  <td><input className="admin-input" value={product.name} onChange={(e) => update(product.id, "name", e.target.value)} /></td>
                  <td><input className="admin-input" value={product.promoLabel} onChange={(e) => update(product.id, "promoLabel", e.target.value)} placeholder="Акция, Хит..." /></td>
                  <td><input type="color" value={product.promoLabelColor || "#d97706"} onChange={(e) => update(product.id, "promoLabelColor", e.target.value)} /></td>
                  <td><input type="color" value={product.promoLabelTextColor || "#ffffff"} onChange={(e) => update(product.id, "promoLabelTextColor", e.target.value)} /></td>
                  <td>
                    <input
                      className="admin-input"
                      value={
                        tagInputs[product.id] ??
                        (product.tags || []).join(", ")
                      }
                      onChange={(e) =>
                        setTagInputs((prev) => ({
                          ...prev,
                          [product.id]: e.target.value,
                        }))
                      }
                      onBlur={(e) => {
                        const next = e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);
                        update(product.id, "tags", next);
                        setTagInputs((prev) => ({
                          ...prev,
                          [product.id]: next.join(", "),
                        }));
                      }}
                      placeholder="озон, вб, гост"
                    />
                  </td>
                  <td><input type="checkbox" checked={product.isVisible} onChange={(e) => update(product.id, "isVisible", e.target.checked)} /></td>
                  <td><input type="checkbox" checked={product.isPromo} onChange={(e) => update(product.id, "isPromo", e.target.checked)} /></td>
                  <td><input type="checkbox" checked={product.isFeatured} onChange={(e) => update(product.id, "isFeatured", e.target.checked)} /></td>
                  <td><input type="checkbox" checked={product.isSale} onChange={(e) => update(product.id, "isSale", e.target.checked)} /></td>
                  <td><input type="checkbox" checked={product.madeToOrder} onChange={(e) => update(product.id, "madeToOrder", e.target.checked)} /></td>
                  <td><input type="number" min={0} className="admin-input bulk-number" value={product.madeToOrderMinQty ?? ""} onChange={(e) => update(product.id, "madeToOrderMinQty", numeric(e.target.value))} /></td>
                  <td><input type="checkbox" checked={product.isCuttable} onChange={(e) => update(product.id, "isCuttable", e.target.checked)} /></td>
                  <td><input type="number" min={0} step="0.01" className="admin-input bulk-number" value={product.cutMetersPerRoll ?? ""} onChange={(e) => update(product.id, "cutMetersPerRoll", numeric(e.target.value))} /></td>
                  <td><input type="number" min={0} step="0.01" className="admin-input bulk-number" value={product.cutPricePerMeter ?? ""} onChange={(e) => update(product.id, "cutPricePerMeter", numeric(e.target.value))} /></td>
                  <td><input className="admin-input" value={product.cutUnitName} onChange={(e) => update(product.id, "cutUnitName", e.target.value)} placeholder="м" /></td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {/* ── Шаг 4: Изображения (для каждого товара отдельно) ── */}
          {step === 4 && (
            <div className="bulk-images-list">
              {loadingImages ? (
                <div className="bulk-images-loading">
                  <Loader2 size={18} className="animate-spin" />
                  Загружаем фотографии только выбранных товаров…
                </div>
              ) : displayedProducts.map((product) => (
                <ProductImageRow
                  key={product.id}
                  product={product}
                  isUploading={uploadingProductId === product.id}
                  onUpload={(file) => uploadImageForProduct(product.id, file)}
                  onRemove={(img) => removeImageFromProduct(product.id, img)}
                />
              ))}
            </div>
          )}

        </div>
      </div>

      {visibleProducts.length > displayedProducts.length && (
        <div className="bulk-load-more">
          <span>
            Показано {displayedProducts.length} из {visibleProducts.length}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => setRenderLimit((current) => current + RENDER_PAGE_SIZE)}
          >
            Показать ещё {Math.min(RENDER_PAGE_SIZE, visibleProducts.length - displayedProducts.length)}
          </button>
        </div>
      )}

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
        <button className="admin-btn admin-btn--primary" disabled={saving || loadingImages || workingIds.size === 0} onClick={saveAndContinue}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : step === 4 ? <Check size={15} /> : <ArrowRight size={15} />}
          {step === 4 ? "Сохранить и завершить" : step === 1 ? "Сохранить и перейти к информации" : step === 2 ? "Сохранить и перейти к меткам" : "Сохранить и перейти к фото"}
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
  onRemove: (img: ImageEntry) => void;
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
          <div key={img.publicId || img.url} className="bulk-img-row__thumb">
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
              onClick={() => onRemove(img)}
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
