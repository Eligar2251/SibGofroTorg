import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { revalidateTag } from "next/cache";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const price = body.purchasePrice != null ? Number(body.purchasePrice) : null;
    if (price != null && (isNaN(price) || price < 0)) {
      return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
    }
    const db = getAdminDb();
    const payload: Record<string, any> = {
      purchase_price: price,
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("products").update(payload).eq("id", id);
    if (error) {
      // колонки может не быть — пробуем без неё не падаем
      if (String(error.message || "").toLowerCase().includes("purchase_price")) {
        return NextResponse.json({ error: "Колонка purchase_price не создана. Выполните миграцию supabase/migration_purchase_price.sql" }, { status: 500 });
      }
      throw error;
    }
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("purchase-price PATCH error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status: 500 });
  }
}
