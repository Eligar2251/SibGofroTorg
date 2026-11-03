// =========================================================
// FILE: src/app/api/admin/products/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  createProduct,
  getProducts,
  invalidateProductsCache,
} from "@/lib/supabase-queries";
import { saveProductLinkForProduct } from "@/lib/product-links-store";
import { NEW_PRODUCT_LINK_TOKEN } from "@/lib/product-links";
import {
  buildColorTwinMaterial,
  buildColorTwinName,
  buildColorTwinSku,
  detectCardboardColor,
  ensureColorInName,
  resolveColorTwinMeta,
} from "@/lib/product-color-twin";
import { requireAdminApi } from "@/lib/auth";
import { isValidBarcode } from "@/lib/qr";

/** Дружелюбная реакция на битый или занятый штрихкод. */
function barcodeErrorResponse(body: any, error?: any): NextResponse | null {
  if (error) {
    // Нарушение unique-индекса products.barcode — код занят.
    if ((error as any)?.code === "23505") {
      return NextResponse.json(
        { error: "Такой штрихкод уже присвоен другому товару" },
        { status: 409 }
      );
    }
    return null;
  }
  const raw = typeof body?.barcode === "string" ? body.barcode.trim() : "";
  if (raw && !isValidBarcode(raw.replace(/\s+/g, ""))) {
    return NextResponse.json(
      {
        error:
          "Штрихкод должен быть корректным EAN-13: 13 цифр с верной контрольной суммой",
      },
      { status: 400 }
    );
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "1000") || 1000, 1),
      5000
    );

    const products = await getProducts({ includeHidden: true });
    const slim = products.slice(0, limit).map((p) => ({
      id: p.id,
      name: p.name,
    }));

    return NextResponse.json({ products: slim });
  } catch (error) {
    console.error("Admin get products error:", error);
    return NextResponse.json(
      { error: "Ошибка сервера при получении товаров" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json(
        { error: "Название товара обязательно" },
        { status: 400 }
      );
    }

    const bcErr = barcodeErrorResponse(body);
    if (bcErr) return bcErr;
    // Нормализуем: без пробелов; пустое → генерируем на сервере.
    if (typeof body.barcode === "string") {
      body.barcode = body.barcode.replace(/\s+/g, "") || null;
    }

    const twinConfig =
      body.createColorTwin &&
      typeof body.createColorTwin === "object" &&
      body.createColorTwin.enabled === true
        ? body.createColorTwin
        : null;

    const twinMeta = twinConfig
      ? resolveColorTwinMeta(body.name, body.material)
      : null;

    // Если нажата кнопка «Есть белый/бурый вариант», а в исходном названии
    // цвет ещё не был дописан («Лоток № 60»), аккуратно дописываем исходный цвет
    // («Лоток № 60 бурый»), чтобы обе связанные карточки отличались понятно.
    if (
      twinConfig &&
      twinMeta &&
      twinConfig.ensurePrimaryColorWord !== false &&
      detectCardboardColor(body.name, null) === null
    ) {
      body.name = ensureColorInName(String(body.name), twinMeta.sourceColor);
    }

    const result = await createProduct(body);

    let twinResult: { id: string; name: string } | null = null;
    if (twinConfig && twinMeta) {
      const twinName =
        (typeof twinConfig.twinName === "string" && twinConfig.twinName.trim()) ||
        buildColorTwinName(String(body.name), twinMeta.targetColor);
      const twinSku =
        twinConfig.twinSku !== undefined
          ? String(twinConfig.twinSku || "").trim() || null
          : buildColorTwinSku(body.sku, twinMeta.targetColor);
      const twinPrice =
        twinConfig.twinPrice !== undefined &&
        twinConfig.twinPrice !== null &&
        String(twinConfig.twinPrice).trim() !== ""
          ? Number(twinConfig.twinPrice)
          : body.price;

      const createdTwin = await createProduct({
        ...body,
        name: twinName,
        slug: undefined,
        sku: twinSku,
        barcode: null,
        material: buildColorTwinMaterial(body.material, twinMeta.targetColor),
        price: Number.isFinite(twinPrice) ? twinPrice : body.price,
        stockQty: 0,
        inStock: false,
        isFeatured: false,
      });
      twinResult = { id: createdTwin.id, name: twinName };

      const rawLinks =
        body.productLinks && typeof body.productLinks === "object"
          ? body.productLinks
          : {};
      const baseIds: string[] = Array.isArray(rawLinks.linkedProductIds)
        ? rawLinks.linkedProductIds.map((id: string) =>
            id === NEW_PRODUCT_LINK_TOKEN ? result.id : id,
          )
        : [];
      const mergedIds = [
        result.id,
        ...baseIds.filter((id) => id && id !== result.id && id !== createdTwin.id),
        createdTwin.id,
      ];

      const rawLabels: Record<string, string> =
        rawLinks.labels && typeof rawLinks.labels === "object"
          ? { ...rawLinks.labels }
          : {};
      if (rawLabels[NEW_PRODUCT_LINK_TOKEN]) {
        rawLabels[result.id] = rawLabels[NEW_PRODUCT_LINK_TOKEN];
        delete rawLabels[NEW_PRODUCT_LINK_TOKEN];
      }
      if (!rawLabels[result.id]) rawLabels[result.id] = twinMeta.sourceLabel;
      if (!rawLabels[createdTwin.id]) rawLabels[createdTwin.id] = twinMeta.targetLabel;

      const requestedPrimary =
        rawLinks.primaryProductId === NEW_PRODUCT_LINK_TOKEN ||
        !rawLinks.primaryProductId
          ? result.id
          : rawLinks.primaryProductId;

      await saveProductLinkForProduct(result.id, {
        linkedProductIds: mergedIds,
        primaryProductId: requestedPrimary,
        labels: rawLabels,
        groupTitle: rawLinks.groupTitle || "Цвет",
      });
      invalidateProductsCache();
      revalidateTag("product-links", { expire: 0 });
    } else if (body.productLinks && typeof body.productLinks === "object") {
      await saveProductLinkForProduct(result.id, body.productLinks);
      invalidateProductsCache();
      revalidateTag("product-links", { expire: 0 });
    }

    revalidateTag("products", { expire: 0 });
    return NextResponse.json(
      twinResult
        ? { ...result, twinId: twinResult.id, twinName: twinResult.name }
        : result,
    );
  } catch (error) {
    console.error("Create product error:", error);
    const resp = barcodeErrorResponse(null, error);
    if (resp) return resp;
    const detail =
      (error as any)?.message && String((error as any).message).slice(0, 300);
    return NextResponse.json(
      {
        error: detail
          ? `Не удалось создать товар: ${detail}`
          : "Ошибка сервера при создании товара",
      },
      { status: 500 }
    );
  }
}