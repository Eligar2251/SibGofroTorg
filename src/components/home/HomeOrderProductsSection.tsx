"use client";

import Link from "next/link";
import { ArrowRight, Clock3, PackagePlus } from "lucide-react";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";

interface OrderProduct {
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
  madeToOrderMinQty?: number | null;
  isCuttable?: boolean | null;
  cutMetersPerRoll?: number | null;
  cutPricePerMeter?: number | null;
  cutUnitName?: string | null;
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
}

export function HomeOrderProductsSection({ products }: { products: OrderProduct[] }) {
  if (products.length === 0) return null;

  return (
    <section className="order-products-section" aria-labelledby="order-products-title">
      <div className="container">
        <div className="order-products-head">
          <div className="order-products-head__icon"><PackagePlus size={22} /></div>
          <div className="order-products-head__main">
            <span className="order-products-eyebrow">Доступно под заказ</span>
            <h2 id="order-products-title" className="section-title">Товары под заказ</h2>
            <p>
              Эти позиции закончились на складе, но мы можем привезти их по вашему
              заказу. Обычное время ожидания — <strong>2–3 дня</strong>.
            </p>
          </div>
          <div className="order-products-wait"><Clock3 size={15} /> 2–3 дня</div>
          <Link href="/catalog" className="text-link order-products-all">
            Весь каталог <ArrowRight size={13} />
          </Link>
        </div>

        <div className="products-grid-4 order-products-grid">
          {products.map((product) => (
            <ProductCardCompact
              key={product.id}
              product={product}
              orderMode
            />
          ))}
        </div>
      </div>
    </section>
  );
}
