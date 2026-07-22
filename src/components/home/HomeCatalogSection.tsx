// =========================================================
// FILE: src/components/home/HomeCatalogSection.tsx
// =========================================================

"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { InstantSearchInput } from "@/components/catalog/InstantSearchInput";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
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

interface HomeCatalogSectionProps {
  categories: CategoryItem[];
  initialProducts: CatalogProduct[];
}

export function HomeCatalogSection({
  categories,
  initialProducts,
}: HomeCatalogSectionProps) {
  const [products, setProducts] = useState<CatalogProduct[]>(initialProducts);
  const [q, setQ] = useState("");
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadProducts = useCallback(
    async (opts: { q: string; categorySlug: string | null }) => {
      const reqId = ++requestIdRef.current;
      setLoading(true);
      try {
        const params = new URLSearchParams();

        if (opts.q.trim()) {
          params.set("q", opts.q.trim());
          params.set("limit", "12");
        } else if (opts.categorySlug) {
          params.set("category", opts.categorySlug);
          params.set("limit", "12");
        } else {
          params.set("featured", "1");
          params.set("limit", "12");
        }

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

  function handleSearch(value: string) {
    setQ(value);
    loadProducts({ q: value, categorySlug: activeSlug });
  }

  function handleCategory(slug: string | null) {
    const next = activeSlug === slug ? null : slug;
    setActiveSlug(next);
    setQ("");
    loadProducts({ q: "", categorySlug: next });
  }

  const title = q.trim()
    ? `Результаты по «${q.trim()}»`
    : activeSlug
      ? categories.find((c) => c.slug === activeSlug)?.name || "Товары"
      : "Популярные товары";

  return (
    <section className="catalog-section">
      <div className="container">
        <div className="home-catalog-unified">
          {/* Левая колонка: поиск + категории */}
          <aside className="home-catalog-unified__side">
            <div className="home-catalog-unified__search-block">
              <div className="home-catalog-unified__label">Поиск</div>
              <InstantSearchInput
                value={q}
                onChange={handleSearch}
                loading={loading}
                placeholder="Размер, марка, артикул..."
                className="sidebar-search-form"
                inputClassName="catalog-search-input"
                buttonClassName="catalog-search-btn"
              />
              <div className="home-catalog-unified__chips">
                {["400×300×250", "Скотч 48мм", "Стрейч-плёнка", "Т-23"].map(
                  (hint) => (
                    <button
                      key={hint}
                      type="button"
                      className="search-chip"
                      onClick={() => handleSearch(hint)}
                    >
                      {hint}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="home-catalog-unified__label">Категории</div>

            {/* ↓ новая строка */}
            <MobileCategorySelect
              categories={categories}
              activeSlug={activeSlug}
              onSelect={handleCategory}
            />

            <div className="home-catalog-unified__cats">
              <button
                type="button"
                onClick={() => handleCategory(null)}
                className={`fcat-item${!activeSlug ? " fcat-item--active" : ""}`}
              >
                <span className="fcat-item__icon"><GlyphIcon value="star" size={16} /></span>
                <span className="fcat-item__name">Популярные</span>
              </button>

              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategory(cat.slug)}
                  className={`fcat-item${activeSlug === cat.slug ? " fcat-item--active" : ""}`}
                >
                  <span className="fcat-item__icon"><GlyphIcon value={cat.icon} size={16} /></span>
                  <span className="fcat-item__name">{cat.name}</span>
                </button>
              ))}
            </div>

            <Link href="/catalog" className="text-link home-catalog-unified__all-link">
              Весь каталог <ArrowRight size={13} />
            </Link>
          </aside>

          {/* Правая колонка: товары */}
          <div className="home-catalog-unified__main">
            <div className="catalog-top home-catalog-unified__top">
              <h2 className="section-title" style={{ margin: 0 }}>
                {title}
                <span className="catalog-top__count" style={{ marginLeft: 8 }}>
                  {loading ? "…" : `${products.length}`}
                </span>
              </h2>
              {activeSlug && (
                <Link
                  href={`/catalog/${activeSlug}`}
                  className="text-link"
                  style={{ fontSize: 13 }}
                >
                  Открыть категорию <ArrowRight size={13} />
                </Link>
              )}
            </div>

            {products.length > 0 ? (
              <div
                className={`products-grid-4${loading ? " products-grid-4--loading" : ""}`}
              >
                {products.map((p, idx) => (
                  <ProductCardCompact key={p.id} product={p} highlight={idx === 0} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span>{loading
                  ? <Loader2 size={32} className="animate-spin" />
                  : <GlyphIcon value="box" size={32} />}</span>
                <p>
                  {loading
                    ? "Загружаем товары..."
                    : q
                      ? `По запросу «${q}» ничего не найдено`
                      : "Отметьте товары как «популярные» в админ-панели"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}