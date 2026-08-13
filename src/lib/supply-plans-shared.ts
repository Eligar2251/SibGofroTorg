export type SupplyPlanStatus = "active" | "completed";

export interface SupplyPlanItem {
  id: string;
  productId: string;
  productName: string;
  sku?: string | null;
  supplierId?: string | null;
  supplierName: string;
  quantity: number;
  estimatedPrice: number;
  vatRate: number;
}

export interface SupplyPlan {
  id: string;
  name: string;
  plannedDate?: string | null;
  comment?: string | null;
  status: SupplyPlanStatus;
  items: SupplyPlanItem[];
  createdAt: string;
  updatedAt: string;
}

export function supplyPlanTotal(plan: Pick<SupplyPlan, "items">): number {
  return Math.round(
    plan.items.reduce(
      (sum, item) =>
        sum + (Number(item.quantity) || 0) * (Number(item.estimatedPrice) || 0),
      0
    ) * 100
  ) / 100;
}

export function supplyPlansTotal(plans: Pick<SupplyPlan, "items">[]): number {
  return Math.round(plans.reduce((sum, plan) => sum + supplyPlanTotal(plan), 0) * 100) / 100;
}

export function supplyPlansItemsCount(plans: Pick<SupplyPlan, "items">[]): number {
  return plans.reduce((sum, plan) => sum + plan.items.length, 0);
}
