// =========================================================
// FILE: src/app/api/admin/qr/[id]/route.ts
// PNG QR-код для одного товара. GET /api/admin/qr/{productId}?size=...
// — `size` в пикселях, по умолчанию 240 (для печати этикеток).
// — Используется страницей массовой печати и компонентом сканера.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getProductById } from "@/lib/supabase-queries";
import { computeQrSlug, qrTargetUrl } from "@/lib/qr";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = await getProductById(id).catch(() => null);
  if (!product) {
    return new NextResponse("Product not found", { status: 404 });
  }

  const slug = product.qrSlug || computeQrSlug(product.id);
  const origin = req.nextUrl.origin;
  const target = qrTargetUrl(slug, origin);

  const sizeParam = Number(req.nextUrl.searchParams.get("size") || 240);
  const size = Number.isFinite(sizeParam)
    ? Math.max(80, Math.min(800, sizeParam))
    : 240;

  const png = await QRCode.toBuffer(target, {
    type: "png",
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: {
      dark: "#1a1a1a",
      light: "#ffffff",
    },
  });

  // NextResponse в Next 15 не принимает Node Buffer напрямую —
  // конвертируем в Uint8Array (тот же байтовый layout, обёртка ArrayBuffer).
  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
