// =========================================================
// FILE: src/app/api/admin/products/generate-images/route.ts
// Сохраняет сгенерированную в конструкторе карточку товара:
// загружает PNG (data URL) в Cloudinary и проставляет товару
// главное фото + массив images. Вызывается по одному товару —
// клиент последовательно генерирует карточки и шлёт их сюда.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
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

    const upload = await cloudinary.uploader.upload(image, {
      folder: "sibgofrotorg/products/generated",
      transformation: [
        { width: 800, height: 800, crop: "limit" },
        { quality: "auto:good" },
        { format: "webp" },
      ],
    });

    const url: string = upload.secure_url;
    const publicId: string = upload.public_id;

    // Существующие фото товара. При replace=false новое фото становится
    // первым (главным), остальные сохраняются в галерее.
    const existing = normalizeProductImages(product.images);
    const nextImages = replace
      ? [{ url, publicId }]
      : [
          { url, publicId },
          ...existing.filter((img) => img.publicId !== publicId),
        ];

    await updateProduct(productId, {
      imageUrl: url,
      images: nextImages,
    });

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
