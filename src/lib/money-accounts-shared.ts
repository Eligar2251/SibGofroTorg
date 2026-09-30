// =========================================================
// FILE: src/lib/money-accounts-shared.ts
// Клиентская (безопасная для браузера) часть денежных правок владельца:
// подписи и приватность. Серверные функции — в money-accounts.ts.
// =========================================================

import { isOwner, type AdminRole } from "./admin-rbac";
import type { BankAccountId, MoneyAdjustment } from "./warehouse-shared";

/** Короткие подписи счетов для компактных карточек-плиток. */
export const MONEY_ACCOUNT_SHORT_LABELS: Record<BankAccountId, string> = {
  cash: "Касса",
  bank: "Р/с",
  ym_card: "Карта ЮМ",
  vm_card: "Карта В.М.",
};

/** Плюс/минус в человекочитаемом виде: +14 ₽ / −14 ₽ */
export function formatMoneyDelta(delta: number): string {
  const value = Math.round((Number(delta) || 0) * 100) / 100;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toLocaleString("ru-RU")} ₽`;
}

/** Сумма правок по каждому счёту (для сверки/подсказок). */
export function sumAdjustmentsByAccount(
  adjustments: MoneyAdjustment[]
): Record<BankAccountId, number> {
  const totals = { cash: 0, bank: 0, ym_card: 0, vm_card: 0 } as Record<
    BankAccountId,
    number
  >;
  for (const item of adjustments) {
    if (totals[item.account] === undefined) continue;
    totals[item.account] += Number(item.delta) || 0;
  }
  return totals;
}

/**
 * Приватность: чужие роли получают правки без комментария, автора и
 * снимка «стало» — только сумму и дату, чтобы итоговый баланс совпадал
 * у всех, но источник движения оставался виден лишь владельцу.
 */
export function redactMoneyAdjustments(
  adjustments: MoneyAdjustment[],
  role: AdminRole | null
): MoneyAdjustment[] {
  if (isOwner(role)) return adjustments;
  return adjustments.map((item) => ({
    id: item.id,
    account: item.account,
    delta: item.delta,
    date: item.date,
    note: null,
    createdBy: null,
    createdAt: null,
    balanceAfter: null,
    label: "Прочее",
  }));
}
