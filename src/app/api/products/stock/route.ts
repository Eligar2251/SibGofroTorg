// =========================================================
// FILE: src/app/api/products/stock/route.ts
// Актуальная проверка складских остатков для позиций корзины.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { validateOrderItemsAgainstLiveDb } from "@/lib/order-stock-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawItems = Array.isArray(body?.items) ? body.items.slice(0, 80) : [];
    if (rawItems.length === 0) {
      return NextResponse.json(
        { ok: true, error: null, items: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const items = rawItems.map((it: any) => ({
      productId: String(it?.productId || "").trim().slice(0, 80),
      variantId: it?.variantId ? String(it.variantId).trim().slice(0, 80) : null,
      variantName: it?.variantName ? String(it.variantName).trim().slice(0, 120) : null,
      name: it?.name ? String(it.name).trim().slice(0, 200) : null,
      quantity: Math.max(1, Math.min(100_000, Math.round(Number(it?.quantity) || 1))),
    }));

    const result = await validateOrderItemsAgainstLiveDb(items);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("API /api/products/stock error:", error);
    return NextResponse.json(
      { error: "Не удалось проверить остатки" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
