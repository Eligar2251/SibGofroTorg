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

    for (const p of products) {
      if (!p.id) continue;
      const { id: _id, ...rest } = p;
      const payload: Record<string, any> = { updated_at: new Date().toISOString() };
      for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
        if (rest[jsKey] !== undefined) payload[dbKey] = rest[jsKey];
      }
      // Фото: приводим массив к виду [{url, publicId}] (могут
      // приехать старые строки-ссылки) и не даём затереть главное
      // фото, если imageUrl не передан, а images — непустой.
      if (rest.images !== undefined) {
        payload.images = normalizeProductImages(rest.images);
      }
      if (rest.imageUrl !== undefined) {
        payload.image_url =
          rest.imageUrl ||
          firstImageUrl(normalizeProductImages(rest.images)) ||
          null;
      }
      await db.from("products").update(payload).eq("id", p.id);
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

    const db = getAdminDb();
    for (const id of ids) {
      if (!id) continue;
      await db.from("products").delete().eq("id", id);
    }

    invalidateProductsCache();
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (error) {
    console.error("Bulk delete error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
