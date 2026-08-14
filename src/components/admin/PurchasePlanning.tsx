"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  PiggyBank,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { ProductPicker, type PickerProduct } from "@/components/admin/ProductPicker";
import {
  PURCHASE_ACCOUNT_LABEL,
  type PurchaseAccount,
  type PurchasePlan,
} from "@/lib/purchase-plans-shared";

const fmt = (value: number) => value.toLocaleString("ru-RU", {
  maximumFractionDigits: 2,
});

function todayIso(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function accountIcon(account: PurchaseAccount) {
  if (account === "cash") return <Banknote size={13} />;
  if (account === "ym_card") return <CreditCard size={13} />;
  return <Wallet size={13} />;
}

export function PurchasePlanning({
  initialPlans,
  products,
}: {
  initialPlans: PurchasePlan[];
  products: PickerProduct[];
}) {
  const router = useRouter();
  const [plans, setPlans] = useState(initialPlans);
  const [selectedProduct, setSelectedProduct] = useState<PickerProduct | null>(null);
  const [targetAmount, setTargetAmount] = useState(0);
  const [contributionAmount, setContributionAmount] = useState(500);
  const [account, setAccount] = useState<PurchaseAccount>("bank");
  const [contributionDrafts, setContributionDrafts] = useState<Record<string, number>>({});
  const [accountDrafts, setAccountDrafts] = useState<Record<string, PurchaseAccount>>({});
  const [showCompleted, setShowCompleted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const activePlans = useMemo(
    () => plans.filter((plan) => plan.status === "active"),
    [plans]
  );
  const completedPlans = useMemo(
    () => plans.filter((plan) => plan.status === "completed"),
    [plans]
  );
  const visiblePlans = showCompleted ? completedPlans : activePlans;
  const totalSaved = activePlans.reduce((sum, plan) => sum + plan.savedAmount, 0);

  function replacePlan(nextPlan: PurchasePlan) {
    setPlans((previous) => {
      const exists = previous.some((plan) => plan.id === nextPlan.id);
      return exists
        ? previous.map((plan) => (plan.id === nextPlan.id ? nextPlan : plan))
        : [nextPlan, ...previous];
    });
  }

  async function createPlan() {
    if (!selectedProduct) {
      setError("Выберите товар для закупки");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/purchase-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          sku: selectedProduct.sku,
          targetAmount,
          contributionAmount,
          account,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось создать план");
      replacePlan(body.plan);
      setSelectedProduct(null);
      setTargetAmount(0);
      setContributionAmount(500);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Ошибка сети");
    } finally {
      setCreating(false);
    }
  }

  async function contribute(plan: PurchasePlan) {
    const amount = Math.max(
      0,
      Number(contributionDrafts[plan.id] ?? plan.contributionAmount) || 0
    );
    if (amount <= 0) {
      setError("Укажите сумму, которую откладываем");
      return;
    }
    setBusyId(plan.id);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/purchase-plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "contribute",
          id: plan.id,
          amount,
          date: todayIso(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось добавить накопление");
      replacePlan(body.plan);
      setContributionDrafts((previous) => ({
        ...previous,
        [plan.id]: body.plan.contributionAmount,
      }));
    } catch (contributionError) {
      setError(contributionError instanceof Error ? contributionError.message : "Ошибка сети");
    } finally {
      setBusyId(null);
    }
  }

  async function spend(plan: PurchasePlan) {
    const source = accountDrafts[plan.id] || plan.account;
    if (
      !confirm(
        `Списать ${fmt(plan.savedAmount)} ₽ на закупку «${plan.productName}»?\n\n` +
          `Счёт: ${PURCHASE_ACCOUNT_LABEL[source]}. Будет создан проведённый расходный платёж.`
      )
    ) {
      return;
    }
    setBusyId(plan.id);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/purchase-plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spend", id: plan.id, account: source }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось списать накопления");
      replacePlan(body.plan);
      router.refresh();
    } catch (spendError) {
      setError(spendError instanceof Error ? spendError.message : "Ошибка сети");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(plan: PurchasePlan) {
    if (!confirm(`Удалить план закупки «${plan.productName}»?`)) return;
    setBusyId(plan.id);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/warehouse/purchase-plans?id=${encodeURIComponent(plan.id)}`,
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось удалить план");
      setPlans((previous) => previous.filter((item) => item.id !== plan.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Ошибка сети");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="purchase-planning">
      <header className="purchase-planning__hero">
        <div>
          <span className="purchase-planning__eyebrow"><PiggyBank size={14} /> Накопления на товар</span>
          <h2>Закупки</h2>
          <p>
            Откладывайте фиксированную сумму раз в неделю. До кнопки списания это только план и баланс счетов не меняется.
          </p>
        </div>
        <div className="purchase-planning__summary">
          <span>Активных планов <b>{activePlans.length}</b></span>
          <span>Накоплено <b>{fmt(totalSaved)} ₽</b></span>
        </div>
      </header>

      <section className="purchase-create">
        <div className="purchase-create__picker">
          <span className="admin-label">Товар</span>
          <ProductPicker products={products} onPick={setSelectedProduct} placeholder="Найти товар для будущей закупки…" />
          {selectedProduct && (
            <div className="purchase-create__selected">
              <strong>{selectedProduct.name}</strong>
              <span>{selectedProduct.sku || "без артикула"}</span>
            </div>
          )}
        </div>
        <label className="admin-field">
          <span className="admin-label">Цель, ₽</span>
          <input className="admin-input" type="number" min={0} step={100} value={targetAmount || ""} onChange={(event) => setTargetAmount(Math.max(0, Number(event.target.value) || 0))} placeholder="необязательно" />
        </label>
        <label className="admin-field">
          <span className="admin-label">Откладывать, ₽</span>
          <input className="admin-input" type="number" min={1} step={100} value={contributionAmount} onChange={(event) => setContributionAmount(Math.max(1, Number(event.target.value) || 500))} />
        </label>
        <label className="admin-field">
          <span className="admin-label">Списать потом со счёта</span>
          <select className="admin-select" value={account} onChange={(event) => setAccount(event.target.value as PurchaseAccount)}>
            {Object.entries(PURCHASE_ACCOUNT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="admin-btn admin-btn--primary" disabled={creating || !selectedProduct} onClick={createPlan}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Создать план
        </button>
      </section>

      {error && <div className="admin-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="admin-filters admin-filters--sub" style={{ marginBottom: 12 }}>
        <button type="button" className={`admin-filter${!showCompleted ? " admin-filter--active" : ""}`} onClick={() => setShowCompleted(false)}>
          Активные ({activePlans.length})
        </button>
        <button type="button" className={`admin-filter${showCompleted ? " admin-filter--active" : ""}`} onClick={() => setShowCompleted(true)}>
          Завершённые ({completedPlans.length})
        </button>
      </div>

      <div className="purchase-plan-list">
        {visiblePlans.length === 0 ? (
          <div className="admin-empty"><PiggyBank size={30} /><p>{showCompleted ? "Завершённых закупок пока нет" : "Создайте первый план закупки"}</p></div>
        ) : visiblePlans.map((plan) => {
          const progress = plan.targetAmount > 0
            ? Math.min(100, Math.round((plan.savedAmount / plan.targetAmount) * 100))
            : 0;
          const planAccount = accountDrafts[plan.id] || plan.account;
          return (
            <article key={plan.id} className={`purchase-plan${plan.status === "completed" ? " purchase-plan--completed" : ""}`}>
              <div className="purchase-plan__head">
                <div className="purchase-plan__product">
                  <span className="purchase-plan__icon"><PiggyBank size={17} /></span>
                  <div><strong>{plan.productName}</strong><small>{plan.sku ? `арт. ${plan.sku}` : "без артикула"}</small></div>
                </div>
                <div className="purchase-plan__amount">
                  <strong>{fmt(plan.savedAmount)} ₽</strong>
                  <span>{plan.targetAmount > 0 ? `из ${fmt(plan.targetAmount)} ₽` : "накоплено"}</span>
                </div>
                {plan.status === "active" && (
                  <button type="button" className="admin-btn admin-btn--icon admin-btn--danger-ghost" onClick={() => remove(plan)} disabled={busyId === plan.id} title="Удалить план"><Trash2 size={14} /></button>
                )}
              </div>

              {plan.targetAmount > 0 && (
                <div className="purchase-plan__progress"><span style={{ width: `${progress}%` }} /><b>{progress}%</b></div>
              )}

              {plan.status === "active" ? (
                <div className="purchase-plan__actions">
                  <label className="admin-field">
                    <span className="admin-label">Отложить сейчас</span>
                    <input className="admin-input" type="number" min={1} step={100} value={contributionDrafts[plan.id] ?? plan.contributionAmount} onChange={(event) => setContributionDrafts((previous) => ({ ...previous, [plan.id]: Math.max(1, Number(event.target.value) || 0) }))} />
                  </label>
                  <button type="button" className="admin-btn admin-btn--outline" onClick={() => contribute(plan)} disabled={busyId === plan.id}>
                    {busyId === plan.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Добавить накопление
                  </button>
                  <label className="admin-field purchase-plan__account">
                    <span className="admin-label">Счёт списания</span>
                    <select className="admin-select" value={planAccount} onChange={(event) => setAccountDrafts((previous) => ({ ...previous, [plan.id]: event.target.value as PurchaseAccount }))}>
                      {Object.entries(PURCHASE_ACCOUNT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <button type="button" className="admin-btn admin-btn--primary" onClick={() => spend(plan)} disabled={busyId === plan.id || plan.savedAmount <= 0}>
                    {busyId === plan.id ? <Loader2 size={13} className="animate-spin" /> : accountIcon(planAccount)}
                    Списать {fmt(plan.savedAmount)} ₽
                  </button>
                </div>
              ) : (
                <div className="purchase-plan__completed">
                  <CheckCircle2 size={15} /> Списано {fmt(plan.spentAmount)} ₽ · {PURCHASE_ACCOUNT_LABEL[plan.account]}
                </div>
              )}

              {plan.contributions.length > 0 && (
                <details className="purchase-plan__history">
                  <summary>История накоплений — {plan.contributions.length}</summary>
                  <div>
                    {[...plan.contributions].reverse().map((contribution) => (
                      <span key={contribution.id}><b>+{fmt(contribution.amount)} ₽</b><small>{contribution.date.split("-").reverse().join(".")}</small></span>
                    ))}
                  </div>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
