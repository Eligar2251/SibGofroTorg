"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Lightbulb, Loader2, RefreshCw, X } from "lucide-react";
import {
  supplyPlansItemsCount,
  type SupplyPlan,
} from "@/lib/supply-plans-shared";

function formatDate(raw?: string | null): string {
  if (!raw) return "Дата не указана";
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("ru-RU");
}

export function AdminSupplyPlans({ adminPath }: { adminPath: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [plans, setPlans] = useState<SupplyPlan[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/supply-plans", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить планы");
      setPlans(Array.isArray(body.plans) ? body.plans : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Ошибка планов поставок");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Загружаем один раз. Старый опрос каждые 30 секунд будил всю админку,
  // дёргал Supabase и был основной причиной тормозов этой секции.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const activePlans = useMemo(
    () => plans.filter((plan) => plan.status === "active"),
    [plans]
  );
  const items = supplyPlansItemsCount(activePlans);

  return (
    <div className="admin-plans-shortcut">
      <button
        type="button"
        className={`admin-notify__btn admin-plans-shortcut__btn${activePlans.length > 0 ? " admin-plans-shortcut__btn--active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-label="Планы поставок"
        title="Планы поставок"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : <Lightbulb size={19} />}
        {activePlans.length > 0 && (
          <span className="admin-notify__badge admin-plans-shortcut__badge">
            {activePlans.length > 99 ? "99+" : activePlans.length}
          </span>
        )}
      </button>

      {open && (
        <div className="admin-notify__panel admin-plans-shortcut__panel">
          <div className="admin-notify__head">
            <div>
              <div className="admin-notify__title">Планы поставок</div>
              <div className="admin-notify__sub">
                {activePlans.length} планов · {items} позиций
              </div>
            </div>
            <div className="admin-notify__actions">
              <button type="button" onClick={() => load(true)} disabled={refreshing} className="admin-notify__iconbtn" title="Обновить">
                {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="admin-notify__iconbtn" title="Закрыть"><X size={14} /></button>
            </div>
          </div>

          {error && <div className="admin-notify__error">{error}</div>}
          {activePlans.length === 0 && !loading ? (
            <div className="admin-notify__empty"><Lightbulb size={22} /><span>Активных планов пока нет</span></div>
          ) : (
            <div className="admin-notify__list">
              {activePlans.map((plan) => (
                <Link
                  key={plan.id}
                  href={`/${adminPath}/warehouse?tab=plans`}
                  prefetch={false}
                  className="admin-notify__item admin-plans-shortcut__item"
                  onClick={() => setOpen(false)}
                >
                  <span className="admin-notify__item-icon"><Lightbulb size={15} /></span>
                  <span className="admin-notify__item-main">
                    <span className="admin-notify__item-title">{plan.name}</span>
                    <span className="admin-notify__item-desc">
                      {plan.items.length} поз. · {formatDate(plan.plannedDate)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
          <div className="admin-plans-shortcut__footer">
            <Link href={`/${adminPath}/warehouse?tab=plans`} prefetch={false} onClick={() => setOpen(false)}>
              Открыть планирование →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
