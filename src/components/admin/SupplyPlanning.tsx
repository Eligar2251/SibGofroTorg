"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Lightbulb,
  Loader2,
  Package,
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

function qtyTotal(plan: SupplyPlan): number {
  return plan.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
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

  const activeItems = supplyPlansItemsCount(activePlans);
  const activeQty = useMemo(
    () => activePlans.reduce((sum, plan) => sum + qtyTotal(plan), 0),
    [activePlans]
  );

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
    const item = plans
      .find((plan) => plan.id === fromPlanId)
      ?.items.find((row) => row.id === itemId);
    if (!item) return;
    const now = new Date().toISOString();
    markChanged(
      plans.map((plan) => {
        if (plan.id === fromPlanId) {
          return {
            ...plan,
            items: plan.items.filter((row) => row.id !== itemId),
            updatedAt: now,
          };
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
    <div className="sp-page">
      {/* Hero */}
      <header className="sp-hero">
        <div className="sp-hero__text">
          <span className="sp-hero__eyebrow">
            <Lightbulb size={13} strokeWidth={2.4} />
            Учёт · поставки
          </span>
          <h2 className="sp-hero__title">Планы поставок</h2>
          <p className="sp-hero__desc">
            Списки того, что нужно привезти: товар и количество. Без цен и бюджета.
          </p>
        </div>
        <div className="sp-hero__actions">
          <button type="button" className="admin-btn admin-btn--ghost" onClick={createPlan}>
            <Plus size={15} /> Новый план
          </button>
          <button
            type="button"
            className={`admin-btn ${dirty ? "admin-btn--primary" : "admin-btn--outline"}`}
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : saved ? (
              <CheckCircle2 size={15} />
            ) : (
              <Save size={15} />
            )}
            {saved ? "Сохранено" : dirty ? "Сохранить" : "Всё сохранено"}
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="sp-stats">
        <div className="sp-stat">
          <span className="sp-stat__icon sp-stat__icon--plans">
            <ClipboardList size={16} />
          </span>
          <div>
            <span className="sp-stat__label">Активные планы</span>
            <strong className="sp-stat__value">{activePlans.length}</strong>
          </div>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__icon sp-stat__icon--items">
            <Package size={16} />
          </span>
          <div>
            <span className="sp-stat__label">Позиций</span>
            <strong className="sp-stat__value">{activeItems}</strong>
          </div>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__icon sp-stat__icon--qty">
            <CalendarDays size={16} />
          </span>
          <div>
            <span className="sp-stat__label">Всего шт.</span>
            <strong className="sp-stat__value">
              {activeQty.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}
            </strong>
          </div>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__icon sp-stat__icon--archive">
            <CheckCircle2 size={16} />
          </span>
          <div>
            <span className="sp-stat__label">В архиве</span>
            <strong className="sp-stat__value">{completedPlans.length}</strong>
          </div>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}
      {dirty && !error && (
        <div className="sp-dirty-hint">
          Есть несохранённые изменения — нажмите «Сохранить».
        </div>
      )}

      {/* Workspace */}
      <div className="sp-workspace">
        {/* Sidebar list */}
        <aside className="sp-side">
          <div className="sp-side__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={!showCompleted}
              className={!showCompleted ? "is-on" : ""}
              onClick={() => switchArchive(false)}
            >
              Активные
              <em>{activePlans.length}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showCompleted}
              className={showCompleted ? "is-on" : ""}
              onClick={() => switchArchive(true)}
            >
              Архив
              <em>{completedPlans.length}</em>
            </button>
          </div>

          <div className="sp-side__list">
            {visiblePlans.map((plan) => {
              const active = selectedPlan?.id === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  className={`sp-nav${active ? " is-on" : ""}`}
                  onClick={() => setTargetPlanId(plan.id)}
                >
                  <span className="sp-nav__icon" aria-hidden>
                    <Package size={15} />
                  </span>
                  <span className="sp-nav__body">
                    <strong className="sp-nav__name">{plan.name || "Без названия"}</strong>
                    <span className="sp-nav__meta">
                      <CalendarDays size={11} />
                      {formatDate(plan.plannedDate)}
                      <span className="sp-nav__dot" />
                      {plan.items.length} поз.
                    </span>
                  </span>
                  <span className="sp-nav__qty" title="Суммарное количество">
                    {qtyTotal(plan).toLocaleString("ru-RU", {
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </button>
              );
            })}

            {visiblePlans.length === 0 && (
              <div className="sp-side__empty">
                <Lightbulb size={22} />
                <p>{showCompleted ? "Архив пуст" : "Создайте первый план"}</p>
                {!showCompleted && (
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary admin-btn--sm"
                    onClick={createPlan}
                  >
                    <Plus size={13} /> Создать
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Editor */}
        <main className="sp-editor">
          {!selectedPlan ? (
            <div className="sp-editor__empty">
              <div className="sp-editor__empty-icon">
                <Lightbulb size={28} />
              </div>
              <strong>Выберите план слева</strong>
              <span>или создайте новый — и добавляйте товары с количеством</span>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={createPlan}
              >
                <Plus size={15} /> Новый план
              </button>
            </div>
          ) : (
            <>
              <div className="sp-editor__head">
                <div className="sp-editor__title-block">
                  <label className="sp-editor__name-field">
                    <span className="admin-label">Название плана</span>
                    <input
                      className="sp-editor__name"
                      value={selectedPlan.name}
                      disabled={selectedPlan.status === "completed"}
                      onChange={(event) =>
                        patchPlan(selectedPlan.id, { name: event.target.value })
                      }
                      placeholder="Например: Поставка на склад · апрель"
                    />
                  </label>
                  <label className="sp-editor__date-field">
                    <span className="admin-label">Плановая дата</span>
                    <input
                      type="date"
                      className="admin-input"
                      value={selectedPlan.plannedDate || ""}
                      disabled={selectedPlan.status === "completed"}
                      onChange={(event) =>
                        patchPlan(selectedPlan.id, {
                          plannedDate: event.target.value || null,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="sp-editor__badges">
                  <span
                    className={`sp-badge ${
                      selectedPlan.status === "active"
                        ? "sp-badge--active"
                        : "sp-badge--done"
                    }`}
                  >
                    {selectedPlan.status === "active" ? "Активный" : "Завершён"}
                  </span>
                  <span className="sp-badge sp-badge--muted">
                    {selectedPlan.items.length} поз. ·{" "}
                    {qtyTotal(selectedPlan).toLocaleString("ru-RU", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    шт.
                  </span>
                </div>
              </div>

              {selectedPlan.status === "active" && (
                <div className="sp-add">
                  <div className="sp-add__head">
                    <strong>
                      <Plus size={14} /> Добавить товар
                    </strong>
                    <span>Поиск по каталогу · укажите количество</span>
                  </div>
                  <div className="sp-add__picker">
                    <ProductPicker
                      products={products}
                      onPick={setSelectedProduct}
                      placeholder="Найти товар для поставки…"
                      showPrice={false}
                    />
                  </div>
                  {selectedProduct && (
                    <div className="sp-add__draft">
                      <div className="sp-add__product">
                        <Package size={16} />
                        <div>
                          <strong>{selectedProduct.name}</strong>
                          <span>
                            {selectedProduct.sku
                              ? `арт. ${selectedProduct.sku}`
                              : "без артикула"}
                          </span>
                        </div>
                      </div>
                      <label className="admin-field sp-add__qty">
                        <span className="admin-label">Количество</span>
                        <input
                          className="admin-input"
                          type="number"
                          min={0.001}
                          step="any"
                          value={quantity}
                          onChange={(event) =>
                            setQuantity(
                              Math.max(0.001, Number(event.target.value) || 1)
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary sp-add__btn"
                        onClick={addItem}
                      >
                        <Plus size={14} /> В план
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="sp-items">
                <div className="sp-items__head">
                  <div>
                    <strong>Состав поставки</strong>
                    <span>
                      {selectedPlan.items.length
                        ? `${selectedPlan.items.length} ${
                            selectedPlan.items.length === 1
                              ? "позиция"
                              : selectedPlan.items.length < 5
                                ? "позиции"
                                : "позиций"
                          }`
                        : "Пока пусто — добавьте товар выше"}
                    </span>
                  </div>
                </div>

                {selectedPlan.items.length === 0 ? (
                  <div className="sp-items__empty">
                    <Package size={26} />
                    <p>В этом плане ещё нет позиций</p>
                  </div>
                ) : (
                  <ul className="sp-items__list">
                    {selectedPlan.items.map((item, index) => (
                      <li key={item.id} className="sp-item">
                        <span className="sp-item__index">{index + 1}</span>
                        <div className="sp-item__info">
                          <strong className="sp-item__name">{item.productName}</strong>
                          <span className="sp-item__sku">
                            {item.sku ? `арт. ${item.sku}` : "без артикула"}
                          </span>
                        </div>
                        <label className="sp-item__qty">
                          <span>Кол-во</span>
                          <input
                            className="admin-input"
                            type="number"
                            min={0.001}
                            step="any"
                            value={item.quantity}
                            disabled={selectedPlan.status === "completed"}
                            onChange={(event) =>
                              patchItem(selectedPlan.id, item.id, {
                                quantity: Math.max(
                                  0.001,
                                  Number(event.target.value) || 1
                                ),
                              })
                            }
                          />
                        </label>
                        {selectedPlan.status === "active" && activePlans.length > 1 && (
                          <label className="sp-item__move">
                            <span>
                              <ArrowRightLeft size={11} /> Переместить
                            </span>
                            <select
                              className="admin-select"
                              value=""
                              onChange={(event) =>
                                moveItem(selectedPlan.id, item.id, event.target.value)
                              }
                            >
                              <option value="">В другой план…</option>
                              {activePlans
                                .filter((entry) => entry.id !== selectedPlan.id)
                                .map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        {selectedPlan.status === "active" && (
                          <button
                            type="button"
                            className="sp-item__remove"
                            onClick={() => removeItem(selectedPlan.id, item.id)}
                            aria-label={`Убрать ${item.productName}`}
                            title="Убрать из плана"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <footer className="sp-editor__footer">
                {selectedPlan.status === "active" ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn--outline admin-btn--sm"
                    onClick={() =>
                      patchPlan(selectedPlan.id, { status: "completed" })
                    }
                  >
                    <CheckCircle2 size={13} /> Завершить план
                  </button>
                ) : (
                  <button
                    type="button"
                    className="admin-btn admin-btn--outline admin-btn--sm"
                    onClick={() => patchPlan(selectedPlan.id, { status: "active" })}
                  >
                    <RotateCcw size={13} /> Вернуть в активные
                  </button>
                )}
                <button
                  type="button"
                  className="admin-btn admin-btn--danger admin-btn--sm"
                  onClick={() => removePlan(selectedPlan)}
                >
                  <Trash2 size={13} /> Удалить
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
