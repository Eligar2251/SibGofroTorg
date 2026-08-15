import "server-only";

import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export interface MirroredPurchaseImage {
  url: string;
  publicId: string;
}

/**
 * Копирует внешний снимок товара в наше постоянное хранилище.
 * Один planId всегда перезаписывает один и тот же ресурс — Cloudinary
 * не захламляется новой картинкой при ручном обновлении цены.
 */
export async function mirrorPurchaseImage(
  sourceUrl: string,
  planId: string,
): Promise<MirroredPurchaseImage> {
  if (
    !process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Cloudinary не настроен");
  }

  const safeId = String(planId || "purchase")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  const result = await cloudinary.uploader.upload(sourceUrl, {
    folder: "sibgofrotorg/purchases",
    public_id: `ozon-${safeId}`,
    overwrite: true,
    invalidate: true,
    unique_filename: false,
    resource_type: "image",
    transformation: [
      { width: 900, height: 900, crop: "limit" },
      { quality: "auto:good" },
      { format: "webp" },
    ],
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
}
