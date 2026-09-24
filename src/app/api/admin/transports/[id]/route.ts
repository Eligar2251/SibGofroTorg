// src/app/api/admin/transports/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { updateTransport, completeTransport, deleteTransport, archiveTransport } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.action === "complete") {
      // Фактические количества по поставкам (ПО-): диспетчер может указать
      // их при завершении рейса — «приняли меньше», остаток останется
      // в поставке. Без них принимаем столько, сколько стоит в точках рейса.
      // То же для заказов (ЗК-): списываем ровно вписанное число, недогруз
      // остаётся в заказе и едет следующим рейсом.
      const toQtyRows = (rows: any) =>
        Array.isArray(rows)
          ? rows.map((row: any) => ({
              id: String(row?.receiptId || row?.dealId || ""),
              items: (Array.isArray(row?.items) ? row.items : []).map((item: any) => ({
                productId: String(item?.productId || ""),
                quantity: Number(item?.quantity) || 0,
              })),
            }))
          : [];
      const receiptRows = toQtyRows(body.receipts);
      const dealRows = toQtyRows(body.deals);
      await completeTransport(id, {
        receipts: Array.isArray(body.receipts)
          ? receiptRows.map((row) => ({ receiptId: row.id, items: row.items }))
          : undefined,
        deals: Array.isArray(body.deals)
          ? dealRows.map((row) => ({ dealId: row.id, items: row.items }))
          : undefined,
      });
    } else if (body.action === "archive") {
      await archiveTransport(id);
    } else {
      await updateTransport(id, body);
    }
    revalidateTag("warehouse-deals", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Transport PATCH error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteTransport(id);
    revalidateTag("warehouse-deals", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Transport DELETE error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка" }, { status: 400 });
  }
}
