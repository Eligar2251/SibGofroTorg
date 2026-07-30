"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { InstantSearchInput } from "@/components/catalog/InstantSearchInput";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { CatalogOrderNote } from "@/components/catalog/CatalogOrderNote";
import { MobileCategorySelect } from "@/components/catalog/MobileCategorySelect";

interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
}

interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
  sku?: string | null;
  price: number | null;
  priceWholesale?: number | null;
  minWholesaleQty?: number | null;
  packQty?: number | null;
  imageUrl?: string | null;
  inStock?: boolean;
  promoLabel?: string | null;
  madeToOrder?: boolean | null;
  stockQty?: number | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  material?: string | null;
}

interface CatalogShopClientProps {
  categories: CategoryItem[];
  initialProducts: CatalogProduct[];
  mode?: "all" | "category";
  initialCategorySlug?: string | null;
  initialCategoryName?: string;
  initialSort?: string;
  initialQ?: string;
  initialStock?: string;
}

const SORTS = [
  { v: "default", label: "По умолчанию" },
  { v: "price_asc", label: "Сначала дешёвые" },
  { v: "price_desc", label: "Сначала дорогие" },
  { v: "newest", label: "Новинки" },
];

function syncUrl(
  mode: "all" | "category",
  slug: string | null,
  q: string,
  sort: string,
  stock: string
) {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (sort && sort !== "default") params.set("sort", sort);
  if (stock) params.set("stock", stock);
  const qs = params.toString();
  const base =
    mode === "category" && slug ? `/catalog/${slug}` : "/catalog";
  window.history.replaceState(null, "", `${base}${qs ? `?${qs}` : ""}`);
}

export function CatalogShopClient({
  categories,
  initialProducts,
  mode = "all",
  initialCategorySlug = null,
  initialCategoryName = "Каталог",
  initialSort = "default",
  initialQ = "",
  initialStock = "",
}: CatalogShopClientProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(
    initialCategorySlug
  );
  const [activeName, setActiveName] = useState(initialCategoryName);
  const [products, setProducts] = useState(initialProducts);
  const [q, setQ] = useState(initialQ);
  const [sort, setSort] = useState(initialSort || "default");
  const [stock, setStock] = useState(initialStock);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadProducts = useCallback(
    async (opts: {
      slug: string | null;
      q: string;
      sort: string;
      stock: string;
    }) => {
      const reqId = ++requestIdRef.current;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (opts.slug) params.set("category", opts.slug);
        if (opts.q.trim()) params.set("q", opts.q.trim());
        if (opts.sort && opts.sort !== "default")
          params.set("sort", opts.sort);
        if (opts.stock) params.set("stock", opts.stock);
        if (!opts.slug && !opts.q.trim()) params.set("limit", "48");

        const res = await fetch(`/api/products?${params.toString()}`);
        const data = await res.json();
        if (reqId !== requestIdRef.current) return;
        setProducts(Array.isArray(data.products) ? data.products : []);
      } catch (e) {
        console.error(e);
        if (reqId !== requestIdRef.current) return;
        setProducts([]);
      } finally {
        if (reqId === requestIdRef.current) setLoading(false);
      }
    },
    []
  );

  function apply(next: {
    slug: string | null;
    name?: string;
    q: string;
    sort: string;
    stock: string;
  }) {
    if (next.name) setActiveName(next.name);
    setActiveSlug(next.slug);
    setQ(next.q);
    setSort(next.sort);
    setStock(next.stock);
    syncUrl(
      next.slug ? "category" : "all",
      next.slug,
      next.q,
      next.sort,
      next.stock
    );
    loadProducts(next);
  }

  function handleCategory(cat: CategoryItem | null) {
    if (!cat) {
      apply({ slug: null, name: "Каталог", q: "", sort, stock });
      return;
    }
    if (cat.slug === activeSlug) return;
    apply({ slug: cat.slug, name: cat.name, q: "", sort, stock });
  }

  function handleSearch(value: string) {
    apply({ slug: activeSlug, q: value, sort, stock });
  }

  function handleSort(value: string) {
    apply({ slug: activeSlug, q, sort: value, stock });
  }

  function handleStockToggle() {
    apply({
      slug: activeSlug,
      q,
      sort,
      stock: stock === "yes" ? "" : "yes",
    });
  }

  function handleReset() {
    apply({
      slug: activeSlug,
      q: "",
      sort: "default",
      stock: "",
    });
  }

  const hasFilters = Boolean(q || (sort && sort !== "default") || stock);
  const title = activeSlug ? activeName : q ? `Поиск: «${q}»` : "Все товары";

  return (
    <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: 64 }}>
      <div className="breadcrumb-bar">
        <div className="container-wide breadcrumbs">
          <Link href="/">Главная</Link>
          <span>/</span>
          {activeSlug ? (
            <>
              <Link href="/catalog">Каталог</Link>
              <span>/</span>
              <span>{activeName}</span>
            </>
          ) : (
            <span>Каталог товаров</span>
          )}
        </div>
      </div>

      <div className="container-wide" style={{ paddingBlock: 24 }}>
        <div className="catalog-layout">
          <aside className="sidebar">
            <div className="filter-block">
              <div className="filter-block__title">Поиск</div>
              <div className="filter-block__body">
                <InstantSearchInput
                  value={q}
                  onChange={handleSearch}
                  loading={loading}
                  placeholder="Размер, артикул, название..."
                  className="sidebar-search-form"
                  inputClassName="catalog-search-input"
                  buttonClassName="catalog-search-btn"
                />
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-block__title">Категории</div>

              {/* ↓ новая строка — мобильный select, на десктопе скрыт через CSS */}
              <MobileCategorySelect
                categories={categories}
                activeSlug={activeSlug}
                onSelect={(slug) =>
                  handleCategory(slug ? categories.find((c) => c.slug === slug) ?? null : null)
                }
              />

              <div className="filter-block__body filter-block__body--cats">
                <button
                  type="button"
                  onClick={() => handleCategory(null)}
                  className={`fcat-item${!activeSlug ? " fcat-item--active" : ""}`}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span className="fcat-item__icon"><GlyphIcon value="box" size={16} /></span>
                  <span className="fcat-item__name">Все товары</span>
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleCategory(c)}
                    className={`fcat-item${
                      c.slug === activeSlug ? " fcat-item--active" : ""
                    }`}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <span className="fcat-item__icon">
                      <GlyphIcon value={c.icon} size={16} />
                    </span>
                    <span className="fcat-item__name">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-block__title">Наличие</div>
              <div className="filter-block__body">
                <button
                  type="button"
                  onClick={handleStockToggle}
                  className={`fcheck__inner${
                    stock === "yes" ? " fcheck__inner--on" : ""
                  }`}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span className="fcheck__box">
                    {stock === "yes" ? <GlyphIcon value="check" size={12} /> : null}
                  </span>
                  Только в наличии
                </button>
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-block__title">Сортировка</div>
              <div className="filter-block__body">
                <div className="fsort">
                  {SORTS.map((s) => (
                    <button
                      key={s.v}
                      type="button"
                      onClick={() => handleSort(s.v)}
                      className={`fsort__item${
                        sort === s.v ? " fsort__item--active" : ""
                      }`}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <span className="fsort__radio" />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {hasFilters && (
              <button
                type="button"
                onClick={handleReset}
                className="filter-reset"
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                <X size={13} style={{ marginRight: 4 }} />Сбросить фильтры
              </button>
            )}
          </aside>

          <div>
            <div className="catalog-toolbar2">
              <div className="catalog-toolbar2__heading">
                <div className="catalog-heading-row catalog-heading-row--page">
                  <h1 className="catalog-title">{title}</h1>
                  <CatalogOrderNote />
                </div>
                <p className="catalog-count">
                  {loading ? "Загрузка..." : `${products.length} товаров`}
                  {q ? <span> по запросу «{q}»</span> : null}
                </p>
              </div>
              <div className="catalog-sort-links">
                {SORTS.map((s) => (
                  <button
                    key={s.v}
                    type="button"
                    onClick={() => handleSort(s.v)}
                    className={`catalog-sort-link${
                      sort === s.v ? " catalog-sort-link--active" : ""
                    }`}
                    style={{
                      border: "none",
                      cursor: "pointer",
                      background:
                        sort === s.v ? undefined : "transparent",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {products.length > 0 ? (
              <div
                className="product-grid-compact"
                style={{
                  opacity: loading ? 0.55 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {products.map((p, idx) => (
                  <ProductCardCompact key={p.id} product={p} highlight={idx === 0} />
                ))}
              </div>
            ) : (
              <div
                className="card-base"
                style={{ textAlign: "center", padding: "64px 24px" }}
              >
                <div style={{ marginBottom: 12, color: "var(--ink-muted)" }}><GlyphIcon value="box" size={44} /></div>
                <h3
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "var(--ink)",
                    marginBottom: 6,
                  }}
                >
                  {q
                    ? `По запросу «${q}» ничего не найдено`
                    : "Товаров пока нет"}
                </h3>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 12, cursor: "pointer" }}
                  >
                    Сбросить фильтры
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}