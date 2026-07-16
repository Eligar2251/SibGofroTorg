// src/app/api/admin/products/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { products } = body as {
      products: {
        id: string;
        name?: string;
        price?: number | null;
        priceWholesale?: number | null;
        minWholesaleQty?: number | null;
        stockQty?: number | null;
        inStock?: boolean;
        isVisible?: boolean;
        isPromo?: boolean;
        isFeatured?: boolean;
        categoryId?: string | null;
        sku?: string | null;
      }[];
    };

    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json({ error: "Нет данных" }, { status: 400 });
    }

    const db = getAdminDb();
    const batch = db.batch();

    for (const p of products) {
      if (!p.id) continue;
      const ref = db.collection("products").doc(p.id);
      const { id: _id, ...rest } = p;
      batch.update(ref, {
        ...rest,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    return NextResponse.json({ success: true, updated: products.length });
  } catch (error) {
    console.error("Bulk update error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}