"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import type { CounterpartyOption } from "@/components/admin/WarehouseCounterparties";
import {
  supplyPlanTotal,
  supplyPlansItemsCount,
  supplyPlansTotal,
  type SupplyPlan,
  type SupplyPlanItem,
} from "@/lib/supply-plans-shared";

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const fmt = (value: number) => value.toLocaleString("ru-RU", {
  maximumFractionDigits: 2,
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SupplyPlanning({
  initialPlans,
  products,
  counterparties,
  adminPath,
  initialProductId,
  initialSupplierId,
}: {
  initialPlans: SupplyPlan[];
  products: PickerProduct[];
  counterparties: CounterpartyOption[];
  adminPath: string;
  initialProductId?: string | null;
  initialSupplierId?: string | null;
}) {
  const suppliers = useMemo(
    () => counterparties.filter((item) => item.roles.includes("supplier")),
    [counterparties]
  );
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
  const [supplierId, setSupplierId] = useState(initialSupplierId || "");
  const [quantity, setQuantity] = useState(1);
  const [estimatedPrice, setEstimatedPrice] = useState(0);
  const [vatRate, setVatRate] = useState(22);

  const activePlans = plans.filter((plan) => plan.status === "active");
  const completedPlans = plans.filter((plan) => plan.status === "completed");
  const visiblePlans = showCompleted ? completedPlans : activePlans;

  function markChanged(next: SupplyPlan[]) {
    setPlans(next);
    setDirty(true);
    setSaved(false);
  }

  function supplierPrice(nextSupplierId: string, productId: string): number {
    const supplier = suppliers.find((item) => item.id === nextSupplierId);
    return Math.max(0, Number(supplier?.supplierPrices?.[productId]) || 0);
  }

  function chooseProduct(product: PickerProduct) {
    setSelectedProduct(product);
    const priced = suppliers
      .filter((item) => item.supplierPrices?.[product.id] !== undefined)
      .sort(
        (a, b) =>
          (Number(a.supplierPrices?.[product.id]) || 0) -
          (Number(b.supplierPrices?.[product.id]) || 0)
      );
    const preferred =
      suppliers.find((item) => item.id === supplierId) || priced[0] || suppliers[0];
    const nextSupplierId = preferred?.id || "";
    setSupplierId(nextSupplierId);
    setEstimatedPrice(
      supplierPrice(nextSupplierId, product.id) ||
        Math.max(0, Number(product.purchasePrice) || 0)
    );
  }

  useEffect(() => {
    if (!initialProductId || selectedProduct) return;
    const product = products.find((item) => item.id === initialProductId);
    if (product) chooseProduct(product);
    // Начальный товар нужен только при первом открытии ссылки из поставщика.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProductId, products]);

  function createPlan() {
    const now = new Date().toISOString();
    const nextPlan: SupplyPlan = {
      id: newId("plan"),
      name: `Поставка ${activePlans.length + 1}`,
      plannedDate: todayIso(),
      comment: null,
      status: "active",
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    markChanged([...plans, nextPlan]);
    setTargetPlanId(nextPlan.id);
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
    const targetPlan = plans.find(
      (plan) => plan.id === targetPlanId && plan.status === "active"
    );
    if (!targetPlan || !selectedProduct) {
      setError("Выберите активный план и товар");
      return;
    }
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (!supplier) {
      setError("Укажите, у какого поставщика планируется заказ");
      return;
    }
    const item: SupplyPlanItem = {
      id: newId("item"),
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      sku: selectedProduct.sku,
      supplierId: supplier.id,
      supplierName: supplier.name,
      quantity: Math.max(0.001, Number(quantity) || 1),
      estimatedPrice: Math.max(0, Number(estimatedPrice) || 0),
      vatRate: Number(vatRate),
    };
    markChanged(
      plans.map((plan) =>
        plan.id === targetPlanId
          ? { ...plan, items: [...plan.items, item], updatedAt: new Date().toISOString() }
          : plan
      )
    );
    setSelectedProduct(null);
    setQuantity(1);
    setEstimatedPrice(0);
    setError("");
  }

  function removeItem(planId: string, itemId: string) {
    const plan = plans.find((entry) => entry.id === planId);
    if (!plan) return;
    patchPlan(planId, { items: plan.items.filter((item) => item.id !== itemId) });
  }

  function moveItem(fromPlanId: string, itemId: string, toPlanId: string) {
    if (!toPlanId || fromPlanId === toPlanId) return;
    const source = plans.find((plan) => plan.id === fromPlanId);
    const item = source?.items.find((entry) => entry.id === itemId);
    if (!source || !item) return;
    const now = new Date().toISOString();
    markChanged(
      plans.map((plan) => {
        if (plan.id === fromPlanId) {
          return { ...plan, items: plan.items.filter((entry) => entry.id !== itemId), updatedAt: now };
        }
        if (plan.id === toPlanId) {
          return { ...plan, items: [...plan.items, item], updatedAt: now };
        }
        return plan;
      })
    );
  }

  function completePlan(planId: string) {
    patchPlan(planId, { status: "completed" });
    if (targetPlanId === planId) {
      setTargetPlanId(
        activePlans.find((plan) => plan.id !== planId)?.id || ""
      );
    }
  }

  function removePlan(planId: string) {
    const plan = plans.find((entry) => entry.id === planId);
    if (!plan || !confirm(`Удалить план «${plan.name}» вместе с его позициями?`)) return;
    const next = plans.filter((entry) => entry.id !== planId);
    markChanged(next);
    if (targetPlanId === planId) {
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
      window.setTimeout(() => setSaved(false), 1800);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить планы");
    } finally {
      setSaving(false);
    }
  }

  const activeTotal = supplyPlansTotal(activePlans);
  const activeItems = supplyPlansItemsCount(activePlans);

  return (
    <div className="supply-planning">
      <div className="supply-planning__hero">
        <div>
          <span className="supply-planning__eyebrow"><Lightbulb size={13} /> Планирование закупок</span>
          <h2>Планы поставок</h2>
          <p>
            Собирайте примерные поставки заранее, выбирайте поставщика для каждой позиции
            и переносите товары между разными планами.
          </p>
        </div>
        <div className="supply-planning__actions">
          <button type="button" className="admin-btn admin-btn--ghost" onClick={createPlan}>
            <Plus size={14} /> Новый план
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saved ? "Сохранено" : "Сохранить планы"}
          </button>
        </div>
      </div>

      <div className="supply-planning__stats">
        <div><span>Активных планов</span><strong>{activePlans.length}</strong></div>
        <div><span>Позиций</span><strong>{activeItems}</strong></div>
        <div><span>Примерный бюджет</span><strong>{fmt(activeTotal)} ₽</strong></div>
      </div>

      {error && <div className="admin-form-error">{error}</div>}

      <div className="admin-card supply-planning__add">
        <div className="admin-card__head">
          <div>
            <h3 className="admin-card__title">Добавить товар в план</h3>
            <div className="admin-muted" style={{ fontSize: 12 }}>
              Цена подставится из прайса выбранного поставщика, но её можно изменить для примерного расчёта.
            </div>
          </div>
        </div>
        <div className="admin-card__pad supply-planning__add-grid">
          <div className="admin-field supply-planning__product-picker">
            <label className="admin-label">Товар</label>
            <ProductPicker products={products} onPick={chooseProduct} />
            {selectedProduct && (
              <div className="supply-planning__selected-product">
                <strong>{selectedProduct.name}</strong>
                <span>{selectedProduct.sku ? `арт. ${selectedProduct.sku} · ` : ""}остаток {selectedProduct.stockQty} шт.</span>
              </div>
            )}
          </div>
          <div className="admin-field">
            <label className="admin-label">В какой план</label>
            <select className="admin-select" value={targetPlanId} onChange={(event) => setTargetPlanId(event.target.value)}>
              <option value="">Выберите план</option>
              {activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </div>
          <div className="admin-field">
            <label className="admin-label">Откуда заказываем</label>
            <select
              className="admin-select"
              value={supplierId}
              onChange={(event) => {
                const nextId = event.target.value;
                setSupplierId(nextId);
                if (selectedProduct) setEstimatedPrice(supplierPrice(nextId, selectedProduct.id));
              }}
            >
              <option value="">Выберите поставщика</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                  {selectedProduct && supplier.supplierPrices?.[selectedProduct.id] !== undefined
                    ? ` · ${fmt(Number(supplier.supplierPrices[selectedProduct.id]) || 0)} ₽`
                    : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-field">
            <label className="admin-label">Количество</label>
            <input className="admin-input" type="number" min={0.001} step="any" value={quantity} onChange={(event) => setQuantity(Math.max(0.001, Number(event.target.value) || 1))} />
          </div>
          <div className="admin-field">
            <label className="admin-label">Примерная цена, ₽</label>
            <input className="admin-input" type="number" min={0} step="0.01" value={estimatedPrice} onChange={(event) => setEstimatedPrice(Math.max(0, Number(event.target.value) || 0))} />
          </div>
          <div className="admin-field">
            <label className="admin-label">НДС</label>
            <select className="admin-select" value={vatRate} onChange={(event) => setVatRate(Number(event.target.value))}>
              <option value={22}>22%</option>
              <option value={20}>20%</option>
              <option value={10}>10%</option>
              <option value={0}>0%</option>
              <option value={-1}>Без НДС</option>
            </select>
          </div>
          <button type="button" className="admin-btn admin-btn--primary supply-planning__add-btn" onClick={addItem} disabled={!selectedProduct || !targetPlanId || !supplierId}>
            <Plus size={14} /> Добавить в план
          </button>
        </div>
      </div>

      <div className="admin-filters admin-filters--sub">
        <button type="button" className={`admin-filter${!showCompleted ? " admin-filter--active" : ""}`} onClick={() => setShowCompleted(false)}>
          Активные ({activePlans.length})
        </button>
        <button type="button" className={`admin-filter${showCompleted ? " admin-filter--active" : ""}`} onClick={() => setShowCompleted(true)}>
          Завершённые ({completedPlans.length})
        </button>
      </div>

      {visiblePlans.length === 0 ? (
        <div className="admin-empty supply-planning__empty">
          <Lightbulb size={34} />
          <p>{showCompleted ? "Завершённых планов пока нет" : "Создайте первый план поставки и добавьте в него товары"}</p>
          {!showCompleted && <button type="button" className="admin-btn admin-btn--primary" onClick={createPlan}><Plus size={14} /> Новый план</button>}
        </div>
      ) : (
        <div className="supply-planning__plans">
          {visiblePlans.map((plan) => (
            <section key={plan.id} className="admin-card supply-plan-card">
              <div className="supply-plan-card__head">
                <div className="supply-plan-card__identity">
                  <Lightbulb size={18} />
                  <input className="admin-input supply-plan-card__name" value={plan.name} onChange={(event) => patchPlan(plan.id, { name: event.target.value })} aria-label="Название плана" />
                </div>
                <div className="supply-plan-card__total">
                  <span>{plan.items.length} поз.</span>
                  <strong>≈ {fmt(supplyPlanTotal(plan))} ₽</strong>
                </div>
              </div>

              <div className="supply-plan-card__meta">
                <label>
                  <CalendarDays size={13} /> Плановая дата
                  <input type="date" className="admin-input" value={plan.plannedDate || ""} onChange={(event) => patchPlan(plan.id, { plannedDate: event.target.value || null })} />
                </label>
                <label className="supply-plan-card__comment">
                  Заметка
                  <input className="admin-input" value={plan.comment || ""} onChange={(event) => patchPlan(plan.id, { comment: event.target.value || null })} placeholder="Например: заказать после согласования цены" />
                </label>
              </div>

              {plan.items.length > 0 ? (
                <div className="admin-table-wrap">
                  <table className="admin-table supply-plan-table">
                    <thead>
                      <tr><th>Товар</th><th>Поставщик</th><th>Кол-во</th><th>Цена, ₽</th><th>НДС</th><th>Сумма</th><th>Переместить</th><th /></tr>
                    </thead>
                    <tbody>
                      {plan.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <Link href={`/${adminPath}/products/${item.productId}`} prefetch={false}><strong>{item.productName}</strong></Link>
                            {item.sku && <small>арт. {item.sku}</small>}
                          </td>
                          <td>
                            <select
                              className="admin-select"
                              value={item.supplierId || ""}
                              onChange={(event) => {
                                const nextSupplier = suppliers.find((supplier) => supplier.id === event.target.value);
                                if (!nextSupplier) return;
                                const nextPrice = supplierPrice(nextSupplier.id, item.productId);
                                patchItem(plan.id, item.id, {
                                  supplierId: nextSupplier.id,
                                  supplierName: nextSupplier.name,
                                  ...(nextPrice > 0 ? { estimatedPrice: nextPrice } : {}),
                                });
                              }}
                            >
                              <option value="">Не выбран</option>
                              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                            </select>
                          </td>
                          <td><input className="admin-input" type="number" min={0.001} step="any" value={item.quantity} onChange={(event) => patchItem(plan.id, item.id, { quantity: Math.max(0.001, Number(event.target.value) || 1) })} /></td>
                          <td><input className="admin-input" type="number" min={0} step="0.01" value={item.estimatedPrice} onChange={(event) => patchItem(plan.id, item.id, { estimatedPrice: Math.max(0, Number(event.target.value) || 0) })} /></td>
                          <td>
                            <select className="admin-select" value={item.vatRate} onChange={(event) => patchItem(plan.id, item.id, { vatRate: Number(event.target.value) })}>
                              <option value={22}>22%</option><option value={20}>20%</option><option value={10}>10%</option><option value={0}>0%</option><option value={-1}>без НДС</option>
                            </select>
                          </td>
                          <td><strong>{fmt(item.quantity * item.estimatedPrice)} ₽</strong></td>
                          <td>
                            {activePlans.filter((entry) => entry.id !== plan.id).length > 0 ? (
                              <select className="admin-select" value="" onChange={(event) => moveItem(plan.id, item.id, event.target.value)} title="Переместить позицию в другой план">
                                <option value="">Выбрать…</option>
                                {activePlans.filter((entry) => entry.id !== plan.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                              </select>
                            ) : <span className="admin-muted">—</span>}
                          </td>
                          <td><button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => removeItem(plan.id, item.id)} title="Убрать позицию"><Trash2 size={13} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="supply-plan-card__empty">В этом плане пока нет товаров</div>
              )}

              <div className="supply-plan-card__footer">
                {plan.status === "active" ? (
                  <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => completePlan(plan.id)}><CheckCircle2 size={13} /> Завершить план</button>
                ) : (
                  <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => patchPlan(plan.id, { status: "active" })}><RotateCcw size={13} /> Вернуть в активные</button>
                )}
                <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => removePlan(plan.id)}><Trash2 size={13} /> Удалить</button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
