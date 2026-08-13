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
  const selectedPlan =
    visiblePlans.find((plan) => plan.id === targetPlanId) || visiblePlans[0] || null;

  function switchArchive(completed: boolean) {
    setShowCompleted(completed);
    const nextPlans = completed ? completedPlans : activePlans;
    setTargetPlanId(nextPlans[0]?.id || "");
  }

  return (
    <div className="supply-planning">
      <header className="supply-planning__hero">
        <div className="supply-planning__hero-copy">
          <span className="supply-planning__eyebrow">
            <Lightbulb size={13} /> Планирование закупок
          </span>
          <h2>Планы поставок</h2>
          <p>Разделяйте будущие закупки на отдельные поставки и заранее оценивайте бюджет.</p>
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
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saved ? (
              <CheckCircle2 size={14} />
            ) : (
              <Save size={14} />
            )}
            {saved ? "Сохранено" : dirty ? "Сохранить изменения" : "Всё сохранено"}
          </button>
        </div>
      </header>

      <div className="supply-planning__stats">
        <div><span>Активные планы</span><strong>{activePlans.length}</strong></div>
        <div><span>Товарные позиции</span><strong>{activeItems}</strong></div>
        <div><span>Примерный бюджет</span><strong>{fmt(activeTotal)} ₽</strong></div>
      </div>

      {error && <div className="admin-form-error">{error}</div>}

      <div className="supply-planning__workspace">
        <aside className="supply-planning__sidebar">
          <div className="supply-planning__sidebar-head">
            <div>
              <strong>Список поставок</strong>
              <span>Выберите план для редактирования</span>
            </div>
            <button type="button" className="admin-btn admin-btn--primary admin-btn--sm" onClick={createPlan} title="Создать план">
              <Plus size={14} />
            </button>
          </div>

          <div className="supply-planning__switch" role="tablist" aria-label="Статус планов">
            <button
              type="button"
              className={!showCompleted ? "is-active" : ""}
              onClick={() => switchArchive(false)}
            >
              Активные <span>{activePlans.length}</span>
            </button>
            <button
              type="button"
              className={showCompleted ? "is-active" : ""}
              onClick={() => switchArchive(true)}
            >
              Завершённые <span>{completedPlans.length}</span>
            </button>
          </div>

          <div className="supply-planning__plan-list">
            {visiblePlans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                className={`supply-planning__plan-nav${selectedPlan?.id === plan.id ? " is-active" : ""}`}
                onClick={() => setTargetPlanId(plan.id)}
              >
                <span className="supply-planning__plan-nav-icon"><Lightbulb size={15} /></span>
                <span className="supply-planning__plan-nav-copy">
                  <strong>{plan.name || "Без названия"}</strong>
                  <small>
                    {plan.items.length} поз. · {plan.plannedDate ? new Date(`${plan.plannedDate}T00:00:00`).toLocaleDateString("ru-RU") : "без даты"}
                  </small>
                </span>
                <b>{fmt(supplyPlanTotal(plan))} ₽</b>
              </button>
            ))}
          </div>

          {visiblePlans.length === 0 && (
            <div className="supply-planning__sidebar-empty">
              <Lightbulb size={22} />
              <span>{showCompleted ? "Завершённых планов нет" : "Планов пока нет"}</span>
              {!showCompleted && (
                <button type="button" className="admin-btn admin-btn--primary admin-btn--sm" onClick={createPlan}>
                  <Plus size={13} /> Создать
                </button>
              )}
            </div>
          )}
        </aside>

        <main className="supply-planning__content">
          {!selectedPlan ? (
            <div className="supply-planning__content-empty">
              <Lightbulb size={38} />
              <strong>Выберите или создайте план поставки</strong>
              <span>Здесь появятся товары, поставщики и примерный расчёт.</span>
            </div>
          ) : (
            <section className="supply-plan-editor">
              <div className="supply-plan-editor__head">
                <div className="supply-plan-editor__title">
                  <span><Lightbulb size={18} /></span>
                  <div>
                    <label className="admin-label">Название поставки</label>
                    <input
                      className="admin-input"
                      value={selectedPlan.name}
                      onChange={(event) => patchPlan(selectedPlan.id, { name: event.target.value })}
                      placeholder="Например: Плёнка на август"
                    />
                  </div>
                </div>
                <div className="supply-plan-editor__summary">
                  <span>{selectedPlan.items.length} позиций</span>
                  <strong>≈ {fmt(supplyPlanTotal(selectedPlan))} ₽</strong>
                </div>
              </div>

              <div className="supply-plan-editor__meta">
                <label className="admin-field">
                  <span className="admin-label"><CalendarDays size={13} /> Плановая дата</span>
                  <input
                    type="date"
                    className="admin-input"
                    value={selectedPlan.plannedDate || ""}
                    onChange={(event) => patchPlan(selectedPlan.id, { plannedDate: event.target.value || null })}
                  />
                </label>
                <label className="admin-field">
                  <span className="admin-label">Заметка к поставке</span>
                  <input
                    className="admin-input"
                    value={selectedPlan.comment || ""}
                    onChange={(event) => patchPlan(selectedPlan.id, { comment: event.target.value || null })}
                    placeholder="Сроки, условия, договорённости…"
                  />
                </label>
              </div>

              {selectedPlan.status === "active" && (
                <div className="supply-plan-add">
                  <div className="supply-plan-add__head">
                    <div>
                      <strong><Plus size={14} /> Добавить товар</strong>
                      <span>Сначала найдите товар, затем уточните поставщика и расчёт.</span>
                    </div>
                  </div>

                  <div className="supply-plan-add__picker">
                    <ProductPicker products={products} onPick={chooseProduct} />
                  </div>

                  {selectedProduct ? (
                    <div className="supply-plan-add__draft">
                      <div className="supply-plan-add__product">
                        <strong>{selectedProduct.name}</strong>
                        <span>
                          {selectedProduct.sku ? `арт. ${selectedProduct.sku} · ` : ""}
                          остаток {selectedProduct.stockQty} шт.
                        </span>
                      </div>
                      <label className="admin-field">
                        <span className="admin-label">Поставщик</span>
                        <select
                          className="admin-select"
                          value={supplierId}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            setSupplierId(nextId);
                            setEstimatedPrice(supplierPrice(nextId, selectedProduct.id));
                          }}
                        >
                          <option value="">Выберите поставщика</option>
                          {suppliers.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.name}
                              {supplier.supplierPrices?.[selectedProduct.id] !== undefined
                                ? ` · ${fmt(Number(supplier.supplierPrices[selectedProduct.id]) || 0)} ₽`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-field">
                        <span className="admin-label">Количество</span>
                        <input
                          className="admin-input"
                          type="number"
                          min={0.001}
                          step="any"
                          value={quantity}
                          onChange={(event) => setQuantity(Math.max(0.001, Number(event.target.value) || 1))}
                        />
                      </label>
                      <label className="admin-field">
                        <span className="admin-label">Цена за единицу</span>
                        <input
                          className="admin-input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={estimatedPrice}
                          onChange={(event) => setEstimatedPrice(Math.max(0, Number(event.target.value) || 0))}
                        />
                      </label>
                      <label className="admin-field">
                        <span className="admin-label">НДС</span>
                        <select className="admin-select" value={vatRate} onChange={(event) => setVatRate(Number(event.target.value))}>
                          <option value={22}>22%</option>
                          <option value={20}>20%</option>
                          <option value={10}>10%</option>
                          <option value={0}>0%</option>
                          <option value={-1}>Без НДС</option>
                        </select>
                      </label>
                      <div className="supply-plan-add__result">
                        <span>Сумма позиции</span>
                        <strong>{fmt(quantity * estimatedPrice)} ₽</strong>
                      </div>
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary supply-plan-add__submit"
                        onClick={addItem}
                        disabled={!supplierId}
                      >
                        <Plus size={14} /> Добавить
                      </button>
                    </div>
                  ) : (
                    <div className="supply-plan-add__hint">Выберите товар в поиске выше</div>
                  )}
                </div>
              )}

              <div className="supply-plan-items">
                <div className="supply-plan-items__head">
                  <div>
                    <strong>Состав поставки</strong>
                    <span>{selectedPlan.items.length ? `${selectedPlan.items.length} товарных позиций` : "Пока пусто"}</span>
                  </div>
                </div>

                {selectedPlan.items.length === 0 ? (
                  <div className="supply-plan-items__empty">
                    <Plus size={24} />
                    <span>Добавьте первый товар в этот план</span>
                  </div>
                ) : (
                  <div className="supply-plan-items__list">
                    {selectedPlan.items.map((item) => (
                      <article key={item.id} className="supply-plan-item">
                        <div className="supply-plan-item__head">
                          <div>
                            <Link href={`/${adminPath}/products/${item.productId}`} prefetch={false}>
                              {item.productName}
                            </Link>
                            <span>{item.sku ? `арт. ${item.sku}` : "без артикула"}</span>
                          </div>
                          <div className="supply-plan-item__amount">
                            <span>Сумма</span>
                            <strong>{fmt(item.quantity * item.estimatedPrice)} ₽</strong>
                          </div>
                          <button
                            type="button"
                            className="supply-plan-item__remove"
                            onClick={() => removeItem(selectedPlan.id, item.id)}
                            title="Убрать позицию"
                            aria-label={`Убрать ${item.productName}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div className="supply-plan-item__fields">
                          <label className="admin-field supply-plan-item__supplier">
                            <span className="admin-label">Поставщик</span>
                            <select
                              className="admin-select"
                              value={item.supplierId || ""}
                              onChange={(event) => {
                                const nextSupplier = suppliers.find((supplier) => supplier.id === event.target.value);
                                if (!nextSupplier) return;
                                const nextPrice = supplierPrice(nextSupplier.id, item.productId);
                                patchItem(selectedPlan.id, item.id, {
                                  supplierId: nextSupplier.id,
                                  supplierName: nextSupplier.name,
                                  ...(nextPrice > 0 ? { estimatedPrice: nextPrice } : {}),
                                });
                              }}
                            >
                              <option value="">Не выбран</option>
                              {suppliers.map((supplier) => (
                                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="admin-field">
                            <span className="admin-label">Количество</span>
                            <input
                              className="admin-input"
                              type="number"
                              min={0.001}
                              step="any"
                              value={item.quantity}
                              onChange={(event) => patchItem(selectedPlan.id, item.id, { quantity: Math.max(0.001, Number(event.target.value) || 1) })}
                            />
                          </label>
                          <label className="admin-field">
                            <span className="admin-label">Цена, ₽</span>
                            <input
                              className="admin-input"
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.estimatedPrice}
                              onChange={(event) => patchItem(selectedPlan.id, item.id, { estimatedPrice: Math.max(0, Number(event.target.value) || 0) })}
                            />
                          </label>
                          <label className="admin-field">
                            <span className="admin-label">НДС</span>
                            <select
                              className="admin-select"
                              value={item.vatRate}
                              onChange={(event) => patchItem(selectedPlan.id, item.id, { vatRate: Number(event.target.value) })}
                            >
                              <option value={22}>22%</option>
                              <option value={20}>20%</option>
                              <option value={10}>10%</option>
                              <option value={0}>0%</option>
                              <option value={-1}>без НДС</option>
                            </select>
                          </label>
                          <label className="admin-field supply-plan-item__move">
                            <span className="admin-label">Переместить в</span>
                            <select
                              className="admin-select"
                              value=""
                              disabled={activePlans.filter((entry) => entry.id !== selectedPlan.id).length === 0}
                              onChange={(event) => moveItem(selectedPlan.id, item.id, event.target.value)}
                            >
                              <option value="">Другой план…</option>
                              {activePlans
                                .filter((entry) => entry.id !== selectedPlan.id)
                                .map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                            </select>
                          </label>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <footer className="supply-plan-editor__footer">
                {selectedPlan.status === "active" ? (
                  <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => completePlan(selectedPlan.id)}>
                    <CheckCircle2 size={13} /> Завершить план
                  </button>
                ) : (
                  <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => patchPlan(selectedPlan.id, { status: "active" })}>
                    <RotateCcw size={13} /> Вернуть в активные
                  </button>
                )}
                <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => removePlan(selectedPlan.id)}>
                  <Trash2 size={13} /> Удалить план
                </button>
              </footer>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
