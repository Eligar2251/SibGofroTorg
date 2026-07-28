// =========================================================
// FILE: src/app/api/admin/scan/[code]/route.ts
// API для сканера: GET /api/admin/scan/{code}
// — code может быть либо QR-slug (12 base32), либо EAN-13 (13 цифр),
//   либо productId (uuid, для обратной совместимости).
//
// Возвращает JSON с product-объектом (минимальным) или 404.
// Используется:
//  • Страницей /admin/scan/[code] (когда сотрудник сканирует QR
//    камерой телефона и попадает на /admin/scan/{slug})
//  • Внутренним сканером в админ-шапке (камера или ручной ввод)
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { getProducts, getProductById } from "@/lib/supabase-queries";
import { computeQrSlug, computeBarcode } from "@/lib/qr";

/** Минимальная проекция продукта — ровно то, что нужно на странице
 *  сканера: цена, наличие, артикул, категория, ссылка в админку. */
function projectForScan(p: any) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    barcode: p.barcode || computeBarcode(p.id),
    qrSlug: p.qrSlug || computeQrSlug(p.id),
    price: p.price,
    priceWholesale: p.priceWholesale,
    inStock: p.inStock,
    stockQty: p.stockQty,
    imageUrl: p.imageUrl,
    isVisible: p.isVisible,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { code: string } }
) {
  const code = (params.code || "").trim();
  if (!code) {
    return NextResponse.json(
      { error: "Пустой код", notFound: true },
      { status: 400 }
    );
  }

  // 1) Прямое попадание по productId (uuid, для обратной совместимости
  //    с ручным вводом).
  const direct = await getProductById(code).catch(() => null);
  if (direct) {
    return NextResponse.json({ found: true, product: projectForScan(direct) });
  }

  // 2) Поиск по коду: ищем среди всех товаров тот, у кого barcode или
  //    qrSlug совпадает с введённой строкой. Стоимость O(N) раз в
  //    120с (кеш), идёт в админке, где N обычно ~сотни, не тысячи.
  const all = await getProducts({ includeHidden: true });

  // EAN-13 — строго 13 цифр, ищем в barcode.
  if (/^\d{13}$/.test(code)) {
    const hit = all.find((p) => p.barcode === code);
    if (hit) {
      return NextResponse.json({ found: true, product: projectForScan(hit) });
    }
  }

  // qrSlug — base32 12 символов, ищем в qrSlug.
  if (/^[A-Z0-9]{8,16}$/i.test(code)) {
    const upper = code.toUpperCase();
    const hit = all.find((p) => p.qrSlug === upper);
    if (hit) {
      return NextResponse.json({ found: true, product: projectForScan(hit) });
    }
  }

  // 3) На крайний случай — может, ввели обычный slug или SKU.
  const bySlug = all.find(
    (p) => p.slug.toLowerCase() === code.toLowerCase()
  );
  if (bySlug) {
    return NextResponse.json({ found: true, product: projectForScan(bySlug) });
  }
  const bySku = all.find(
    (p) => p.sku && p.sku.toLowerCase() === code.toLowerCase()
  );
  if (bySku) {
    return NextResponse.json({ found: true, product: projectForScan(bySku) });
  }

  return NextResponse.json(
    {
      found: false,
      notFound: true,
      code,
      message: `Товар с кодом «${code}» не найден`,
    },
    { status: 404 }
  );
}
