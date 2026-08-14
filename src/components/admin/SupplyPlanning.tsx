"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Lightbulb,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { ProductPicker, type PickerProduct } from "@/components/admin/ProductPicker";
import {
  supplyPlansItemsCount,
  type SupplyPlan,
  type SupplyPlanItem,
} from "@/lib/supply-plans-shared";

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(raw?: string | null): string {
  if (!raw) return "Без даты";
  const [year, month, day] = raw.split("-");
  return day && month && year ? `${day}.${month}.${year}` : raw;
}

export function SupplyPlanning({
  initialPlans,
  products,
  initialProductId,
}: {
  initialPlans: SupplyPlan[];
  products: PickerProduct[];
  initialProductId?: string | null;
}) {
  const [plans, setPlans] = useState(initialPlans);
  const [showCompleted, setShowCompleted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [targetPlanId, setTargetPlanId] = useState(
    initialPlans.find((plan) => plan.status === "active")?.id || ""
  );
  const [selectedProduct, setSelectedProduct] = useState<PickerProduct | null>(null);
  const [quantity, setQuantity] = useState(1);

  // После client-side перехода данные приходят новыми props. Не оставляем
  // пустое состояние от предыдущей вкладки — это и выглядело как сломанный переход.
  useEffect(() => {
    if (dirty) return;
    setPlans(initialPlans);
    setTargetPlanId((current) =>
      initialPlans.some((plan) => plan.id === current)
        ? current
        : initialPlans.find((plan) => plan.status === "active")?.id || ""
    );
  }, [dirty, initialPlans]);

  useEffect(() => {
    if (!initialProductId || selectedProduct) return;
    const product = products.find((item) => item.id === initialProductId);
    if (product) setSelectedProduct(product);
  }, [initialProductId, products, selectedProduct]);

  const activePlans = useMemo(
    () => plans.filter((plan) => plan.status === "active"),
    [plans]
  );
  const completedPlans = useMemo(
    () => plans.filter((plan) => plan.status === "completed"),
    [plans]
  );
  const visiblePlans = showCompleted ? completedPlans : activePlans;
  const selectedPlan =
    visiblePlans.find((plan) => plan.id === targetPlanId) || visiblePlans[0] || null;

  function markChanged(next: SupplyPlan[]) {
    setPlans(next);
    setDirty(true);
    setSaved(false);
  }

  function createPlan() {
    const now = new Date().toISOString();
    const plan: SupplyPlan = {
      id: newId("plan"),
      name: `Поставка ${activePlans.length + 1}`,
      plannedDate: todayIso(),
      comment: null,
      status: "active",
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    markChanged([...plans, plan]);
    setTargetPlanId(plan.id);
    setShowCompleted(false);
  }

  function patchPlan(planId: string, patch: Partial<SupplyPlan>) {
    markChanged(
      plans.map((plan) =>
        plan.id === planId
          ? { ...plan, ...patch, updatedAt: new Date().toISOString() }
          : plan
      )
    );
  }

  function patchItem(planId: string, itemId: string, patch: Partial<SupplyPlanItem>) {
    markChanged(
      plans.map((plan) =>
        plan.id === planId
          ? {
              ...plan,
              items: plan.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item
              ),
              updatedAt: new Date().toISOString(),
            }
          : plan
      )
    );
  }

  function addItem() {
    const plan = plans.find(
      (entry) => entry.id === targetPlanId && entry.status === "active"
    );
    if (!plan || !selectedProduct) {
      setError("Выберите активный план и товар");
      return;
    }
    const existing = plan.items.find((item) => item.productId === selectedProduct.id);
    if (existing) {
      patchItem(plan.id, existing.id, {
        quantity: existing.quantity + Math.max(0.001, Number(quantity) || 1),
      });
    } else {
      const item: SupplyPlanItem = {
        id: newId("item"),
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        sku: selectedProduct.sku,
        supplierId: null,
        supplierName: "",
        quantity: Math.max(0.001, Number(quantity) || 1),
        estimatedPrice: 0,
        vatRate: 0,
      };
      patchPlan(plan.id, { items: [...plan.items, item] });
    }
    setSelectedProduct(null);
    setQuantity(1);
    setError("");
  }

  function removeItem(planId: string, itemId: string) {
    const plan = plans.find((entry) => entry.id === planId);
    if (plan) patchPlan(planId, { items: plan.items.filter((item) => item.id !== itemId) });
  }

  function moveItem(fromPlanId: string, itemId: string, toPlanId: string) {
    if (!toPlanId || fromPlanId === toPlanId) return;
    const item = plans.find((plan) => plan.id === fromPlanId)?.items.find((row) => row.id === itemId);
    if (!item) return;
    const now = new Date().toISOString();
    markChanged(
      plans.map((plan) => {
        if (plan.id === fromPlanId) {
          return { ...plan, items: plan.items.filter((row) => row.id !== itemId), updatedAt: now };
        }
        if (plan.id === toPlanId) {
          return { ...plan, items: [...plan.items, item], updatedAt: now };
        }
        return plan;
      })
    );
  }

  function removePlan(plan: SupplyPlan) {
    if (!confirm(`Удалить план «${plan.name}» вместе с позициями?`)) return;
    const next = plans.filter((entry) => entry.id !== plan.id);
    markChanged(next);
    if (targetPlanId === plan.id) {
      setTargetPlanId(next.find((entry) => entry.status === "active")?.id || "");
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/supply-plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plans }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить планы");
      setPlans(Array.isArray(body.plans) ? body.plans : plans);
      setDirty(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  function switchArchive(completed: boolean) {
    setShowCompleted(completed);
    const next = completed ? completedPlans : activePlans;
    setTargetPlanId(next[0]?.id || "");
  }

  return (
    <div className="supply-planning supply-planning--simple">
      <header className="supply-planning__hero">
        <div className="supply-planning__hero-copy">
          <span className="supply-planning__eyebrow"><Lightbulb size={13} /> Список будущих поставок</span>
          <h2>Планы поставок</h2>
          <p>Только позиции и количество — без цен, бюджета и тяжёлой загрузки прайсов.</p>
        </div>
        <div className="supply-planning__actions">
          <button type="button" className="admin-btn admin-btn--ghost" onClick={createPlan}><Plus size={14} /> Новый план</button>
          <button type="button" className="admin-btn admin-btn--primary" disabled={!dirty || saving} onClick={save}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saved ? "Сохранено" : dirty ? "Сохранить" : "Всё сохранено"}
          </button>
        </div>
      </header>

      <div className="supply-planning__stats">
        <div><span>Активные планы</span><strong>{activePlans.length}</strong></div>
        <div><span>Позиций</span><strong>{supplyPlansItemsCount(activePlans)}</strong></div>
        <div><span>Архив</span><strong>{completedPlans.length}</strong></div>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="supply-planning__workspace">
        <aside className="supply-plan-list">
          <div className="supply-plan-list__tabs">
            <button type="button" className={!showCompleted ? "is-active" : ""} onClick={() => switchArchive(false)}>Активные</button>
            <button type="button" className={showCompleted ? "is-active" : ""} onClick={() => switchArchive(true)}>Архив</button>
          </div>
          <div className="supply-plan-list__scroll">
            {visiblePlans.map((plan) => (
              <button key={plan.id} type="button" className={`supply-plan-card${selectedPlan?.id === plan.id ? " is-active" : ""}`} onClick={() => setTargetPlanId(plan.id)}>
                <span className="supply-plan-card__title">{plan.name}</span>
                <span className="supply-plan-card__meta"><CalendarDays size={11} /> {formatDate(plan.plannedDate)} · {plan.items.length} поз.</span>
              </button>
            ))}
            {visiblePlans.length === 0 && <div className="supply-plan-list__empty">{showCompleted ? "Архив пуст" : "Создайте первый план"}</div>}
          </div>
        </aside>

        <main className="supply-plan-editor">
          {!selectedPlan ? (
            <div className="admin-empty"><Lightbulb size={28} /><p>Выберите или создайте план</p></div>
          ) : (
            <section>
              <div className="supply-plan-editor__head">
                <input className="supply-plan-editor__name" value={selectedPlan.name} disabled={selectedPlan.status === "completed"} onChange={(event) => patchPlan(selectedPlan.id, { name: event.target.value })} />
                <label><span>Дата</span><input type="date" className="admin-input" value={selectedPlan.plannedDate || ""} disabled={selectedPlan.status === "completed"} onChange={(event) => patchPlan(selectedPlan.id, { plannedDate: event.target.value || null })} /></label>
              </div>

              {selectedPlan.status === "active" && (
                <div className="supply-plan-add supply-plan-add--simple">
                  <ProductPicker products={products} onPick={setSelectedProduct} placeholder="Добавить товар в поставку…" showPrice={false} />
                  {selectedProduct && (
                    <div className="supply-plan-add__draft">
                      <strong>{selectedProduct.name}</strong>
                      <label className="admin-field"><span className="admin-label">Количество</span><input className="admin-input" type="number" min={0.001} step="any" value={quantity} onChange={(event) => setQuantity(Math.max(0.001, Number(event.target.value) || 1))} /></label>
                      <button type="button" className="admin-btn admin-btn--primary" onClick={addItem}><Plus size={14} /> Добавить</button>
                    </div>
                  )}
                </div>
              )}

              <div className="supply-plan-items">
                <div className="supply-plan-items__head"><div><strong>Позиции</strong><span>{selectedPlan.items.length ? `${selectedPlan.items.length} позиций` : "Пока пусто"}</span></div></div>
                {selectedPlan.items.length === 0 ? (
                  <div className="supply-plan-items__empty"><Plus size={24} /><span>Добавьте товар</span></div>
                ) : (
                  <div className="supply-plan-items__list">
                    {selectedPlan.items.map((item) => (
                      <article key={item.id} className="supply-plan-item supply-plan-item--simple">
                        <div className="supply-plan-item__head">
                          <div><strong>{item.productName}</strong><span>{item.sku ? `арт. ${item.sku}` : "без артикула"}</span></div>
                          <label className="admin-field"><span className="admin-label">Количество</span><input className="admin-input" type="number" min={0.001} step="any" value={item.quantity} disabled={selectedPlan.status === "completed"} onChange={(event) => patchItem(selectedPlan.id, item.id, { quantity: Math.max(0.001, Number(event.target.value) || 1) })} /></label>
                          {selectedPlan.status === "active" && activePlans.length > 1 && (
                            <label className="admin-field"><span className="admin-label">Переместить</span><select className="admin-select" value="" onChange={(event) => moveItem(selectedPlan.id, item.id, event.target.value)}><option value="">В другой план…</option>{activePlans.filter((entry) => entry.id !== selectedPlan.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
                          )}
                          {selectedPlan.status === "active" && <button type="button" className="supply-plan-item__remove" onClick={() => removeItem(selectedPlan.id, item.id)} aria-label={`Убрать ${item.productName}`}><Trash2 size={14} /></button>}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <footer className="supply-plan-editor__footer">
                {selectedPlan.status === "active" ? <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => patchPlan(selectedPlan.id, { status: "completed" })}><CheckCircle2 size={13} /> Завершить</button> : <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => patchPlan(selectedPlan.id, { status: "active" })}><RotateCcw size={13} /> Вернуть</button>}
                <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => removePlan(selectedPlan)}><Trash2 size={13} /> Удалить</button>
              </footer>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
