// =========================================================
// FILE: src/app/api/admin/products/[id]/color-twin/route.ts
// Создаёт связанную карточку-дубликат противоположного цвета
// («Лоток № 60 бурый» ↔ «Лоток № 60 белый») для уже существующего товара
// и сразу объединяет их в одну связку карточек (как на Ozon).
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import {
  createProduct,
  getProductByIdForAdmin,
  invalidateProductsCache,
  updateProduct,
} from "@/lib/supabase-queries";
import {
  getProductLinkGroupForProduct,
  saveProductLinkForProduct,
} from "@/lib/product-links-store";
import {
  buildColorTwinMaterial,
  buildColorTwinName,
  buildColorTwinSku,
  detectCardboardColor,
  ensureColorInName,
  resolveColorTwinMeta,
} from "@/lib/product-color-twin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const source = await getProductByIdForAdmin(id);
    if (!source) {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const meta = resolveColorTwinMeta(source.name, source.material);

    // Если в существующем товаре цвет не был указан в названии — по умолчанию
    // уточняем его (например «Лоток № 60» → «Лоток № 60 бурый»).
    let sourceName = source.name;
    if (
      body?.ensurePrimaryColorWord !== false &&
      detectCardboardColor(source.name, null) === null
    ) {
      sourceName = ensureColorInName(source.name, meta.sourceColor);
      if (sourceName !== source.name) {
        await updateProduct(source.id, { name: sourceName });
      }
    }

    const twinName =
      (typeof body?.twinName === "string" && body.twinName.trim()) ||
      buildColorTwinName(sourceName, meta.targetColor);
    const twinSku =
      body?.twinSku !== undefined
        ? String(body.twinSku || "").trim() || null
        : buildColorTwinSku(source.sku, meta.targetColor);
    const twinPrice =
      body?.twinPrice !== undefined &&
      body?.twinPrice !== null &&
      String(body.twinPrice).trim() !== ""
        ? Number(body.twinPrice)
        : source.price;

    const createdTwin = await createProduct({
      name: twinName,
      categoryId: source.categoryId,
      sku: twinSku,
      barcode: null,
      description: source.description,
      price: Number.isFinite(twinPrice) ? twinPrice : source.price,
      priceWholesale: source.priceWholesale,
      purchasePrice: source.purchasePrice ?? null,
      minWholesaleQty: source.minWholesaleQty,
      dimensionLength: source.dimensionLength,
      dimensionWidth: source.dimensionWidth,
      dimensionHeight: source.dimensionHeight,
      dimensionUnit: source.dimensionUnit,
      dimensionProfileId: source.dimensionProfileId ?? null,
      dimensionValues: source.dimensionValues ?? null,
      weight: source.weight,
      material: buildColorTwinMaterial(source.material, meta.targetColor),
      packQty: source.packQty,
      note: source.note,
      stockQty: 0,
      stockWarnQty: source.stockWarnQty ?? null,
      isPromo: source.isPromo,
      promoLabel: source.promoLabel,
      promoLabelColor: source.promoLabelColor,
      promoLabelTextColor: source.promoLabelTextColor,
      tags: source.tags,
      madeToOrder: source.madeToOrder,
      madeToOrderMinQty: source.madeToOrderMinQty,
      isCuttable: source.isCuttable,
      cutMetersPerRoll: source.cutMetersPerRoll,
      cutPricePerMeter: source.cutPricePerMeter,
      cutUnitName: source.cutUnitName,
      discountType: source.discountType,
      discountValue: source.discountValue,
      discountBadge: source.discountBadge,
      isVisible: source.isVisible,
      isFeatured: false,
      isSale: source.isSale ?? false,
      images: source.images,
      imageUrl: source.imageUrl,
    });

    const existingGroup = await getProductLinkGroupForProduct(source.id);
    const existingIds = existingGroup ? existingGroup.productIds : [source.id];
    const mergedIds = [
      ...existingIds.filter((pid) => pid !== createdTwin.id),
      createdTwin.id,
    ];
    const labels: Record<string, string> = {
      ...(existingGroup?.labels || {}),
    };
    if (!labels[source.id]) labels[source.id] = meta.sourceLabel;
    labels[createdTwin.id] = meta.targetLabel;

    await saveProductLinkForProduct(source.id, {
      linkedProductIds: mergedIds,
      primaryProductId: existingGroup?.primaryProductId || source.id,
      labels,
      groupTitle: existingGroup?.groupTitle || "Цвет",
    });

    invalidateProductsCache();
    revalidateTag("product-links", { expire: 0 });
    revalidateTag("products", { expire: 0 });

    return NextResponse.json({
      ok: true,
      twinId: createdTwin.id,
      twinName,
    });
  } catch (error: any) {
    console.error("[products/color-twin POST]", error);
    return NextResponse.json(
      { error: error?.message || "Не удалось создать парный вариант" },
      { status: 500 },
    );
  }
}
