import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { setWarehouseStock } from "@/lib/warehouse";

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
