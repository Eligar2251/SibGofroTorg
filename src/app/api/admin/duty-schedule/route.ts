// =========================================================
// FILE: src/app/api/admin/duty-schedule/route.ts
// Чтение и атомарное автосохранение общего табеля охраны.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  dutyScheduleStoreErrorMessage,
  getDutyScheduleSnapshot,
  saveDutyScheduleSnapshot,
} from "@/lib/duty-schedule-store";
import type { DutyScheduleStoredState } from "@/components/admin/duty-schedule/types";

export const dynamic = "force-dynamic";

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Проверяем обязательные контейнеры; вложенные значения создаёт только UI. */
function isDutyScheduleState(value: unknown): value is DutyScheduleStoredState {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.employees) &&
    isRecord(value.schedules) &&
    isRecord(value.amountOverrides) &&
    (value.payPlans == null || isRecord(value.payPlans)) &&
    (value.salaryPayouts == null || isRecord(value.salaryPayouts)) &&
    (value.payoutTitles == null || isRecord(value.payoutTitles)) &&
    (value.salaryAccruals == null || isRecord(value.salaryAccruals))
  );
}

function parsePayOffset(value: unknown): number | null {
  const n = Number(value);
  return n === 0 || n === 1 || n === 2 ? n : null;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const snapshot = await getDutyScheduleSnapshot();
    return NextResponse.json(
      { snapshot },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Read duty schedule error:", error);
    return NextResponse.json(
      { error: dutyScheduleStoreErrorMessage(error) },
      { status: 503 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || !isDutyScheduleState(body.state)) {
      return NextResponse.json(
        { error: "Некорректный формат табеля" },
        { status: 400 }
      );
    }

    const payOffset = parsePayOffset(body.payOffset);
    if (payOffset == null) {
      return NextResponse.json(
        { error: "Сдвиг зарплаты должен быть 0, 1 или 2 месяца" },
        { status: 400 }
      );
    }

    const snapshotSize = Buffer.byteLength(JSON.stringify(body.state), "utf8");
    if (snapshotSize > MAX_SNAPSHOT_BYTES) {
      return NextResponse.json(
        { error: "Табель слишком большой для сохранения" },
        { status: 413 }
      );
    }

    const result = await saveDutyScheduleSnapshot(
      { state: body.state, payOffset },
      auth.username
    );
    return NextResponse.json({ success: true, updatedAt: result.updatedAt });
  } catch (error) {
    console.error("Save duty schedule error:", error);
    return NextResponse.json(
      { error: dutyScheduleStoreErrorMessage(error) },
      { status: 503 }
    );
  }
}
