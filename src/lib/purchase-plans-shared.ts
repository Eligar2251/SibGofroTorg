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
  savedAmount: number;
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
