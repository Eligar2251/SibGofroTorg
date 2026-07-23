// src/app/api/admin/orders/[id]/delivery/route.ts
import { NextRequest, NextResponse } from "next/server";
import { updateOrderDelivery, getOrderById } from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const existing = await getOrderById(id);
    if (!existing) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    const body = await request.json();
    const action = typeof body.action === "string" ? body.action : null;

    // Быстрые действия
    if (action === "set_free") {
      const address =
        body.deliveryAddress != null
          ? String(body.deliveryAddress).trim()
          : existing.deliveryAddress;
      if (!address) {
        return NextResponse.json(
          { error: "Укажите адрес доставки" },
          { status: 400 }
        );
      }
      const order = await updateOrderDelivery(id, {
        hasDelivery: true,
        deliveryType: "free",
        deliveryCost: 0,
        deliveryAddress: address,
        deliveryPlannedDate:
          body.deliveryPlannedDate !== undefined
            ? body.deliveryPlannedDate || null
            : existing.deliveryPlannedDate ?? null,
        deliveryNote:
          body.deliveryNote !== undefined
            ? body.deliveryNote
            : existing.deliveryNote ?? null,
      });
      return NextResponse.json({ success: true, order });
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
          : existing.deliveryAddress;
      if (!address) {
        return NextResponse.json(
          { error: "Укажите адрес доставки" },
          { status: 400 }
        );
      }
      const order = await updateOrderDelivery(id, {
        hasDelivery: true,
        deliveryType: "paid",
        deliveryCost: cost,
        deliveryAddress: address,
        deliveryPlannedDate:
          body.deliveryPlannedDate !== undefined
            ? body.deliveryPlannedDate || null
            : existing.deliveryPlannedDate ?? null,
        deliveryNote:
          body.deliveryNote !== undefined
            ? body.deliveryNote
            : existing.deliveryNote ?? null,
      });
      return NextResponse.json({ success: true, order });
    }

    if (action === "remove") {
      const order = await updateOrderDelivery(id, { hasDelivery: false });
      return NextResponse.json({ success: true, order });
    }

    if (action === "release") {
      if (!existing.hasDelivery) {
        return NextResponse.json(
          { error: "У заказа нет доставки" },
          { status: 400 }
        );
      }
      const order = await updateOrderDelivery(id, {
        deliveryReleasedAt: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, order });
    }

    if (action === "unrelease") {
      const order = await updateOrderDelivery(id, { clearRelease: true });
      return NextResponse.json({ success: true, order });
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
      if (!existing.hasDelivery) {
        return NextResponse.json(
          { error: "Сначала отметьте доставку у заказа" },
          { status: 400 }
        );
      }
      const order = await updateOrderDelivery(id, {
        deliveryPlannedDate: date,
      });
      return NextResponse.json({ success: true, order });
    }

    // Полное обновление полей
    const patch: Parameters<typeof updateOrderDelivery>[1] = {};

    if (body.hasDelivery !== undefined) patch.hasDelivery = Boolean(body.hasDelivery);
    if (body.deliveryType !== undefined) {
      if (body.deliveryType === "free" || body.deliveryType === "paid" || body.deliveryType === null) {
        patch.deliveryType = body.deliveryType;
      }
    }
    if (body.deliveryCost !== undefined) {
      patch.deliveryCost =
        body.deliveryCost == null ? 0 : Math.max(0, Number(body.deliveryCost) || 0);
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
    if (body.deliveryReleasedAt === null) {
      patch.clearRelease = true;
    } else if (body.deliveryReleasedAt !== undefined) {
      patch.deliveryReleasedAt = body.deliveryReleasedAt
        ? String(body.deliveryReleasedAt)
        : null;
    }

    // При включении доставки адрес обязателен
    const willHave =
      patch.hasDelivery !== undefined
        ? patch.hasDelivery
        : existing.hasDelivery;
    if (willHave) {
      const addr =
        patch.deliveryAddress !== undefined
          ? patch.deliveryAddress
          : existing.deliveryAddress;
      if (!addr) {
        return NextResponse.json(
          { error: "Адрес доставки обязателен" },
          { status: 400 }
        );
      }
      if (patch.hasDelivery === true && !patch.deliveryType && !existing.deliveryType) {
        patch.deliveryType = "free";
      }
    }

    const order = await updateOrderDelivery(id, patch);
    return NextResponse.json({ success: true, order });
  } catch (error) {
    console.error("Update order delivery error:", error);
    const msg =
      error instanceof Error ? error.message : "Ошибка сервера";
    // Подсказка, если колонки ещё не добавлены
    if (/column|does not exist|schema cache/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "Поля доставки ещё не добавлены в БД. Выполните supabase/migration_deliveries.sql в SQL Editor.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
