// =========================================================
// FILE: src/app/[adminPath]/scan/[code]/page.tsx
// Компактная страница сканера: открывается по ссылке из QR-кода
// (вида /admin/scan/{slug}). Показывает название товара, цену,
// наличие. Сверху — поле «Введите код / отсканируйте» + кнопка
// камеры (getUserMedia), чтобы сканировать прямо в браузере.
//
// Доступ — по авторизации админки (через layout-обёртку).
// Если код не найден — страница показывает сообщение.
// =========================================================

import { notFound } from "next/navigation";
import Link from "next/link";
import { getProductById, getProducts } from "@/lib/supabase-queries";
import { computeBarcode, computeQrSlug, formatBarcode } from "@/lib/qr";
import { ScanCode } from "@/components/admin/ScanCode";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

async function findByCode(code: string) {
  const trimmed = (code || "").trim();
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
  const product = await findByCode(code);

  // Если код введён руками и не нашёлся — показываем экран «не найдено».
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

  // Если зашли прямым URL и код битый — 404
  if (!product) {
    notFound();
  }

  const barcode = product.barcode || computeBarcode(product.id);
  const qrSlug = product.qrSlug || computeQrSlug(product.id);
  const stockLabel = (() => {
    if (product.stockQty != null) {
      if (product.stockQty <= 0) return { text: "Нет в наличии", tone: "out" as const };
      if (product.stockQty < 10) return { text: `Мало: ${product.stockQty} шт`, tone: "low" as const };
      return { text: `В наличии: ${product.stockQty} шт`, tone: "ok" as const };
    }
    return product.inStock
      ? { text: "В наличии", tone: "ok" as const }
      : { text: "Нет в наличии", tone: "out" as const };
  })();

  return (
    <ScanCode
      adminPath={adminPath}
      initialCode=""
      product={(() => {
        const basePrice = product.price ?? 0;
        return {
          id: product.id,
          name: product.name,
          slug: product.slug,
          sku: product.sku ?? null,
          barcode,
          qrSlug,
          imageUrl: product.imageUrl ?? null,
          price: basePrice,
          priceWholesale: product.priceWholesale ?? null,
          stockQty: product.stockQty ?? null,
          stockLabel,
        };
      })()}
    />
  );
}
