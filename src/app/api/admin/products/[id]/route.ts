// =========================================================
// FILE: src/app/api/admin/products/[id]/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { updateProduct, deleteProduct } from "@/lib/firestore-queries";
import { requireAdminApi } from "@/lib/auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json(
        { error: "Название товара обязательно" },
        { status: 400 }
      );
    }

    await updateProduct(id, body);
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update product error:", error);
    return NextResponse.json(
      { error: "Ошибка сервера при обновлении товара" },
      { status: 500 }
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
    await deleteProduct(id);
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete product error:", error);
    return NextResponse.json(
      { error: "Ошибка сервера при удалении товара" },
      { status: 500 }
    );
  }
}