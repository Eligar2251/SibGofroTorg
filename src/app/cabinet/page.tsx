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
  X,
  Save,
  Search,
  Plus,
  Minus,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface OrderItem {
  productId?: string;
  name: string;
  quantity: number;
  price: number;
  sku?: string;
}

interface ProductOption {
  id: string;
  name: string;
  sku?: string | null;
  price: number | null;
  imageUrl?: string | null;
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

function OrderCard({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editItems, setEditItems] = useState<OrderItem[]>(order.items || []);
  const [productQuery, setProductQuery] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const st = statusStyles[order.status || "new"] || statusStyles.new;
  const isOrder = order.type === "order";

  async function loadProducts(q = "") {
    setLoadingProducts(true);
    try {
      const res = await fetch(`/api/products?limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}`, { cache: "no-store" });
      const data = await res.json();
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch {
      setProducts([]);
    }
    setLoadingProducts(false);
  }

  function startEdit() {
    setEditItems(order.items || []);
    setEditError("");
    setEditing(true);
    loadProducts();
  }

  function patchQty(productId: string | undefined, delta: number) {
    if (!productId) return;
    setEditItems((prev) =>
      prev
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function addProduct(p: ProductOption) {
    const price = Number(p.price) || 0;
    setEditItems((prev) => {
      const found = prev.find((item) => item.productId === p.id);
      if (found) {
        return prev.map((item) =>
          item.productId === p.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { productId: p.id, name: p.name, sku: p.sku || "—", quantity: 1, price }];
    });
  }

  async function saveEdit() {
    setSaving(true);
    setEditError("");
    try {
      const res = await fetch(`/api/cabinet/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: editItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          comment: order.comment || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Не удалось изменить заказ");
      const due = Number(body.additionalDue) || 0;
      alert(due > 0 ? `Заказ снова в обработке. Сумма доплаты: ${due.toLocaleString("ru-RU")} ₽` : "Заказ снова в обработке. Доплата не требуется.");
      setEditing(false);
      onChanged();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Ошибка сети");
    }
    setSaving(false);
  }

  async function cancelOrder() {
    if (!confirm("Отменить заказ? Это можно сделать на любом этапе.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/cabinet/orders/${order.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Не удалось отменить заказ");
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сети");
    }
    setSaving(false);
  }

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

          <div className="cab-order__meta" style={{ alignItems: "flex-start", textAlign: "left", marginLeft: 0 }}>
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

          {isOrder && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button type="button" className="btn-primary" onClick={startEdit} disabled={saving} style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
                <Package size={14} /> <span>Изменить / добавить товар</span>
              </button>
              <button type="button" className="btn-back" onClick={cancelOrder} disabled={saving} style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap", border: "1.5px solid #ef4444", color: "#dc2626", background: "#fff", borderRadius: 8, fontWeight: 700 }}>
                <X size={14} /> <span>Отменить заказ</span>
              </button>
            </div>
          )}

          {editing && (
            <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--bg-card)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <strong style={{ color: "var(--ink)" }}>Изменение заказа</strong>
                <button type="button" className="cart-item__del" onClick={() => setEditing(false)}><X size={14} /></button>
              </div>

              <div className="cab-order__items-list" style={{ marginBottom: 12 }}>
                {editItems.map((item) => (
                  <div key={item.productId || item.name} className="cab-order__item">
                    <div className="cab-order__item-name">{item.name}<span className="cab-order__item-sku">{item.sku}</span></div>
                    <div className="cab-order__item-right">
                      <button type="button" className="qty-btn" onClick={() => patchQty(item.productId, -1)}><Minus size={12} /></button>
                      <span className="cab-order__item-qty">{item.quantity} шт.</span>
                      <button type="button" className="qty-btn" onClick={() => patchQty(item.productId, 1)}><Plus size={12} /></button>
                      <span className="cab-order__item-sum">{(item.price * item.quantity).toLocaleString("ru-RU")} ₽</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
                <input
                  className="form-input"
                  value={productQuery}
                  onChange={(e) => { setProductQuery(e.target.value); loadProducts(e.target.value); }}
                  placeholder="Найти товар и добавить..."
                  style={{ paddingLeft: 36 }}
                />
              </div>
              <div style={{ maxHeight: 220, overflow: "auto", display: "grid", gap: 6 }}>
                {loadingProducts ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Загрузка...</div> : products.map((p) => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff", cursor: "pointer", textAlign: "left" }}>
                    <span>{p.name}</span>
                    <strong>{Number(p.price || 0).toLocaleString("ru-RU")} ₽</strong>
                  </button>
                ))}
              </div>

              <div className="cab-order__total" style={{ marginTop: 12 }}>
                <span>Новая сумма:</span>
                <span className="cab-order__total-sum">{editItems.reduce((s, item) => s + item.price * item.quantity, 0).toLocaleString("ru-RU")} ₽</span>
              </div>
              {editError && <div className="checkout-error" style={{ marginTop: 10 }}>{editError}</div>}
              <button type="button" className="checkout-submit" onClick={saveEdit} disabled={saving || editItems.length === 0} style={{ marginTop: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} <span>Сохранить изменения</span>
              </button>
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
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
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
  }, [refreshKey]);

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
                Здесь ваши заказы, привязанные к номеру.
              </p>
              <button type="button" onClick={handleLogout} className="cab-sidebar__btn" style={{ background: "var(--ink)" }}>
                <LogOut size={15} /> Выйти
              </button>
            </div>

            <div className="cab-sidebar__contact">
              <div style={{ fontSize: "13px", color: "var(--ink-light)", marginBottom: "8px" }}>
                Нужна помощь?
              </div>
              <a href="tel:+73832918146" className="cab-sidebar__phone">
                <Phone size={15} /> +7 (383) 291-81-46
              </a>
              <div style={{ fontSize: "11px", color: "var(--ink-muted)", marginTop: "4px" }}>
                Пн–Пт 8:30–17:00 · Сб, Вс — выходные
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
                  <OrderCard key={order.id} order={order} onChanged={() => setRefreshKey((v) => v + 1)} />
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