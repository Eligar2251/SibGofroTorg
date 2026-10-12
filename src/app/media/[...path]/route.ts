// =========================================================
// FILE: src/app/media/[...path]/route.ts — прокси изображений

import { NextRequest, NextResponse } from "next/server";
import { parseMediaSource } from "@/lib/media";
import { buildUpstreamUrl } from "@/lib/media-proxy";

const REVALIDATE_SECONDS = 60 * 60 * 24 * 30;
const CACHE_HEADER = "public, max-age=31536000, immutable";

/** Разрешённые параметры: ширина и качество. */
function intParam(value: string | null, min: number, max: number): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const [sourceSegment, ...restSegments] = path ?? [];
  const source = sourceSegment ? parseMediaSource(sourceSegment) : null;
  if (!source || restSegments.length === 0) {
    return new NextResponse(null, { status: 404 });
  }

  const rest = restSegments.join("/");
  // Защита от обхода каталога и мусорных путей.
  if (rest.includes("..") || !/^[A-Za-z0-9._~:/@!$&'()*+,;=%-]+$/.test(rest)) {
    return new NextResponse(null, { status: 400 });
  }

  const searchParams = new URL(request.url).searchParams;
  const upstream = buildUpstreamUrl(
    source,
    rest,
    intParam(searchParams.get("w"), 16, 3840),
    intParam(searchParams.get("q"), 1, 100),
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  );
  if (!upstream) return new NextResponse(null, { status: 404 });

  try {
    const upstreamResponse = await fetch(upstream, {
      headers: { accept: "image/*" },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    const contentType = upstreamResponse.headers.get("content-type") || "";
    if (!upstreamResponse.ok || !contentType.startsWith("image/")) {
      return new NextResponse(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": CACHE_HEADER,
      "X-Content-Type-Options": "nosniff",
    };
    const contentLength = upstreamResponse.headers.get("content-length");
    if (contentLength) headers["Content-Length"] = contentLength;

    return new NextResponse(upstreamResponse.body, { status: 200, headers });
  } catch {
    return new NextResponse(null, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
