// =========================================================
// FILE: src/app/api/admin/die-calc/route.ts
// Расчёты штанцформ: список, сохранение нового расчёта, модель обучения.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";
import {
  createDieCalcJob,
  dieCalcTableHint,
  getActiveDieCalcModel,
  getDieCalcStats,
  listDieCalcJobs,
} from "@/lib/die-calc-db";

const bad = (error: unknown, fallback: string) => {
  const status = Number((error as { status?: number })?.status ?? 0);
  const message = String((error as { message?: string })?.message || fallback);
  return NextResponse.json({ error: dieCalcTableHint(error) ?? message }, { status: status >= 400 && status < 500 ? status : 500 });
};

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const sp = request.nextUrl.searchParams;
    const { jobs, total } = await listDieCalcJobs({
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
      construction: sp.get("construction") ?? undefined,
      profileId: sp.get("profile") ?? undefined,
      onlyLearned: sp.get("learned") === "1",
      limit: Number(sp.get("limit") ?? 200) || 200,
      offset: Number(sp.get("offset") ?? 0) || 0,
    });
    const [model, stats] = await Promise.all([getActiveDieCalcModel(), getDieCalcStats()]);
    return NextResponse.json({ jobs, total, model, stats });
  } catch (error) {
    console.error("Die-calc list error:", error);
    return bad(error, "Не удалось прочитать расчёты");
  }
}

/**
 * POST — сохранить расчёт. Тело = payload из core/learn.ts (packJob):
 * колонки + settings/result. Сервер ничего не пересчитывает: ядро считает на
 * клиенте, здесь только проверка полей и запись.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });
    }
    const job = await createDieCalcJob(body, auth.displayName || auth.username);
    await logAdminAction(
      auth.displayName || auth.username,
      auth.role,
      "create",
      "die-calc",
      job.id,
      job.name || job.order_no || "расчёт штанцформы",
      { qty: job.qty, price_per_pcs: job.price_per_pcs },
    );
    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error("Die-calc create error:", error);
    return bad(error, "Не удалось сохранить расчёт");
  }
}
