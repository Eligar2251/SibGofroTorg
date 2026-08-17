"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Tag, ShoppingCart, Check } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { GlyphIcon } from "@/components/ui/Glyph";
import { getProductEffectivePrice } from "@/lib/types";

interface SaleProduct {
  id: string;
  name: string;
  slug: string;
  sku?: string | null;
  price: number | null;
  imageUrl?: string | null;
  inStock?: boolean;
  stockQty?: number | null;
  discountType?: "percent" | "fixed" | null;
  discountValue?: number | null;
}

function effectivePrice(p: SaleProduct): number | null {
  return getProductEffectivePrice(p as any);
}

/**
 * Секция «Распродажа остатков» — компактные карточки с ценой и остатком.
 * Показывается на главной перед «Популярными товарами».
 */
export function HomeSaleSection({ products }: { products: SaleProduct[] }) {
  const { addToCart, cart } = useCart();
  const [addedId, setAddedId] = useState<string | null>(null);

  if (products.length === 0) return null;

  function handleAdd(p: SaleProduct) {
    const price = effectivePrice(p);
    if (price == null) return;
    addToCart(
      {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        price,
        imageUrl: p.imageUrl,
        maxStock: p.stockQty ?? null,
      },
      1
    );
    setAddedId(p.id);
    setTimeout(() => setAddedId(null), 1800);
  }

  return (
    <section className="sale-section" aria-labelledby="sale-section-title">
      <div className="container">
        <div className="sale-head">
          <div className="sale-head__icon"><Tag size={20} /></div>
          <div className="sale-head__main">
            <span className="sale-head__eyebrow">Выгодно · ограниченное количество</span>
            <h2 id="sale-section-title" className="section-title">Распродажа остатков</h2>
            <p>Товары со скидкой, пока они в наличии. Количество ограничено.</p>
          </div>
          <Link href="/catalog" className="text-link sale-head__all">
            Весь каталог <ArrowRight size={13} />
          </Link>
        </div>

        <div className="sale-grid">
          {products.map((p) => {
            const price = effectivePrice(p);
            const hasDiscount =
              p.price != null &&
              price != null &&
              price < p.price;
            const inCart = cart.find((i) => i.productId === p.id);
            const added = addedId === p.id;
            const out = p.stockQty != null && p.stockQty <= 0;

            return (
              <div key={p.id} className="sale-card">
                <Link href={`/catalog/product/${p.slug}`} className="sale-card__media">
                  {p.imageUrl ? (
                    <Image
                      src={p.imageUrl}
                      alt={p.name}
                      fill
                      sizes="(max-width: 640px) 44vw, 180px"
                      style={{ objectFit: "cover" }}
                    />
                  ) : (
                    <span className="sale-card__placeholder"><GlyphIcon value="box" size={28} /></span>
                  )}
                </Link>

                <div className="sale-card__body">
                  <Link href={`/catalog/product/${p.slug}`} className="sale-card__name">
                    {p.name}
                  </Link>

                  <div className="sale-card__price-row">
                    {price != null ? (
                      <>
                        <span className="sale-card__price">
                          {price.toLocaleString("ru-RU")} ₽
                        </span>
                        {hasDiscount && p.price != null && (
                          <span className="sale-card__old-price">
                            {p.price.toLocaleString("ru-RU")} ₽
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="sale-card__price-muted">Цена по запросу</span>
                    )}
                  </div>

                  <div className={`sale-card__stock${out ? " sale-card__stock--out" : ""}`}>
                    {out
                      ? "Нет в наличии"
                      : p.stockQty != null
                        ? `В наличии: ${p.stockQty.toLocaleString("ru-RU")} шт.`
                        : "В наличии"}
                  </div>

                  {price != null && !out ? (
                    <button
                      type="button"
                      className={`sale-card__btn${added ? " sale-card__btn--added" : ""}`}
                      onClick={() => handleAdd(p)}
                    >
                      {added ? <Check size={14} /> : <ShoppingCart size={14} />}
                      {added ? "В корзине" : inCart ? `Ещё (${inCart.quantity})` : "В корзину"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
