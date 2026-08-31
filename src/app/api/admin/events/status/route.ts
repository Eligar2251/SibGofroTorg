// =========================================================
// FILE: src/app/api/admin/events/status/route.ts
// Статус realtime-канала одним GET-запросом (для диагностики).
//
// Примеры:
//   curl -H "Cookie: admin-session=..." /api/admin/events/status
//   { "status": "connected", "listeners": 3, "error": null }
//
// "connected"  — канал к Supabase жив, события долетают (при наличии
//                изменений в публикациии supabase_realtime);
// "error"      — Realtime недоступен: проверьте SUPABASE_URL /
//                SUPABASE_SERVICE_ROLE_KEY и что сервис Realtime
//                запущен (self-hosted). Админка в любом случае
//                обновляется по таймеру — просто не мгновенно;
// "idle"       — сейчас никто не слушает поток (поднимется по запросу).
//
// Если status "connected", а события всё равно не приходят — таблицы не
// добавлены в публикацию supabase_realtime. Выполните миграцию
// supabase/migration_realtime_admin.sql (SQL Editor → Run).
// =========================================================

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { getHubStatus, tablesForRole } from "@/lib/realtime-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ...getHubStatus(),
    role: session.role,
    tables: [...tablesForRole(session.role)],
    at: new Date().toISOString(),
  });
}
