export type PurchaseAccount = "cash" | "bank" | "ym_card";
export type PurchasePlanStatus = "active" | "completed";

export interface PurchaseContribution {
  id: string;
  date: string;
  amount: number;
  note?: string | null;
  createdAt: string;
}

export interface PurchasePlan {
  id: string;
  productId: string;
  productName: string;
  sku?: string | null;
  targetAmount: number;
  contributionAmount: number;
  account: PurchaseAccount;
  status: PurchasePlanStatus;
  contributions: PurchaseContribution[];
  savedAmount: number;
  spentAmount: number;
  spentPaymentId?: string | null;
  spentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PURCHASE_ACCOUNT_LABEL: Record<PurchaseAccount, string> = {
  cash: "Наличная касса",
  bank: "Расчётный счёт",
  ym_card: "Карта ЮМ",
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
