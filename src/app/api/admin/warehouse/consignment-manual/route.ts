// =========================================================
// FILE: src/app/api/admin/warehouse/consignment-manual/route.ts
// Ручные продажи товара на реализации: одна запись на пару
// (поставка + товар), количество добавляется к автоматически
// посчитанным по отгрузкам продажам.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  return null;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const db = getAdminDb();
    const { data, error } = await db
      .from("consignment_manual_sales")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) {
      // До применения миграции таблицы нет — отдаём пусто, а не ошибку.
      if (String(error.message).includes("does not exist")) {
        return NextResponse.json({ rows: [] });
      }
      throw error;
    }
    const rows = (data || []).map((row: any) => ({
      id: row.id,
      receiptId: row.receipt_id,
      productId: row.product_id,
      productName: row.product_name || "",
      quantity: Number(row.quantity || 0),
      comment: row.comment ?? null,
      updatedAt: toIso(row.updated_at),
    }));
    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Consignment manual GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const receiptId = String(body.receiptId || "").trim();
    const productId = String(body.productId || "").trim();
    const productName = String(body.productName || "").trim();
    const quantity = Math.max(0, Number(body.quantity) || 0);

    if (!receiptId || !productId) {
      return NextResponse.json(
        { error: "Не указаны поставка или товар" },
        { status: 400 }
      );
    }

    const db = getAdminDb();

    // Ноль = сброс ручной продажи: убираем запись целиком.
    if (quantity === 0) {
      const { error } = await db
        .from("consignment_manual_sales")
        .delete()
        .eq("receipt_id", receiptId)
        .eq("product_id", productId);
      if (error) throw error;
      await logAdminAction(
        auth.displayName, auth.role, "update", "receipt", receiptId,
        `Сброс ручной продажи товара на реализации (ПО → ${receiptId.slice(0, 8)})`,
        { receiptId, productId }
      );
      return NextResponse.json({ success: true, quantity: 0 });
    }

    const { data, error } = await db
      .from("consignment_manual_sales")
      .upsert(
        {
          receipt_id: receiptId,
          product_id: productId,
          product_name: productName,
          quantity,
          comment: body.comment ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "receipt_id,product_id" }
      )
      .select()
      .single();
    if (error) throw error;

    await logAdminAction(
      auth.displayName, auth.role, "update", "receipt", receiptId,
      `Ручная продажа товара на реализации: ${quantity} шт (ПО → ${receiptId.slice(0, 8)})`,
      { receiptId, productId, quantity }
    );

    return NextResponse.json({
      success: true,
      row: {
        id: data.id,
        receiptId: data.receipt_id,
        productId: data.product_id,
        productName: data.product_name || "",
        quantity: Number(data.quantity || 0),
        comment: data.comment ?? null,
        updatedAt: toIso(data.updated_at),
      },
    });
  } catch (error) {
    console.error("Consignment manual POST error:", error);
    const message = error instanceof Error ? error.message : "Ошибка сервера";
    // Таблица ещё не создана — подсказываем применить миграцию.
    if (message.includes("does not exist")) {
      return NextResponse.json(
        { error: "Нет таблицы consignment_manual_sales — примените миграцию supabase/migration_consignment_manual.sql" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
