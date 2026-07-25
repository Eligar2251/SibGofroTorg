"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, ClipboardList, Loader2, PackageSearch, RefreshCw, Wallet, X } from "lucide-react";

type NotificationType = "order" | "stock" | "unpaid_released";
type NotificationSeverity = "danger" | "warning" | "info";

type AdminNotification = {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  description: string;
  href: string;
  createdAt?: string | null;
};

type NotificationsResponse = {
  total: number;
  counts: {
    orders: number;
    stock: number;
    unpaidReleased: number;
  };
  items: AdminNotification[];
};

function iconFor(type: NotificationType) {
  if (type === "order") return ClipboardList;
  if (type === "stock") return PackageSearch;
  return Wallet;
}

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

export function AdminNotifications({ adminPath }: { adminPath: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<NotificationsResponse>({
    total: 0,
    counts: { orders: 0, stock: 0, unpaidReleased: 0 },
    items: [],
  });

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/notifications", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Не удалось загрузить уведомления");
      setData({
        total: Number(body.total) || 0,
        counts: {
          orders: Number(body.counts?.orders) || 0,
          stock: Number(body.counts?.stock) || 0,
          unpaidReleased: Number(body.counts?.unpaidReleased) || 0,
        },
        items: Array.isArray(body.items) ? body.items : [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка уведомлений");
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
    const parts: string[] = [];
    if (data.counts.orders) parts.push(`заявки ${data.counts.orders}`);
    if (data.counts.stock) parts.push(`остатки ${data.counts.stock}`);
    if (data.counts.unpaidReleased) parts.push(`без оплаты ${data.counts.unpaidReleased}`);
    return parts.join(" · ") || "Срочных уведомлений нет";
  }, [data.counts.orders, data.counts.stock, data.counts.unpaidReleased]);

  return (
    <div className="admin-notify">
      <button
        type="button"
        className={`admin-notify__btn${data.total > 0 ? " admin-notify__btn--active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Уведомления"
        title="Срочные уведомления"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : <Bell size={18} />}
        {data.total > 0 && <span className="admin-notify__badge">{data.total > 99 ? "99+" : data.total}</span>}
      </button>

      {open && (
        <div className="admin-notify__panel">
          <div className="admin-notify__head">
            <div>
              <div className="admin-notify__title">Срочные уведомления</div>
              <div className="admin-notify__sub">{summary}</div>
            </div>
            <div className="admin-notify__actions">
              <button type="button" onClick={() => load(true)} disabled={refreshing} className="admin-notify__iconbtn" title="Обновить">
                {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="admin-notify__iconbtn" title="Закрыть">
                <X size={14} />
              </button>
            </div>
          </div>

          {error && <div className="admin-notify__error">{error}</div>}

          {data.items.length === 0 && !loading ? (
            <div className="admin-notify__empty">
              <Bell size={22} />
              <span>Сейчас срочных уведомлений нет</span>
            </div>
          ) : (
            <div className="admin-notify__list">
              {data.items.map((item) => {
                const Icon = iconFor(item.type);
                return (
                  <Link
                    key={item.id}
                    href={item.href || `/${adminPath}`}
                    prefetch={false}
                    className={`admin-notify__item admin-notify__item--${item.severity}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="admin-notify__item-icon">
                      {item.severity === "danger" ? <AlertTriangle size={15} /> : <Icon size={15} />}
                    </span>
                    <span className="admin-notify__item-main">
                      <span className="admin-notify__item-title">{item.title}</span>
                      <span className="admin-notify__item-desc">{item.description}</span>
                    </span>
                    {item.createdAt && <span className="admin-notify__time">{formatTime(item.createdAt)}</span>}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
