export type PurchaseAccount = "cash" | "bank" | "ym_card";
export type PurchasePlanStatus = "active" | "completed";
/** Куда уходит списание: исходящий платёж в банке или выплата в ЗП. */
export type PurchaseSpendMode = "bank" | "salary";

export interface PurchaseContribution {
  id: string;
  date: string;
  amount: number;
  note?: string | null;
  createdAt: string;
}

/**
 * Платёж по закупке — обычная строка bank_payments с привязкой
 * purchase_plan_id. Живёт в банке: его видно в общем списке платежей,
 * можно отредактировать и удалить там же.
 */
export interface PurchasePayment {
  id: string;
  number: number;
  date: string;
  amount: number;
  /** Проведён (деньги ушли) или ещё запланирован. */
  isPaid: boolean;
  paidAt?: string | null;
  /** Наличные / расчётный счёт / карта ЮМ. */
  account: PurchaseAccount;
  /** true = не влияет на текущий баланс банка/кассы. */
  excludeFromBalance: boolean;
  counterparty?: string | null;
  comment?: string | null;
}

export interface PurchaseImage {
  url: string;
  publicId: string;
}

export interface PurchasePlan {
  id: string;
  productId: string;
  productName: string;
  sku?: string | null;
  images: PurchaseImage[];
  ozonUrl?: string | null;
  ozonImageUrl?: string | null;
  ozonImagePublicId?: string | null;
  ozonPrice?: number | null;
  ozonCheckedAt?: string | null;
  ozonPriceUpdatedAt?: string | null;
  ozonLastError?: string | null;
  targetAmount: number;
  contributionAmount: number;
  account: PurchaseAccount;
  status: PurchasePlanStatus;
  contributions: PurchaseContribution[];
  /** Сумма старых виртуальных «отложено» (не движение денег). */
  savedAmount: number;
  /** Реальные платежи, отнесённые к этой закупке. */
  payments: PurchasePayment[];
  /** Сумма проведённых платежей — сколько уже реально оплачено. */
  paidAmount: number;
  /** Сумма запланированных, но ещё не проведённых платежей. */
  plannedAmount: number;
  /** Плановая дата закупки. */
  dueDate?: string | null;
  spentAmount: number;
  spentPaymentId?: string | null;
  /** ID записи зарплаты, если списание шло через ЗП. */
  spentSalaryId?: string | null;
  /** bank | salary — куда ушло списание. */
  spendMode?: PurchaseSpendMode | null;
  /** true = платёж/ЗП «вне баланса». */
  excludeFromBalance?: boolean;
  spentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PURCHASE_ACCOUNT_LABEL: Record<PurchaseAccount, string> = {
  cash: "Наличная касса",
  bank: "Расчётный счёт",
  ym_card: "Карта ЮМ",
};

export const PURCHASE_SPEND_MODE_LABEL: Record<PurchaseSpendMode, string> = {
  bank: "Платёж в банке",
  salary: "Выплата в ЗП",
};

/** Сколько реально оплачено: только проведённые платежи. */
export function purchasePaidAmount(
  payments: PurchasePayment[] | null | undefined
): number {
  return (
    Math.round(
      (payments || [])
        .filter((payment) => payment.isPaid)
        .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) * 100
    ) / 100
  );
}

/** Запланировано, но ещё не проведено. */
export function purchasePlannedAmount(
  payments: PurchasePayment[] | null | undefined
): number {
  return (
    Math.round(
      (payments || [])
        .filter((payment) => !payment.isPaid)
        .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) * 100
    ) / 100
  );
}

export function purchaseSavedAmount(
  contributions: PurchaseContribution[] | null | undefined
): number {
  return Math.round(
    (contributions || []).reduce(
      (sum, contribution) => sum + Math.max(0, Number(contribution.amount) || 0),
      0
    ) * 100
  ) / 100;
}
