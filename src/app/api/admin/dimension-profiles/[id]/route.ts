// Типы размеров товаров: изменение и удаление.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { deleteDimensionProfile, updateDimensionProfile } from "@/lib/dimension-profiles-db";
import { invalidateProductsCache } from "@/lib/supabase-queries";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const profile = await updateDimensionProfile(id, body);
    return NextResponse.json({ profile });
  } catch (error: any) {
    console.error("Update dimension profile error:", error);
    return NextResponse.json(
      { error: error?.message || "Не удалось сохранить тип размеров" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteDimensionProfile(id);
    invalidateProductsCache();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete dimension profile error:", error);
    return NextResponse.json(
      { error: error?.message || "Не удалось удалить тип размеров" },
      { status: 500 }
    );
  }
}
