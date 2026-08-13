import "server-only";

import { revalidateTag } from "next/cache";
import { getAdminDb } from "@/lib/supabase";
import type {
  SupplyPlan,
  SupplyPlanItem,
  SupplyPlanStatus,
} from "@/lib/supply-plans-shared";

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function normalizeItem(raw: unknown, index: number): SupplyPlanItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const productId = cleanText(item.productId, 100);
  const productName = cleanText(item.productName, 300);
  if (!productId || !productName) return null;

  return {
    id: cleanText(item.id, 100) || `item-${index}-${productId}`,
    productId,
    productName,
    sku: cleanText(item.sku, 80) || null,
    supplierId: cleanText(item.supplierId, 100) || null,
    supplierName: cleanText(item.supplierName, 200) || "Поставщик не выбран",
    quantity: Math.max(0.001, Math.round(finiteNumber(item.quantity, 1) * 1000) / 1000),
    estimatedPrice: Math.max(0, Math.round(finiteNumber(item.estimatedPrice) * 100) / 100),
    vatRate: Math.max(-1, Math.min(100, Math.round(finiteNumber(item.vatRate, 22) * 100) / 100)),
  };
}

function normalizeStatus(value: unknown): SupplyPlanStatus {
  return value === "completed" ? "completed" : "active";
}

export function normalizeSupplyPlans(raw: unknown): SupplyPlan[] {
  if (!Array.isArray(raw)) return [];
  const now = new Date().toISOString();
  return raw.slice(0, 100).flatMap((entry, planIndex) => {
    if (!entry || typeof entry !== "object") return [];
    const plan = entry as Record<string, unknown>;
    const id = cleanText(plan.id, 100) || `plan-${planIndex}-${Date.now()}`;
    const createdAt = cleanText(plan.createdAt, 40) || now;
    const plannedDate = cleanText(plan.plannedDate, 10);
    const items = Array.isArray(plan.items)
      ? plan.items
          .slice(0, 500)
          .map(normalizeItem)
          .filter((item): item is SupplyPlanItem => item !== null)
      : [];

    return [{
      id,
      name: cleanText(plan.name, 160) || `Поставка ${planIndex + 1}`,
      plannedDate: /^\d{4}-\d{2}-\d{2}$/.test(plannedDate) ? plannedDate : null,
      comment: cleanText(plan.comment, 1000) || null,
      status: normalizeStatus(plan.status),
      items,
      createdAt,
      updatedAt: cleanText(plan.updatedAt, 40) || createdAt,
    } satisfies SupplyPlan];
  });
}

function mapPlanRow(row: Record<string, unknown>): SupplyPlan {
  return normalizeSupplyPlans([{
    id: row.id,
    name: row.name,
    plannedDate: row.planned_date,
    comment: row.comment,
    status: row.status,
    items: row.items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }])[0];
}

export async function getSupplyPlans(): Promise<SupplyPlan[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("warehouse_supply_plans")
    .select("*")
    .order("status", { ascending: true })
    .order("planned_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    // До применения миграции не роняем весь дашборд. Запись через API
    // всё равно вернёт понятную ошибку о необходимости миграции.
    if (error.code === "42P01" || error.message.includes("does not exist")) return [];
    throw error;
  }
  return (data || []).map((row) => mapPlanRow(row as Record<string, unknown>));
}

export async function saveSupplyPlans(raw: unknown): Promise<SupplyPlan[]> {
  const db = getAdminDb();
  const now = new Date().toISOString();
  const plans = normalizeSupplyPlans(raw).map((plan) => ({ ...plan, updatedAt: now }));

  const { data: existingRows, error: readError } = await db
    .from("warehouse_supply_plans")
    .select("id");
  if (readError) {
    if (readError.code === "42P01" || readError.message.includes("does not exist")) {
      throw new Error("Примените миграцию migration_supply_plans.sql");
    }
    throw readError;
  }

  if (plans.length > 0) {
    const { error: upsertError } = await db.from("warehouse_supply_plans").upsert(
      plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        planned_date: plan.plannedDate || null,
        comment: plan.comment || null,
        status: plan.status,
        items: plan.items,
        created_at: plan.createdAt,
        updated_at: plan.updatedAt,
      })),
      { onConflict: "id" }
    );
    if (upsertError) throw upsertError;
  }

  const keep = new Set(plans.map((plan) => plan.id));
  for (const row of existingRows || []) {
    const id = String(row.id);
    if (keep.has(id)) continue;
    const { error: deleteError } = await db
      .from("warehouse_supply_plans")
      .delete()
      .eq("id", id);
    if (deleteError) throw deleteError;
  }

  revalidateTag("supply-plans", { expire: 0 });
  return plans;
}
