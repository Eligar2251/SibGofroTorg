// =========================================================
// FILE: src/components/admin/mobile/ProductsMobile.tsx
// Мобильный список товаров — карточки вместо таблицы.
//
// Десктопная таблица ProductListClient не меняется: на телефоне
// вместо неё рендерится этот компонент (ветка useIsMobile там).
// Логика фильтрации остаётся в ProductListClient — компонент только
// показывает результат и управляет теми же state-значениями.
//
// Что выбрано «как в приложении»:
//  • поиск + кнопка «Фильтры» с бейджем активных фильтров;
//  • фильтры — нижний лист (категория/наличие/видимость);
//  • карточка: фото, название, артикул, цена и опт, остаток, бейджи;
//  • действия — крупные иконки: редактировать / QR / на сайте.
// =========================================================

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Edit2,
  Eye,
  EyeOff,
  QrCode,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { useBodyLock } from "@/hooks/use-body-lock";
import { normalizeProductLabelColor } from "@/lib/product-fields";
import styles from "./ProductsMobile.module.css";

export interface ProductsMobileItem {
  id: string;
  name: string;
  slug: string;
  sku?: string | null;
  barcode?: string | null;
  price: number | null;
  priceWholesale?: number | null;
  stockQty: number;
  isPromo: boolean;
  promoLabel?: string | null;
  promoLabelColor?: string | null;
  promoLabelTextColor?: string | null;
  madeToOrder?: boolean | null;
  madeToOrderMinQty?: number | null;
  isCuttable?: boolean | null;
  cutMetersPerRoll?: number | null;
  isVisible: boolean;
  isFeatured?: boolean;
  featuredOrder?: number | null;
  isSale?: boolean;
  imageUrl?: string | null;
  viewCount?: number;
}

type StockFilter = "all" | "in" | "out";
type VisibilityFilter = "all" | "visible" | "hidden";

export function ProductsMobile({
  products,
  categories,
  adminPath,
  search,
  onSearch,
  category,
  onCategory,
  stock,
  onStock,
  visibility,
  onVisibility,
}: {
  products: ProductsMobileItem[];
  categories: { id: string; name: string }[];
  adminPath: string;
  search: string;
  onSearch: (value: string) => void;
  category: string;
  onCategory: (value: string) => void;
  stock: StockFilter;
  onStock: (value: StockFilter) => void;
  visibility: VisibilityFilter;
  onVisibility: (value: VisibilityFilter) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  useBodyLock(filtersOpen);

  const activeFilters =
    (category !== "all" ? 1 : 0) +
    (stock !== "all" ? 1 : 0) +
    (visibility !== "all" ? 1 : 0);

  return (
    <div className={styles.page}>
      {/* ── Поиск + фильтры ── */}
      <div className={styles.searchRow}>
        <label className={styles.searchField}>
          <Search size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="search"
            inputMode="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Название или артикул…"
            className={styles.searchInput}
            aria-label="Поиск по товарам"
          />
          {search && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => onSearch("")}
              aria-label="Очистить поиск"
            >
              <X size={15} />
            </button>
          )}
        </label>

        <button
          type="button"
          className={`${styles.filterBtn}${activeFilters > 0 ? ` ${styles.filterBtnActive}` : ""}`}
          onClick={() => setFiltersOpen(true)}
          aria-label="Фильтры товаров"
        >
          <SlidersHorizontal size={17} />
          {activeFilters > 0 && (
            <span className={styles.filterCount}>{activeFilters}</span>
          )}
        </button>
      </div>

      {/* ── Кнопка «Добавить» + счётчик ── */}
      <div className={styles.metaRow}>
        <span className={styles.count}>{products.length} товаров</span>
        <Link
          href={`/${adminPath}/products/new`}
          prefetch={false}
          className={styles.addBtn}
        >
          + Добавить
        </Link>
      </div>

      {/* ── Карточки ── */}
      {products.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <GlyphIcon value="box" size={34} />
          </div>
          <p>
            {search || activeFilters > 0
              ? "Ничего не найдено по заданным критериям"
              : "Товаров пока нет"}
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} adminPath={adminPath} />
          ))}
        </div>
      )}

      {/* ── Лист фильтров ── */}
      {filtersOpen && (
        <FilterSheet
          categories={categories}
          category={category}
          onCategory={onCategory}
          stock={stock}
          onStock={onStock}
          visibility={visibility}
          onVisibility={onVisibility}
          onClose={() => setFiltersOpen(false)}
          activeCount={activeFilters}
        />
      )}
    </div>
  );
}

/* ── Карточка товара ── */

function formatCutStock(rolls: number, mpr: number | null | undefined) {
  const r = Math.max(0, Number(rolls) || 0);
  const m = Math.max(0, Number(mpr) || 0);
  if (!m) return `${r} шт.`;
  const full = Math.floor(r + 1e-9);
  const rem = Math.round((r - full) * m * 100) / 100;
  const total = Math.round(r * m * 100) / 100;
  if (rem > 0.009) return `${full} рул.+${rem}м (${total}м)`;
  return `${full} рул. (${total}м)`;
}

function ProductCard({
  product,
  adminPath,
}: {
  product: ProductsMobileItem;
  adminPath: string;
}) {
  const cuttable = Boolean(product.isCuttable && Number(product.cutMetersPerRoll) > 0);
  const inStock = product.stockQty > 0;

  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.thumb}>
          {product.imageUrl ? (
            /* Внешние URL (Cloudinary) без конфигурации next/image. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className={styles.thumbImg}
            />
          ) : (
            <GlyphIcon value="box" size={22} />
          )}
        </span>

        <div className={styles.cardMain}>
          <h3 className={styles.name}>{product.name}</h3>
          <div className={styles.skuRow}>
            {product.sku && <span className={styles.sku}>{product.sku}</span>}
            <span
              className={`${styles.stock}${inStock ? ` ${styles.stockIn}` : ` ${styles.stockOut}`}`}
            >
              {cuttable
                ? formatCutStock(product.stockQty, product.cutMetersPerRoll)
                : `${product.stockQty.toLocaleString("ru-RU")} шт.`}
            </span>
          </div>
        </div>

        <div className={styles.priceCol}>
          <span className={styles.price}>
            {product.madeToOrder
              ? `Под заказ${product.madeToOrderMinQty ? ` · ${product.madeToOrderMinQty}+` : ""}`
              : product.price != null
                ? `${product.price.toLocaleString("ru-RU")} ₽`
                : "по запросу"}
          </span>
          {product.priceWholesale != null && (
            <span className={styles.priceOpt}>
              опт {product.priceWholesale.toLocaleString("ru-RU")} ₽
            </span>
          )}
        </div>
      </div>

      <div className={styles.badges}>
        {inStock ? (
          <span className={styles.badgeGreen}>В наличии</span>
        ) : (
          <span className={styles.badgeRed}>Нет</span>
        )}
        {product.isPromo && (
          <span
            className={styles.badgeAmber}
            style={{
              backgroundColor: normalizeProductLabelColor(product.promoLabelColor) || undefined,
              color: normalizeProductLabelColor(product.promoLabelTextColor) || undefined,
            }}
          >
            {product.promoLabel || "Акция"}
          </span>
        )}
        {product.isFeatured && (
          <span className={styles.badgeBlue}>
            Популярный{product.featuredOrder ? ` · #${product.featuredOrder}` : ""}
          </span>
        )}
        {product.isSale && <span className={styles.badgeRed}>Распродажа</span>}
        {!product.isVisible && (
          <span className={styles.badgeMuted}>Скрыт</span>
        )}
        {typeof product.viewCount === "number" && product.viewCount > 0 && (
          <span className={styles.views}>
            <Eye size={11} /> {product.viewCount.toLocaleString("ru-RU")}
          </span>
        )}
      </div>

      <div className={styles.actions}>
        <Link
          href={`/${adminPath}/products/${product.id}`}
          prefetch={false}
          className={styles.action}
        >
          <Edit2 size={16} />
          <span>Изменить</span>
        </Link>
        <Link
          href={`/${adminPath}/scan/${(product as any).qrSlug || (product as any).barcode || product.id}`}
          prefetch={false}
          className={styles.action}
        >
          <QrCode size={16} />
          <span>QR / код</span>
        </Link>
        <Link
          href={`/catalog/product/${product.slug}`}
          prefetch={false}
          target="_blank"
          className={styles.action}
        >
          {product.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
          <span>На сайте</span>
        </Link>
      </div>
    </article>
  );
}

/* ── Лист фильтров ── */

function FilterSheet({
  categories,
  category,
  onCategory,
  stock,
  onStock,
  visibility,
  onVisibility,
  onClose,
  activeCount,
}: {
  categories: { id: string; name: string }[];
  category: string;
  onCategory: (value: string) => void;
  stock: StockFilter;
  onStock: (value: StockFilter) => void;
  visibility: VisibilityFilter;
  onVisibility: (value: VisibilityFilter) => void;
  onClose: () => void;
  activeCount: number;
}) {
  return (
    <div className={styles.sheetRoot} role="dialog" aria-modal="true" aria-label="Фильтры товаров">
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label="Закрыть фильтры"
      />
      <div className={styles.sheet}>
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>Фильтры</span>
          <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <FilterGroup label="Категория">
          <FilterOption
            active={category === "all"}
            onClick={() => onCategory("all")}
          >
            Все категории
          </FilterOption>
          {categories.map((c) => (
            <FilterOption
              key={c.id}
              active={category === c.id}
              onClick={() => onCategory(c.id)}
            >
              {c.name}
            </FilterOption>
          ))}
        </FilterGroup>

        <FilterGroup label="Наличие">
          <FilterOption active={stock === "all"} onClick={() => onStock("all")}>
            Любое
          </FilterOption>
          <FilterOption active={stock === "in"} onClick={() => onStock("in")}>
            В наличии
          </FilterOption>
          <FilterOption active={stock === "out"} onClick={() => onStock("out")}>
            Нет в наличии
          </FilterOption>
        </FilterGroup>

        <FilterGroup label="Видимость">
          <FilterOption
            active={visibility === "all"}
            onClick={() => onVisibility("all")}
          >
            Любая
          </FilterOption>
          <FilterOption
            active={visibility === "visible"}
            onClick={() => onVisibility("visible")}
          >
            Видимые
          </FilterOption>
          <FilterOption
            active={visibility === "hidden"}
            onClick={() => onVisibility("hidden")}
          >
            Скрытые
          </FilterOption>
        </FilterGroup>

        <button type="button" className={styles.sheetApply} onClick={onClose}>
          {activeCount > 0 ? `Показать (${activeCount} фильтр(ов))` : "Готово"}
        </button>
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.filterGroup}>
      <div className={styles.filterLabel}>{label}</div>
      <div className={styles.filterOptions}>{children}</div>
    </div>
  );
}

function FilterOption({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${styles.filterOption}${active ? ` ${styles.filterOptionActive}` : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
      {active && <ChevronDown className={styles.filterCheck} size={14} aria-hidden="true" />}
    </button>
  );
}
