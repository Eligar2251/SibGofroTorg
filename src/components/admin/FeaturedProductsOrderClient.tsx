"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

function SortableFeaturedCard({
  product,
  index,
}: {
  product: FeaturedProduct;
  index: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: product.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`featured-sort__item${isDragging ? " featured-sort__item--dragging" : ""}`}
      {...attributes}
      {...listeners}
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 140,
        tolerance: 8,
      },
    })
  );

  const activeProduct = useMemo(
    () => products.find((item) => item.id === activeId) || null,
    [products, activeId]
  );

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

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    setProducts((current) => {
      const oldIndex = current.findIndex((item) => item.id === String(active.id));
      const newIndex = current.findIndex((item) => item.id === String(over.id));
      if (oldIndex < 0 || newIndex < 0) return current;
      const next = arrayMove(current, oldIndex, newIndex);
      void persistOrder(next);
      return next;
    });
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
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={products.map((item) => item.id)}
                    strategy={rectSortingStrategy}
                  >
                    <div className="products-grid-4 featured-sort-grid">
                      {products.map((product, index) => (
                        <SortableFeaturedCard
                          key={product.id}
                          product={product}
                          index={index}
                        />
                      ))}
                    </div>
                  </SortableContext>

                  <DragOverlay>
                    {activeProduct ? (
                      <DragCardOverlay
                        product={activeProduct}
                        index={products.findIndex((item) => item.id === activeProduct.id)}
                      />
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
