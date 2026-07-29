import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getProductStockSummary, setWarehouseStock } from "@/lib/warehouse";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const summary = await getProductStockSummary(id);
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Product stock summary error:", error);
    const message = error instanceof Error ? error.message : "Не удалось загрузить сводку";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
    const quantity = Number(body.stockQty);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return NextResponse.json(
        { error: "Остаток должен быть числом от 0" },
        { status: 400 }
      );
    }
    await setWarehouseStock(id, quantity);
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true, stockQty: Math.floor(quantity) });
  } catch (error) {
    console.error("Update stock error:", error);
    return NextResponse.json({ error: "Не удалось изменить остаток" }, { status: 500 });
  }
}
