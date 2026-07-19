// =========================================================
// FILE: src/app/cabinet/page.tsx
// =========================================================

"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Phone,
  Package,
  MessageSquare,
  LogOut,
  LogIn,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
  sku?: string;
}

interface Order {
  id: string;
  type?: string;
  status?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  communicationChannel?: string;
  paymentMethod?: string;
  items?: OrderItem[];
  totalSum?: number;
  productInfo?: string;
  quantity?: number;
  comment?: string;
  createdAt?: any;
}

interface UserInfo {
  id: string;
  phone: string;
  name?: string | null;
}

const statusLabels: Record<string, string> = {
  new: "В обработке",
  in_progress: "Сборка заказа",
  completed: "Выполнен",
  rejected: "Отменён",
};

const statusStyles: Record<string, { bg: string; color: string; dot: string }> = {
  new: { bg: "#fff7ed", color: "#c2410c", dot: "#f97316" },
  in_progress: { bg: "#eff6ff", color: "#1d4ed8", dot: "#3b82f6" },
  completed: { bg: "#f0fdf4", color: "#15803d", dot: "#22c55e" },
  rejected: { bg: "#fef2f2", color: "#dc2626", dot: "#ef4444" },
};

const commLabels: Record<string, string> = {
  call: "Звонок",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  max: "Макс",
  email: "Email",
};

const payLabels: Record<string, string> = {
  transfer: "Перевод на карту",
  cash: "Наличные",
  invoice: "Счёт (б/н)",
};

function parseDate(raw: any): string {
  if (!raw) return "—";
  if (raw.seconds !== undefined) {
    return new Date(raw.seconds * 1000).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  if (typeof raw.toDate === "function") {
    return raw.toDate().toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
  }
  if (typeof raw === "number") {
    return new Date(raw).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return "—";
}

function OrderCard({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const st = statusStyles[order.status || "new"] || statusStyles.new;
  const isOrder = order.type === "order";

  return (
    <div className="cab-order">
      <button className="cab-order__head" onClick={() => setOpen(!open)}>
        <div className="cab-order__head-left">
          <span className="cab-order__num">#{order.id.slice(0, 8).toUpperCase()}</span>
          <span className="cab-order__type"><GlyphIcon value={isOrder ? "box" : "chat"} size={12} /> {isOrder ? "Заказ" : "Заявка"}</span>
        </div>
        <div className="cab-order__head-right">
          <span className="cab-order__status" style={{ background: st.bg, color: st.color }}>
            <span className="cab-order__dot" style={{ background: st.dot }} />
            {statusLabels[order.status || "new"]}
          </span>
          <span className="cab-order__date">{parseDate(order.createdAt)}</span>
          <span className="cab-order__chevron">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>
      </button>

      {open && (
        <div className="cab-order__body">
          {isOrder && order.items && order.items.length > 0 && (
            <div className="cab-order__items">
              <div className="cab-order__items-title">
                <Package size={14} /> Состав заказа
              </div>
              <div className="cab-order__items-list">
                {order.items.map((item, idx) => (
                  <div key={idx} className="cab-order__item">
                    <div className="cab-order__item-name">
                      {item.name}
                      {item.sku && <span className="cab-order__item-sku">{item.sku}</span>}
                    </div>
                    <div className="cab-order__item-right">
                      <span className="cab-order__item-qty">× {item.quantity} шт.</span>
                      <span className="cab-order__item-sum">
                        {(item.price * item.quantity).toLocaleString("ru-RU")} ₽
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="cab-order__total">
                <span>Итого к оплате:</span>
                <span className="cab-order__total-sum">
                  {order.totalSum?.toLocaleString("ru-RU")} ₽
                </span>
              </div>
            </div>
          )}

          {!isOrder && order.productInfo && (
            <div className="cab-order__inquiry">
              <span className="cab-order__inquiry-label">Интересует:</span>
              <span className="cab-order__inquiry-val">{order.productInfo}</span>
              {order.quantity && (
                <span className="cab-order__inquiry-qty">{order.quantity} шт.</span>
              )}
            </div>
          )}

          <div className="cab-order__meta">
            {order.communicationChannel && (
              <div className="cab-order__meta-row">
                <span className="cab-order__meta-label">
                  <MessageSquare size={12} /> Способ связи:
                </span>
                <span className="cab-order__meta-val">
                  {commLabels[order.communicationChannel] ?? order.communicationChannel}
                </span>
              </div>
            )}
            {order.paymentMethod && (
              <div className="cab-order__meta-row">
                <span className="cab-order__meta-label"><GlyphIcon value="card" size={13} /> Оплата:</span>
                <span className="cab-order__meta-val">
                  {payLabels[order.paymentMethod] ?? order.paymentMethod}
                </span>
              </div>
            )}
            {order.customerPhone && (
              <div className="cab-order__meta-row">
                <span className="cab-order__meta-label">
                  <Phone size={12} /> Телефон:
                </span>
                <a href={`tel:${order.customerPhone}`} className="cab-order__meta-phone">
                  {order.customerPhone}
                </a>
              </div>
            )}
          </div>

          {order.comment && (
            <div className="cab-order__comment">
              <span className="cab-order__comment-label">Комментарий:</span>
              <span className="cab-order__comment-val">«{order.comment}»</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CabinetPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (cancelled) return;

        if (!meData.user) {
          setUser(null);
          setAuthChecked(true);
          setLoading(false);
          return;
        }

        setUser(meData.user);
        setAuthChecked(true);

        const ordersRes = await fetch("/api/cabinet/orders");
        if (ordersRes.status === 401) {
          setUser(null);
          setOrders([]);
          setLoading(false);
          return;
        }
        if (ordersRes.ok) {
          const data = await ordersRes.json();
          if (!cancelled) setOrders(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        console.error(e);
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setOrders([]);
    router.push("/login?next=/cabinet");
    router.refresh();
  }

  // Не авторизован
  if (authChecked && !user) {
    return (
      <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: "64px" }}>
        <div style={{ borderBottom: "1px solid var(--border)", backgroundColor: "#ffffff" }}>
          <div className="container-wide" style={{ paddingBlock: "14px" }}>
            <div style={{ display: "flex", gap: "8px", fontSize: "13px", color: "var(--ink-muted)" }}>
              <Link href="/" style={{ color: "var(--ink-muted)", textDecoration: "none" }}>
                Главная
              </Link>
              <span>/</span>
              <span style={{ color: "var(--ink)" }}>Мои заказы</span>
            </div>
          </div>
        </div>

        <div className="container-wide" style={{ marginTop: 48, maxWidth: 520 }}>
          <div className="card-base" style={{ textAlign: "center", padding: 40 }}>
            <div style={{ marginBottom: 12, color: "var(--ink-muted)" }}><GlyphIcon value="lock" size={40} /></div>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Нужен вход</h1>
            <p style={{ fontSize: 14, color: "var(--ink-light)", marginBottom: 24, lineHeight: 1.6 }}>
              Заказы видит только владелец аккаунта. Войдите по телефону и паролю —
              чужие заявки недоступны.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/login?next=/cabinet" className="btn-primary" style={{ height: 44, padding: "0 20px", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <LogIn size={16} /> Войти
              </Link>
              <Link
                href="/register?next=/cabinet"
                style={{
                  height: 44,
                  padding: "0 20px",
                  display: "inline-flex",
                  alignItems: "center",
                  border: "1.5px solid var(--border)",
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                Регистрация
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: "64px" }}>
      <div style={{ borderBottom: "1px solid var(--border)", backgroundColor: "#ffffff" }}>
        <div className="container-wide" style={{ paddingBlock: "14px" }}>
          <div style={{ display: "flex", gap: "8px", fontSize: "13px", color: "var(--ink-muted)" }}>
            <Link href="/" style={{ color: "var(--ink-muted)", textDecoration: "none" }}>
              Главная
            </Link>
            <span>/</span>
            <span style={{ color: "var(--ink)" }}>Мои заказы</span>
          </div>
        </div>
      </div>

      <div className="container-wide" style={{ marginTop: "28px" }}>
        <div className="cab-layout">
          <aside className="cab-sidebar">
            <div className="cab-sidebar__card">
              <div className="cab-sidebar__icon"><GlyphIcon value="user" size={22} /></div>
              <h2 className="cab-sidebar__title">Мои заказы</h2>
              {user && (
                <div style={{ fontSize: 13, color: "var(--ink-light)", lineHeight: 1.5 }}>
                  {user.name && (
                    <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                      {user.name}
                    </div>
                  )}
                  <div>{user.phone}</div>
                </div>
              )}
              <p className="cab-sidebar__desc">
                Здесь только ваши заказы, привязанные к аккаунту. Поиск чужих номеров недоступен.
              </p>
              <button type="button" onClick={handleLogout} className="cab-sidebar__btn" style={{ background: "var(--ink)" }}>
                <LogOut size={15} /> Выйти
              </button>
              <div className="cab-sidebar__hint">
                <div className="cab-sidebar__hint-icon"><GlyphIcon value="bulb" size={18} /></div>
                <p>
                  Оформляйте заказ будучи в аккаунте — он сразу появится здесь. Старые заказы с
                  тем же телефоном тоже подтянутся.
                </p>
              </div>
            </div>

            <div className="cab-sidebar__contact">
              <div style={{ fontSize: "13px", color: "var(--ink-light)", marginBottom: "8px" }}>
                Нужна помощь?
              </div>
              <a href="tel:+73832918146" className="cab-sidebar__phone">
                <Phone size={15} /> +7 (383) 291-81-46
              </a>
              <div style={{ fontSize: "11px", color: "var(--ink-muted)", marginTop: "4px" }}>
                Пн–Пт 9:00–18:00 · Сб 10:00–15:00
              </div>
            </div>
          </aside>

          <div className="cab-orders">
            <div className="cab-orders__header">
              <h3 className="cab-orders__title">
                {orders.length > 0 ? `Ваши заказы: ${orders.length}` : "История заказов"}
              </h3>
              {orders.length > 0 && <span className="cab-orders__count">{orders.length}</span>}
            </div>

            {loading && (
              <div className="cab-empty">
                <Loader2 size={32} className="animate-spin" style={{ color: "var(--kraft)" }} />
                <p>Загружаем заказы...</p>
              </div>
            )}

            {!loading && orders.length > 0 && (
              <div className="cab-orders__list">
                {orders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}
              </div>
            )}

            {!loading && orders.length === 0 && (
              <div className="cab-empty">
                <ClipboardList size={40} style={{ color: "var(--ink-muted)" }} />
                <p>Заказов пока нет</p>
                <span>Оформите заказ из каталога — он появится здесь</span>
                <Link href="/catalog" className="cab-empty__cta">
                  Перейти в каталог{" "}
                  <ChevronDown size={14} style={{ transform: "rotate(-90deg)" }} />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}