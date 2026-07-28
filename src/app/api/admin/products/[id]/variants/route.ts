// =========================================================
// FILE: src/app/api/admin/products/[id]/variants/route.ts
// CRUD для вариантов товара (цвет/размер/фасовка).
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  deleteProductVariants,
  getProductVariants,
  saveVariant,
  saveVariantsBatch,
  type VariantInput,
} from "@/lib/variants";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const variants = await getProductVariants(id);
    return NextResponse.json({ variants });
  } catch (error: any) {
    console.error("Admin get variants error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const body = await request.json();
    // Поддерживаем два режима: одна позиция или сразу пачка.
    if (Array.isArray(body?.items)) {
      const items = body.items as VariantInput[];
      await saveVariantsBatch(id, items);
      return NextResponse.json({ ok: true });
    }
    const item = body as VariantInput;
    const variant = await saveVariant(id, item);
    return NextResponse.json({ ok: true, variant });
  } catch (error: any) {
    console.error("Admin save variants error:", error);
    return NextResponse.json(
      { error: error?.message || "Не удалось сохранить варианты" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const variantId = searchParams.get("variantId");
    if (variantId) {
      const { deleteVariant } = await import("@/lib/variants");
      await deleteVariant(variantId);
    } else {
      await deleteProductVariants(id);
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Admin delete variants error:", error);
    return NextResponse.json(
      { error: error?.message || "Не удалось удалить варианты" },
      { status: 400 }
    );
  }
}
