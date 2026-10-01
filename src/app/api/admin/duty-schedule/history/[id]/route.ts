// =========================================================
// FILE: src/app/api/admin/duty-schedule/history/[id]/route.ts
// Одна сохранённая версия табеля охраны.
//
// GET  — прочитать версию целиком (просмотр «как было»);
// POST — вернуть её в работу (снимок версии становится текущим,
//        в журнал добавляется запись о восстановлении).
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  DUTY_SCHEDULE_HISTORY_HINT,
  dutyScheduleStoreErrorMessage,
  getDutyScheduleRevision,
  restoreDutyScheduleRevision,
} from "@/lib/duty-schedule-store";

export const dynamic = "force-dynamic";

function noStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function resolveId(
  params: Promise<{ id: string }>
): Promise<number | null> {
  const { id } = await params;
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const id = await resolveId(params);
  if (id == null) {
    return noStore({ error: "Некорректный номер версии" }, { status: 400 });
  }

  try {
    const revision = await getDutyScheduleRevision(id);
    if (!revision) {
      return noStore({ error: "Версия не найдена" }, { status: 404 });
    }
    return noStore({ revision });
  } catch (error) {
    console.error("Duty schedule revision read error:", error);
    return noStore(
      { error: dutyScheduleStoreErrorMessage(error), hint: DUTY_SCHEDULE_HISTORY_HINT },
      { status: 503 }
    );
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const id = await resolveId(params);
  if (id == null) {
    return noStore({ error: "Некорректный номер версии" }, { status: 400 });
  }

  try {
    const snapshot = await restoreDutyScheduleRevision(id, auth.username);
    if (!snapshot) {
      return noStore({ error: "Версия не найдена" }, { status: 404 });
    }
    return noStore({ success: true, snapshot });
  } catch (error) {
    console.error("Duty schedule revision restore error:", error);
    return noStore(
      { error: dutyScheduleStoreErrorMessage(error), hint: DUTY_SCHEDULE_HISTORY_HINT },
      { status: 503 }
    );
  }
}
