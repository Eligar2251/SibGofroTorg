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
import { computeQrSlug, computeBarcode, computeLegacyQrSlug } from "@/lib/qr";
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

  // Цифровой ввод: EAN-13 со сканера, код, введённый вручную, или
  // скопированный «красивый» вариант с пробелами («200 1234 …»).
  // Пробелы/дефисы вычищаем — иначе ручной ввод не находился.
  const digits = code.replace(/[\s-]+/g, "");
  if (/^\d{8,14}$/.test(digits)) {
    const hit = all.find((p) => (p.barcode || "").replace(/\s+/g, "") === digits);
    if (hit) {
      return NextResponse.json({ found: true, product: projectForScan(hit) });
    }
  }

  // Верхняя граница 24, а не 16: багованный legacy-slug со словом
  // «undefined» внутри мог вырасти до 20 символов (см. qr.ts).
  if (/^[A-Z0-9]{8,24}$/i.test(code)) {
    const upper = code.toUpperCase();
    // Регистронезависимо: в старой базе встречаются slug со
    // строчными буквами (бывший баг base32-алфавита), а QR везде
    // кодирует код в верхнем регистре. Плюс фоллбек на старый
    // багованный slug — чтобы уже напечатанные QR-этикетки начали
    // находиться (см. computeLegacyQrSlug).
    const hit = all.find(
      (p) =>
        (p.qrSlug || "").toUpperCase() === upper ||
        computeLegacyQrSlug(p.id).toUpperCase() === upper
    );
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
