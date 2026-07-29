// =========================================================
// FILE: src/app/api/admin/products/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createProduct, getProducts } from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";
import { isValidBarcode } from "@/lib/qr";

/** Дружелюбная реакция на битый или занятый штрихкод. */
function barcodeErrorResponse(body: any, error?: any): NextResponse | null {
  if (error) {
    // Нарушение unique-индекса products.barcode — код занят.
    if ((error as any)?.code === "23505") {
      return NextResponse.json(
        { error: "Такой штрихкод уже присвоен другому товару" },
        { status: 409 }
      );
    }
    return null;
  }
  const raw = typeof body?.barcode === "string" ? body.barcode.trim() : "";
  if (raw && !isValidBarcode(raw.replace(/\s+/g, ""))) {
    return NextResponse.json(
      {
        error:
          "Штрихкод должен быть корректным EAN-13: 13 цифр с верной контрольной суммой",
      },
      { status: 400 }
    );
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "1000") || 1000, 1),
      5000
    );

    const products = await getProducts({});
    const slim = products.slice(0, limit).map((p) => ({
      id: p.id,
      name: p.name,
    }));

    return NextResponse.json({ products: slim });
  } catch (error) {
    console.error("Admin get products error:", error);
    return NextResponse.json(
      { error: "Ошибка сервера при получении товаров" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json(
        { error: "Название товара обязательно" },
        { status: 400 }
      );
    }

    const bcErr = barcodeErrorResponse(body);
    if (bcErr) return bcErr;
    // Нормализуем: без пробелов; пустое → генерируем на сервере.
    if (typeof body.barcode === "string") {
      body.barcode = body.barcode.replace(/\s+/g, "") || null;
    }

    const result = await createProduct(body);
    revalidateTag("products", { expire: 0 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Create product error:", error);
    const resp = barcodeErrorResponse(null, error);
    if (resp) return resp;
    const detail =
      (error as any)?.message && String((error as any).message).slice(0, 300);
    return NextResponse.json(
      {
        error: detail
          ? `Не удалось создать товар: ${detail}`
          : "Ошибка сервера при создании товара",
      },
      { status: 500 }
    );
  }
}