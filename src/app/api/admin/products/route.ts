// =========================================================
// FILE: src/app/api/admin/products/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { createProduct, getProducts } from "@/lib/firestore-queries";
import { requireAdminApi } from "@/lib/auth";

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