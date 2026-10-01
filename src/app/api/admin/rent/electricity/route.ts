// GET/POST /api/admin/rent/electricity — чтение и пакетное сохранение показаний счётчиков ЭЭ
import { NextRequest, NextResponse } from "next/server";
import { requireRentRead, requireRentEdit } from "../helpers";
import {
  getRentMeterReadings,
  bulkUpsertRentMeterReadings,
  type RentMeterReadingInput,
} from "@/lib/rent";
import { logAdminAction } from "@/lib/activity-log";

export async function GET(request: NextRequest) {
  const auth = await requireRentRead();
  if (auth instanceof NextResponse) return auth;
  try {
    const period = request.nextUrl.searchParams.get("period") || undefined;
    const readings = await getRentMeterReadings(period);
    return NextResponse.json({ readings });
  } catch (error: any) {
    console.error("Rent electricity GET error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRentEdit();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const rawItems: any[] = Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.readings)
        ? body.readings
        : Array.isArray(body)
          ? body
          : [body];

    const syncInvoice = body?.syncInvoice !== false;
    const updateTenantTariff = body?.updateTenantTariff !== false;

    const items: RentMeterReadingInput[] = rawItems.map((it) => ({
      id: it.id,
      tenantId: String(it.tenantId || it.tenant_id || ""),
      period: String(it.period || body?.period || ""),
      tariff:
        it.tariff != null && it.tariff !== "" ? Number(it.tariff) : undefined,
      readingStart:
        it.readingStart !== undefined
          ? it.readingStart === "" || it.readingStart == null
            ? null
            : Number(it.readingStart)
          : it.reading_start !== undefined
            ? it.reading_start === "" || it.reading_start == null
              ? null
              : Number(it.reading_start)
            : undefined,
      readingEnd:
        it.readingEnd !== undefined
          ? it.readingEnd === "" || it.readingEnd == null
            ? null
            : Number(it.readingEnd)
          : it.reading_end !== undefined
            ? it.reading_end === "" || it.reading_end == null
              ? null
              : Number(it.reading_end)
            : undefined,
      comment: it.comment,
      syncInvoice: it.syncInvoice ?? syncInvoice,
      updateTenantTariff: it.updateTenantTariff ?? updateTenantTariff,
    }));

    const result = await bulkUpsertRentMeterReadings(items);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "rent-electricity",
      items[0]?.period || "bulk",
      `Показания ЭЭ: ${result.readings.length} зап., счетов созд.: ${result.invoicesCreated}, обновл.: ${result.invoicesUpdated}`
    );
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Rent electricity POST error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
