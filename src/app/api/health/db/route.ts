// src/app/api/health/db/route.ts
//
// ГЛАВНАЯ СТРАНИЦА ДИАГНОСТИКИ, когда «сайт работает, а админка — нет».
// Открывается прямо в браузере: /api/health/db (или /api/health/db?deep=1).
//
// Раньше здесь был только {ok:false,error:"supabase_unreachable"} — по нему
// невозможно понять, что случилось (проект на паузе? ротировали JWT-секрет?
// отключили legacy-ключи? сеть из РФ не проходит?). Теперь ответ содержит
// классифицированную причину, человеческое действие и проверку переменных
// окружения. Секреты не выводятся: ни ключей, ни их фрагментов.

import { NextResponse } from "next/server";
import {
  checkAdminAccounts,
  collectEnvChecks,
  diagnoseSupabase,
} from "@/lib/supabase-diagnostics";
import { adminPathReport } from "@/lib/admin-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "1";

  const diagnosis = await diagnoseSupabase({ deep });

  const body: Record<string, unknown> = {
    ...diagnosis,
    envChecks: collectEnvChecks(),
    adminPath: adminPathReport(),
    runtime: {
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      timeoutMs: Number(process.env.SUPABASE_FETCH_TIMEOUT_MS || 20000),
    },
  };

  if (deep) {
    const accounts = await checkAdminAccounts();
    body.adminAccounts = accounts;
    if (accounts && accounts.total === 0) {
      body.accountWarning =
        "В таблице admins нет ни одной записи — войти в админку некому. Создайте администратора (см. docs/ADMIN-RECOVERY.md) или включите ADMIN_RECOVERY_TOKEN и восстановите доступ через /api/health/recover-admin.";
    }
  }

  return NextResponse.json(body, {
    status: diagnosis.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
