// =========================================================
// FILE: src/app/api/admin/home-tiles/route.ts
// Плитки главной: список, создание, сохранение порядка.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  createHomeTile,
  getAllHomeTiles,
  reorderHomeTiles,
} from "@/lib/supabase-queries";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const tiles = await getAllHomeTiles();
    return NextResponse.json({ tiles });
  } catch (error) {
    console.error("Get home tiles error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    if (!String(body.title || "").trim()) {
      return NextResponse.json({ error: "Название обязательно" }, { status: 400 });
    }
    const result = await createHomeTile(body);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Create home tile error:", error);
    return NextResponse.json(
      { error: tableHint(error) || "Ошибка сервера" },
      { status: 500 }
    );
  }
}

/** Сохранение порядка плиток: { ids: [...] } в нужной последовательности. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const ids = Array.isArray(body.ids)
      ? body.ids.map((x: unknown) => String(x)).filter(Boolean)
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Пустой список" }, { status: 400 });
    }
    await reorderHomeTiles(ids);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reorder home tiles error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

/** Подсказка админу, если миграция ещё не применена. */
function tableHint(error: unknown): string | null {
  const msg = String((error as any)?.message || "").toLowerCase();
  if (msg.includes("home_tiles") || msg.includes("schema cache")) {
    return "Таблицы home_tiles нет в базе. Выполните supabase/migration_home_tiles.sql в Supabase → SQL Editor.";
  }
  return null;
}
