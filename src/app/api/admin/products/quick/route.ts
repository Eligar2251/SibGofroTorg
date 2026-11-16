// =========================================================
// FILE: src/app/api/admin/products/quick/route.ts
// Быстрое создание позиции из окна поставки / заказа (как контрагенты).
//
// Название + цена + количество (+ флаг «услуга») — этого достаточно, чтобы
// провести документ. Карточка создаётся ЧЕРНОВИКОМ: без размеров, с нулевым
// остатком и выключенной публикацией на сайте — её дозаполнят позже.
// Если позиция с таким названием уже есть — новую не заводим, возвращаем
// существующую: «Резка», «резка » и «РЕЗКА» из разных документов — это одна
// и та же позиция, а три карточки потом никто не сведёт в отчёт. 
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { createProduct, getProducts } from "@/lib/supabase-queries";
import { buildQuickProduct, quickNameKey } from "@/lib/product-service";

/** Ответ пикеру: строка PickerProduct (src/components/admin/ProductPicker.tsx). */
function pickerRow(row: {
  id: string;
  name: string;
  sku?: string | null;
  price?: number | null;
  priceWholesale?: number | null;
  purchasePrice?: number | null;
  stockQty?: number | null;
  isService?: boolean | null;
}) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku ?? null,
    price: row.price ?? null,
    priceWholesale: row.priceWholesale ?? null,
    purchasePrice: row.purchasePrice ?? null,
    stockQty: row.isService ? 0 : Number(row.stockQty ?? 0),
    isService: row.isService === true,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const { payload, error } = buildQuickProduct(body || {});
    if (error) return NextResponse.json({ error }, { status: 400 });

    const all = await getProducts({ includeHidden: true }).catch(() => []);
    const key = quickNameKey(payload.name);
    const existing = all.find((p: any) => quickNameKey(p.name) === key);
    if (existing) {
      return NextResponse.json({
        ...pickerRow(existing as any),
        reused: true,
      });
    }

    const created = await createProduct({
      name: payload.name,
      price: payload.price,
      // Услуга — не складской товар: остаток нулевой и не публикуем.
      // Для товара ровно так же: приход появится строкой поставки, иначе
      // количество посчитали бы дважды.
      isService: payload.isService,
      isVisible: false,
      stockQty: 0,
      note: payload.note,
      isPromo: false,
      isFeatured: false,
      madeToOrder: false,
      isCuttable: false,
    });

    const fresh = (await getProducts({ includeHidden: true }).catch(() => [])) as any[];
    const row = fresh.find((p) => p.id === created.id);

    return NextResponse.json({
      ...pickerRow(
        row ?? {
          id: created.id,
          name: payload.name,
          price: payload.price,
          stockQty: 0,
          isService: payload.isService,
        }
      ),
      reused: false,
    });
  } catch (error: any) {
    console.error("Quick product create error:", error);
    const detail = error?.message ? String(error.message).slice(0, 300) : "";
    return NextResponse.json(
      {
        error: detail
          ? `Не удалось создать позицию: ${detail}`
          : "Ошибка сервера при создании позиции",
      },
      { status: 500 }
    );
  }
}
