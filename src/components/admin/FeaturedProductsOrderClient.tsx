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

const FEATURED_ORDER_SETTING_KEY = "featured_products_order";

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
  onPointerDown,
  registerRef,
}: {
  product: FeaturedProduct;
  index: number;
  dragging: boolean;
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
      <div className="featured-sort__order">
        <GripVertical size={15} /> #{index + 1}
      </div>
      {!product.isVisible && (
        <div className="featured-sort__hidden">
          <EyeOff size={13} /> Скрыт на сайте
        </div>
      )}
      <div className="featured-sort__card-mask">
        <ProductCardCompact product={product} highlight={index === 0} />
      </div>
    </div>
  );
}

function DragCardOverlay({
  product,
  index,
}: {
  product: FeaturedProduct;
  index: number;
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
        <ProductCardCompact product={product} highlight={index === 0} />
      </div>
    </div>
  );
}

export function FeaturedProductsOrderClient({
  adminPath,
  initialProducts,
}: {
  adminPath: string;
  initialProducts: FeaturedProduct[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPointer, setDragPointer] = useState({ x: 0, y: 0 });
  const [dragBox, setDragBox] = useState({ width: 0, height: 0, offsetX: 0, offsetY: 0 });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const itemRefs = useRef(new Map<string, HTMLDivElement | null>());
  const productsRef = useRef(products);
  const initialOrderRef = useRef<string[]>([]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const activeProduct = useMemo(
    () => products.find((item) => item.id === draggingId) || null,
    [products, draggingId]
  );

  function registerRef(id: string, node: HTMLDivElement | null) {
    itemRefs.current.set(id, node);
  }

  async function persistOrder(nextProducts: FeaturedProduct[]) {
    setSaveState("saving");
    setError("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [FEATURED_ORDER_SETTING_KEY]: JSON.stringify(nextProducts.map((item) => item.id)),
        }),
      });
      if (!res.ok) {
        throw new Error("Не удалось сохранить порядок популярных товаров");
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

  function reorderByHover(activeId: string, clientX: number, clientY: number) {
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
  }

  const finishDrag = useCallback(() => {
    const currentOrder = productsRef.current.map((item) => item.id);
    const changed =
      currentOrder.length !== initialOrderRef.current.length ||
      currentOrder.some((id, index) => id !== initialOrderRef.current[index]);

    setDraggingId(null);
    document.body.style.userSelect = "";

    if (changed) {
      void persistOrder(productsRef.current);
    }
  }, []);

  useEffect(() => {
    if (!draggingId) return;

    const handleMove = (event: PointerEvent) => {
      setDragPointer({ x: event.clientX, y: event.clientY });
      reorderByHover(draggingId, event.clientX, event.clientY);
    };

    const handleUp = () => {
      finishDrag();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [draggingId, finishDrag]);

  function handlePointerDown(id: string, e: React.PointerEvent<HTMLDivElement>) {
    if (products.length < 2) return;
    if (e.button !== 0 && e.pointerType !== "touch") return;

    const node = itemRefs.current.get(id);
    if (!node) return;

    const rect = node.getBoundingClientRect();
    initialOrderRef.current = productsRef.current.map((item) => item.id);
    setDraggingId(id);
    setDragPointer({ x: e.clientX, y: e.clientY });
    setDragBox({
      width: rect.width,
      height: rect.height,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    });
    document.body.style.userSelect = "none";
  }

  return (
    <div className="featured-sort-page">
      <div className="featured-sort-page__head no-print">
        <div>
          <Link href={`/${adminPath}/products`} className="featured-sort-page__back">
            <ArrowLeft size={14} /> К товарам
          </Link>
          <h1 className="featured-sort-page__title">Порядок популярных товаров</h1>
          <p className="featured-sort-page__sub">
            Это копия товарной секции главной страницы. Перетаскивайте карточки как иконки на iPhone —
            порядок меняется сразу и сохраняется автоматически.
          </p>
        </div>
        <div className="featured-sort-page__meta">
          <div className="featured-sort-page__count">
            Популярных товаров: <strong>{products.length}</strong>
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
                <p>Зажмите карточку и перетащите её в нужное место.</p>
                <p>Позиция <strong>#1</strong> будет первой в блоке «Популярные товары» на главной.</p>
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
                  Популярные товары
                  <span className="catalog-top__count" style={{ marginLeft: 8 }}>
                    {products.length}
                  </span>
                </h2>
              </div>

              {products.length === 0 ? (
                <div className="empty-state">
                  <p>Нет товаров, отмеченных как популярные.</p>
                  <span>Отметьте товары флагом «Популярный товар» в карточке товара.</span>
                </div>
              ) : (
                <div className="products-grid-4 featured-sort-grid">
                  {products.map((product, index) => (
                    <FeaturedCard
                      key={product.id}
                      product={product}
                      index={index}
                      dragging={draggingId === product.id}
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
          />
        </div>
      )}
    </div>
  );
}
