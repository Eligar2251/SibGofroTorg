"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { InstantSearchInput } from "@/components/catalog/InstantSearchInput";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";

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
          // как на сервере: популярные
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
    // при выборе категории поиск оставляем — или сбрасываем; сбрасываем для ясности
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
        <div
          className="home-catalog-unified"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 280px) 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          {/* Левая колонка: поиск + категории */}
          <aside
            className="home-catalog-unified__side"
            style={{
              background: "var(--white, #fff)",
              border: "1px solid var(--border, #e8e6e1)",
              borderRadius: "var(--radius, 12px)",
              padding: 16,
              position: "sticky",
              top: 16,
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--ink-muted, #888)",
                  marginBottom: 8,
                }}
              >
                Поиск
              </div>
              <InstantSearchInput
                value={q}
                onChange={handleSearch}
                loading={loading}
                placeholder="Размер, марка, артикул..."
                className="sidebar-search-form"
                inputClassName="catalog-search-input"
                buttonClassName="catalog-search-btn"
              />
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 10,
                }}
              >
                {["400×300×250", "Скотч 48мм", "Стрейч-плёнка", "Т-23"].map(
                  (hint) => (
                    <button
                      key={hint}
                      type="button"
                      className="search-chip"
                      onClick={() => handleSearch(hint)}
                      style={{ cursor: "pointer", border: "none" }}
                    >
                      {hint}
                    </button>
                  )
                )}
              </div>
            </div>

            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--ink-muted, #888)",
                marginBottom: 8,
              }}
            >
              Категории
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
                <span className="fcat-item__icon">⭐</span>
                <span className="fcat-item__name">Популярные</span>
              </button>

              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategory(cat.slug)}
                  className={`fcat-item${activeSlug === cat.slug ? " fcat-item--active" : ""}`}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span className="fcat-item__icon">{cat.icon || "📦"}</span>
                  <span className="fcat-item__name">{cat.name}</span>
                </button>
              ))}
            </div>

            <Link
              href="/catalog"
              className="text-link"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 14,
                fontSize: 13,
              }}
            >
              Весь каталог <ArrowRight size={13} />
            </Link>
          </aside>

          {/* Правая колонка: товары */}
          <div className="home-catalog-unified__main">
            <div
              className="catalog-top"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
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
                className="products-grid-4"
                style={{
                  opacity: loading ? 0.55 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {products.map((p) => (
                  <ProductCardCompact key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span>{loading ? "⏳" : "📦"}</span>
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

        {/* Адаптив: одна колонка на мобиле */}
        <style>{`
          @media (max-width: 900px) {
            .home-catalog-unified {
              grid-template-columns: 1fr !important;
            }
            .home-catalog-unified__side {
              position: static !important;
            }
          }
        `}</style>
      </div>
    </section>
  );
}