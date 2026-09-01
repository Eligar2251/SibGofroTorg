// =========================================================
// FILE: src/lib/duty-schedule-store.ts
// Серверное хранилище табеля охраны в Supabase.
// =========================================================

import { getAdminDb } from "@/lib/supabase";
import type {
  DutyScheduleSnapshot,
  DutyScheduleStoredState,
} from "@/components/admin/duty-schedule/types";

const TABLE = "duty_schedule_state";
const SINGLETON_ID = "main";

function normalizePayOffset(value: unknown): number {
  const offset = Number(value);
  return offset === 0 || offset === 1 || offset === 2 ? offset : 1;
}

/** Возвращает общий снимок табелей. null означает, что запись ещё не создана. */
export async function getDutyScheduleSnapshot(): Promise<DutyScheduleSnapshot | null> {
  const db = getAdminDb();
  const { data, error } = await db
    .from(TABLE)
    .select("snapshot, pay_offset, updated_at")
    .eq("id", SINGLETON_ID)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    state: data.snapshot as DutyScheduleStoredState,
    payOffset: normalizePayOffset(data.pay_offset),
    updatedAt: data.updated_at ? String(data.updated_at) : null,
  };
}

/**
 * Атомарно заменяет общий снимок. upsert по постоянному id не создаёт новый
 * табель при повторной генерации — обновляется та же строка базы.
 */
export async function saveDutyScheduleSnapshot(
  snapshot: Pick<DutyScheduleSnapshot, "state" | "payOffset">,
  updatedBy?: string | null
): Promise<{ updatedAt: string | null }> {
  const db = getAdminDb();
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        id: SINGLETON_ID,
        snapshot: snapshot.state,
        pay_offset: normalizePayOffset(snapshot.payOffset),
        updated_by: updatedBy || null,
      },
      { onConflict: "id" }
    )
    .select("updated_at")
    .single();

  if (error) throw error;
  return { updatedAt: data?.updated_at ? String(data.updated_at) : null };
}

/** Понятная подсказка, если код уже развёрнут, а SQL-миграция ещё нет. */
export function dutyScheduleStoreErrorMessage(error: unknown): string {
  const raw = String((error as { message?: unknown })?.message || error || "");
  const lower = raw.toLowerCase();
  if (
    lower.includes(TABLE) ||
    lower.includes("schema cache") ||
    lower.includes("does not exist")
  ) {
    return "Хранилище табелей ещё не создано. Выполните supabase/migration_duty_schedule_storage.sql в Supabase → SQL Editor.";
  }
  return "Не удалось обратиться к базе табелей. Проверьте соединение и повторите попытку.";
}
