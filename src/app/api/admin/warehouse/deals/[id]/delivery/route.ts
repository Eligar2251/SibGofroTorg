// src/app/api/admin/warehouse/deals/[id]/delivery/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { updateDealDelivery } from "@/lib/warehouse";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const db = getAdminDb();
    const { data: existing } = await db
      .from("customer_deals")
      .select("id, has_delivery, delivery_address, delivery_type, delivery_cost, delivery_planned_date, delivery_note")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    const body = await request.json();
    const action = typeof body.action === "string" ? body.action : null;

    if (action === "set_free") {
      const address =
        body.deliveryAddress != null
          ? String(body.deliveryAddress).trim()
          : existing.delivery_address;
      if (!address) {
        return NextResponse.json(
          { error: "Укажите адрес доставки" },
          { status: 400 }
        );
      }
      const deal = await updateDealDelivery(id, {
        hasDelivery: true,
        deliveryType: "free",
        deliveryCost: 0,
        deliveryAddress: address,
        deliveryPlannedDate:
          body.deliveryPlannedDate !== undefined
            ? body.deliveryPlannedDate || null
            : existing.delivery_planned_date ?? null,
        deliveryNote:
          body.deliveryNote !== undefined
            ? body.deliveryNote
            : existing.delivery_note ?? null,
      });
      return NextResponse.json({ success: true, deal });
    }

    if (action === "set_paid") {
      const cost = Math.max(0, Number(body.deliveryCost) || 0);
      if (cost <= 0) {
        return NextResponse.json(
          { error: "Укажите сумму платной доставки" },
          { status: 400 }
        );
      }
      const address =
        body.deliveryAddress != null
          ? String(body.deliveryAddress).trim()
          : existing.delivery_address;
      if (!address) {
        return NextResponse.json(
          { error: "Укажите адрес доставки" },
          { status: 400 }
        );
      }
      const deal = await updateDealDelivery(id, {
        hasDelivery: true,
        deliveryType: "paid",
        deliveryCost: cost,
        deliveryAddress: address,
        deliveryPlannedDate:
          body.deliveryPlannedDate !== undefined
            ? body.deliveryPlannedDate || null
            : existing.delivery_planned_date ?? null,
        deliveryNote:
          body.deliveryNote !== undefined
            ? body.deliveryNote
            : existing.delivery_note ?? null,
      });
      return NextResponse.json({ success: true, deal });
    }

    if (action === "remove") {
      const deal = await updateDealDelivery(id, { hasDelivery: false });
      return NextResponse.json({ success: true, deal });
    }

    if (action === "release") {
      if (!existing.has_delivery) {
        return NextResponse.json(
          { error: "У заказа нет доставки" },
          { status: 400 }
        );
      }
      const deal = await updateDealDelivery(id, {
        deliveryReleasedAt: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, deal });
    }

    if (action === "unrelease") {
      const deal = await updateDealDelivery(id, { clearRelease: true });
      return NextResponse.json({ success: true, deal });
    }

    if (action === "plan") {
      const date =
        body.deliveryPlannedDate != null
          ? String(body.deliveryPlannedDate).trim() || null
          : null;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json(
          { error: "Дата в формате YYYY-MM-DD" },
          { status: 400 }
        );
      }
      if (!existing.has_delivery) {
        return NextResponse.json(
          { error: "Сначала отметьте доставку у заказа" },
          { status: 400 }
        );
      }
      const deal = await updateDealDelivery(id, {
        deliveryPlannedDate: date,
      });
      return NextResponse.json({ success: true, deal });
    }

    // Полный патч
    const patch: Parameters<typeof updateDealDelivery>[1] = {};
    if (body.hasDelivery !== undefined) patch.hasDelivery = Boolean(body.hasDelivery);
    if (body.deliveryType !== undefined) {
      if (
        body.deliveryType === "free" ||
        body.deliveryType === "paid" ||
        body.deliveryType === null
      ) {
        patch.deliveryType = body.deliveryType;
      }
    }
    if (body.deliveryCost !== undefined) {
      patch.deliveryCost =
        body.deliveryCost == null
          ? 0
          : Math.max(0, Number(body.deliveryCost) || 0);
    }
    if (body.deliveryAddress !== undefined) {
      patch.deliveryAddress =
        body.deliveryAddress == null
          ? null
          : String(body.deliveryAddress).trim().slice(0, 400);
    }
    if (body.deliveryPlannedDate !== undefined) {
      const d =
        body.deliveryPlannedDate == null
          ? null
          : String(body.deliveryPlannedDate).trim() || null;
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return NextResponse.json(
          { error: "Дата в формате YYYY-MM-DD" },
          { status: 400 }
        );
      }
      patch.deliveryPlannedDate = d;
    }
    if (body.deliveryNote !== undefined) {
      patch.deliveryNote =
        body.deliveryNote == null
          ? null
          : String(body.deliveryNote).trim().slice(0, 1000);
    }
    if (body.deliveryReleasedAt === null) patch.clearRelease = true;
    else if (body.deliveryReleasedAt !== undefined) {
      patch.deliveryReleasedAt = body.deliveryReleasedAt
        ? String(body.deliveryReleasedAt)
        : null;
    }

    const deal = await updateDealDelivery(id, patch);
    return NextResponse.json({ success: true, deal });
  } catch (error) {
    console.error("Update deal delivery error:", error);
    const msg = error instanceof Error ? error.message : "Ошибка сервера";
    if (/column|does not exist|schema cache/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "Поля доставки заказов учёта ещё не в БД. Выполните supabase/migration_deal_delivery_vat.sql",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
