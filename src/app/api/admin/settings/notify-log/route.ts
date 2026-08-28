// =========================================================
// FILE: src/app/api/admin/settings/notify-log/route.ts
// Журнал последних отправок уведомлений (MAX).
// Хранится в памяти процесса — предназначен для быстрой
// диагностики «ушло или нет и почему».
// =========================================================

import { NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { getNotificationLog } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_settings")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  return NextResponse.json({ entries: getNotificationLog() });
}
