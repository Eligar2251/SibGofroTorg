"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  PackageCheck,
  RotateCcw,
  Ticket,
  ClipboardList,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";

interface IssueOrder {
  id: string;
  status: string;
  customerType: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  companyName: string | null;
  inn: string | null;
  pickupCode: string | null;
  issuedAt: string | null;
  items: { name: string; quantity: number; price: number; sku: string | null }[] | null;
  totalSum: number | null;
  comment: string | null;
  deliveryAddress: string | null;
  createdAt: string | null;
}

const statusLabels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  ready: "Готов к выдаче",
  issued: "Выдан",
  completed: "Проведена",
  rejected: "Отменена",
};

function formatDate(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderIssueClient() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<IssueOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/issue/lookup?q=${encodeURIComponent(q)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка поиска");
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка поиска");
    }
    setLoading(false);
  }

  async function act(id: string, action: "issue" | "unissue") {
    if (
      action === "issue" &&
      !confirm("Выдать товар по этому заказу? Заказ будет помечен как «Выдан».")
    ) {
      return;
    }
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/issue/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось выполнить действие");
      // Обновляем список после действия
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                status: action === "issue" ? "issued" : "ready",
                issuedAt: action === "issue" ? new Date().toISOString() : null,
              }
            : o
        )
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
    setBusyId(null);
  }

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Выдача товара</h1>
          <p className="admin-sub">
            Введите код выдачи, номер, имя или телефон — и отметьте заказ выданным.
          </p>
        </div>
      </div>

      <form onSubmit={search} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          className="admin-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Код выдачи (например AB3CD7), имя, телефон или № заказа"
          style={{ flex: 1, minWidth: 260 }}
        />
        <button type="submit" className="admin-btn admin-btn--navy" disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          Найти
        </button>
      </form>

      {error && (
        <div className="admin-status__reason" style={{ color: "var(--adm-rust)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {searched && !loading && orders.length === 0 && (
        <div className="admin-empty">
          <div className="admin-empty__icon"><GlyphIcon value="clipboard" size={40} /></div>
          <p>По запросу «{query}» ничего не найдено</p>
        </div>
      )}

      {orders.map((order) => (
        <div key={order.id} className="admin-card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start", justifyContent: "space-between" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <span className="admin-order__id">#{order.id.slice(0, 8)}</span>
                <span
                  className={`admin-badge ${
                    order.status === "issued"
                      ? "admin-badge--green"
                      : order.status === "ready"
                        ? "admin-badge--indigo"
                        : order.status === "rejected"
                          ? "admin-badge--red"
                          : order.status === "completed"
                            ? "admin-badge--green"
                            : "admin-badge--amber"
                  }`}
                >
                  {statusLabels[order.status] || order.status}
                </span>
                <span className="admin-badge admin-badge--muted">
                  <GlyphIcon value={order.customerType === "legal" ? "building" : "user"} size={11} />{" "}
                  {order.customerType === "legal" ? "Юр. лицо" : "Физ. лицо"}
                </span>
                <span className="admin-muted" style={{ fontSize: 12 }}>{formatDate(order.createdAt)}</span>
              </div>

              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--adm-navy)" }}>
                {order.customerName || "Без имени"} · {order.customerPhone || "—"}
              </div>
              {order.companyName && (
                <div style={{ fontSize: 13, color: "var(--adm-muted)" }}>
                  {order.companyName}
                  {order.inn ? ` · ИНН ${order.inn}` : ""}
                </div>
              )}
              {order.customerEmail && (
                <div style={{ fontSize: 13, color: "var(--adm-muted)" }}>
                  {order.customerEmail}
                </div>
              )}

              {order.pickupCode && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--adm-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Код выдачи:
                  </span>{" "}
                  <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.1em", color: "var(--adm-navy)" }}>
                    {order.pickupCode}
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              {order.status !== "issued" ? (
                <button
                  type="button"
                  className="admin-btn admin-btn--navy"
                  disabled={busyId === order.id || order.status === "rejected"}
                  onClick={() => act(order.id, "issue")}
                >
                  {busyId === order.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <PackageCheck size={14} />
                  )}
                  Выдать товар
                </button>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "var(--adm-muted)" }}>
                    Выдан: {formatDate(order.issuedAt)}
                  </div>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    disabled={busyId === order.id}
                    onClick={() => act(order.id, "unissue")}
                  >
                    {busyId === order.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                    Отменить выдачу
                  </button>
                </>
              )}
            </div>
          </div>

          {order.items && order.items.length > 0 && (
            <div className="admin-order__items" style={{ marginTop: 12 }}>
              <div className="admin-order__items-title">
                <ClipboardList size={13} /> Позиции заказа ({order.items.length})
              </div>
              {order.items.map((item, idx) => (
                <div key={idx} className="admin-order__item">
                  <span>
                    {item.name}
                    <span className="admin-muted"> × {item.quantity} шт.</span>
                  </span>
                  <span className="admin-order__item-sum">
                    {(item.price * item.quantity).toLocaleString("ru-RU")} ₽
                  </span>
                </div>
              ))}
              {order.totalSum != null && (
                <div className="admin-order__total">
                  <span>Итого:</span>
                  <span>{order.totalSum.toLocaleString("ru-RU")} ₽</span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
