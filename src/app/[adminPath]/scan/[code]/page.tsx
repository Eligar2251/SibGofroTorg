// =========================================================
// FILE: src/app/[adminPath]/scan/[code]/page.tsx
// Прямой вход по URL из QR-кода вида /admin/scan/{slug}.
// Показывает тот же экран сканера, но уже с найденным товаром.
// =========================================================

import { notFound } from "next/navigation";
import { getProductById, getProducts } from "@/lib/supabase-queries";
import { computeBarcode, computeQrSlug } from "@/lib/qr";
import { buildStockLabel, normalizeScanCode } from "@/lib/scan";
import { ScanCode } from "@/components/admin/ScanCode";

export const dynamic = "force-dynamic";

async function findByCode(rawCode: string, adminPath: string) {
  const trimmed = normalizeScanCode(rawCode, adminPath);
  if (!trimmed) return null;

  // 1) productId
  const direct = await getProductById(trimmed).catch(() => null);
  if (direct) return direct;

  // 2) EAN-13
  if (/^\d{13}$/.test(trimmed)) {
    const all = await getProducts({ includeHidden: true });
    return all.find((p) => p.barcode === trimmed) || null;
  }

  // 3) qrSlug
  if (/^[A-Z0-9]{8,16}$/i.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    const all = await getProducts({ includeHidden: true });
    return all.find((p) => p.qrSlug === upper) || null;
  }

  // 4) slug / sku (фоллбек)
  const all = await getProducts({ includeHidden: true });
  return (
    all.find((p) => p.slug.toLowerCase() === trimmed.toLowerCase()) ||
    all.find((p) => p.sku && p.sku.toLowerCase() === trimmed.toLowerCase()) ||
    null
  );
}

export default async function ScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string; code: string }>;
  searchParams: Promise<{ notFound?: string }>;
}) {
  const { adminPath, code } = await params;
  const { notFound: notFoundFlag } = await searchParams;
  const product = await findByCode(code, adminPath);

  if (!product && notFoundFlag) {
    return (
      <ScanCode
        adminPath={adminPath}
        initialCode={decodeURIComponent(notFoundFlag)}
        notFoundMessage={`Товар с кодом «${decodeURIComponent(
          notFoundFlag
        )}» не найден`}
      />
    );
  }

  if (!product) {
    notFound();
  }

  const barcode = product.barcode || computeBarcode(product.id);
  const qrSlug = product.qrSlug || computeQrSlug(product.id);

  return (
    <ScanCode
      adminPath={adminPath}
      initialCode=""
      product={{
        id: product.id,
        name: product.name,
        slug: product.slug,
        sku: product.sku ?? null,
        barcode,
        qrSlug,
        imageUrl: product.imageUrl ?? null,
        price: product.price ?? 0,
        priceWholesale: product.priceWholesale ?? null,
        stockQty: product.stockQty ?? null,
        stockLabel: buildStockLabel({
          stockQty: product.stockQty,
          inStock: product.inStock,
        }),
      }}
    />
  );
}
