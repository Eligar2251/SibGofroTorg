// =========================================================
// FILE: src/app/api/admin/qr/[id]/route.ts
// PNG QR-код для одного товара. GET /api/admin/qr/{productId}?size=...
// — `size` в пикселях, по умолчанию 240 (для печати этикеток).
// — Используется страницей массовой печати и компонентом сканера.
//
// ── Почему код читается камерой не через раз, а всегда ──
// Раньше QR рендерился так: { width: size, margin: 1, ecLevel: "M" }.
// Три независимых дефекта, каждый из которых по отдельности ронял
// распознавание на части этикеток:
//
// 1) ДРОБНЫЙ МАСШТАБ МОДУЛЯ.
//    node-qrcode при заданном `width` считает scale = width/(modules+2*margin)
//    и НЕ округляет его. Для 33-модульного кода и width=170 это
//    scale = 4.857 px на модуль. Рендерер раскладывает пиксели через
//    Math.floor(), поэтому модули получают неравную ширину: 4,5,5,4,5…
//    Сетка «плывёт», сканер не может надёжно определить границы
//    модулей и таймин-паттерны. width=210/280 давали целый scale и
//    читались — отсюда и «через раз»: 4×4 и 6×6 см ломались, 5×5 и
//    лента работали.
//    → Теперь scale вычисляется как ЦЕЛОЕ число, а итоговый размер
//      подгоняется под него. Все модули строго одинаковые.
//
// 2) QUIET ZONE 1 МОДУЛЬ ВМЕСТО 4.
//    ISO/IEC 18004 требует свободное поле ≥4 модулей вокруг символа.
//    С margin:1 код, напечатанный впритык к рамке/тексту этикетки,
//    сливается с окружением — детектор не находит finder-паттерны.
//    Это классическая причина «одни этикетки читаются, другие нет»:
//    зависит от того, что оказалось рядом на конкретной этикетке.
//    → margin: 4.
//
// 3) СЛИШКОМ НИЗКАЯ КОРРЕКЦИЯ ОШИБОК ДЛЯ ТЕРМОПЕЧАТИ.
//    ecLevel "M" (15%) плюс термопринтер, который «мажет» точки, плюс
//    затёртая на складе этикетка = нечитаемо.
//    → ecLevel "Q" (25%). Вместе с укороченным payload (см. lib/qr.ts)
//      это не увеличило версию QR: было v4/33 модуля, стало v3/29.
//
// Дополнительно код отдаётся ещё и в SVG (?format=svg) — вектор
// печатается без растровой интерполяции, это лучший вариант для
// принтера.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getProductById } from "@/lib/supabase-queries";
import { computeQrSlug, qrTargetUrl } from "@/lib/qr";

/** Уровень коррекции ошибок: Q = 25% символа можно потерять. */
const EC_LEVEL = "Q" as const;
/** Quiet zone по стандарту ISO/IEC 18004 — минимум 4 модуля. */
const QUIET_ZONE = 4;

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

  // Публичный origin сайта важнее origin запроса: этикетка может
  // печататься из внутренней сети (http://192.168.x.x:3000), а
  // сканировать её будут телефоном с улицы. Зашивать в QR
  // недоступный снаружи адрес нельзя.
  const publicOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  const target = qrTargetUrl(slug, publicOrigin);

  const format = req.nextUrl.searchParams.get("format");

  // ── SVG: вектор, идеален для печати ──
  if (format === "svg") {
    const svg = await QRCode.toString(target, {
      type: "svg",
      margin: QUIET_ZONE,
      errorCorrectionLevel: EC_LEVEL,
      color: { dark: "#000000", light: "#ffffff" },
    });

    return new NextResponse(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  }

  const sizeParam = Number(req.nextUrl.searchParams.get("size") || 240);
  const requested = Number.isFinite(sizeParam)
    ? Math.max(80, Math.min(1200, sizeParam))
    : 240;

  // ── Целочисленный масштаб модуля ──
  // Считаем реальное число модулей символа, чтобы подобрать scale,
  // при котором КАЖДЫЙ модуль занимает одинаковое целое число
  // пикселей. Итоговая картинка может быть чуть меньше запрошенной
  // (например 246px вместо 250px) — это правильный размен: CSS
  // растянет её до слота, а сетка модулей останется ровной.
  const probe = QRCode.create(target, { errorCorrectionLevel: EC_LEVEL });
  const totalModules = probe.modules.size + QUIET_ZONE * 2;
  const scale = Math.max(1, Math.floor(requested / totalModules));

  const png = await QRCode.toBuffer(target, {
    type: "png",
    scale,
    margin: QUIET_ZONE,
    errorCorrectionLevel: EC_LEVEL,
    color: {
      // Чистый чёрный вместо прежнего #1a1a1a: максимальный контраст.
      // Серый на термопечати уходит в «грязный» полутон и снижает
      // отношение сигнал/шум для бинаризатора камеры.
      dark: "#000000",
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
