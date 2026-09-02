// =========================================================
// FILE: src/components/home/HomeShowcase.tsx
// Витрина главной: плитки разделов вместо блока «Популярные
// товары». Клик по плитке МГНОВЕННО открывает привычное окно
// каталога (поиск + фильтр + сетка товаров) — без перехода и
// перезагрузки: товары каждой плитки приходят с сервера вместе
// со страницей, переключение работает как вкладки.
//
// Набор плиток, их порядок, картинки и правила отбора товаров
// настраиваются в админке: «Товары и категории → Плитки на главной».
// =========================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowLeft, Loader2, LayoutGrid, Ruler } from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { InstantSearchInput } from "@/components/catalog/InstantSearchInput";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { CatalogOrderNote } from "@/components/catalog/CatalogOrderNote";
import { BoxSizeFinder, type BoxFinderProduct } from "@/components/catalog/BoxSizeFinder";

export interface ShowcaseProduct {
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
  promoLabelColor?: string | null;
  promoLabelTextColor?: string | null;
  madeToOrder?: boolean | null;
  stockQty?: number | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  material?: string | null;
}

export interface ShowcaseTile {
  id: string;
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  icon?: string | null;
  accent?: string | null;
  /** Ссылка «открыть в каталоге» (для SEO и правого клика). */
  href: string;
  /** Query-строка для /api/products — используется только при поиске. */
  apiQuery: string;
  /** Сколько всего товаров попадает в плитку. */
  count: number;
  /** Предзагруженные товары плитки (мгновенное переключение). */
  products: ShowcaseProduct[];
}

const SEARCH_HINTS = ["400×300×250", "Скотч 48мм", "Стрейч-плёнка", "Т-23"];

/** Служебная «плитка» подбора коробки по размерам. Открывается тем же
 *  мгновенным переключением, что и разделы, но вместо сетки товаров
 *  показывает форму подбора. Отдельная страница: /podbor-korobki. */
const FINDER_TILE_ID = "__box-finder__";

export function HomeShowcase({
  tiles,
  finderProducts,
}: {
  tiles: ShowcaseTile[];
  /** Товары с размерами для плитки «Подбор коробки» (мм). */
  finderProducts?: BoxFinderProduct[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [searchResults, setSearchResults] = useState<ShowcaseProduct[] | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollRef = useRef(false);

  const showFinder = (finderProducts?.length ?? 0) > 0;

  // Плитка подбора всегда последней — после разделов каталога.
  const finderTile: ShowcaseTile | null = useMemo(
    () =>
      showFinder
        ? {
            id: FINDER_TILE_ID,
            title: "Подбор коробки по размерам",
            subtitle: "Укажите Д×Ш×В — покажем ближайшие коробки, цену и наличие",
            imageUrl: null,
            icon: null,
            accent: null,
            href: "/podbor-korobki",
            apiQuery: "",
            count: finderProducts!.length,
            products: [],
          }
        : null,
    [showFinder, finderProducts]
  );

  const allTiles = useMemo(
    () => (finderTile ? [...tiles, finderTile] : tiles),
    [tiles, finderTile]
  );

  const active = useMemo(
    () => allTiles.find((t) => t.id === activeId) || null,
    [allTiles, activeId]
  );

  const finderActive = active?.id === FINDER_TILE_ID;

  // Плавно подводим к панели только после клика по плитке
  // (при переключении вкладок внутри панели не дёргаем скролл).
  useEffect(() => {
    if (!active || !shouldScrollRef.current) return;
    shouldScrollRef.current = false;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [active]);

  const runSearch = useCallback(
    async (value: string, tile: ShowcaseTile | null) => {
      const reqId = ++requestIdRef.current;
      const term = value.trim();
      if (!term) {
        setSearchResults(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams(tile?.apiQuery || "");
        params.set("q", term);
        params.set("limit", "24");
        const res = await fetch(`/api/products?${params.toString()}`);
        const data = await res.json();
        if (reqId !== requestIdRef.current) return;
        setSearchResults(Array.isArray(data.products) ? data.products : []);
      } catch (e) {
        console.error(e);
        if (reqId !== requestIdRef.current) return;
        setSearchResults([]);
      } finally {
        if (reqId === requestIdRef.current) setLoading(false);
      }
    },
    []
  );

  function openTile(id: string) {
    if (id === activeId) return;
    requestIdRef.current++;
    shouldScrollRef.current = activeId === null;
    setActiveId(id);
    setQ("");
    setSearchResults(null);
    setLoading(false);
  }

  function closePanel() {
    requestIdRef.current++;
    setActiveId(null);
    setQ("");
    setSearchResults(null);
    setLoading(false);
  }

  function handleSearch(value: string) {
    setQ(value);
    runSearch(value, active);
  }

  const products = searchResults ?? active?.products ?? [];
  const heading = q.trim()
    ? `Результаты по «${q.trim()}»`
    : active?.title || "Разделы каталога";
  const countLabel = q.trim()
    ? products.length
    : (active?.count ?? 0);

  return (
    <section className="showcase-section" id="showcase">
      <div className="container">
        <div className="showcase-head">
          <div>
            <span className="showcase-head__eyebrow">Каталог</span>
            <h2 className="section-title" style={{ margin: 0 }}>
              {active ? active.title : "Выберите раздел"}
            </h2>
          </div>
          <Link href="/catalog" className="deals-head__all">
            Весь каталог <ArrowRight size={13} />
          </Link>
        </div>

        {/* ── Плитки разделов ── */}
        {!active && (
          <div className="showcase-tiles">
            {allTiles.map((tile) =>
              tile.id === FINDER_TILE_ID ? (
                <button
                  key={tile.id}
                  type="button"
                  className="showcase-tile showcase-tile--finder"
                  onClick={() => openTile(tile.id)}
                >
                  <span className="showcase-tile__media">
                    <span className="showcase-tile__glyph">
                      <Ruler size={38} />
                    </span>
                  </span>
                  <span className="showcase-tile__body">
                    <span className="showcase-tile__title">{tile.title}</span>
                    {tile.subtitle && (
                      <span className="showcase-tile__sub">{tile.subtitle}</span>
                    )}
                    <span className="showcase-tile__count">
                      Подобрать коробку <ArrowRight size={12} />
                    </span>
                  </span>
                </button>
              ) : (
                <button
                  key={tile.id}
                  type="button"
                  className="showcase-tile"
                  onClick={() => openTile(tile.id)}
                  style={
                    tile.accent
                      ? ({ "--tile-accent": tile.accent } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span className="showcase-tile__media">
                    {tile.imageUrl ? (
                      <Image
                        src={tile.imageUrl}
                        alt={tile.title}
                        fill
                        sizes="(max-width: 768px) 50vw, 260px"
                        style={{ objectFit: "cover" }}
                      />
                    ) : (
                      <span className="showcase-tile__glyph">
                        <GlyphIcon value={tile.icon || "box"} size={38} />
                      </span>
                    )}
                  </span>
                  <span className="showcase-tile__body">
                    <span className="showcase-tile__title">{tile.title}</span>
                    {tile.subtitle && (
                      <span className="showcase-tile__sub">{tile.subtitle}</span>
                    )}
                    <span className="showcase-tile__count">
                      {tile.count} товаров <ArrowRight size={12} />
                    </span>
                  </span>
                </button>
              )
            )}
            {allTiles.length === 0 && (
              <div className="empty-state">
                <span>
                  <LayoutGrid size={32} />
                </span>
                <p>Плитки ещё не настроены — добавьте их в админ-панели</p>
              </div>
            )}
          </div>
        )}

        {/* ── Окно каталога выбранного раздела ── */}
        {active && (
          <div className="home-catalog-unified showcase-panel" ref={panelRef}>
            <aside className="home-catalog-unified__side">
              <button
                type="button"
                className="showcase-back"
                onClick={closePanel}
              >
                <ArrowLeft size={14} /> Все разделы
              </button>

              {!finderActive && (
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
                    {SEARCH_HINTS.map((hint) => (
                      <button
                        key={hint}
                        type="button"
                        className="search-chip"
                        onClick={() => handleSearch(hint)}
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="home-catalog-unified__label">Разделы</div>

              {/* Мобильный выбор раздела — тот же мгновенный переход */}
              <div className="mcs-wrap">
                <div className="mcs-select-box">
                  <select
                    className="mcs-select"
                    value={active.id}
                    onChange={(e) => openTile(e.target.value)}
                    aria-label="Выбор раздела"
                  >
                    {allTiles.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id === FINDER_TILE_ID ? t.title : `${t.title} (${t.count})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="home-catalog-unified__cats">
                {allTiles.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => openTile(tile.id)}
                    className={`fcat-item${tile.id === active.id ? " fcat-item--active" : ""}`}
                  >
                    <span className="fcat-item__icon">
                      {tile.id === FINDER_TILE_ID ? (
                        <Ruler size={16} />
                      ) : (
                        <GlyphIcon value={tile.icon || "box"} size={16} />
                      )}
                    </span>
                    <span className="fcat-item__name">{tile.title}</span>
                    {tile.id !== FINDER_TILE_ID && (
                      <span className="fcat-item__count">{tile.count}</span>
                    )}
                  </button>
                ))}
              </div>

              <Link
                href="/catalog"
                className="text-link home-catalog-unified__all-link"
              >
                Весь каталог <ArrowRight size={13} />
              </Link>
            </aside>

            <div className="home-catalog-unified__main">
              {finderActive ? (
                <>
                  <div className="catalog-top home-catalog-unified__top">
                    <div className="catalog-heading-row">
                      <h3 className="section-title" style={{ margin: 0 }}>
                        Подбор коробки по размерам
                      </h3>
                    </div>
                    <Link href="/podbor-korobki" className="text-link" style={{ fontSize: 13 }}>
                      Открыть страницу подбора <ArrowRight size={13} />
                    </Link>
                  </div>
                  <BoxSizeFinder products={finderProducts || []} />
                </>
              ) : (
                <>
                  <div className="catalog-top home-catalog-unified__top">
                    <div className="catalog-heading-row">
                      <h3 className="section-title" style={{ margin: 0 }}>
                        {heading}
                        <span className="catalog-top__count" style={{ marginLeft: 8 }}>
                          {loading ? "…" : countLabel}
                        </span>
                      </h3>
                      <CatalogOrderNote />
                    </div>
                    <Link href={active.href} className="text-link" style={{ fontSize: 13 }}>
                      Открыть в каталоге <ArrowRight size={13} />
                    </Link>
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
                  <span>
                    {loading ? (
                      <Loader2 size={32} className="animate-spin" />
                    ) : (
                      <GlyphIcon value="box" size={32} />
                    )}
                  </span>
                  <p>
                    {loading
                      ? "Загружаем товары..."
                      : q
                        ? `По запросу «${q}» ничего не найдено`
                        : "В этом разделе пока нет товаров"}
                  </p>
                </div>
              )}

                  {!q.trim() && active.count > products.length && (
                    <div className="showcase-more">
                      <Link href={active.href} className="btn-hero-ghost">
                        Показать все {active.count} товаров <ArrowRight size={14} />
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
