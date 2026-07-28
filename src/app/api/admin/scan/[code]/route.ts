// =========================================================
// FILE: src/app/api/admin/scan/[code]/route.ts
// API для сканера: GET /api/admin/scan/{code}
// — code может быть либо QR-slug, либо EAN-13, productId, SKU,
//   slug товара или даже целый URL, считанный из QR-кода.
//
// Возвращает JSON с компактным product-объектом или 404.
// Используется:
//  • встроенным экраном сканера /admin/scan
//  • прямыми переходами по QR вида /admin/scan/{slug}
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { getProducts, getProductById } from "@/lib/supabase-queries";
import { computeQrSlug, computeBarcode } from "@/lib/qr";
import { buildStockLabel, normalizeScanCode } from "@/lib/scan";

/** Минимальная проекция продукта — ровно то, что нужно сканеру. */
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
    stockLabel: buildStockLabel({ stockQty: p.stockQty, inStock: p.inStock }),
    imageUrl: p.imageUrl,
    isVisible: p.isVisible,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: codeParam } = await params;
  const adminPath = process.env.ADMIN_SECRET_PATH || "admin";
  const code = normalizeScanCode(codeParam, adminPath);

  if (!code) {
    return NextResponse.json(
      { error: "Пустой код", notFound: true },
      { status: 400 }
    );
  }

  // 1) Прямое попадание по productId.
  const direct = await getProductById(code).catch(() => null);
  if (direct) {
    return NextResponse.json({ found: true, product: projectForScan(direct) });
  }

  // 2) Поиск по кодам / slug / SKU среди всех товаров.
  const all = await getProducts({ includeHidden: true });

  if (/^\d{13}$/.test(code)) {
    const hit = all.find((p) => p.barcode === code);
    if (hit) {
      return NextResponse.json({ found: true, product: projectForScan(hit) });
    }
  }

  if (/^[A-Z0-9]{8,16}$/i.test(code)) {
    const upper = code.toUpperCase();
    const hit = all.find((p) => p.qrSlug === upper);
    if (hit) {
      return NextResponse.json({ found: true, product: projectForScan(hit) });
    }
  }

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
