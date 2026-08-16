// src/app/api/admin/products/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import {
  invalidateProductsCache,
  normalizeProductImages,
  firstImageUrl,
} from "@/lib/supabase-queries";

/** Фотографии не входят в тяжёлую начальную загрузку редактора. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    if (body?.action !== "load-images" || !Array.isArray(body.ids)) {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }
    const ids = [...new Set(body.ids.map((id: unknown) => String(id || "")).filter(Boolean))].slice(0, 1000);
    if (ids.length === 0) return NextResponse.json({ products: [] });

    const db = getAdminDb();
    const { data, error } = await db
      .from("products")
      .select("id,images,image_url")
      .in("id", ids);
    if (error) throw error;

    return NextResponse.json({
      products: (data || []).map((row) => {
        const images = normalizeProductImages(row.images);
        return {
          id: row.id,
          images,
          imageUrl: row.image_url || firstImageUrl(images) || null,
        };
      }),
    });
  } catch (error) {
    console.error("Bulk images load error:", error);
    return NextResponse.json({ error: "Не удалось загрузить фотографии" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { products } = body as {
      products: { id: string; [key: string]: any }[];
    };

    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json({ error: "Нет данных" }, { status: 400 });
    }

    const db = getAdminDb();
    const fieldMap: Record<string, string> = {
      name: "name", price: "price", priceWholesale: "price_wholesale",
      minWholesaleQty: "min_wholesale_qty", dimensionLength: "dimension_length",
      dimensionWidth: "dimension_width", dimensionHeight: "dimension_height",
      dimensionUnit: "dimension_unit", weight: "weight", material: "material",
      packQty: "pack_qty", volume: "volume", note: "note",
      stockQty: "stock_qty", inStock: "in_stock", isVisible: "is_visible",
      isPromo: "is_promo", isFeatured: "is_featured", categoryId: "category_id",
      sku: "sku", promoLabel: "promo_label",
      madeToOrder: "made_to_order", madeToOrderMinQty: "made_to_order_min_qty",
      isCuttable: "is_cuttable", cutMetersPerRoll: "cut_meters_per_roll", cutPricePerMeter: "cut_price_per_meter", cutUnitName: "cut_unit_name",
      images: "images", imageUrl: "image_url",
    };

    const updateOne = async (p: { id: string; [key: string]: any }) => {
      if (!p.id) return;
      const { id: _id, ...rest } = p;
      const payload: Record<string, any> = { updated_at: new Date().toISOString() };
      for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
        if (rest[jsKey] !== undefined) payload[dbKey] = rest[jsKey];
      }
      if ("category_id" in payload && !payload.category_id) {
        payload.category_id = null;
      }
      // Фото загружаются лениво только на третьем шаге. Если они ещё
      // не загружены, ключа images нет и существующие фото не затрагиваются.
      if (rest.images !== undefined) {
        payload.images = normalizeProductImages(rest.images);
      }
      if (rest.imageUrl !== undefined) {
        payload.image_url =
          rest.imageUrl ||
          firstImageUrl(normalizeProductImages(rest.images)) ||
          null;
      }
      const { error } = await db.from("products").update(payload).eq("id", p.id);
      if (error) throw error;
    };

    // Раньше каждый товар ждал предыдущего. Небольшие параллельные
    // пачки заметно ускоряют сохранение и не создают пиковую нагрузку.
    const batchSize = 10;
    for (let index = 0; index < products.length; index += batchSize) {
      await Promise.all(products.slice(index, index + batchSize).map(updateOne));
    }

    invalidateProductsCache();
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true, updated: products.length });
  } catch (error) {
    console.error("Bulk update error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { ids } = body as { ids: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "Нет ID товаров для удаления" }, { status: 400 });
    }

    const cleanIds = [...new Set(ids.map((id) => String(id || "")).filter(Boolean))];
    if (cleanIds.length === 0) {
      return NextResponse.json({ error: "Нет ID товаров для удаления" }, { status: 400 });
    }
    const db = getAdminDb();
    const { error } = await db.from("products").delete().in("id", cleanIds);
    if (error) throw error;

    invalidateProductsCache();
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true, deleted: cleanIds.length });
  } catch (error) {
    console.error("Bulk delete error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
