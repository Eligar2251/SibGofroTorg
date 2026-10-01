// PUT/PATCH/DELETE /api/admin/rent/electricity/[id] — редактирование и удаление одной записи показаний
import { NextRequest, NextResponse } from "next/server";
import { requireRentEdit } from "../../helpers";
import {
  updateRentMeterReadingById,
  deleteRentMeterReading,
} from "@/lib/rent";
import { logAdminAction } from "@/lib/activity-log";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRentEdit();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const reading = await updateRentMeterReadingById(id, {
      tenantId: body.tenantId || body.tenant_id,
      period: body.period,
      tariff:
        body.tariff !== undefined && body.tariff !== ""
          ? Number(body.tariff)
          : undefined,
      readingStart:
        body.readingStart !== undefined
          ? body.readingStart === "" || body.readingStart == null
            ? null
            : Number(body.readingStart)
          : body.reading_start !== undefined
            ? body.reading_start === "" || body.reading_start == null
              ? null
              : Number(body.reading_start)
            : undefined,
      readingEnd:
        body.readingEnd !== undefined
          ? body.readingEnd === "" || body.readingEnd == null
            ? null
            : Number(body.readingEnd)
          : body.reading_end !== undefined
            ? body.reading_end === "" || body.reading_end == null
              ? null
              : Number(body.reading_end)
            : undefined,
      comment: body.comment,
      updateTenantTariff: body.updateTenantTariff,
      syncInvoice: body.syncInvoice,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "rent-electricity",
      id,
      `Показание ЭЭ за ${reading.period}`
    );
    return NextResponse.json({ reading });
  } catch (error: any) {
    console.error("Rent electricity PATCH error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return PATCH(request, ctx);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRentEdit();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteRentMeterReading(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "rent-electricity",
      id,
      "Удалено показание ЭЭ"
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Rent electricity DELETE error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
