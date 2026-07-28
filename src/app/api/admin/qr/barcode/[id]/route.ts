// =========================================================
// FILE: src/app/api/admin/qr/barcode/[id]/route.ts
// PNG штрихкод EAN-13 для одного товара. GET /api/admin/qr/barcode/{id}
// Используется страницей массовой печати и компонентом превью.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import JsBarcode from "jsbarcode";
import { getProductById } from "@/lib/supabase-queries";
import { computeBarcode } from "@/lib/qr";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const product = await getProductById(id).catch(() => null);
  if (!product) {
    return new NextResponse("Product not found", { status: 404 });
  }

  const barcode = product.barcode || computeBarcode(product.id);

  try {
    // JsBarcode v3 в Node возвращает data-URL строкой
    // ("data:image/png;base64,XXXX..."). Извлекаем base64.
    const dataUrl = JsBarcode({
      format: "EAN13",
      value: barcode,
      width: 2,
      height: 60,
      displayValue: true,
      fontSize: 14,
      margin: 4,
      background: "#ffffff",
      lineColor: "#1a1a1a",
    }) as unknown as string;
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const png = Buffer.from(b64, "base64");

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
