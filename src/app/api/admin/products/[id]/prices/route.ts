// =========================================================
// FILE: src/app/api/admin/products/[id]/prices/route.ts
// Быстрая правка закупочной и/или продажной цены товара прямо
// из таблицы «Учёт → Склад». Принимает { price?, purchasePrice? };
// отсутствующее поле не трогается.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { revalidateTag } from "next/cache";

function parsePrice(value: unknown): number | null | undefined {
  // undefined — поле не присылали, не меняем.
  if (value === undefined) return undefined;
  // null / пустая строка — очистить (только для закупочной).
  if (value === null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();

    const payload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.price !== undefined) {
      const price = parsePrice(body.price);
      if (price === null) {
        return NextResponse.json(
          { error: "Цена продажи должна быть числом от 0" },
          { status: 400 }
        );
      }
      payload.price = price;
    }

    if (body.purchasePrice !== undefined) {
      const purchasePrice = parsePrice(body.purchasePrice);
      if (purchasePrice === null && body.purchasePrice !== null && body.purchasePrice !== "") {
        return NextResponse.json(
          { error: "Закупочная цена должна быть числом от 0" },
          { status: 400 }
        );
      }
      payload.purchase_price = purchasePrice;
    }

    if (Object.keys(payload).length <= 1) {
      return NextResponse.json(
        { error: "Не передано ни одного поля для обновления" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const { error } = await db.from("products").update(payload).eq("id", id);
    if (error) {
      if (String(error.message || "").toLowerCase().includes("purchase_price")) {
        return NextResponse.json(
          { error: "Колонка purchase_price не создана. Выполните миграцию supabase/migration_purchase_price.sql" },
          { status: 500 }
        );
      }
      throw error;
    }

    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("product prices PATCH error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка" },
      { status: 500 }
    );
  }
}
