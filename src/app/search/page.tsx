import Link from "next/link";
import { getProducts } from "@/lib/firestore-queries";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { SearchBar } from "@/components/layout/SearchBar";

export const metadata = { title: "Поиск упаковочных материалов — СибГофроТорг" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const queryStr = q?.trim() || "";
  const results = queryStr ? await getProducts({ search: queryStr }) : [];

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
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Ничего не найдено</h3>
            <p style={{ fontSize: 14, color: "var(--ink-light)", marginTop: 4 }}>
              Попробуйте проверить опечатки или используйте более общие фразы, например: «скотч» или «коробка».
            </p>
          </div>
        ) : (
          <div className="card-base" style={{ textAlign: "center", padding: "48px 16px" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✍️</div>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Введите ваш поисковый запрос</h3>
            <p style={{ fontSize: 14, color: "var(--ink-light)", marginTop: 4 }}>
              Начните вводить название товара или размеры коробки в поисковой строке выше.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}