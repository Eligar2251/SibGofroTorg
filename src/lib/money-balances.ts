// =========================================================
// FILE: src/lib/money-balances.ts
// Остатки по четырём денежным счетам с учётом прямых правок владельца.
//
// Отдельный модуль нужен, чтобы не было циклического импорта:
// warehouse.ts → money-accounts.ts (журнал правок) и
// money-balances.ts → warehouse.ts (данные для расчёта).
// =========================================================

import {
  getAccountTransfers,
  getCashCollections,
  getPayments,
  getSalaries,
} from "./warehouse";
import { getMoneyAdjustments } from "./money-accounts";
import {
  getBankSummary,
  getWarehouseBusinessDate,
  type BankAccountId,
  type BankAccountTransfer,
  type BankPayment,
  type CashCollection,
  type CustomerDeal,
  type MoneyAdjustment,
  type Salary,
} from "./warehouse-shared";

/**
 * Остатки по всем четырём счетам с учётом правок владельца.
 * Единая точка расчёта для панели владельца.
 */
export function getMoneyAccountBalances(args: {
  payments: BankPayment[];
  salaries?: Salary[];
  collections?: CashCollection[];
  deals?: CustomerDeal[];
  accountTransfers?: BankAccountTransfer[];
  adjustments?: MoneyAdjustment[];
  asOfDate?: string;
}) {
  return getBankSummary(
    args.payments,
    args.salaries || [],
    args.collections || [],
    args.asOfDate || getWarehouseBusinessDate(),
    args.deals,
    args.accountTransfers || [],
    args.adjustments || []
  );
}

/** Баланс одного счёта по названию (для расчёта дельты «сделать 0 ₽»). */
export async function getAccountBalance(
  account: BankAccountId,
  asOfDate = getWarehouseBusinessDate()
): Promise<number> {
  const summary = await loadMoneyBalances(asOfDate);
  if (account === "bank") return summary.bankBalance;
  if (account === "ym_card") return summary.ymCardBalance;
  if (account === "vm_card") return summary.vmCardBalance;
  return summary.cashBalance;
}

/**
 * Все четыре остатка по серверным данным с учётом правок владельца.
 * Используется панелью владельца и API.
 */
export async function loadMoneyBalances(asOfDate = getWarehouseBusinessDate()) {
  const [payments, salaries, collections, accountTransfers, adjustments] =
    await Promise.all([
      getPayments(),
      getSalaries(),
      getCashCollections(),
      getAccountTransfers(),
      getMoneyAdjustments(),
    ]);
  return getMoneyAccountBalances({
    payments,
    salaries,
    collections,
    accountTransfers,
    adjustments,
    asOfDate,
  });
}
