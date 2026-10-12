// =========================================================
// FILE: src/lib/media-proxy.ts — построение адреса апстрима

import { MEDIA_HOSTS } from "./media";

const CLOUDINARY_MARKER = "image/upload/";

/**
 * @param source    "cloudinary" | "unsplash"
 * @param rest      путь после /media/<source>/ — у Cloudinary начинается
 *                  с имени облака: "<cloud>/image/upload/v1/a/b.jpg"
 * @param width     ширина из srcset (её запрашивает next/image)
 * @param quality   качество (по умолчанию 75)
 * @param cloudName NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: если задан, имя
 *                  облака из пути должно совпадать с ним — прокси работает
 *                  только со своим облаком, а не с произвольным.
 */
export function buildUpstreamUrl(
  source: string,
  rest: string,
  width: number | null,
  quality: number | null,
  cloudName: string | null | undefined
): string | null {
  if (source === "cloudinary") {
    const [cloudSegment, ...tailSegments] = rest.split("/");
    const cloud = (cloudSegment || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!cloud) return null;

    const allowed = (cloudName || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    if (allowed && allowed !== cloud) return null;

    const tail = tailSegments.join("/");
    const index = tail.indexOf(CLOUDINARY_MARKER);
    if (index !== 0) return null;
    const path = tail.slice(CLOUDINARY_MARKER.length);
    if (!path) return null;

    // w_/q_ — размеры, f_auto — современный формат, c_limit — не увеличивать.
    const transform = [
      width ? `w_${width}` : "",
      quality ? `q_${quality}` : "",
      "f_auto",
      "c_limit",
    ]
      .filter(Boolean)
      .join(",");
    return `https://${MEDIA_HOSTS.cloudinary}/${cloud}/${CLOUDINARY_MARKER}${transform}/${path}`;
  }

  if (source === "unsplash") {
    const params = new URLSearchParams();
    if (width) params.set("w", String(width));
    if (quality) params.set("q", String(quality));
    params.set("fit", "max");
    return `https://${MEDIA_HOSTS.unsplash}/${rest}?${params.toString()}`;
  }

  return null;
}
