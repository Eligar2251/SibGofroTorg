// =========================================================
// FILE: src/app/api/admin/products/barcodes/route.ts
// Управление штрихкодами товаров.
//
// POST {}              — «Обновить штрихкоды» для всего каталога:
//                        дозаписывает коды только там, где их нет
//                        или они битые/дублируются. Товары с
//                        валидным кодом НЕ меняются — штрихкод
//                        один и навсегда (см. fixMissingProductBarcodes).
// POST { "id": "..." } — принудительная перегенерация кода одного
//                        товара (ручное действие из карточки).
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  fixMissingProductBarcodes,
  regenerateProductBarcode,
} from "@/lib/supabase-queries";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));

    // Ручная перегенерация для одного товара.
    if (body?.id && typeof body.id === "string") {
      const { barcode } = await regenerateProductBarcode(body.id);
      return NextResponse.json({ success: true, barcode });
    }

    const report = await fixMissingProductBarcodes();
    return NextResponse.json({ success: true, ...report });
  } catch (error) {
    console.error("Barcodes fix error:", error);
    const message =
      error instanceof Error ? error.message : "Ошибка сервера";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
