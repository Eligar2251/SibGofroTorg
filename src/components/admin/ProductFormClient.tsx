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
  RefreshCw,
} from "lucide-react";
import { ImageUploader } from "./ImageUploader";
import { MarkdownText } from "@/components/catalog/MarkdownText";
import { VariantsEditor } from "./VariantsEditor";
import {
  calculateBoxVolumeLiters,
  DEFAULT_PRODUCT_LABEL_COLOR,
  DEFAULT_PRODUCT_LABEL_TEXT_COLOR,
} from "@/lib/product-fields";

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
  barcode?: string | null;
  categoryId?: string | null;
  description?: string | null;
  price?: number | null;
  purchasePrice?: number | null;
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
  promoLabelColor?: string | null;
  promoLabelTextColor?: string | null;
  madeToOrder?: boolean | null;
  madeToOrderMinQty?: number | null;
  isCuttable?: boolean | null;
  cutMetersPerRoll?: number | null;
  cutPricePerMeter?: number | null;
  cutUnitName?: string | null;
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
  // Фото: если массив images пуст, но у товара есть главное фото
  // (image_url — обычно пришло импортом из Excel), подставляем его
  // как первый элемент. Иначе пересохранение формы ЗАТИРАЛО
  // главное фото: imageUrl считался из пустого images как null.
  const [images, setImages] = useState<ProductImage[]>(() => {
    const fromDb = product?.images || [];
    if (fromDb.length > 0) return fromDb;
    return product?.imageUrl ? [{ url: product.imageUrl, publicId: "" }] : [];
  });
  // Штрихкод — постоянный EAN-13. Контролируемое поле, чтобы
  // кнопка «Перегенерировать» могла сразу подставить новый код.
  const [barcodeValue, setBarcodeValue] = useState(product?.barcode || "");
  const [regeneratingBarcode, setRegeneratingBarcode] = useState(false);
  const [madeToOrderChecked, setMadeToOrderChecked] = useState(
    product?.madeToOrder ?? false
  );
  const [madeToOrderMinQty, setMadeToOrderMinQty] = useState<string>(
    product?.madeToOrderMinQty != null ? String(product.madeToOrderMinQty) : ""
  );
  const [isCuttableChecked, setIsCuttableChecked] = useState(product?.isCuttable ?? false);
  const [cutMetersPerRoll, setCutMetersPerRoll] = useState<string>(
    product?.cutMetersPerRoll != null ? String(product.cutMetersPerRoll) : "100"
  );
  const [cutPricePerMeter, setCutPricePerMeter] = useState<string>(
    product?.cutPricePerMeter != null ? String(product.cutPricePerMeter) : ""
  );
  const [cutUnitName, setCutUnitName] = useState<string>(product?.cutUnitName || "м");
  const [dimensionLength, setDimensionLength] = useState(
    product?.dimensionLength != null ? String(product.dimensionLength) : ""
  );
  const [dimensionWidth, setDimensionWidth] = useState(
    product?.dimensionWidth != null ? String(product.dimensionWidth) : ""
  );
  const [dimensionHeight, setDimensionHeight] = useState(
    product?.dimensionHeight != null ? String(product.dimensionHeight) : ""
  );
  const [dimensionUnit, setDimensionUnit] = useState(product?.dimensionUnit || "мм");
  const [promoLabel, setPromoLabel] = useState(product?.promoLabel || "");
  const [promoLabelColor, setPromoLabelColor] = useState(
    product?.promoLabelColor || DEFAULT_PRODUCT_LABEL_COLOR
  );
  const [promoLabelTextColor, setPromoLabelTextColor] = useState(
    product?.promoLabelTextColor || DEFAULT_PRODUCT_LABEL_TEXT_COLOR
  );
  const calculatedVolume = calculateBoxVolumeLiters(
    dimensionLength,
    dimensionWidth,
    dimensionHeight,
    dimensionUnit,
  );

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

  // Принудительно сменить штрихкод товара (ручное действие админа).
  // Сервер сохраняет новый код сразу; поле подставляется в форму.
  async function handleRegenerateBarcode() {
    if (!product?.id) {
      // Новый товар ещё не сохранён в БД — код присвоится автоматом
      // при сохранении карточки.
      return;
    }
    if (
      !confirm(
        "Товар получит НОВЫЙ штрихкод. Старые напечатанные этикетки перестанут находить товар сканером. Продолжить?"
      )
    ) {
      return;
    }
    setRegeneratingBarcode(true);
    setError("");
    try {
      const res = await fetch("/api/admin/products/barcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: product.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.barcode) {
        throw new Error(data?.error || "Не удалось сгенерировать штрихкод");
      }
      setBarcodeValue(data.barcode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка генерации штрихкода");
    } finally {
      setRegeneratingBarcode(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const form = e.currentTarget;
    const data = new FormData(form);
    const cleanPromoLabel = promoLabel.trim();

    const isFeatured = data.get("isFeatured") === "on";
    const featuredOrderRaw = String(data.get("featuredOrder") || "").trim();
    const featuredOrder = featuredOrderRaw ? Number(featuredOrderRaw) : null;

    const body = {
      stockQty: data.get("stockQty") !== "" ? Number(data.get("stockQty")) : null,
      stockWarnQty:
        data.get("stockWarnQty") !== "" ? Number(data.get("stockWarnQty")) : null,
      name: data.get("name"),
      sku: data.get("sku") || null,
      // Штрихкод из контролируемого поля (форма его всегда
      // отправляет — так код из БД сохраняется даже у товаров,
      // где он пока только вычислялся на лету). Пустое значение
      // = «очистить», сервер потом дозапишет новый генерацией.
      barcode: barcodeValue.replace(/\s+/g, "") || null,
      categoryId: data.get("categoryId") || null,
      description: data.get("description") || null,
      price: data.get("price") ? Number(data.get("price")) : null,
      purchasePrice: data.get("purchasePrice") ? Number(data.get("purchasePrice")) : null,
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
      volume: calculatedVolume,
      note: data.get("note") || null,
      inStock: data.get("inStock") === "on",
      isPromo: data.get("isPromo") === "on",
      promoLabel: cleanPromoLabel || null,
      promoLabelColor: cleanPromoLabel ? promoLabelColor : null,
      promoLabelTextColor: cleanPromoLabel ? promoLabelTextColor : null,
      madeToOrder: madeToOrderChecked,
      madeToOrderMinQty: madeToOrderChecked && madeToOrderMinQty !== "" ? Math.max(1, Math.floor(Number(madeToOrderMinQty) || 1)) : null,
      isCuttable: isCuttableChecked,
      cutMetersPerRoll: isCuttableChecked && cutMetersPerRoll !== "" ? Math.max(0.01, Number(cutMetersPerRoll) || 0) : null,
      cutPricePerMeter: isCuttableChecked && cutPricePerMeter !== "" ? Math.max(0, Number(cutPricePerMeter) || 0) : null,
      cutUnitName: isCuttableChecked ? (cutUnitName || "м") : null,
      discountType: data.get("discountType") || null,
      discountValue: data.get("discountValue")
        ? Number(data.get("discountValue"))
        : null,
      discountBadge: data.get("discountBadge") || null,
      isVisible: data.get("isVisible") === "on",
      isFeatured,
      images,
      // Главное фото — первое в массиве. Затирания больше нет
      // благодаря инициализации images из product.imageUrl выше
      // (Excel-товары), поэтому НЕ добавляем сюда фоллбек на
      // product.imageUrl: иначе удалить последнее фото у товара
      // стало бы невозможно (старое «воскресало» при сохранении).
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
      const hadFeatured = Boolean(product?.isFeatured);
      const previousOrder = product?.featuredOrder ?? null;
      const requestedOrder =
        Number.isFinite(featuredOrder ?? NaN) && (featuredOrder ?? 0) > 0
          ? featuredOrder
          : null;
      const featuredOrderChanged =
        hadFeatured !== isFeatured || previousOrder !== requestedOrder;

      // Порядок популярных — отдельная настройка. Если её обновление
      // внезапно упадёт, сам товар уже всё равно сохранён и юзера
      // нельзя оставлять на форме с ощущением «ничего не сохранилось».
      if (productId && featuredOrderChanged) {
        try {
          const nextOrderIds = normalizeFeaturedOrderIds(
            featuredOrderIds,
            productId,
            isFeatured,
            requestedOrder
          );
          await fetch("/api/admin/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              [FEATURED_ORDER_SETTING_KEY]: JSON.stringify(nextOrderIds),
            }),
          });
        } catch (err) {
          console.error("featured order update error:", err);
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
            <label className="admin-label">Штрихкод (EAN-13)</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                name="barcode"
                type="text"
                inputMode="numeric"
                value={barcodeValue}
                onChange={(e) =>
                  setBarcodeValue(e.target.value.replace(/[^\d\s]/g, ""))
                }
                maxLength={16}
                placeholder={
                  isEdit
                    ? "Сгенерируется автоматически"
                    : "Присвоится автоматически при сохранении"
                }
                className="admin-input"
                style={{ fontFamily: "var(--f-mono, monospace)" }}
              />
              {isEdit && (
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  onClick={handleRegenerateBarcode}
                  disabled={regeneratingBarcode}
                  title="Выдать товару новый штрихкод (ручная смена — по кнопке «Обновить штрихкоды» в списке товары с рабочим кодом не трогаются)"
                >
                  {regeneratingBarcode ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Новый код
                </button>
              )}
            </div>
            <div className="admin-hint">
              Постоянный код товара: присваивается один раз и не меняется при
              правках. Здесь его можно изменить вручную — например, если
              этикетка повреждена и нужно перевыпустить код.
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
          <div className="admin-grid-4">
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
              <label className="admin-label">Закупочная цена, ₽</label>
              <input
                name="purchasePrice"
                type="number"
                step="0.01"
                defaultValue={product?.purchasePrice ?? ""}
                placeholder="0.00"
                className="admin-input"
              />
              <span className="admin-hint">Для расчёта прибыли в отчётах. Берётся, если нет цены из поставки.</span>
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
              <label className="admin-label">Длина, {dimensionUnit}</label>
              <input
                name="dimensionLength"
                type="number"
                min="0"
                step="any"
                value={dimensionLength}
                onChange={(event) => setDimensionLength(event.target.value)}
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Ширина, {dimensionUnit}</label>
              <input
                name="dimensionWidth"
                type="number"
                min="0"
                step="any"
                value={dimensionWidth}
                onChange={(event) => setDimensionWidth(event.target.value)}
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Высота, {dimensionUnit}</label>
              <input
                name="dimensionHeight"
                type="number"
                min="0"
                step="any"
                value={dimensionHeight}
                onChange={(event) => setDimensionHeight(event.target.value)}
                className="admin-input"
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Объём, л</label>
              <input
                name="volume"
                type="number"
                step="0.001"
                value={calculatedVolume ?? ""}
                readOnly
                placeholder="Заполните Д × Ш × В"
                className="admin-input"
                aria-describedby="product-volume-hint"
              />
              <span id="product-volume-hint" className="admin-hint">
                {calculatedVolume != null
                  ? "Рассчитан автоматически по трём размерам"
                  : "Появится автоматически, когда заполнены длина, ширина и высота"}
              </span>
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
                min="0"
                defaultValue={product?.packQty ?? ""}
                className="admin-input"
              />
            </div>
          </div>

          <div className="admin-field" style={{ maxWidth: 200 }}>
            <label className="admin-label">Ед. измерения</label>
            <select
              name="dimensionUnit"
              value={dimensionUnit}
              onChange={(event) => setDimensionUnit(event.target.value)}
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

          <div
            className="admin-field"
            style={{
              marginTop: 12,
              padding: 14,
              border: "1px solid var(--adm-border)",
              borderRadius: 10,
              background: madeToOrderChecked ? "rgba(200,134,10,0.06)" : "transparent",
            }}
          >
            <label className="admin-check" style={{ marginBottom: 8 }}>
              <input
                name="madeToOrder"
                type="checkbox"
                checked={madeToOrderChecked}
                onChange={(e) => setMadeToOrderChecked(e.target.checked)}
              />
              <span style={{ fontWeight: 700 }}>Под заказ (без цены на сайте)</span>
            </label>
            {madeToOrderChecked && (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className="admin-field" style={{ margin: 0, minWidth: 220 }}>
                  <label className="admin-label">Минимальное кол-во для заказа, шт.</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={madeToOrderMinQty}
                    onChange={(e) => setMadeToOrderMinQty(e.target.value)}
                    placeholder="например: 100"
                    className="admin-input"
                  />
                  <span className="admin-hint">От какого количества изготавливаем. На сайте покажется «От N шт.»</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--adm-muted)", maxWidth: 320, lineHeight: 1.4 }}>
                  Если указано — на карточке товара и в каталоге будет «Под заказ от {madeToOrderMinQty || "…"} шт.» и в отдельной вкладке «Товары под заказ» можно массово менять это число.
                </div>
              </div>
            )}
          </div>

          <div
            className="admin-field"
            style={{
              marginTop: 12,
              padding: 14,
              border: "1px solid var(--adm-border)",
              borderRadius: 10,
              background: isCuttableChecked ? "rgba(59,130,246,0.06)" : "transparent",
            }}
          >
            <label className="admin-check" style={{ marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={isCuttableChecked}
                onChange={(e) => setIsCuttableChecked(e.target.checked)}
              />
              <span style={{ fontWeight: 700 }}>Можно продавать рулонами и метрами (плёнка, отмотка)</span>
            </label>
            {isCuttableChecked && (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginTop: 8 }}>
                <div className="admin-field" style={{ margin: 0, minWidth: 160 }}>
                  <label className="admin-label">Метров в рулоне</label>
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={cutMetersPerRoll}
                    onChange={(e) => setCutMetersPerRoll(e.target.value)}
                    placeholder="100"
                    className="admin-input"
                  />
                  <span className="admin-hint">Обычно 100 м</span>
                </div>
                <div className="admin-field" style={{ margin: 0, minWidth: 160 }}>
                  <label className="admin-label">Цена за метр, ₽</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={cutPricePerMeter}
                    onChange={(e) => setCutPricePerMeter(e.target.value)}
                    placeholder="например: 12"
                    className="admin-input"
                  />
                  <span className="admin-hint">Если не указана — считается из цены рулона</span>
                </div>
                <div className="admin-field" style={{ margin: 0, minWidth: 100 }}>
                  <label className="admin-label">Ед. изм.</label>
                  <input
                    type="text"
                    value={cutUnitName}
                    onChange={(e) => setCutUnitName(e.target.value)}
                    placeholder="м"
                    className="admin-input"
                    maxLength={5}
                  />
                </div>
                <div style={{ fontSize: 12, color: "var(--adm-muted)", maxWidth: 340, lineHeight: 1.4 }}>
                  Товар можно будет добавить в заказ как рулоны и как метры. Остаток показывается автоматом: напр. 5 рулонов по 100 м + 90 м = 5.9 рулона. При отмотке 10 м остаток станет 5 рул. + 80 м. На карточке сайта будет пометка «Можно рулоном и метрами».
                </div>
              </div>
            )}
          </div>

          <div className="admin-grid-2" style={{ marginTop: 12 }}>
            <div className="admin-field">
              <label className="admin-label">Метка товара</label>
              <input
                name="promoLabel"
                type="text"
                value={promoLabel}
                onChange={(event) => setPromoLabel(event.target.value)}
                placeholder='например: "Хит", "Акция"'
                className="admin-input"
              />
              <div className="product-label-colors">
                <label className="product-label-color">
                  <span>Цвет метки</span>
                  <input
                    name="promoLabelColor"
                    type="color"
                    value={promoLabelColor}
                    onChange={(event) => setPromoLabelColor(event.target.value)}
                  />
                  <code>{promoLabelColor}</code>
                </label>
                <label className="product-label-color">
                  <span>Цвет текста</span>
                  <input
                    name="promoLabelTextColor"
                    type="color"
                    value={promoLabelTextColor}
                    onChange={(event) => setPromoLabelTextColor(event.target.value)}
                  />
                  <code>{promoLabelTextColor}</code>
                </label>
              </div>
              <div className="product-label-preview" aria-live="polite">
                <span
                  style={{
                    backgroundColor: promoLabelColor,
                    color: promoLabelTextColor,
                  }}
                >
                  {promoLabel || "Пример метки"}
                </span>
              </div>
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
