// =========================================================
// FILE: src/app/api/admin/nav-layout/route.ts
// Личная раскладка меню. Любая роль админки читает и пишет
// только свою запись — чужие логины из сессии не берутся.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  ADMIN_NAV_CATALOG,
  sanitizeNavLayout,
  type AdminNavLayout,
} from "@/lib/admin-nav";
import {
  deleteAdminNavLayout,
  readAdminNavLayout,
  writeAdminNavLayout,
} from "@/lib/admin-nav-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_IDS = ADMIN_NAV_CATALOG.map((item) => item.id);

function noStore(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const raw = await readAdminNavLayout(auth.username);
    const layout = raw ? sanitizeNavLayout(raw, ALLOWED_IDS) : null;
    return noStore({ layout });
  } catch (error) {
    console.error("Read admin nav layout error:", error);
    return noStore({ error: "Не удалось прочитать меню" }, 500);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const text = await request.text();
    if (text.length > 80_000) {
      return noStore({ error: "Слишком большая раскладка" }, 413);
    }
    const body = JSON.parse(text) as { layout?: unknown };
    const layout: AdminNavLayout | null = sanitizeNavLayout(body?.layout, ALLOWED_IDS);
    if (!layout) {
      return noStore({ error: "Некорректная раскладка меню" }, 400);
    }
    await writeAdminNavLayout(auth.username, layout);
    return noStore({ ok: true, layout });
  } catch (error) {
    console.error("Save admin nav layout error:", error);
    return noStore({ error: "Не удалось сохранить меню" }, 500);
  }
}

export async function DELETE() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    await deleteAdminNavLayout(auth.username);
    return noStore({ ok: true, layout: null });
  } catch (error) {
    console.error("Reset admin nav layout error:", error);
    return noStore({ error: "Не удалось сбросить меню" }, 500);
  }
}
