// =========================================================
// FILE: src/app/api/admin/products/generate-images/route.ts
// Сохраняет сгенерированную в конструкторе карточку товара:
// загружает PNG (data URL) в Cloudinary и проставляет товару
// главное фото + массив images. Вызывается по одному товару —
// клиент последовательно генерирует карточки и шлёт их сюда.
//
// Важно: каждый залив — новый public_id (со штампом времени),
// старые файлы при replace удаляются и инвалидируется CDN.
// Иначе Cloudinary/Next Image продолжают отдавать прошлое фото.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { v2 as cloudinary } from "cloudinary";
import { requireAdminApi } from "@/lib/auth";
import {
  getProductByIdForAdmin,
  normalizeProductImages,
  updateProduct,
} from "@/lib/supabase-queries";

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/** Максимальный размер data URL в символах (~10 МБ PNG в base64). */
const MAX_DATA_URL_LENGTH = 14 * 1024 * 1024;

function safePublicIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "item";
}

async function destroyCloudinaryIds(ids: string[]) {
  const unique = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  await Promise.all(
    unique.map((publicId) =>
      cloudinary.uploader.destroy(publicId, { invalidate: true }).catch((err) => {
        console.warn("Cloudinary destroy skipped:", publicId, err?.message || err);
      })
    )
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Некорректный запрос" },
        { status: 400 }
      );
    }

    const productId =
      typeof body.productId === "string" && body.productId.trim()
        ? body.productId.trim()
        : "";
    const image = typeof body.image === "string" ? body.image : "";
    const replace = Boolean(body.replace);

    if (!productId) {
      return NextResponse.json(
        { error: "Не указан товар" },
        { status: 400 }
      );
    }
    if (!image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Картинка должна быть data URL (data:image/…)" },
        { status: 400 }
      );
    }
    if (image.length > MAX_DATA_URL_LENGTH) {
      return NextResponse.json(
        { error: "Картинка слишком большая (более ~10 МБ)" },
        { status: 400 }
      );
    }

    const product = await getProductByIdForAdmin(productId);
    if (!product) {
      return NextResponse.json(
        { error: "Товар не найден" },
        { status: 404 }
      );
    }

    const stamp = Date.now();
    const upload = await cloudinary.uploader.upload(image, {
      public_id: `sibgofrotorg/products/generated/${safePublicIdPart(productId)}_${stamp}`,
      overwrite: false,
      unique_filename: true,
      invalidate: true,
      transformation: [
        { width: 800, height: 800, crop: "limit" },
        { quality: "auto:good" },
        { format: "webp" },
      ],
    });

    const url: string = String(upload.secure_url || "");
    const publicId: string = upload.public_id;

    const existing = normalizeProductImages(product.images);
    const nextImages = replace
      ? [{ url, publicId }]
      : [
          { url, publicId },
          ...existing.filter((img) => img.publicId !== publicId && img.url !== url),
        ];

    await updateProduct(productId, {
      imageUrl: url,
      images: nextImages,
    });

    if (replace) {
      const staleIds = existing
        .map((img) => img.publicId)
        .filter((id) => id && id !== publicId);
      await destroyCloudinaryIds(staleIds);
    }

    revalidatePath("/", "layout");
    revalidatePath("/catalog");
    if (product.slug) {
      revalidatePath(`/catalog/product/${product.slug}`);
    }

    return NextResponse.json({ ok: true, url, publicId });
  } catch (error) {
    console.error("Generate images error:", error);
    const detail =
      (error as any)?.message && String((error as any).message).slice(0, 300);
    return NextResponse.json(
      {
        error: detail
          ? `Не удалось сохранить фото: ${detail}`
          : "Ошибка при сохранении фото",
      },
      { status: 500 }
    );
  }
}
