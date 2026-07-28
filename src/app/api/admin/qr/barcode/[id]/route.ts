// =========================================================
// FILE: src/app/api/admin/qr/barcode/[id]/route.ts
// PNG штрихкод EAN-13 для одного товара. GET /api/admin/qr/barcode/{id}
// Используется страницей массовой печати и компонентом превью.
//
// Реализация на bwip-js вместо jsbarcode:
//  • jsbarcode v3 написан для браузера (canvas/document) и падает
//    в Node SSR-роуте с "ReferenceError: document is not defined".
//  • bwip-js работает одинаково в Node и в браузере, без DOM.
//  • Один пакет — меньше bundle-size, чем тянуть DOM-эмуляцию.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import bwipjs from "bwip-js";
import { getProductById } from "@/lib/supabase-queries";
import { computeBarcode } from "@/lib/qr";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = await getProductById(id).catch(() => null);
  if (!product) {
    return new NextResponse("Product not found", { status: 404 });
  }

  const barcode = product.barcode || computeBarcode(product.id);

  try {
    // bwip-js: toBuffer({ bcid: "ean13", text: ..., scale, height, includetext })
    // — возвращает Promise<Buffer> с PNG.
    const png = await bwipjs.toBuffer({
      bcid: "ean13",
      text: barcode,
      scale: 2,
      height: 14, // ~14 мм при scale=2
      includetext: true,
      textxalign: "center",
      textsize: 8,
    });

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (e) {
    console.error("barcode render error:", e);
    return new NextResponse("Barcode render error", { status: 500 });
  }
}
