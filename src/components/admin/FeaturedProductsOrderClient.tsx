"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  EyeOff,
  GripVertical,
  Loader2,
  Save,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { ORDER_PRODUCTS_ORDER_SETTING_KEY } from "@/lib/home-product-order";

const FEATURED_ORDER_SETTING_KEY = "featured_products_order";
type OrderTab = "featured" | "order";

type FeaturedProduct = {
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
  hasVariants?: boolean;
  variantCount?: number;
  variantPriceMin?: number | null;
  variantPriceMax?: number | null;
  variantTotalStock?: number;
  isVisible?: boolean;
};

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function FeaturedCard({
  product,
  index,
  dragging,
  orderMode,
  onPointerDown,
  registerRef,
}: {
  product: FeaturedProduct;
  index: number;
  dragging: boolean;
  orderMode: boolean;
  onPointerDown: (id: string, e: React.PointerEvent<HTMLDivElement>) => void;
  registerRef: (id: string, node: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={(node) => registerRef(product.id, node)}
      data-featured-id={product.id}
      className={`featured-sort__item${dragging ? " featured-sort__item--placeholder" : ""}`}
      onPointerDown={(e) => onPointerDown(product.id, e)}
    >
      {/* Ручка перетаскивания: на телефоне тянуть ТОЛЬКО за неё,
          иначе каждый скролл по странице срывал карточки в drag. */}
      <div className="featured-sort__order" title="Тяните, чтобы переместить">
        <GripVertical size={15} /> #{index + 1}
      </div>
      {!product.isVisible && (
        <div className="featured-sort__hidden">
          <EyeOff size={13} /> Скрыт на сайте
        </div>
      )}
      <div className="featured-sort__card-mask">
        <ProductCardCompact product={product} highlight={index === 0} orderMode={orderMode} />
      </div>
    </div>
  );
}

function DragCardOverlay({
  product,
  index,
  orderMode,
}: {
  product: FeaturedProduct;
  index: number;
  orderMode: boolean;
}) {
  return (
    <div className="featured-sort__item featured-sort__item--overlay">
      <div className="featured-sort__order">
        <GripVertical size={15} /> #{index + 1}
      </div>
      {!product.isVisible && (
        <div className="featured-sort__hidden">
          <EyeOff size={13} /> Скрыт на сайте
        </div>
      )}
      <div className="featured-sort__card-mask">
        <ProductCardCompact product={product} highlight={index === 0} orderMode={orderMode} />
      </div>
    </div>
  );
}

export function FeaturedProductsOrderClient({
  adminPath,
  initialFeaturedProducts,
  initialOrderProducts,
}: {
  adminPath: string;
  initialFeaturedProducts: FeaturedProduct[];
  initialOrderProducts: FeaturedProduct[];
}) {
  const [activeTab, setActiveTab] = useState<OrderTab>("featured");
  const [productsByTab, setProductsByTab] = useState<Record<OrderTab, FeaturedProduct[]>>({
    featured: initialFeaturedProducts,
    order: initialOrderProducts,
  });
  const products = productsByTab[activeTab];
  const setProducts = useCallback(
    (
      updater:
        | FeaturedProduct[]
        | ((current: FeaturedProduct[]) => FeaturedProduct[])
    ) => {
      setProductsByTab((current) => ({
        ...current,
        [activeTab]:
          typeof updater === "function"
            ? updater(current[activeTab])
            : updater,
      }));
    },
    [activeTab]
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPointer, setDragPointer] = useState({ x: 0, y: 0 });
  const [dragBox, setDragBox] = useState({ width: 0, height: 0, offsetX: 0, offsetY: 0 });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const itemRefs = useRef(new Map<string, HTMLDivElement | null>());
  const productsRef = useRef(products);
  const initialOrderRef = useRef<string[]>([]);
  // Зеркало draggingId для обработчиков (они висят глобально и не
  // пересоздаются при каждом рендере).
  const draggingIdRef = useRef<string | null>(null);
  // «Кандидат» в drag: палец/кнопка нажаты, но порог ещё не пройден.
  // Пока не пройден — это обычный клик/скролл, карточку не трогаем.
  const pendingDragRef = useRef<{
    id: string;
    downX: number;
    downY: number;
  } | null>(null);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    draggingIdRef.current = draggingId;
  }, [draggingId]);

  const activeProduct = useMemo(
    () => products.find((item) => item.id === draggingId) || null,
    [products, draggingId]
  );

  function registerRef(id: string, node: HTMLDivElement | null) {
    itemRefs.current.set(id, node);
  }

  async function persistOrder(nextProducts: FeaturedProduct[], tab: OrderTab) {
    setSaveState("saving");
    setError("");
    const settingKey =
      tab === "featured"
        ? FEATURED_ORDER_SETTING_KEY
        : ORDER_PRODUCTS_ORDER_SETTING_KEY;
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [settingKey]: JSON.stringify(nextProducts.map((item) => item.id)),
        }),
      });
      if (!res.ok) {
        throw new Error(
          tab === "featured"
            ? "Не удалось сохранить порядок популярных товаров"
            : "Не удалось сохранить порядок товаров под заказ"
        );
      }
      setSaveState("saved");
      window.setTimeout(() => {
        setSaveState((current) => (current === "saved" ? "idle" : current));
      }, 1600);
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Не удалось сохранить порядок");
    }
  }

  const reorderByHover = useCallback((activeId: string, clientX: number, clientY: number) => {
    const orderedIds = productsRef.current.map((item) => item.id);
    let overId: string | null = null;

    for (const id of orderedIds) {
      if (id === activeId) continue;
      const node = itemRefs.current.get(id);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        overId = id;
        break;
      }
    }

    if (!overId) return;

    setProducts((current) => {
      const oldIndex = current.findIndex((item) => item.id === activeId);
      const newIndex = current.findIndex((item) => item.id === overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return current;
      return moveItem(current, oldIndex, newIndex);
    });
  }, [setProducts]);

  const finishDrag = useCallback(() => {
    const currentOrder = productsRef.current.map((item) => item.id);
    const changed =
      currentOrder.length !== initialOrderRef.current.length ||
      currentOrder.some((id, index) => id !== initialOrderRef.current[index]);

    setDraggingId(null);
    document.body.style.userSelect = "";

    if (changed) {
      void persistOrder(productsRef.current, activeTab);
    }
  }, [activeTab]);

  // Старт фактического перетаскивания (когда порог движения пройден).
  const beginDrag = useCallback(
    (id: string, downX: number, downY: number, curX: number, curY: number) => {
      const node = itemRefs.current.get(id);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      initialOrderRef.current = productsRef.current.map((item) => item.id);
      setDraggingId(id);
      setDragPointer({ x: curX, y: curY });
      setDragBox({
        width: rect.width,
        height: rect.height,
        offsetX: downX - rect.left,
        offsetY: downY - rect.top,
      });
      document.body.style.userSelect = "none";
    },
    []
  );

  // Глобальные обработчики: фаза «кандидат» (ждём порога) и фаза drag.
  // Порог 8px отделяет перетаскивание от обычного клика/скролла —
  // раньше карточка уходила в drag от одного касания, и страницу
  // было невозможно листать (карточки «срывались» под палец).
  useEffect(() => {
    const DRAG_THRESHOLD = 8;

    const handleMove = (event: PointerEvent) => {
      const activeId = draggingIdRef.current;
      if (activeId) {
        setDragPointer({ x: event.clientX, y: event.clientY });
        reorderByHover(activeId, event.clientX, event.clientY);
        return;
      }
      const pending = pendingDragRef.current;
      if (!pending) return;
      const dx = event.clientX - pending.downX;
      const dy = event.clientY - pending.downY;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        pendingDragRef.current = null;
        beginDrag(pending.id, pending.downX, pending.downY, event.clientX, event.clientY);
      }
    };

    const handleUp = () => {
      pendingDragRef.current = null;
      if (draggingIdRef.current) {
        finishDrag();
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [beginDrag, finishDrag, reorderByHover]);

  function handlePointerDown(id: string, e: React.PointerEvent<HTMLDivElement>) {
    if (products.length < 2) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;

    // На тачах перетаскивание начинается ТОЛЬКО от ручки (значок ⠿
    // с номером в углу) — остальная площадь карточки отдаётся
    // обычному скроллу страницы. На десктопе мышью можно тянуть за
    // любую точку карточки, но drag стартует после порога 8px —
    // простые клики карточки больше не двигают.
    const onHandle =
      (e.target as HTMLElement).closest(".featured-sort__order") != null;
    if (e.pointerType !== "mouse" && !onHandle) return;

    pendingDragRef.current = { id, downX: e.clientX, downY: e.clientY };
  }

  function selectTab(tab: OrderTab) {
    if (tab === activeTab) return;
    pendingDragRef.current = null;
    setDraggingId(null);
    draggingIdRef.current = null;
    document.body.style.userSelect = "";
    setSaveState("idle");
    setError("");
    productsRef.current = productsByTab[tab];
    setActiveTab(tab);
  }

  const isFeaturedTab = activeTab === "featured";
  const blockTitle = isFeaturedTab ? "Популярные товары" : "Товары под заказ";
  const emptyText = isFeaturedTab
    ? "Нет товаров, отмеченных как популярные."
    : "Нет видимых товаров с нулевым остатком.";

  return (
    <div className="featured-sort-page">
      <div className="featured-sort-page__head no-print">
        <div>
          <Link href={`/${adminPath}/products`} className="featured-sort-page__back">
            <ArrowLeft size={14} /> К товарам
          </Link>
          <h1 className="featured-sort-page__title">Порядок товаров на главной</h1>
          <p className="featured-sort-page__sub">
            В одном блоке настраивается порядок двух секций главной страницы.
            Выберите вкладку и перетащите карточку за значок ⠿ с номером —
            порядок сохраняется автоматически.
          </p>
          <div className="featured-sort-tabs" role="tablist" aria-label="Секция товаров">
            <button
              type="button"
              role="tab"
              aria-selected={isFeaturedTab}
              className={isFeaturedTab ? "featured-sort-tab featured-sort-tab--active" : "featured-sort-tab"}
              onClick={() => selectTab("featured")}
            >
              Популярные <span>{productsByTab.featured.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isFeaturedTab}
              className={!isFeaturedTab ? "featured-sort-tab featured-sort-tab--active" : "featured-sort-tab"}
              onClick={() => selectTab("order")}
            >
              Под заказ <span>{productsByTab.order.length}</span>
            </button>
          </div>
        </div>
        <div className="featured-sort-page__meta">
          <div className="featured-sort-page__count">
            {blockTitle}: <strong>{products.length}</strong>
          </div>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="featured-sort-page__preview"
          >
            <ExternalLink size={14} /> Открыть сайт
          </a>
        </div>
      </div>

      <section className="catalog-section featured-sort-page__section">
        <div className="container">
          <div className="home-catalog-unified featured-sort-layout">
            <aside className="home-catalog-unified__side featured-sort-side no-print">
              <div className="home-catalog-unified__label">Как пользоваться</div>
              <div className="featured-sort-side__card">
                <p>Тяните карточку <strong>за значок ⠿ с номером</strong> в её левом верхнем углу
                (на компьютере мышью — за любое место карточки) и отпустите на новом месте.</p>
                <p>Позиция <strong>#1</strong> будет первой в блоке «{blockTitle}» на главной.</p>
                {!isFeaturedTab && (
                  <p>В этот список автоматически попадают видимые товары с нулевым остатком.</p>
                )}
                <p>Скролл страницы пальцем по карточкам работает как обычно — теперь он не
                переставляет карточки случайно.</p>
              </div>

              <div className="home-catalog-unified__label">Статус</div>
              <div className="featured-sort-side__status">
                {saveState === "saving" && (
                  <span className="featured-sort-side__status-badge featured-sort-side__status-badge--saving">
                    <Loader2 size={14} className="animate-spin" /> Сохраняем…
                  </span>
                )}
                {saveState === "saved" && (
                  <span className="featured-sort-side__status-badge featured-sort-side__status-badge--saved">
                    <CheckCircle2 size={14} /> Сохранено
                  </span>
                )}
                {saveState === "error" && (
                  <span className="featured-sort-side__status-badge featured-sort-side__status-badge--error">
                    <AlertCircle size={14} /> Ошибка сохранения
                  </span>
                )}
                {saveState === "idle" && (
                  <span className="featured-sort-side__status-badge">
                    <Save size={14} /> Автосохранение включено
                  </span>
                )}
              </div>

              {error && <div className="featured-sort-side__error">{error}</div>}
            </aside>

            <div className="home-catalog-unified__main">
              <div className="catalog-top home-catalog-unified__top">
                <h2 className="section-title" style={{ margin: 0 }}>
                  {blockTitle}
                  <span className="catalog-top__count" style={{ marginLeft: 8 }}>
                    {products.length}
                  </span>
                </h2>
              </div>

              {products.length === 0 ? (
                <div className="empty-state">
                  <p>{emptyText}</p>
                  <span>
                    {isFeaturedTab
                      ? "Отметьте товары флагом «Популярный товар» в карточке товара."
                      : "Секция появится автоматически, когда у видимого товара закончится остаток."}
                  </span>
                </div>
              ) : (
                <div className="featured-sort-grid">
                  {products.map((product, index) => (
                    <FeaturedCard
                      key={product.id}
                      product={product}
                      index={index}
                      dragging={draggingId === product.id}
                      orderMode={!isFeaturedTab}
                      onPointerDown={handlePointerDown}
                      registerRef={registerRef}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {activeProduct && (
        <div
          className="featured-sort-overlay"
          style={{
            width: dragBox.width,
            height: dragBox.height,
            left: dragPointer.x - dragBox.offsetX,
            top: dragPointer.y - dragBox.offsetY,
          }}
        >
          <DragCardOverlay
            product={activeProduct}
            index={products.findIndex((item) => item.id === activeProduct.id)}
            orderMode={!isFeaturedTab}
          />
        </div>
      )}
    </div>
  );
}
