import { NextRequest, NextResponse } from "next/server";
import { importHistoricalDeals } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

// Массовая загрузка старых проведённых заказов контрагентов (архив).
// Заказы создаются со статусом «completed» и пометкой is_archive:
// склад и банк не затрагиваются, суммы попадают в отчёты и прогноз.
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const result = await importHistoricalDeals({
      customerName: String(body.customerName || ""),
      rows: Array.isArray(body.rows)
        ? body.rows.map((row: any) => ({
            date: row.date ?? null,
            productId: row.productId ?? null,
            name: row.name ?? null,
            sku: row.sku ?? null,
            quantity: Number(row.quantity) || 0,
            price: Number(row.price) || 0,
          }))
        : [],
      comment: body.comment ?? null,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Import historical deals error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
