// =========================================================
// FILE: src/app/api/admin/diagnostics/route.ts
// Диагностика для админки: сессия, переменные окружения, база.
// Доступна владельцу и администратору. Секретов не отдаёт.
// =========================================================

import { NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { adminSessionSecretState, ADMIN_SESSION_TTL_SEC } from "@/lib/admin-session-token";
import {
  checkAdminAccounts,
  collectEnvChecks,
  diagnoseSupabase,
} from "@/lib/supabase-diagnostics";
import { adminPathReport } from "@/lib/admin-path";
import { getAdminDb } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "view_dashboard")) {
    return noStore({ error: "Недостаточно прав" }, 403);
  }

  const db = await diagnoseSupabase({ deep: true });
  const accounts = await checkAdminAccounts();

  // Сколько строк в ключевых таблицах — показывает «пустую базу» (частый
  // симптом после смены проекта Supabase: всё доступно, но данных нет).
  const counts: Record<string, number | string> = {};
  if (db.ok) {
    const client = getAdminDb();
    for (const table of ["products", "orders", "categories", "settings"]) {
      try {
        const { count, error } = await client
          .from(table)
          .select("id", { count: "exact", head: true });
        counts[table] = error ? `ошибка: ${error.message}` : count || 0;
      } catch (error) {
        counts[table] = `ошибка: ${(error as Error)?.message || "неизвестно"}`;
      }
    }
  }

  return noStore({
    auth: {
      username: auth.username,
      role: auth.role,
      displayName: auth.displayName,
      sessionSecret: adminSessionSecretState(),
      sessionTtlHours: Math.round(ADMIN_SESSION_TTL_SEC / 3600),
    },
    adminPath: adminPathReport(),
    db,
    adminAccounts: accounts,
    counts,
    runtime: {
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      env: process.env.NODE_ENV || "не задан",
      timeoutMs: Number(process.env.SUPABASE_FETCH_TIMEOUT_MS || 20000),
    },
    envChecks: collectEnvChecks(),
    ts: new Date().toISOString(),
  });
}
