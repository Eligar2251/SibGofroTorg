// =========================================================
// FILE: src/lib/image-loader.ts — лоадер next/image
// =========================================================
//
// Next.js передаёт сюда исходный src и запрошенную ширину. Мы переводим
// внешние ссылки (Cloudinary, Unsplash) в собственный путь /media/...:
// тогда в HTML и в srcset не остаётся чужих доменов, а изображение
// отдаёт наш сервер (см. src/app/media/[...path]/route.ts).
//
// Локальные файлы из /public (и уже готовые /media/...) возвращаются без
// изменений — их оптимизирует сам Next.
//
// ВАЖНО: функция выполняется и в браузере, поэтому здесь нет ничего
// серверного.

import { MEDIA_PREFIX, toSameOriginMediaUrl } from "./media";

export default function imageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  const mapped = toSameOriginMediaUrl(src);
  if (!mapped.startsWith(`${MEDIA_PREFIX}/`)) return mapped || src;

  const [base, query = ""] = mapped.split("?");
  const params = new URLSearchParams(query);
  params.set("w", String(width));
  params.set("q", String(quality || 75));
  return `${base}?${params.toString()}`;
}
