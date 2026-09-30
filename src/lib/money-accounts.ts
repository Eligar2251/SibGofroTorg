// =========================================================
// FILE: src/lib/money-accounts.ts
// Прямые правки денежных счетов владельцем (без документов).
//
// Владелец может изменить остаток любого счёта (касса, р/с, карты ЮМ и
// В.М.) одним движением: деньги просто добавляются или исчезают. Документ
// не создаётся — вместо него появляется запись в `money_adjustments`,
// которая подмешивается в расчёт балансов (getBankSummary /
// getCashCarryoverSummary).
//
// Такие движения видит в журнале только владелец: обычному админу
// остаётся лишь итоговый баланс, без строки и комментария правки.
// =========================================================

import { getAdminDb } from "./supabase";
import { logActivity } from "./activity-log";
import { formatMoneyDelta } from "./money-accounts-shared";
import {
  getWarehouseBusinessDate,
  type BankAccountId,
  type BankAccountTransfer,
  type BankPayment,
  type CashCollection,
  type CustomerDeal,
  type MoneyAdjustment,
  type Salary,
} from "./warehouse-shared";

/** Строка таблицы `money_adjustments` → обычная модель. */
function mapMoneyAdjustment(row: any): MoneyAdjustment {
  return {
    id: String(row.id),
    account: (row.account || "cash") as BankAccountId,
    delta: Number(row.delta) || 0,
    date: String(row.date || row.created_at || "").slice(0, 10),
    note: row.note ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    balanceAfter: row.balance_after != null ? Number(row.balance_after) : null,
    label: "Правка владельца",
  };
}

/**
 * Все правки владельца. Если миграция ещё не применена, таблицы нет —
 * возвращаем пустой список, чтобы админка продолжала работать.
 */
export async function getMoneyAdjustments(): Promise<MoneyAdjustment[]> {
  try {
    const db = getAdminDb();
    const { data, error } = await db
      .from("money_adjustments")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data || []).map(mapMoneyAdjustment);
  } catch (error) {
    console.warn("[money] Не удалось загрузить правки счетов:", (error as any)?.message || error);
    return [];
  }
}

/**
 * Создать правку счёта: `delta` считается от текущего остатка.
 * `balanceAfter` сохраняется как снимок «стало», чтобы журнал владельца
 * показывал результат даже если позже прошли другие документы.
 */
export async function createMoneyAdjustment(data: {
  account: BankAccountId;
  delta: number;
  note?: string | null;
  balanceAfter?: number | null;
  adminName: string;
  adminRole: string;
  adminId?: string | null;
  ipAddress?: string;
}): Promise<MoneyAdjustment> {
  const db = getAdminDb();
  const date = getWarehouseBusinessDate();
  const { data: inserted, error } = await db
    .from("money_adjustments")
    .insert({
      account: data.account,
      delta: Math.round(data.delta * 100) / 100,
      date,
      note: data.note || null,
      balance_after:
        data.balanceAfter == null ? null : Math.round(data.balanceAfter * 100) / 100,
      created_by: data.adminName || null,
    })
    .select("*")
    .single();
  if (error) throw error;

  await logActivity({
    adminId: data.adminId || undefined,
    adminName: data.adminName,
    adminRole: data.adminRole,
    action: "update",
    entityType: "money-adjustment",
    entityId: String(inserted.id),
    entityLabel: `Правка счёта «${data.account}»: ${formatMoneyDelta(data.delta)}`,
    details: {
      account: data.account,
      delta: Math.round(data.delta * 100) / 100,
      balanceAfter: data.balanceAfter ?? null,
      note: data.note || null,
      date,
    },
    ipAddress: data.ipAddress,
  });

  return mapMoneyAdjustment(inserted);
}

/**
 * Отменить (удалить) правку — деньги возвращаются к прежнему состоянию.
 * Удаляем запись полностью: владелец должен иметь возможность откатить
 * ошибочное движение. Факт отмены остаётся в журнале действий.
 */
export async function deleteMoneyAdjustment(
  id: string,
  actor: { adminName: string; adminRole: string; adminId?: string | null; ipAddress?: string }
): Promise<MoneyAdjustment | null> {
  const db = getAdminDb();
  const { data: current, error: readError } = await db
    .from("money_adjustments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return null;

  const { error } = await db.from("money_adjustments").delete().eq("id", id);
  if (error) throw error;

  const removed = mapMoneyAdjustment(current);
  await logActivity({
    adminId: actor.adminId || undefined,
    adminName: actor.adminName,
    adminRole: actor.adminRole,
    action: "delete",
    entityType: "money-adjustment",
    entityId: id,
    entityLabel: `Отмена правки счёта «${removed.account}»: ${formatMoneyDelta(removed.delta)}`,
    details: {
      account: removed.account,
      delta: removed.delta,
      note: removed.note || null,
      date: removed.date,
      cancelled: true,
    },
    ipAddress: actor.ipAddress,
  });

  return removed;
}
