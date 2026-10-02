// =========================================================
// FILE: src/app/api/admin/die-calc/[id]/route.ts
// Одна строка сохранённого расчёта: чтение, правка (цена, факт, статус,
// что угодно из таблицы), удаление.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";
import { deleteDieCalcJob, dieCalcTableHint, getDieCalcJob, updateDieCalcJob } from "@/lib/die-calc-db";

const bad = (error: unknown, fallback: string) => {
  const status = Number((error as { status?: number })?.status ?? 0);
  const message = String((error as { message?: string })?.message || fallback);
  return NextResponse.json({ error: dieCalcTableHint(error) ?? message }, { status: status >= 400 && status < 500 ? status : 500 });
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const job = await getDieCalcJob(id);
    if (!job) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (error) {
    console.error("Die-calc get error:", error);
    return bad(error, "Не удалось прочитать расчёт");
  }
}

/**
 * PATCH — частичное обновление: любые колонки из белого списка
 * (см. JOB_*_COLUMNS в src/lib/die-calc-db.ts). Числа правятся руками в
 * таблице, jsonb приходит из калькулятора при «сохранить поверх».
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });
    }
    const job = await updateDieCalcJob(id, body, auth.displayName || auth.username);
    if (!job) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
    await logAdminAction(
      auth.displayName || auth.username,
      auth.role,
      "update",
      "die-calc",
      job.id,
      job.name || job.order_no || "расчёт штанцформы",
      { fields: Object.keys(body).slice(0, 30) },
    );
    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error("Die-calc update error:", error);
    return bad(error, "Не удалось сохранить изменения");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  // удаление — право рабочее, но не для юриста/макулатурщика
  if (!hasPermission(auth, "delete")) {
    return NextResponse.json({ error: "Недостаточно прав для удаления" }, { status: 403 });
  }
  try {
    const { id } = await params;
    const before = await getDieCalcJob(id);
    const ok = await deleteDieCalcJob(id);
    if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
    await logAdminAction(
      auth.displayName || auth.username,
      auth.role,
      "delete",
      "die-calc",
      id,
      before?.name || before?.order_no || "расчёт штанцформы",
      { reason: new URL(request.url).searchParams.get("reason") ?? undefined },
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Die-calc delete error:", error);
    return bad(error, "Не удалось удалить запись");
  }
}
