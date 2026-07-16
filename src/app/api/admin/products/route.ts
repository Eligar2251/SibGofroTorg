// =========================================================
// FILE: src/app/api/admin/products/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { createProduct } from "@/lib/firestore-queries";
import { requireAdminApi } from "@/lib/auth";

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

    const result = await createProduct(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Create product error:", error);
    return NextResponse.json(
      { error: "Ошибка сервера при создании товара" },
      { status: 500 }
    );
  }
}