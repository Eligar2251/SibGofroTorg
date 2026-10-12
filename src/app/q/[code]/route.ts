// =========================================================
// FILE: src/app/q/[code]/route.ts
// Короткий публичный вход по QR-коду с этикетки: /q/{slug}.
// =========================================================

import { NextRequest, NextResponse } from "next/server";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // В QR slug закодирован в верхнем регистре.
  const normalized = decodeURIComponent(code || "")
    .trim()
    .toUpperCase();

  if (!normalized) {
    return NextResponse.redirect(new URL(`/${ADMIN_PATH}/scan`, req.url), 307);
  }

  return NextResponse.redirect(
    new URL(
      `/${ADMIN_PATH}/scan/${encodeURIComponent(normalized)}`,
      req.url
    ),
    307
  );
}
