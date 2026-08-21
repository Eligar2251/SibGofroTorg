"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  Pencil,
  PiggyBank,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { ProductPicker, type PickerProduct } from "@/components/admin/ProductPicker";
import { ImageUploader } from "@/components/admin/ImageUploader";
import {
  PURCHASE_ACCOUNT_LABEL,
  type PurchaseAccount,
  type PurchaseImage,
  type PurchasePlan,
} from "@/lib/purchase-plans-shared";

const fmt = (value: number) => value.toLocaleString("ru-RU", {
  maximumFractionDigits: 2,
});

type OzonPreview = {
  url: string;
  title: string;
  price: number;
  imageUrl: string | null;
  fetchedAt: string;
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

export function PurchasePlanning({
  initialPlans,
  products,
}: {
  initialPlans: PurchasePlan[];
  products: PickerProduct[];
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
  const [contributionDrafts, setContributionDrafts] = useState<Record<string, number>>({});
  const [accountDrafts, setAccountDrafts] = useState<Record<string, PurchaseAccount>>({});
  const [editDrafts, setEditDrafts] = useState<Record<string, {
    productName: string;
    targetAmount: number;
    contributionAmount: number;
    account: PurchaseAccount;
    images: PurchaseImage[];
  }>>({});
  const [showCompleted, setShowCompleted] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const activePlans = useMemo(() => plans.filter((plan) => plan.status === "active"), [plans]);
  const completedPlans = useMemo(() => plans.filter((plan) => plan.status === "completed"), [plans]);
  const visiblePlans = showCompleted ? completedPlans : activePlans;
  const totalSaved = activePlans.reduce((sum, plan) => sum + plan.savedAmount, 0);

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
    return editDrafts[plan.id] || {
      productName: plan.productName,
      targetAmount: plan.targetAmount,
      contributionAmount: plan.contributionAmount,
      account: plan.account,
      images: plan.images?.length
        ? plan.images
        : plan.ozonImageUrl
          ? [{ url: plan.ozonImageUrl, publicId: plan.ozonImagePublicId || "" }]
          : [],
    };
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
      setError(previewError instanceof Error ? previewError.message : "Не удалось получить данные товара Ozon");
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
          images: createImages,
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
          images: draft.images,
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

  async function contribute(plan: PurchasePlan) {
    const amount = Math.max(0, Number(contributionDrafts[plan.id] ?? plan.contributionAmount) || 0);
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
        body: JSON.stringify({ action: "contribute", id: plan.id, amount, date: todayIso() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось добавить накопление");
      replacePlan(body.plan);
    } catch (contributionError) {
      setError(contributionError instanceof Error ? contributionError.message : "Ошибка сети");
    } finally {
      setBusyId(null);
    }
  }

  async function spend(plan: PurchasePlan) {
    const source = accountDrafts[plan.id] || draftFor(plan).account || plan.account;
    if (!confirm(`Списать ${fmt(plan.savedAmount)} ₽ на закупку «${plan.productName}»?\n\nСчёт: ${PURCHASE_ACCOUNT_LABEL[source]}.`)) {
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
    if (!confirm(`Удалить закупку «${plan.productName}»? Это можно сделать и для архивных.`)) return;
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

  return (
    <div className="purchase-planning">
      <header className="purchase-planning__hero">
        <div>
          <span className="purchase-planning__eyebrow"><PiggyBank size={14} /> Карточки закупок</span>
          <h2>Закупки</h2>
          <p>Плитки как у товаров: фото в Cloudinary, правка, удаление — в том числе из архива.</p>
        </div>
        <div className="purchase-planning__summary">
          <span>Активных <b>{activePlans.length}</b></span>
          <span>Накоплено <b>{fmt(totalSaved)} ₽</b></span>
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
                if (selectedProduct && event.target.value !== selectedProduct.name) setSelectedProduct(null);
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
                  if (ozonUrl.trim() && !ozonPreview && !loadingOzon) void loadOzonPreview();
                }}
              />
              <button type="button" className="admin-btn admin-btn--outline" disabled={loadingOzon || !ozonUrl.trim()} onClick={() => void loadOzonPreview()}>
                {loadingOzon ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Подтянуть
              </button>
            </div>
          </label>
          <div className="admin-field">
            <span className="admin-label">Фото закупки</span>
            <ImageUploader images={createImages} onChange={setCreateImages} />
          </div>
          <span className="admin-label purchase-create__catalog-label">Или выбрать из каталога</span>
          <ProductPicker products={products} onPick={(product) => { setSelectedProduct(product); setProductName(product.name); }} placeholder="Поиск по каталогу…" showPrice={false} />
        </div>
        <label className="admin-field">
          <span className="admin-label">Цель, ₽</span>
          <input className="admin-input" type="number" min={0} step={100} value={targetAmount || ""} onChange={(event) => setTargetAmount(Math.max(0, Number(event.target.value) || 0))} />
        </label>
        <label className="admin-field">
          <span className="admin-label">Откладывать, ₽</span>
          <input className="admin-input" type="number" min={1} step={100} value={contributionAmount} onChange={(event) => setContributionAmount(Math.max(1, Number(event.target.value) || 500))} />
        </label>
        <label className="admin-field">
          <span className="admin-label">Счёт списания</span>
          <select className="admin-select" value={account} onChange={(event) => setAccount(event.target.value as PurchaseAccount)}>
            {Object.entries(PURCHASE_ACCOUNT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="admin-btn admin-btn--primary" disabled={creating || (!productName.trim() && !ozonUrl.trim())} onClick={createPlan}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Создать карточку
        </button>
      </section>

      {error && <div className="admin-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="admin-filters admin-filters--sub" style={{ marginBottom: 12 }}>
        <button type="button" className={`admin-filter${!showCompleted ? " admin-filter--active" : ""}`} onClick={() => setShowCompleted(false)}>Активные ({activePlans.length})</button>
        <button type="button" className={`admin-filter${showCompleted ? " admin-filter--active" : ""}`} onClick={() => setShowCompleted(true)}>Архив ({completedPlans.length})</button>
      </div>

      {visiblePlans.length === 0 ? (
        <div className="admin-empty"><PiggyBank size={30} /><p>{showCompleted ? "Архив пуст" : "Создайте первую карточку закупки"}</p></div>
      ) : (
        <div className="purchase-grid">
          {visiblePlans.map((plan) => {
            const cover = planCover(plan);
            const progress = plan.targetAmount > 0 ? Math.min(100, Math.round((plan.savedAmount / plan.targetAmount) * 100)) : 0;
            const open = openId === plan.id;
            const draft = draftFor(plan);
            return (
              <article key={plan.id} className={`purchase-tile${open ? " is-open" : ""}${plan.status === "completed" ? " is-done" : ""}`}>
                <button type="button" className="purchase-tile__face" onClick={() => setOpenId(open ? null : plan.id)}>
                  <span className="purchase-tile__media">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" />
                    ) : (
                      <PiggyBank size={28} />
                    )}
                    {plan.status === "completed" && <em>архив</em>}
                    {plan.status === "completed" && (
                      <button type="button" className="purchase-tile__restore" title="Вернуть в активные"
                        onClick={async (e) => {
                          e.stopPropagation();
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
                        }}>
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </span>
                  <strong>{plan.productName}</strong>
                  <span>{fmt(plan.savedAmount)} ₽{plan.targetAmount > 0 ? ` / ${fmt(plan.targetAmount)} ₽` : ""}</span>
                  {plan.targetAmount > 0 && <i style={{ width: `${progress}%` }} />}
                </button>

                {open && (
                  <div className="purchase-tile__editor">
                    <label className="admin-field">
                      <span className="admin-label">Название</span>
                      <input className="admin-input" value={draft.productName} onChange={(e) => setEditDrafts((p) => ({ ...p, [plan.id]: { ...draft, productName: e.target.value } }))} />
                    </label>
                    <div className="admin-grid-2">
                      <label className="admin-field">
                        <span className="admin-label">Цель, ₽</span>
                        <input className="admin-input" type="number" value={draft.targetAmount || ""} onChange={(e) => setEditDrafts((p) => ({ ...p, [plan.id]: { ...draft, targetAmount: Math.max(0, Number(e.target.value) || 0) } }))} />
                      </label>
                      <label className="admin-field">
                        <span className="admin-label">Откладывать, ₽</span>
                        <input className="admin-input" type="number" value={draft.contributionAmount} onChange={(e) => setEditDrafts((p) => ({ ...p, [plan.id]: { ...draft, contributionAmount: Math.max(1, Number(e.target.value) || 1) } }))} />
                      </label>
                    </div>
                    <label className="admin-field">
                      <span className="admin-label">Счёт</span>
                      <select className="admin-select" value={draft.account} onChange={(e) => setEditDrafts((p) => ({ ...p, [plan.id]: { ...draft, account: e.target.value as PurchaseAccount } }))}>
                        {Object.entries(PURCHASE_ACCOUNT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <div className="admin-field">
                      <span className="admin-label">Фото</span>
                      <ImageUploader
                        images={draft.images}
                        onChange={(images) => setEditDrafts((p) => ({ ...p, [plan.id]: { ...draft, images } }))}
                      />
                    </div>
                    {plan.ozonUrl && (
                      <a href={plan.ozonUrl} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn--ghost admin-btn--sm">
                        Ozon <ExternalLink size={12} />
                      </a>
                    )}
                    {plan.status === "active" && (
                      <div className="purchase-tile__money">
                        <input className="admin-input" type="number" min={1} value={contributionDrafts[plan.id] ?? plan.contributionAmount} onChange={(e) => setContributionDrafts((p) => ({ ...p, [plan.id]: Math.max(1, Number(e.target.value) || 0) }))} />
                        <button type="button" className="admin-btn admin-btn--outline" disabled={busyId === plan.id} onClick={() => contribute(plan)}>
                          <Plus size={13} /> Отложить
                        </button>
                        <button type="button" className="admin-btn admin-btn--primary" disabled={busyId === plan.id || plan.savedAmount <= 0} onClick={() => spend(plan)}>
                          {accountIcon(draft.account)} Списать {fmt(plan.savedAmount)} ₽
                        </button>
                      </div>
                    )}
                    {plan.status === "completed" && (
                      <>
                        <div className="purchase-plan__completed">
                          <CheckCircle2 size={15} /> Списано {fmt(plan.spentAmount)} ₽
                          {plan.spentPaymentId && (
                            <a
                              href={`/${(typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "admin")}/warehouse?tab=bank&payment=${plan.spentPaymentId}`}
                              className="admin-btn admin-btn--ghost admin-btn--sm"
                              style={{ marginLeft: 8 }}
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink size={12} /> Платёж
                            </a>
                          )}
                        </div>
                        <button type="button" className="admin-btn admin-btn--outline admin-btn--sm" disabled={busyId === plan.id} onClick={async () => {
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
                        }}>
                          <RotateCcw size={13} /> Вернуть в активные
                        </button>
                      </>
                    )}
                    <div className="purchase-tile__actions">
                      <button type="button" className="admin-btn admin-btn--primary" disabled={busyId === plan.id} onClick={() => saveEdit(plan)}>
                        {busyId === plan.id ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
                        Сохранить
                      </button>
                      <button type="button" className="admin-btn admin-btn--danger" disabled={busyId === plan.id} onClick={() => remove(plan)}>
                        <Trash2 size={13} /> Удалить
                      </button>
                    </div>
                    {plan.contributions.length > 0 && (
                      <details className="purchase-plan__history">
                        <summary>История — {plan.contributions.length}</summary>
                        <div>
                          {[...plan.contributions].reverse().map((item) => (
                            <span key={item.id}><b>+{fmt(item.amount)} ₽</b><small>{item.date.split("-").reverse().join(".")}</small></span>
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
