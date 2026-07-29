// =========================================================
// FILE: src/app/api/admin/qr/barcode/[id]/route.ts
// Изображение штрихкода EAN-13 для одного товара.
// GET /api/admin/qr/barcode/{id}[?format=svg][&height=мм]
//
// • PNG (по умолчанию) — для превью/совместимости.
// • SVG (?format=svg) — вектор, для печати: на термопринтере
//   (Xprinter 203 dpi) и на листе A4 штрихи остаются идеально
//   ровными при любом масштабе, без растровой интерполяции.
//
// Реализация на bwip-js вместо jsbarcode:
//  • jsbarcode v3 написан для браузера (canvas/document) и падает
//    в Node SSR-роуте с "ReferenceError: document is not defined".
//  • bwip-js работает одинаково в Node и в браузере, без DOM.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import bwipjs from "bwip-js";
import { getProductById } from "@/lib/supabase-queries";
import { computeBarcode } from "@/lib/qr";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = await getProductById(id).catch(() => null);
  if (!product) {
    return new NextResponse("Product not found", { status: 404 });
  }

  // Приоритет — постоянный код из БД; фоллбек — детерминированный
  // (товары, созданные до миграции колонки barcode).
  const barcode = product.barcode || computeBarcode(product.id);

  // Высота штрихов в миллиметрах. По умолчанию 14 мм (комфортно
  // читается любым сканером), можно подкрутить под этикетку.
  const heightParam = Number(req.nextUrl.searchParams.get("height") || 14);
  const heightMm = Number.isFinite(heightParam)
    ? Math.max(8, Math.min(30, heightParam))
    : 14;

  const opts = {
    bcid: "ean13",
    text: barcode,
    // scale: 3 вместо 2 — при печати на 203 dpi узкий модуль EAN-13
    // при scale=2 попадал примерно в 0.25 мм и «слипался» с соседним
    // после растекания краски/термопереноса. scale=3 даёт запас.
    scale: 3,
    height: heightMm,
    includetext: true,
    textxalign: "center" as const,
    textsize: 8,
    // paddingwidth: обязательная светлая зона слева/справа от
    // штрихкода (для EAN-13 стандарт требует ≥ 11 узких модулей);
    // без неё сканер не видит границу символа.
    paddingwidth: 10,
    paddingheight: 3,
  };

  try {
    // ── SVG: вектор — предпочтительный формат для печати ──
    // TS резолвит браузерные типы bwip-js (там только toBuffer),
    // поэтому toSVG типизируем явно: в node-бандле функция есть
    // (dist/bwip-js-node.d.ts объявляет toSVG(opts): string).
    if (req.nextUrl.searchParams.get("format") === "svg") {
      const toSVG = (
        bwipjs as unknown as { toSVG: (o: typeof opts) => string | Promise<string> }
      ).toSVG;
      const svg = await Promise.resolve(toSVG(opts));
      return new NextResponse(svg, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=86400, immutable",
        },
      });
    }

    const png = await bwipjs.toBuffer(opts);

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
