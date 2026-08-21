"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ClipboardList,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

type AlertItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  createdAt?: string | null;
};

type AlertsResponse = {
  total: number;
  items: AlertItem[];
};

function formatTime(raw?: string | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Третий кружок рядом с планами поставок и срочными уведомлениями.
 * Показывает только необработанные заявки (status = new).
 * Как только заявку отправили в работу / закрыли — она пропадает.
 */
export function AdminRequestAlerts({ adminPath }: { adminPath: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<AlertsResponse>({ total: 0, items: [] });

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/notifications", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Не удалось загрузить заявки");

      // API уже отдаёт только status=new (и заказы, и макулатуру).
      const orderItems: AlertItem[] = (Array.isArray(body.items) ? body.items : [])
        .filter((item: { type?: string }) => item.type === "order")
        .map(
          (item: {
            id: string;
            title: string;
            description: string;
            href: string;
            createdAt?: string | null;
          }) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            href: item.href,
            createdAt: item.createdAt,
          })
        );

      setData({
        total: orderItems.length,
        items: orderItems,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка заявок");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(() => load(true), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const summary = useMemo(() => {
    if (!data.total) return "Новых заявок нет";
    const n = data.total;
    const word =
      n % 10 === 1 && n % 100 !== 11
        ? "заявка"
        : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)
          ? "заявки"
          : "заявок";
    return `${n} ${word} ждут обработки`;
  }, [data.total]);

  return (
    <div className="admin-requests-shortcut">
      <button
        type="button"
        className={`admin-notify__btn admin-requests-shortcut__btn${
          data.total > 0 ? " admin-requests-shortcut__btn--active" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Необработанные заявки"
        title="Необработанные заявки"
      >
        {loading ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <ClipboardList size={18} />
        )}
        {data.total > 0 && (
          <span className="admin-notify__badge admin-requests-shortcut__badge">
            {data.total > 99 ? "99+" : data.total}
          </span>
        )}
      </button>

      {open && (
        <div className="admin-notify__panel admin-requests-shortcut__panel">
          <div className="admin-notify__head">
            <div>
              <div className="admin-notify__title">Новые заявки</div>
              <div className="admin-notify__sub">{summary}</div>
            </div>
            <div className="admin-notify__actions">
              <button
                type="button"
                onClick={() => load(true)}
                disabled={refreshing}
                className="admin-notify__iconbtn"
                title="Обновить"
              >
                {refreshing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="admin-notify__iconbtn"
                title="Закрыть"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {error && <div className="admin-notify__error">{error}</div>}

          {data.items.length === 0 && !loading ? (
            <div className="admin-notify__empty">
              <ClipboardList size={22} />
              <span>Необработанных заявок нет</span>
            </div>
          ) : (
            <div className="admin-notify__list">
              {data.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href || `/${adminPath}/orders?status=new`}
                  prefetch={false}
                  className="admin-notify__item admin-notify__item--warning"
                  onClick={() => setOpen(false)}
                >
                  <span className="admin-notify__item-icon">
                    <ClipboardList size={15} />
                  </span>
                  <span className="admin-notify__item-main">
                    <span className="admin-notify__item-title">{item.title}</span>
                    <span className="admin-notify__item-desc">
                      {item.description}
                    </span>
                  </span>
                  {item.createdAt && (
                    <span className="admin-notify__time">
                      {formatTime(item.createdAt)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}

          <div className="admin-requests-shortcut__footer">
            <Link
              href={`/${adminPath}/orders?status=new`}
              prefetch={false}
              onClick={() => setOpen(false)}
            >
              Открыть все новые →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
