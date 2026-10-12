// =========================================================
// FILE: src/lib/image-loader.ts — лоадер next/image

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
