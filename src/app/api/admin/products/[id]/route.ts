// =========================================================
// FILE: src/app/api/admin/products/[id]/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { updateProduct, deleteProduct } from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";
import { isValidBarcode } from "@/lib/qr";

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

    // Штрихкод меняется только явно из формы: либо корректный
    // EAN-13, либо пустое значение (очистить → потом дозапишется
    // генерацией кнопкой «Обновить штрихкоды»).
    if (typeof body.barcode === "string") {
      body.barcode = body.barcode.replace(/\s+/g, "");
      if (body.barcode && !isValidBarcode(body.barcode)) {
        return NextResponse.json(
          {
            error:
              "Штрихкод должен быть корректным EAN-13: 13 цифр с верной контрольной суммой",
          },
          { status: 400 }
        );
      }
      if (!body.barcode) body.barcode = null;
    }

    await updateProduct(id, body);
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update product error:", error);
    // Нарушение уникального индекса products.barcode.
    if ((error as any)?.code === "23505") {
      return NextResponse.json(
        { error: "Такой штрихкод уже присвоен другому товару" },
        { status: 409 }
      );
    }
    // Отдаём реальный текст ошибки БД — иначе по «Ошибка сервера»
    // невозможно понять причину (например, занятый slug или
    // неприменённая миграция со штрихкодом).
    const detail =
      (error as any)?.message && String((error as any).message).slice(0, 300);
    return NextResponse.json(
      {
        error: detail
          ? `Не удалось сохранить товар: ${detail}`
          : "Ошибка сервера при обновлении товара",
      },
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