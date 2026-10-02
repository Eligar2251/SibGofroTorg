// =========================================================
// FILE: src/app/api/admin/die-calc/train/route.ts
// «Обучить по базе»: пересчитать выученную модель по подтверждённым
// записям die_calc_jobs. GET — активная модель (её читает калькулятор).
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";
import { buildDieCalcModel, dieCalcTableHint, getActiveDieCalcModel, trainDieCalcModel } from "@/lib/die-calc-db";

const bad = (error: unknown, fallback: string) => {
  const status = Number((error as { status?: number })?.status ?? 0);
  const message = String((error as { message?: string })?.message || fallback);
  return NextResponse.json({ error: dieCalcTableHint(error) ?? message }, { status: status >= 400 && status < 500 ? status : 500 });
};

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ model: await getActiveDieCalcModel() });
  } catch (error) {
    console.error("Die-calc model read error:", error);
    // модель — необязательная надстройка: без неё калькулятор считается по ставкам
    return NextResponse.json({ model: null });
  }
}

/** POST { preview?: true } — preview считает модель, но не сохраняет её */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const actor = auth.displayName || auth.username;
    if (body?.preview) {
      const { model, rows } = await buildDieCalcModel();
      return NextResponse.json({ model, rows, preview: true });
    }
    const { model, rows } = await trainDieCalcModel(actor);
    await logAdminAction(actor, auth.role, "update", "die-calc", "model", `обучение по ${rows} записям`, {
      notes: model.notes.slice(0, 8),
    });
    return NextResponse.json({ success: true, model, rows });
  } catch (error) {
    console.error("Die-calc train error:", error);
    return bad(error, "Не удалось переобучить модель");
  }
}
