// =========================================================
// FILE: src/app/api/admin/products/prices/bulk/route.ts
// Массовое сохранение цен (админка → «Массовые цены»).
//
// Принимает { rows: [{ id, price, purchasePrice?, clearDiscount? }] }.
// Пишет только то, что пришло: у строки без purchasePrice закупочная цена
// не трогается, у строки без clearDiscount остаётся её скидка.
//
// Почему отдельный маршрут, а не /api/admin/products/bulk: тот принимает
// произвольные поля товара и рассчитан на редактор карточек. Здесь же
// узкая и проверяемая операция «поменять цены у списка товаров», с отчётом
// по каждой строке и записью в журнал действий.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { invalidateProductsCache } from "@/lib/supabase-queries";
import { logActivity } from "@/lib/activity-log";
import { clientIp } from "@/lib/rate-limit";
import { round2 } from "@/lib/price-calc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Предохранитель: одна операция — не больше 2000 товаров. */
const MAX_ROWS = 2000;

type Row = {
  id: string;
  price: number;
  purchasePrice?: number | null;
  clearDiscount?: boolean;
};

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

/** Число из поля запроса: пустое значение и мусор → null (а не 0!). */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseRow(raw: unknown, index: number): Row | { error: string } {
  if (!raw || typeof raw !== "object") {
    return { error: `Строка ${index + 1}: ожидается объект` };
  }
  const item = raw as Record<string, unknown>;
  const id = String(item.id ?? "").trim();
  if (!id) return { error: `Строка ${index + 1}: не указан товар` };

  // Цена обязательна: пустая строка и «дорого» — разные сообщения, но
  // обе отклоняются до записи, чтобы в товар не попал 0 ₽ по ошибке.
  const priceValue = numberOrNull(item.price);
  if (priceValue === null) {
    return { error: `Товар ${id}: укажите цену числом` };
  }
  if (priceValue < 0) {
    return { error: `Товар ${id}: цена должна быть числом от 0` };
  }

  const row: Row = { id, price: round2(priceValue) };

  if (item.purchasePrice !== undefined) {
    if (item.purchasePrice === null || item.purchasePrice === "") {
      row.purchasePrice = null;
    } else {
      const cost = numberOrNull(item.purchasePrice);
      if (cost === null || cost < 0) {
        return { error: `Товар ${id}: закупочная цена должна быть числом от 0` };
      }
      row.purchasePrice = round2(cost);
    }
  }

  if (item.clearDiscount === true) row.clearDiscount = true;

  return row;
}

/** Колонки закупки/скидки добавлены миграциями и могут отсутствовать. */
function isMissingOptionalColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("unknown column")
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  let body: { rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "Ожидается JSON" }, 400);
  }

  const rawRows = Array.isArray(body.rows) ? body.rows : null;
  if (!rawRows || rawRows.length === 0) {
    return noStoreJson({ error: "Нет товаров для сохранения" }, 400);
  }
  if (rawRows.length > MAX_ROWS) {
    return noStoreJson(
      { error: `За раз можно сохранить не больше ${MAX_ROWS} товаров (сейчас ${rawRows.length})` },
      413
    );
  }

  const rows: Row[] = [];
  for (let index = 0; index < rawRows.length; index += 1) {
    const parsed = parseRow(rawRows[index], index);
    if ("error" in parsed) {
      return noStoreJson({ error: parsed.error }, 400);
    }
    rows.push(parsed);
  }

  const db = getAdminDb();
  const failed: { id: string; error: string }[] = [];
  let updated = 0;
  let purchaseUpdated = 0;
  let discountsCleared = 0;
  const updatedAt = new Date().toISOString();

  const updateOne = async (row: Row) => {
    const payload: Record<string, unknown> = {
      price: row.price,
      updated_at: updatedAt,
    };
    if (row.purchasePrice !== undefined) payload.purchase_price = row.purchasePrice;
    if (row.clearDiscount) {
      payload.discount_type = null;
      payload.discount_value = null;
    }

    // .select("id") — чтобы точно знать, сколько строк обновилось:
    // товар мог быть удалён в другой вкладке, и тогда честнее сказать
    // «не найден», чем отчитаться об успешном сохранении.
    let { data, error } = await db
      .from("products")
      .update(payload)
      .eq("id", row.id)
      .select("id");

    // База без миграции закупочных цен: сохраняем цену и скидку без неё.
    if (error && row.purchasePrice !== undefined && isMissingOptionalColumn(error)) {
      delete payload.purchase_price;
      ({ data, error } = await db
        .from("products")
        .update(payload)
        .eq("id", row.id)
        .select("id"));
    }

    if (error) {
      console.error("Bulk price update error:", error);
      failed.push({ id: row.id, error: String(error.message || "не удалось сохранить") });
      return;
    }

    if (Array.isArray(data) && data.length === 0) {
      failed.push({ id: row.id, error: "товар не найден (возможно, удалён)" });
      return;
    }

    updated += 1;
    if (row.purchasePrice !== undefined) purchaseUpdated += 1;
    if (row.clearDiscount) discountsCleared += 1;
  };

  // Пачки по 10 — как в остальных массовых операциях: быстро, но без
  // пиковой нагрузки на базу.
  const batchSize = 10;
  for (let index = 0; index < rows.length; index += batchSize) {
    await Promise.all(rows.slice(index, index + batchSize).map(updateOne));
  }

  // Цены уже в базе: сброс кеша — важная, но не обязательная часть.
  // Если он не удался (например, обработчик вызвали вне контекста
  // запроса), сохранение всё равно считаем успешным.
  invalidateProductsCache();
  try {
    revalidateTag("products", { expire: 0 });
  } catch (error) {
    console.warn("Не удалось сбросить кеш товаров:", error);
  }

  await logActivity({
    adminName: auth.displayName || auth.username,
    adminRole: auth.role,
    action: "bulk_update",
    entityType: "product",
    entityId: "prices",
    entityLabel: `Массовое изменение цен: ${updated} товаров`,
    details: {
      rows: rows.length,
      updated,
      purchaseUpdated,
      discountsCleared,
      failed: failed.length,
      // Для разбора «кто и какие цены поставил» — первые 50 строк.
      sample: rows.slice(0, 50).map((row) => ({
        id: row.id,
        price: row.price,
        purchasePrice: row.purchasePrice,
      })),
    },
    ipAddress: clientIp(request),
  });

  return noStoreJson({
    success: failed.length === 0,
    updated,
    purchaseUpdated,
    discountsCleared,
    failed,
  });
}
