// =========================================================
// FILE: src/app/api/admin/categories/[id]/route.ts
// Удаление категории: товары не трогаем (у них сбрасывается
// category_id в NULL), удаляем только саму категорию.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { deleteCategory } from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    await deleteCategory(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete category error:", error);
    const detail =
      (error as any)?.message && String((error as any).message).slice(0, 300);
    return NextResponse.json(
      {
        error: detail
          ? `Не удалось удалить категорию: ${detail}`
          : "Ошибка сервера при удалении категории",
      },
      { status: 500 }
    );
  }
}
