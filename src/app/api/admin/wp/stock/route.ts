// src/app/api/admin/wp/stock/route.ts
// Учёт макулатуры: ручная правка остатка на складе (вкладка «Склад»).
// Храним разницу с расчётом «принято − продано», поэтому правка не
// затирает будущие приёмы и продажи.
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWpStockAdjustment,
  getWpStockAdjustments,
  requireWastepaperApi,
  setWpStockAdjustment,
} from "@/lib/wastepaper-account";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string) {
  console.error("WP stock error:", error);
  const message = error instanceof Error && error.message ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ items: await getWpStockAdjustments() });
  } catch (error) {
    return errorResponse(error, "Не удалось загрузить правки остатка");
  }
}

/** Сохранить правку по виду: { wastepaperType, deltaKg | stockKg, note? }. */
export async function PATCH(req: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const b = await req.json();
    const item = await setWpStockAdjustment(
      {
        wastepaperType: String(b.wastepaperType || ""),
        // Приоритет у разницы: её шлёт интерфейс, посчитав от расчётного
        // остатка строки. stockKg — на случай правки «вписал факт».
        ...(b.deltaKg !== undefined ? { deltaKg: Number(b.deltaKg) || 0 } : {}),
        ...(b.deltaKg === undefined && b.stockKg !== undefined
          ? { stockKg: Number(b.stockKg) || 0 }
          : {}),
        note: b.note ?? null,
      },
      auth.displayName
    );
    await logAdminAction(
      auth.displayName,
      auth.role,
      item ? "update" : "delete",
      "wp-stock",
      String(b.wastepaperType || ""),
      item
        ? `Ручная правка остатка «${item.wastepaperType}»: ${item.deltaKg > 0 ? "+" : ""}${item.deltaKg} кг`
        : `Снята ручная правка остатка «${b.wastepaperType}»`,
      { deltaKg: item?.deltaKg ?? 0 }
    );
    return NextResponse.json({
      success: true,
      item,
      items: await getWpStockAdjustments(),
    });
  } catch (error) {
    return errorResponse(error, "Не удалось сохранить остаток");
  }
}

/** Снять правку: { wastepaperType } — остаток снова только по документам. */
export async function DELETE(req: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const wastepaperType = String(b.wastepaperType || "");
    await deleteWpStockAdjustment(wastepaperType);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "wp-stock",
      wastepaperType,
      `Снята ручная правка остатка «${wastepaperType}»`
    );
    return NextResponse.json({
      success: true,
      items: await getWpStockAdjustments(),
    });
  } catch (error) {
    return errorResponse(error, "Не удалось снять правку остатка");
  }
}
