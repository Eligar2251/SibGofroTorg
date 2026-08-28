"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  Check,
  Pencil,
  PiggyBank,
  Plus,
  X,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { ProductPicker, type PickerProduct } from "@/components/admin/ProductPicker";
import { ImageUploader } from "@/components/admin/ImageUploader";
import {
  PURCHASE_ACCOUNT_LABEL,
  type PurchaseAccount,
  type PurchaseImage,
  type PurchasePayment,
  type PurchasePlan,
} from "@/lib/purchase-plans-shared";

const fmt = (value: number) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

type OzonPreview = {
  url: string;
  title: string;
  price: number;
  imageUrl: string | null;
  fetchedAt: string;
};

type EmployeeOption = {
  id: string;
  name: string;
};

function todayIso(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function planCover(plan: PurchasePlan): string | null {
  return plan.images?.[0]?.url || plan.ozonImageUrl || null;
}

function accountIcon(account: PurchaseAccount) {
  if (account === "cash") return <Banknote size={13} />;
  if (account === "ym_card") return <CreditCard size={13} />;
  return <Wallet size={13} />;
}

function adminBasePath(): string {
  if (typeof window === "undefined") return "admin";
  return window.location.pathname.split("/")[1] || "admin";
}

export function PurchasePlanning({
  initialPlans,
  products,
}: {
  initialPlans: PurchasePlan[];
  products: PickerProduct[];
  /** Оставлен для совместимости вызова: списание через ЗП больше не используется. */
  employees?: EmployeeOption[];
}) {
  const router = useRouter();
  const [plans, setPlans] = useState(initialPlans);
  const [productName, setProductName] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<PickerProduct | null>(null);
  const [ozonUrl, setOzonUrl] = useState("");
  const [ozonPreview, setOzonPreview] = useState<OzonPreview | null>(null);
  const [createImages, setCreateImages] = useState<PurchaseImage[]>([]);
  const [loadingOzon, setLoadingOzon] = useState(false);
  const ozonPreviewRequestRef = useRef(0);
  const [targetAmount, setTargetAmount] = useState(0);
  const [contributionAmount, setContributionAmount] = useState(500);
  const [account, setAccount] = useState<PurchaseAccount>("bank");
  const [editDrafts, setEditDrafts] = useState<
    Record<
      string,
      {
        productName: string;
        targetAmount: number;
        contributionAmount: number;
        account: PurchaseAccount;
        images: PurchaseImage[];
      }
    >
  >({});
  /** Форма «добавить платёж» по каждой закупке. */
  const [payDrafts, setPayDrafts] = useState<
    Record<
      string,
      {
        amount: number;
        date: string;
        account: PurchaseAccount;
        isPaid: boolean;
        excludeFromBalance: boolean;
        comment: string;
      }
    >
  >({});
  /** Редактирование конкретного платежа: id платежа → черновик. */
  const [editPayment, setEditPayment] = useState<
    Record<
      string,
      { amount: number; date: string; account: PurchaseAccount; isPaid: boolean }
    >
  >({});
  const [showCompleted, setShowCompleted] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
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
  const totalPaid = activePlans.reduce((sum, plan) => sum + plan.paidAmount, 0);
  const totalPlanned = activePlans.reduce((sum, plan) => sum + plan.plannedAmount, 0);
  const totalTarget = activePlans.reduce((sum, plan) => sum + plan.targetAmount, 0);

  function replacePlan(nextPlan: PurchasePlan) {
    setPlans((previous) => {
      const exists = previous.some((plan) => plan.id === nextPlan.id);
      return exists
        ? previous.map((plan) => (plan.id === nextPlan.id ? nextPlan : plan))
        : [nextPlan, ...previous];
    });
    setEditDrafts((prev) => ({
      ...prev,
      [nextPlan.id]: {
        productName: nextPlan.productName,
        targetAmount: nextPlan.targetAmount,
        contributionAmount: nextPlan.contributionAmount,
        account: nextPlan.account,
        images: nextPlan.images?.length
          ? nextPlan.images
          : nextPlan.ozonImageUrl
            ? [{ url: nextPlan.ozonImageUrl, publicId: nextPlan.ozonImagePublicId || "" }]
            : [],
      },
    }));
  }

  function draftFor(plan: PurchasePlan) {
    return (
      editDrafts[plan.id] || {
        productName: plan.productName,
        targetAmount: plan.targetAmount,
        contributionAmount: plan.contributionAmount,
        account: plan.account,
        images: plan.images?.length
          ? plan.images
          : plan.ozonImageUrl
            ? [{ url: plan.ozonImageUrl, publicId: plan.ozonImagePublicId || "" }]
            : [],
      }
    );
  }

  function payDraftFor(plan: PurchasePlan) {
    return (
      payDrafts[plan.id] || {
        // По умолчанию предлагаем «сколько осталось до цели», но не больше
        // привычного шага — так удобнее и разово закрыть, и платить частями.
        amount: Math.max(
          0,
          Math.min(
            plan.contributionAmount,
            Math.max(0, plan.targetAmount - plan.paidAmount - plan.plannedAmount) ||
              plan.contributionAmount
          )
        ),
        date: todayIso(),
        account: plan.account,
        isPaid: true,
        excludeFromBalance: false,
        comment: "",
      }
    );
  }

  /** Единый вызов API закупок: любое действие возвращает обновлённый план. */
  async function planAction(
    plan: PurchasePlan | null,
    body: Record<string, unknown>,
    fallbackError: string
  ) {
    setBusyId(plan?.id || "global");
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/purchase-plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || fallbackError);
      if (payload.plan) replacePlan(payload.plan);
      if (Array.isArray(payload.plans)) setPlans(payload.plans);
      // Банк и дашборд считают те же платежи — обновляем серверные данные.
      router.refresh();
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Ошибка сети");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function addPayment(plan: PurchasePlan) {
    const draft = payDraftFor(plan);
    const amount = Math.max(0, Number(draft.amount) || 0);
    if (amount <= 0) {
      setError("Укажите сумму платежа");
      return;
    }
    const ok = await planAction(
      plan,
      {
        action: "add-payment",
        planId: plan.id,
        amount,
        date: draft.date || todayIso(),
        account: draft.account,
        isPaid: draft.isPaid,
        excludeFromBalance: draft.excludeFromBalance,
        comment: draft.comment.trim() || undefined,
      },
      "Не удалось добавить платёж"
    );
    if (ok) {
      setPayDrafts((prev) => {
        const next = { ...prev };
        delete next[plan.id];
        return next;
      });
    }
  }

  async function savePayment(plan: PurchasePlan, payment: PurchasePayment) {
    const draft = editPayment[payment.id];
    if (!draft) return;
    const ok = await planAction(
      plan,
      {
        action: "update-payment",
        paymentId: payment.id,
        amount: draft.amount,
        date: draft.date,
        account: draft.account,
        isPaid: draft.isPaid,
      },
      "Не удалось изменить платёж"
    );
    if (ok) {
      setEditPayment((prev) => {
        const next = { ...prev };
        delete next[payment.id];
        return next;
      });
    }
  }

  async function removePayment(plan: PurchasePlan, payment: PurchasePayment) {
    if (
      !confirm(
        `Удалить платёж на ${fmt(payment.amount)} ₽ от ${payment.date}?\n\n` +
          "Платёж исчезнет и из банка, деньги вернутся в баланс."
      )
    ) {
      return;
    }
    await planAction(
      plan,
      { action: "delete-payment", paymentId: payment.id },
      "Не удалось удалить платёж"
    );
  }

  async function setStatus(plan: PurchasePlan, status: "active" | "completed") {
    await planAction(
      plan,
      { action: "status", id: plan.id, status },
      "Не удалось изменить статус закупки"
    );
  }

  async function loadOzonPreview(urlValue = ozonUrl) {
    const value = urlValue.trim();
    if (!value) {
      setOzonPreview(null);
      return;
    }
    const requestId = ++ozonPreviewRequestRef.current;
    setLoadingOzon(true);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/purchase-plans/ozon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось прочитать ссылку Ozon");
      if (requestId !== ozonPreviewRequestRef.current) return;
      const preview = body.product as OzonPreview;
      setOzonUrl(preview.url);
      setOzonPreview(preview);
      setProductName(preview.title);
      setSelectedProduct(null);
      setTargetAmount(preview.price);
      if (preview.imageUrl) {
        setCreateImages([{ url: preview.imageUrl, publicId: "" }]);
      }
    } catch (previewError) {
      if (requestId !== ozonPreviewRequestRef.current) return;
      setOzonPreview(null);
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Не удалось получить данные товара Ozon"
      );
    } finally {
      if (requestId === ozonPreviewRequestRef.current) setLoadingOzon(false);
    }
  }

  async function createPlan() {
    const cleanProductName = productName.trim();
    if (!cleanProductName && !ozonUrl.trim()) {
      setError("Введите название товара или вставьте ссылку Ozon");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/purchase-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct?.id || null,
          productName: cleanProductName,
          sku: selectedProduct?.sku || null,
          ozonUrl: ozonUrl.trim() || null,
          ozonTitle: ozonPreview?.title || null,
          ozonPrice: ozonPreview?.price || null,
          ozonImageUrl: ozonPreview?.imageUrl || createImages[0]?.url || null,
          images: createImages.slice(0, 1),
          targetAmount,
          contributionAmount,
          account,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось создать план");
      replacePlan(body.plan);
      setProductName("");
      setSelectedProduct(null);
      setOzonUrl("");
      setOzonPreview(null);
      setCreateImages([]);
      setTargetAmount(0);
      setContributionAmount(500);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Ошибка сети");
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(plan: PurchasePlan) {
    const draft = draftFor(plan);
    setBusyId(plan.id);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/purchase-plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: plan.id,
          productName: draft.productName,
          targetAmount: draft.targetAmount,
          contributionAmount: draft.contributionAmount,
          account: draft.account,
          images: draft.images.slice(0, 1),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить");
      replacePlan(body.plan);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Ошибка сети");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Старое «отложено» — виртуальные накопления без движения денег.
   * Оставлены только для уже накопленных сумм: их можно провести
   * настоящим платежом или просто удалить.
   */
  async function convertContribution(plan: PurchasePlan, contributionId: string) {
    await planAction(
      plan,
      { action: "convert-contribution", planId: plan.id, contributionId },
      "Не удалось провести отложенное"
    );
  }

  async function removeContribution(plan: PurchasePlan, contributionId: string) {
    if (!confirm("Удалить отложенное? Денег это не двигало.")) return;
    await planAction(
      plan,
      { action: "delete-contribution", planId: plan.id, contributionId },
      "Не удалось удалить отложенное"
    );
  }

  async function restorePlan(plan: PurchasePlan) {
    setBusyId(plan.id);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/purchase-plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: plan.id, status: "active" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось вернуть из архива");
      replacePlan(body.plan);
      router.refresh();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Ошибка сети");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(plan: PurchasePlan) {
    if (
      !confirm(
        `Удалить закупку «${plan.productName}»? Это можно сделать и для архивных.`
      )
    )
      return;
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
      if (openId === plan.id) setOpenId(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Ошибка сети");
    } finally {
      setBusyId(null);
    }
  }

  const base = adminBasePath();

  return (
    <div className="purchase-planning">
      <header className="purchase-planning__hero">
        <div>
          <span className="purchase-planning__eyebrow">
            <PiggyBank size={14} /> Карточки закупок
          </span>
          <h2>Закупки</h2>
          <p>
            Компактные плитки с фото. Закупка оплачивается по частям: каждый платёж —
            отдельная строка в банке, её можно изменить или удалить. Готовый платёж
            из банка тоже можно отнести к закупке.
          </p>
        </div>
        <div className="purchase-planning__summary">
          <span>
            Активных <b>{activePlans.length}</b>
          </span>
          <span>
            Оплачено <b>{fmt(totalPaid)} ₽</b>
            {totalTarget > 0 ? <> из {fmt(totalTarget)} ₽</> : null}
          </span>
          {totalPlanned > 0 && (
            <span>
              В плане <b>{fmt(totalPlanned)} ₽</b>
            </span>
          )}
        </div>
      </header>

      <section className="purchase-create">
        <div className="purchase-create__picker">
          <label className="admin-field purchase-create__name">
            <span className="admin-label">Название *</span>
            <input
              className="admin-input"
              type="text"
              value={productName}
              maxLength={300}
              placeholder="Что закупаем"
              onChange={(event) => {
                setProductName(event.target.value);
                if (selectedProduct && event.target.value !== selectedProduct.name) {
                  setSelectedProduct(null);
                }
              }}
            />
          </label>

          <label className="admin-field purchase-create__ozon-field">
            <span className="admin-label">Ссылка Ozon — необязательно</span>
            <div className="purchase-create__ozon-input">
              <input
                className="admin-input"
                type="url"
                value={ozonUrl}
                placeholder="https://www.ozon.ru/product/…"
                onChange={(event) => {
                  setOzonUrl(event.target.value);
                  setOzonPreview(null);
                }}
                onBlur={() => {
                  if (ozonUrl.trim() && !ozonPreview && !loadingOzon) {
                    void loadOzonPreview();
                  }
                }}
              />
              <button
                type="button"
                className="admin-btn admin-btn--outline"
                disabled={loadingOzon || !ozonUrl.trim()}
                onClick={() => void loadOzonPreview()}
              >
                {loadingOzon ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                Подтянуть
              </button>
            </div>
          </label>

          {ozonPreview && (
            <div className="purchase-create__ozon-preview">
              {ozonPreview.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ozonPreview.imageUrl} alt="" loading="lazy" decoding="async" />
              ) : (
                <div className="purchase-create__ozon-placeholder">OZON</div>
              )}
              <div>
                <strong title={ozonPreview.title}>{ozonPreview.title}</strong>
                <b>{fmt(ozonPreview.price)} ₽</b>
                <small>Данные с Ozon</small>
              </div>
            </div>
          )}

          <div className="admin-field purchase-create__photo">
            <span className="admin-label">Фото (одно, компактное)</span>
            <div className="purchase-photo-upload">
              <ImageUploader
                images={createImages.slice(0, 1)}
                onChange={(images) => setCreateImages(images.slice(0, 1))}
                defaultReplace
                hideReplaceToggle
              />
            </div>
          </div>

          <span className="admin-label purchase-create__catalog-label">
            Или выбрать из каталога
          </span>
          <ProductPicker
            products={products}
            onPick={(product) => {
              setSelectedProduct(product);
              setProductName(product.name);
            }}
            placeholder="Поиск по каталогу…"
            showPrice={false}
          />
        </div>

        <label className="admin-field">
          <span className="admin-label">Цель, ₽</span>
          <input
            className="admin-input"
            type="number"
            min={0}
            step={100}
            value={targetAmount || ""}
            onChange={(event) =>
              setTargetAmount(Math.max(0, Number(event.target.value) || 0))
            }
          />
        </label>
        <label className="admin-field">
          <span className="admin-label">Откладывать, ₽</span>
          <input
            className="admin-input"
            type="number"
            min={1}
            step={100}
            value={contributionAmount}
            onChange={(event) =>
              setContributionAmount(Math.max(1, Number(event.target.value) || 500))
            }
          />
        </label>
        <label className="admin-field">
          <span className="admin-label">Счёт по умолчанию</span>
          <select
            className="admin-select"
            value={account}
            onChange={(event) => setAccount(event.target.value as PurchaseAccount)}
          >
            {Object.entries(PURCHASE_ACCOUNT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          disabled={creating || (!productName.trim() && !ozonUrl.trim())}
          onClick={createPlan}
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Создать карточку
        </button>
      </section>

      {error && (
        <div className="admin-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="admin-filters admin-filters--sub" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`admin-filter${!showCompleted ? " admin-filter--active" : ""}`}
          onClick={() => setShowCompleted(false)}
        >
          Активные ({activePlans.length})
        </button>
        <button
          type="button"
          className={`admin-filter${showCompleted ? " admin-filter--active" : ""}`}
          onClick={() => setShowCompleted(true)}
        >
          Архив ({completedPlans.length})
        </button>
      </div>

      {visiblePlans.length === 0 ? (
        <div className="admin-empty">
          <PiggyBank size={30} />
          <p>
            {showCompleted ? "Архив пуст" : "Создайте первую карточку закупки"}
          </p>
        </div>
      ) : (
        <div className="purchase-grid">
          {visiblePlans.map((plan) => {
            const cover = planCover(plan);
            const progress =
              plan.targetAmount > 0
                ? Math.min(100, Math.round((plan.paidAmount / plan.targetAmount) * 100))
                : 0;
            const open = openId === plan.id;
            const draft = draftFor(plan);
            const pay = payDraftFor(plan);

            return (
              <article
                key={plan.id}
                className={`purchase-tile${open ? " is-open" : ""}${
                  plan.status === "completed" ? " is-done" : ""
                }`}
              >
                <button
                  type="button"
                  className="purchase-tile__face"
                  onClick={() => setOpenId(open ? null : plan.id)}
                >
                  <span className="purchase-tile__media">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <PiggyBank size={28} />
                    )}
                    {plan.status === "completed" && <em>архив</em>}
                    {plan.status === "completed" && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="purchase-tile__restore"
                        title="Вернуть в активные"
                        onClick={(e) => {
                          e.stopPropagation();
                          void restorePlan(plan);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            void restorePlan(plan);
                          }
                        }}
                      >
                        <RotateCcw size={12} />
                      </span>
                    )}
                  </span>
                  <strong title={plan.productName}>{plan.productName}</strong>
                  <span>
                    {fmt(plan.paidAmount)} ₽
                    {plan.targetAmount > 0 ? ` / ${fmt(plan.targetAmount)} ₽` : ""}
                  </span>
                  {plan.targetAmount > 0 && (
                    <span className="purchase-tile__progress" aria-hidden>
                      <span
                        className="purchase-tile__bar"
                        style={{ width: `${progress}%` }}
                      />
                    </span>
                  )}
                </button>

                {open && (
                  <div className="purchase-tile__editor">
                    <div className="purchase-tile__editor-top">
                      <div className="purchase-tile__thumb">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover} alt="" loading="lazy" decoding="async" />
                        ) : (
                          <PiggyBank size={22} />
                        )}
                      </div>
                      <div className="purchase-tile__editor-fields">
                        <label className="admin-field">
                          <span className="admin-label">Название</span>
                          <input
                            className="admin-input"
                            value={draft.productName}
                            onChange={(e) =>
                              setEditDrafts((p) => ({
                                ...p,
                                [plan.id]: { ...draft, productName: e.target.value },
                              }))
                            }
                          />
                        </label>
                        <div className="admin-grid-2">
                          <label className="admin-field">
                            <span className="admin-label">Цель, ₽</span>
                            <input
                              className="admin-input"
                              type="number"
                              value={draft.targetAmount || ""}
                              onChange={(e) =>
                                setEditDrafts((p) => ({
                                  ...p,
                                  [plan.id]: {
                                    ...draft,
                                    targetAmount: Math.max(0, Number(e.target.value) || 0),
                                  },
                                }))
                              }
                            />
                          </label>
                          <label className="admin-field">
                            <span className="admin-label">Откладывать, ₽</span>
                            <input
                              className="admin-input"
                              type="number"
                              value={draft.contributionAmount}
                              onChange={(e) =>
                                setEditDrafts((p) => ({
                                  ...p,
                                  [plan.id]: {
                                    ...draft,
                                    contributionAmount: Math.max(
                                      1,
                                      Number(e.target.value) || 1
                                    ),
                                  },
                                }))
                              }
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="admin-field purchase-tile__photo-field">
                      <span className="admin-label">Фото карточки</span>
                      <div className="purchase-photo-upload">
                        <ImageUploader
                          images={draft.images.slice(0, 1)}
                          onChange={(images) =>
                            setEditDrafts((p) => ({
                              ...p,
                              [plan.id]: { ...draft, images: images.slice(0, 1) },
                            }))
                          }
                          defaultReplace
                          hideReplaceToggle
                        />
                      </div>
                    </div>

                    {plan.ozonUrl && (
                      <a
                        href={plan.ozonUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                      >
                        Ozon <ExternalLink size={12} />
                      </a>
                    )}

                    {/* ── Платежи по закупке ──
                        Каждый платёж — обычная строка банка: её видно
                        в разделе «Банк», можно править и удалять здесь же. */}
                    <div className="purchase-pay">
                      <div className="purchase-pay__head">
                        <strong>Платежи по закупке</strong>
                        <span className="purchase-pay__sum">
                          оплачено {fmt(plan.paidAmount)} ₽
                          {plan.targetAmount > 0 ? ` из ${fmt(plan.targetAmount)} ₽` : ""}
                          {plan.plannedAmount > 0 && (
                            <em> · запланировано {fmt(plan.plannedAmount)} ₽</em>
                          )}
                        </span>
                      </div>

                      {plan.payments.length === 0 ? (
                        <p className="purchase-pay__empty">
                          Платежей пока нет. Добавьте первый — он появится и в банке.
                        </p>
                      ) : (
                        <ul className="purchase-pay__list">
                          {plan.payments.map((payment) => {
                            const editing = editPayment[payment.id];
                            if (editing) {
                              return (
                                <li key={payment.id} className="purchase-pay__row purchase-pay__row--edit">
                                  <input
                                    className="admin-input"
                                    type="date"
                                    value={editing.date}
                                    onChange={(e) =>
                                      setEditPayment((prev) => ({
                                        ...prev,
                                        [payment.id]: { ...editing, date: e.target.value },
                                      }))
                                    }
                                  />
                                  <input
                                    className="admin-input"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={editing.amount}
                                    onChange={(e) =>
                                      setEditPayment((prev) => ({
                                        ...prev,
                                        [payment.id]: {
                                          ...editing,
                                          amount: Number(e.target.value) || 0,
                                        },
                                      }))
                                    }
                                  />
                                  <select
                                    className="admin-select"
                                    value={editing.account}
                                    onChange={(e) =>
                                      setEditPayment((prev) => ({
                                        ...prev,
                                        [payment.id]: {
                                          ...editing,
                                          account: e.target.value as PurchaseAccount,
                                        },
                                      }))
                                    }
                                  >
                                    {(
                                      Object.entries(PURCHASE_ACCOUNT_LABEL) as [
                                        PurchaseAccount,
                                        string,
                                      ][]
                                    ).map(([value, label]) => (
                                      <option key={value} value={value}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>
                                  <label className="admin-check purchase-pay__paid">
                                    <input
                                      type="checkbox"
                                      checked={editing.isPaid}
                                      onChange={(e) =>
                                        setEditPayment((prev) => ({
                                          ...prev,
                                          [payment.id]: {
                                            ...editing,
                                            isPaid: e.target.checked,
                                          },
                                        }))
                                      }
                                    />
                                    <span>проведён</span>
                                  </label>
                                  <span className="purchase-pay__row-actions">
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--primary admin-btn--sm"
                                      disabled={busyId === plan.id}
                                      onClick={() => savePayment(plan, payment)}
                                      title="Сохранить"
                                    >
                                      <Check size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--ghost admin-btn--sm"
                                      onClick={() =>
                                        setEditPayment((prev) => {
                                          const next = { ...prev };
                                          delete next[payment.id];
                                          return next;
                                        })
                                      }
                                      title="Отменить"
                                    >
                                      <X size={13} />
                                    </button>
                                  </span>
                                </li>
                              );
                            }
                            return (
                              <li key={payment.id} className="purchase-pay__row">
                                <span className="purchase-pay__date">{payment.date}</span>
                                <span className="purchase-pay__amount">
                                  {fmt(payment.amount)} ₽
                                </span>
                                <span className="purchase-pay__acc">
                                  {accountIcon(payment.account)}
                                  {PURCHASE_ACCOUNT_LABEL[payment.account]}
                                </span>
                                {payment.isPaid ? (
                                  <span className="admin-badge admin-badge--green">проведён</span>
                                ) : (
                                  <span className="admin-badge admin-badge--amber">план</span>
                                )}
                                {payment.excludeFromBalance && (
                                  <span className="admin-badge admin-badge--muted">
                                    вне баланса
                                  </span>
                                )}
                                <span className="purchase-pay__row-actions">
                                  <a
                                    href={`/${base}/warehouse?tab=bank&payment=${payment.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="admin-btn admin-btn--ghost admin-btn--sm"
                                    title={`Платёж №${payment.number} в банке`}
                                  >
                                    <ExternalLink size={13} />
                                  </a>
                                  <button
                                    type="button"
                                    className="admin-btn admin-btn--ghost admin-btn--sm"
                                    onClick={() =>
                                      setEditPayment((prev) => ({
                                        ...prev,
                                        [payment.id]: {
                                          amount: payment.amount,
                                          date: payment.date,
                                          account: payment.account,
                                          isPaid: payment.isPaid,
                                        },
                                      }))
                                    }
                                    title="Изменить платёж"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    className="admin-btn admin-btn--ghost admin-btn--sm"
                                    disabled={busyId === plan.id}
                                    onClick={() => removePayment(plan, payment)}
                                    title="Удалить платёж"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {plan.status === "active" && (
                        <div className="purchase-pay__form">
                          <input
                            className="admin-input"
                            type="date"
                            value={pay.date}
                            onChange={(e) =>
                              setPayDrafts((prev) => ({
                                ...prev,
                                [plan.id]: { ...pay, date: e.target.value },
                              }))
                            }
                          />
                          <input
                            className="admin-input"
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Сумма"
                            value={pay.amount || ""}
                            onChange={(e) =>
                              setPayDrafts((prev) => ({
                                ...prev,
                                [plan.id]: { ...pay, amount: Number(e.target.value) || 0 },
                              }))
                            }
                          />
                          <select
                            className="admin-select"
                            value={pay.account}
                            onChange={(e) =>
                              setPayDrafts((prev) => ({
                                ...prev,
                                [plan.id]: {
                                  ...pay,
                                  account: e.target.value as PurchaseAccount,
                                },
                              }))
                            }
                          >
                            {(
                              Object.entries(PURCHASE_ACCOUNT_LABEL) as [
                                PurchaseAccount,
                                string,
                              ][]
                            ).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <input
                            className="admin-input purchase-pay__note"
                            type="text"
                            placeholder="Комментарий (необязательно)"
                            value={pay.comment}
                            onChange={(e) =>
                              setPayDrafts((prev) => ({
                                ...prev,
                                [plan.id]: { ...pay, comment: e.target.value },
                              }))
                            }
                          />
                          <label className="admin-check purchase-pay__paid">
                            <input
                              type="checkbox"
                              checked={pay.isPaid}
                              onChange={(e) =>
                                setPayDrafts((prev) => ({
                                  ...prev,
                                  [plan.id]: { ...pay, isPaid: e.target.checked },
                                }))
                              }
                            />
                            <span>деньги уже ушли</span>
                          </label>
                          <label className="admin-check purchase-pay__paid">
                            <input
                              type="checkbox"
                              checked={pay.excludeFromBalance}
                              onChange={(e) =>
                                setPayDrafts((prev) => ({
                                  ...prev,
                                  [plan.id]: {
                                    ...pay,
                                    excludeFromBalance: e.target.checked,
                                  },
                                }))
                              }
                            />
                            <span>вне баланса</span>
                          </label>
                          <button
                            type="button"
                            className="admin-btn admin-btn--primary"
                            disabled={busyId === plan.id}
                            onClick={() => addPayment(plan)}
                          >
                            <Plus size={13} /> Внести платёж
                          </button>
                        </div>
                      )}

                      <p className="purchase-pay__hint">
                        Платёж сразу попадает в «Банк» как исходящий. Снятая галочка
                        «деньги уже ушли» — это план: он виден в закупке, но баланс не
                        трогает, пока вы его не проведёте. Отнести к закупке можно и
                        готовый платёж — в банке у исходящих есть поле «Закупка».
                      </p>
                    </div>

                    {/* ── Старые виртуальные накопления ── */}
                    {plan.contributions.length > 0 && (
                      <div className="purchase-pay purchase-pay--legacy">
                        <div className="purchase-pay__head">
                          <strong>Отложено (старый учёт)</strong>
                          <span className="purchase-pay__sum">
                            {fmt(plan.savedAmount)} ₽ — деньги не двигались
                          </span>
                        </div>
                        <ul className="purchase-pay__list">
                          {plan.contributions.map((contribution) => (
                            <li key={contribution.id} className="purchase-pay__row">
                              <span className="purchase-pay__date">{contribution.date}</span>
                              <span className="purchase-pay__amount">
                                {fmt(contribution.amount)} ₽
                              </span>
                              <span className="purchase-pay__row-actions">
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--outline admin-btn--sm"
                                  disabled={busyId === plan.id}
                                  onClick={() => convertContribution(plan, contribution.id)}
                                  title="Сделать настоящим платежом в банке"
                                >
                                  Провести платежом
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--ghost admin-btn--sm"
                                  disabled={busyId === plan.id}
                                  onClick={() => removeContribution(plan, contribution.id)}
                                  title="Удалить"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {plan.status === "active" ? (
                      <button
                        type="button"
                        className="admin-btn admin-btn--outline"
                        disabled={busyId === plan.id}
                        onClick={() => setStatus(plan, "completed")}
                      >
                        <CheckCircle2 size={13} /> Закупка завершена — в архив
                      </button>
                    ) : (
                      <div className="purchase-plan__completed">
                        <CheckCircle2 size={15} /> Закупка закрыта · оплачено{" "}
                        {fmt(plan.paidAmount || plan.spentAmount)} ₽
                        {plan.spentPaymentId && (
                          <a
                            href={`/${base}/warehouse?tab=bank&payment=${plan.spentPaymentId}`}
                            className="admin-btn admin-btn--ghost admin-btn--sm"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink size={12} /> Старое списание
                          </a>
                        )}
                        {plan.spentSalaryId && (
                          <a
                            href={`/${base}/warehouse?tab=salaries`}
                            className="admin-btn admin-btn--ghost admin-btn--sm"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Users size={12} /> Зарплата
                          </a>
                        )}
                        <button
                          type="button"
                          className="admin-btn admin-btn--outline admin-btn--sm"
                          disabled={busyId === plan.id}
                          onClick={() => restorePlan(plan)}
                        >
                          <RotateCcw size={13} /> Вернуть в активные
                        </button>
                      </div>
                    )}

                    <div className="purchase-tile__actions">
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary"
                        disabled={busyId === plan.id}
                        onClick={() => saveEdit(plan)}
                      >
                        {busyId === plan.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Pencil size={13} />
                        )}
                        Сохранить
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--danger"
                        disabled={busyId === plan.id}
                        onClick={() => remove(plan)}
                      >
                        <Trash2 size={13} /> Удалить
                      </button>
                    </div>

                    {plan.contributions.length > 0 && (
                      <details className="purchase-plan__history">
                        <summary>История — {plan.contributions.length}</summary>
                        <div>
                          {[...plan.contributions].reverse().map((item) => (
                            <span key={item.id}>
                              <b>+{fmt(item.amount)} ₽</b>
                              <small>{item.date.split("-").reverse().join(".")}</small>
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
