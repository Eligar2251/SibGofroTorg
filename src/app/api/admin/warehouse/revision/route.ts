// src/app/api/admin/warehouse/revision/route.ts
// Применение ревизии склада: фактические остатки записываются в products.
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { applyStockRevision } from "@/lib/warehouse";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const rawItems = Array.isArray(body.items) ? body.items : [];

    const items = rawItems
      .map((it: any) => ({
        productId: String(it?.productId || "").trim(),
        name: it?.name ? String(it.name).slice(0, 300) : undefined,
        accountedQty: Math.floor(Number(it?.accountedQty) || 0),
        actualQty: Math.max(0, Math.floor(Number(it?.actualQty) || 0)),
      }))
      .filter((it: { productId: string }) => it.productId);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "Не переданы позиции ревизии" },
        { status: 400 }
      );
    }
    if (items.length > 1000) {
      return NextResponse.json(
        { error: "Слишком много позиций за раз (максимум 1000)" },
        { status: 400 }
      );
    }

    const note = body.note ? String(body.note).slice(0, 500) : null;
    const responsible = body.responsible
      ? String(body.responsible).slice(0, 200)
      : null;

    const result = await applyStockRevision(items);

    await logAdminAction(
      auth.displayName,
      auth.role,
      "bulk_update",
      "product",
      "stock-revision",
      `Ревизия склада: обновлено ${result.updated} поз.${
        responsible ? ` (считал: ${responsible})` : ""
      }`,
      { note, responsible, changes: result.changes }
    );

    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Stock revision error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
