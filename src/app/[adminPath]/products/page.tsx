// =========================================================
// FILE: src/app/[adminPath]/products/page.tsx
// =========================================================

import { getProducts, getAllCategories } from "@/lib/firestore-queries";
import Link from "next/link";
import { Plus, Eye, EyeOff } from "lucide-react";
import { notFound } from "next/navigation";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const allProducts = await getProducts({});
  const cats = await getAllCategories();
  const catMap = new Map(cats.map((c) => [c.id, c.name]));

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Товары</h1>
          <p className="admin-sub">Всего: {allProducts.length} товаров</p>
        </div>
        <Link href={`/${ADMIN_PATH}/products/new`} className="admin-btn admin-btn--primary">
          <Plus size={16} /> Добавить товар
        </Link>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Категория</th>
                <th>Цена</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {allProducts.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="admin-product-cell">
                      <div className="admin-product-thumb">
                        {product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={product.imageUrl} alt="" />
                        ) : (
                          "📦"
                        )}
                      </div>
                      <div>
                        <div className="admin-product-name">{product.name}</div>
                        <div className="admin-product-sku">{product.sku || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="admin-muted">
                    {product.categoryId ? catMap.get(product.categoryId) || "—" : "—"}
                  </td>
                  <td>
                    <div className="admin-price">
                      {product.price
                        ? `${product.price.toLocaleString("ru-RU")} ₽`
                        : "по запросу"}
                    </div>
                    {product.priceWholesale != null && (
                      <div className="admin-price-opt">
                        опт: {product.priceWholesale.toLocaleString("ru-RU")} ₽
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="admin-row">
                      {product.inStock ? (
                        <span className="admin-badge admin-badge--green">В наличии</span>
                      ) : (
                        <span className="admin-badge admin-badge--red">Нет</span>
                      )}
                      {product.isPromo && (
                        <span className="admin-badge admin-badge--amber">
                          {product.promoLabel || "Акция"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <Link
                        href={`/${ADMIN_PATH}/products/${product.id}`}
                        className="admin-btn admin-btn--icon"
                        title="Редактировать"
                      >
                        ✏️
                      </Link>
                      <Link
                        href={`/catalog/product/${product.slug}`}
                        className="admin-btn admin-btn--icon"
                        title="Просмотр"
                        target="_blank"
                      >
                        {product.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {allProducts.length === 0 && (
            <div className="admin-table__empty">Товаров пока нет</div>
          )}
        </div>
      </div>
    </div>
  );
}