// src/app/api/admin/wp/products/[id]/route.ts
// Учёт макулатуры: правка/удаление одного вида макулатуры.
import { NextRequest, NextResponse } from "next/server";
import { deleteWpProduct, requireWastepaperApi, upsertWpProduct } from "@/lib/wastepaper-account";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string) {
  console.error("WP product error:", error);
  const message = error instanceof Error && error.message ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const b = await req.json();
    const item = await upsertWpProduct({
      id,
      name: String(b.name ?? ""),
      pricePerKg: Number(b.pricePerKg) || 0,
      isActive: b.isActive === undefined ? undefined : b.isActive !== false,
    });
    await logAdminAction(auth.displayName, auth.role, "update", "wp-product", item.id, `Вид макулатуры: ${item.name}`, {
      pricePerKg: item.pricePerKg,
      isActive: item.isActive,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error, "Не удалось сохранить вид макулатуры");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const result = await deleteWpProduct(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "wp-product",
      id,
      `Вид макулатуры: ${result.product?.name || id}`,
      { mode: result.mode }
    );
    return NextResponse.json({ success: true, mode: result.mode, item: result.product });
  } catch (error) {
    return errorResponse(error, "Не удалось удалить вид макулатуры");
  }
}
