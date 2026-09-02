// =========================================================
// FILE: src/app/podbor-korobki/page.tsx
// Отдельная страница «Подбор коробки по размерам».
// На неё удобно ссылаться из акций (Админка → Акции → ссылка
// /podbor-korobki). Тот же подбор есть и на главной — плиткой
// «Подбор коробки по размерам» в витрине разделов.
//
// Логика ранжирования — как в админке (lib/box-search.ts):
// каждая сторона сравнивается отдельно, ближайшие сверху.
// Отклонения показываем со знаком: «−2 мм» — коробка меньше,
// «+2 мм» — больше введённого размера.
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
  title: "Подбор коробки по размерам — найдите подходящую за 10 секунд",
  description:
    "Введите длину, ширину и высоту в миллиметрах — покажем ближайшие картонные коробки со склада в Новосибирске: сразу видно цену, наличие и отклонение размера. Подходящую коробку можно сразу добавить в корзину.",
  alternates: { canonical: `${SITE_URL}${PAGE_PATH}` },
  openGraph: {
    title: `Подбор коробки по размерам — ${SITE_NAME}`,
    description:
      "Укажите Д×Ш×В — подберём ближайшие коробки из каталога с ценой и наличием. Склад в Новосибирске, от 1 штуки.",
    url: `${SITE_URL}${PAGE_PATH}`,
  },
};

// Данные каталога кэшируются через unstable_cache (TTL 120с),
// как на главной странице.
export const revalidate = 120;
export const dynamic = "force-dynamic";

export default async function BoxFinderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Предустановка размеров из ссылки (для акций):
  // /podbor-korobki?l=600&w=400&h=400
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

          <h1 className="seo-block__title">
            Подбор коробки по размерам — <span>найдите подходящую за 10 секунд</span>
          </h1>
          <p className="seo-block__intro">
            Введите длину, ширину и высоту в миллиметрах — покажем ближайшие
            коробки со склада. У каждой видны цена, наличие и отклонение
            размера: <strong>−2&nbsp;мм</strong> — коробка меньше нужной,{" "}
            <strong>+2&nbsp;мм</strong> — больше. Подходящую можно сразу
            добавить в корзину.
          </p>

          <BoxSizeFinder
            products={finderProducts}
            visibleCount={12}
            initial={initial}
          />

          <p className="seo-block__intro" style={{ marginTop: 18 }}>
            Не нашли подходящий размер?{" "}
            <Link href="/korobki-na-zakaz">Изготовим коробки на заказ</Link> или
            посмотрите <Link href="/catalog">весь каталог</Link> — марки Т-22,
            Т-23, Т-24, от 1 штуки.
          </p>
        </div>
      </section>
    </>
  );
}
