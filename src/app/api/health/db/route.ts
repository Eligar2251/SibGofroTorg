// src/app/health/db/route.ts → GET /api/health/db
//
// Readiness-проверка: реально ли доступен Supabase (PostgreSQL).
// Возвращает 503, если переменные не заданы или запрос упал —
// это диагностика, её НЕ должен использовать health-check контейнера
// (см. комментарий в ../route.ts: зависимость ливнес-пробы от БД
// приводила к restart-loop на Timeweb).

import { getAdminDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      {
        ok: false,
        error:
          "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы в переменных окружения контейнера",
      },
      { status: 503 }
    );
  }

  try {
    const { error } = await getAdminDb().from("settings").select("key").limit(1);
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
    return Response.json({ ok: true, db: "up" });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || "supabase_unreachable" },
      { status: 503 }
    );
  }
}
