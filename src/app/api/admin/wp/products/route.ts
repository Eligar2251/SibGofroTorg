// src/app/api/admin/wp/products/route.ts
// Учёт макулатуры: справочник видов макулатуры (список, добавление, правка).
import { NextRequest, NextResponse } from "next/server";
import { getWpProducts, requireWastepaperApi, upsertWpProduct } from "@/lib/wastepaper-account";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string) {
  console.error("WP products error:", error);
  const message = error instanceof Error && error.message ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ items: await getWpProducts() });
  } catch (error) {
    return errorResponse(error, "Не удалось загрузить виды макулатуры");
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const b = await req.json();
    const item = await upsertWpProduct({
      name: String(b.name ?? ""),
      pricePerKg: Number(b.pricePerKg) || 0,
      isActive: b.isActive === undefined ? undefined : b.isActive !== false,
    });
    await logAdminAction(auth.displayName, auth.role, "create", "wp-product", item.id, `Вид макулатуры: ${item.name}`, {
      pricePerKg: item.pricePerKg,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error, "Не удалось добавить вид макулатуры");
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const b = await req.json();
    const id = String(b.id || "");
    if (!id) return NextResponse.json({ error: "Не указан вид макулатуры" }, { status: 400 });
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
