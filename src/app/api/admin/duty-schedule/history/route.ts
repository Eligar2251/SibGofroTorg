// =========================================================
// FILE: src/app/api/admin/duty-schedule/history/route.ts
// Список сохранённых версий табеля охраны (сотрудники, смены,
// начисления и выплаты — всё, что лежало в снимке на тот момент).
//
// GET /api/admin/duty-schedule/history?limit=100
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  dutyScheduleStoreErrorMessage,
  getDutyScheduleRevisions,
} from "@/lib/duty-schedule-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 100);
    const result = await getDutyScheduleRevisions(limit);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Duty schedule history list error:", error);
    return NextResponse.json(
      { error: dutyScheduleStoreErrorMessage(error) },
      { status: 503 }
    );
  }
}
