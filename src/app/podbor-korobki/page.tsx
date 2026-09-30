// =========================================================
// FILE: src/app/podbor-korobki/page.tsx
// =========================================================

import type { Metadata } from "next";
import Link from "next/link";
import { getProducts } from "@/lib/supabase-queries";
import { BoxSizeFinder, type BoxFinderProduct } from "@/components/catalog/BoxSizeFinder";
import { toMm } from "@/lib/box-search";
import { SITE_URL, SITE_NAME, buildBreadcrumbJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import "@/app/seo-blocks.css";

const PAGE_PATH = "/podbor-korobki";

export const metadata: Metadata = {
  title: "Подбор коробки по размерам",
  description:
    "Подбор картонных коробок по размерам (Д × Ш × В) со склада в Новосибирске.",
  alternates: { canonical: `${SITE_URL}${PAGE_PATH}` },
  openGraph: {
    title: `Подбор коробки по размерам — ${SITE_NAME}`,
    description:
      "Подбор картонных коробок по размерам из каталога. Склад в Новосибирске, от 1 штуки.",
    url: `${SITE_URL}${PAGE_PATH}`,
  },
};

export const revalidate = 120;
export const dynamic = "force-dynamic";

export default async function BoxFinderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const dimParam = (v: string | string[] | undefined) => {
    const raw = Array.isArray(v) ? v[0] : v;
    const n = Number(String(raw || "").replace(",", "."));
    return Number.isFinite(n) && n > 0 && n <= 100000 ? String(n) : undefined;
  };
  const initial = {
    length: dimParam(sp.l),
    width: dimParam(sp.w),
    height: dimParam(sp.h),
  };

  const products = await getProducts({}).catch(() => []);

  const finderProducts: BoxFinderProduct[] = products
    .filter((p) => p.dimensionLength != null && p.dimensionWidth != null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku ?? null,
      imageUrl: p.imageUrl ?? null,
      price: p.price,
      priceWholesale: p.priceWholesale ?? null,
      minWholesaleQty: p.minWholesaleQty ?? null,
      inStock: p.inStock,
      stockQty: p.stockQty ?? null,
      madeToOrder: p.madeToOrder ?? false,
      lengthMm: toMm(p.dimensionLength, p.dimensionUnit),
      widthMm: toMm(p.dimensionWidth, p.dimensionUnit),
      heightMm: toMm(p.dimensionHeight, p.dimensionUnit),
    }));

  return (
    <>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Главная", url: SITE_URL },
          { name: "Подбор коробки по размерам", url: `${SITE_URL}${PAGE_PATH}` },
        ])}
      />

      <section className="seo-block" aria-label="Подбор коробки по размерам">
        <div className="seo-block__inner seo-block__inner--narrow">
          <nav aria-label="Навигация" style={{ marginBottom: 12, fontSize: 14 }}>
            <Link href="/">Главная</Link> → <span>Подбор коробки по размерам</span>
          </nav>

          <h1 className="seo-block__title" style={{ marginBottom: 18 }}>
            Подбор коробки по размерам
          </h1>

          <BoxSizeFinder
            products={finderProducts}
            visibleCount={12}
            initial={initial}
          />
        </div>
      </section>
    </>
  );
}
