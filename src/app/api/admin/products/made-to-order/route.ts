import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { invalidateProductsCache } from "@/lib/supabase-queries";

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { products } = body as {
      products: { id: string; madeToOrderMinQty?: number | null }[];
    };

    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json({ error: "Нет данных" }, { status: 400 });
    }

    const db = getAdminDb();

    for (const p of products) {
      if (!p.id) continue;
      const val =
        p.madeToOrderMinQty == null || p.madeToOrderMinQty === ("" as any)
          ? null
          : Math.max(1, Math.floor(Number(p.madeToOrderMinQty) || 0)) || null;

      // Проверяем существование товара и что он действительно под заказ
      const payload: Record<string, any> = {
        made_to_order_min_qty: val,
        updated_at: new Date().toISOString(),
      };

      const { error } = await db.from("products").update(payload).eq("id", p.id);
      if (error) {
        // Если колонки ещё нет в БД — пробуем без неё и даём понятную ошибку
        const msg = String(error.message || "").toLowerCase();
        if (msg.includes("made_to_order_min_qty")) {
          return NextResponse.json(
            {
              error:
                "В БД ещё нет колонки made_to_order_min_qty. Выполните миграцию supabase/migration_made_to_order_min_qty.sql",
            },
            { status: 400 }
          );
        }
        throw error;
      }
    }

    invalidateProductsCache();
    revalidateTag("products", { expire: 0 });

    return NextResponse.json({ success: true, updated: products.length });
  } catch (error) {
    console.error("Made-to-order bulk update error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
