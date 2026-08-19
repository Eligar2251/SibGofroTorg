import Link from "next/link";
import type { Metadata } from "next";
import { getProducts } from "@/lib/supabase-queries";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { SearchBar } from "@/components/layout/SearchBar";
import { GlyphIcon } from "@/components/ui/Glyph";
import { SITE_URL } from "@/lib/seo";

// Сама страница /search — индексируется (полезный вход «подбор коробки
// по размерам»), а страницы результатов /search?q=… — noindex:
// служебные выдачи не должны попадать в индекс как дубли.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  if (q?.trim()) {
    return {
      title: "Поиск по каталогу",
      robots: { index: false, follow: true },
    };
  }
  return {
    title: "Подбор коробок по размеру — поиск по каталогу",
    description:
      "Подбор картонных коробок и упаковки по размерам и названиям: введите габариты (например, 600х400х400) или название товара. Склад в Новосибирске, от 1 шт.",
    alternates: { canonical: `${SITE_URL}/search` },
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const queryStr = q?.trim() || "";
  const results = queryStr
    ? await getProducts({ search: queryStr }).catch(() => [])
    : [];

  return (
    <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: 64 }}>
      <div className="breadcrumb-bar">
        <div className="container-wide breadcrumbs">
          <Link href="/">Главная</Link>
          <span>/</span>
          <span>Поиск по сайту</span>
        </div>
      </div>

      <div className="container-wide" style={{ paddingBlock: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 20, color: "var(--ink)" }}>Результаты поиска</h1>

        <div className="search-panel" style={{ marginBottom: 24 }}>
          <SearchBar variant="panel" defaultValue={queryStr} placeholder="Введите название, коробки, размеры или артикул..." />
        </div>

        {queryStr && (
          <p style={{ fontSize: 14, color: "var(--ink-light)", marginBottom: 16 }}>
            По запросу <strong>«{queryStr}»</strong> найдено: {results.length} товаров.
          </p>
        )}

        {results.length > 0 ? (
          <div className="product-grid-compact">
            {results.map((product) => (
              <ProductCardCompact key={product.id} product={product} />
            ))}
          </div>
        ) : queryStr ? (
          <div className="card-base" style={{ textAlign: "center", padding: "48px 16px" }}>
            <div style={{ marginBottom: 12, color: "var(--ink-muted)" }}><GlyphIcon value="search" size={36} /></div>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Ничего не найдено</h3>
            <p style={{ fontSize: 14, color: "var(--ink-light)", marginTop: 4 }}>
              Попробуйте проверить опечатки или используйте более общие фразы, например: «скотч» или «коробка».
            </p>
          </div>
        ) : (
          <>
            <div className="card-base" style={{ textAlign: "center", padding: "48px 16px" }}>
              <div style={{ marginBottom: 12, color: "var(--ink-muted)" }}><GlyphIcon value="penline" size={36} /></div>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Введите ваш поисковый запрос</h3>
              <p style={{ fontSize: 14, color: "var(--ink-light)", marginTop: 4 }}>
                Начните вводить название товара или размеры коробки в поисковой строке выше.
              </p>
            </div>

            {/* SEO-блок: вход по запросам «коробка по размерам», «коробка 600 400 400» */}
            <div style={{ maxWidth: 760, margin: "32px auto 0", fontSize: 14, lineHeight: 1.7, color: "var(--ink-light)" }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>
                Как найти коробку нужного размера
              </h2>
              <p>
                Поиск понимает размеры: введите габариты в любом порядке — например,{" "}
                «600 400 400» или «коробка 600х400х400» — и покажет коробки,
                ближайшие по размерам. Можно искать и по названию («миникороб»,
                «гофроформат», «скотч»), и по артикулу (например, «GK-670»).
              </p>
              <p style={{ marginTop: 8 }}>
                Если нужного типоразмера нет в наличии —{" "}
                <Link href="/korobki-na-zakaz">изготовим коробки на заказ</Link> по вашим
                размерам от 1000 м². Популярные размеры собраны в{" "}
                <Link href="/catalog">каталоге</Link> и на страницах{" "}
                <Link href="/korobki-dlya-pereezda">коробок для переезда</Link> и{" "}
                <Link href="/korobki-dlya-marketplejsov">коробок для WB и Ozon</Link>.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
