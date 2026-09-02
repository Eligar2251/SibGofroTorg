// =========================================================
// FILE: src/components/admin/UserCabinetViewer.tsx
// «Кабинет клиента» внутри админки.
//
// Смысл экрана: менеджер выбирает клиента и видит его личный кабинет
// ТАКИМ ЖЕ, каким его видит сам клиент, — те же карточки, те же
// клиентские формулировки статусов, тот же код выдачи. Данные берутся
// из /api/admin/user-orders, который вызывает ровно ту же функцию
// выборки, что и /api/cabinet/orders, поэтому расхождение картинки
// технически невозможно.
//
// Под каждой карточкой — панель менеджера (её у клиента нет): смена
// статуса, отметка о выдаче, ручная правка состава и удаление заявки
// именно у этого клиента. Так проверяется синхронизация: нажали
// «Выдать товар» — карточка сверху сразу становится «Выдан».
// =========================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Eye,
  Loader2,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react";
import { OrderStatusUpdater } from "@/components/admin/OrderStatusUpdater";
import { OrderIssueButton } from "@/components/admin/OrderIssueButton";
import { useAdminRealtime } from "@/lib/use-admin-realtime";
import {
  ADMIN_STATUS_LABELS,
  CLIENT_STATUS_LABELS,
} from "@/lib/order-status";

interface CabUser {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  username: string | null;
  customerType: string | null;
  companyName: string | null;
  createdAt: string | null;
  ordersCount: number;
}

interface CabItem {
  productId: string | null;
  variantId: string | null;
  variantName: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  price: number;
}

interface CabOrder {
  id: string;
  type: string;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  paymentMethod: string | null;
  communicationChannel: string | null;
  items: CabItem[] | null;
  totalSum: number | null;
  productInfo: string | null;
  quantity: number | null;
  comment: string | null;
  pickupCode: string | null;
  closeReason: string | null;
  createdAt: string | null;
  guest: boolean;
}

interface ProductOption {
  id: string;
  name: string;
  sku?: string | null;
  price: number | null;
}

/* Палитра статусов — та же, что в src/app/cabinet/page.tsx. */
const statusStyles: Record<string, { bg: string; color: string; dot: string }> = {
  new: { bg: "#fff7ed", color: "#c2410c", dot: "#f97316" },
  in_progress: { bg: "#eff6ff", color: "#1d4ed8", dot: "#3b82f6" },
  ready: { bg: "#f5f3ff", color: "#6d28d9", dot: "#8b5cf6" },
  issued: { bg: "#ecfeff", color: "#0e7490", dot: "#06b6d4" },
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

const money = (value: number | null | undefined) =>
  (Number(value) || 0).toLocaleString("ru-RU");

function formatDate(raw: string | null): string {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function userTitle(user: CabUser): string {
  return (
    user.name ||
    user.companyName ||
    user.username ||
    user.phone ||
    `Клиент ${user.id.slice(0, 8)}`
  );
}

/* ── Карточка: сверху вид клиента, снизу инструменты менеджера ── */

function CabinetOrderCard({
  order,
  onChanged,
}: {
  order: CabOrder;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<CabItem[]>(order.items || []);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const st = statusStyles[order.status] || statusStyles.new;
  const isOrder = order.type === "order";
  const isClosed = order.status === "completed" || order.status === "rejected";

  const loadProducts = useCallback(async (q = "") => {
    setLoadingProducts(true);
    try {
      const res = await fetch(
        `/api/products?limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch {
      setProducts([]);
    }
    setLoadingProducts(false);
  }, []);

  function startEdit() {
    setItems(order.items || []);
    setError("");
    setEditing(true);
    loadProducts();
  }

  function patchQty(item: CabItem, delta: number) {
    setItems((prev) =>
      prev
        .map((row) =>
          row.productId === item.productId &&
          (row.variantId ?? null) === (item.variantId ?? null)
            ? { ...row, quantity: Math.max(0, row.quantity + delta) }
            : row
        )
        .filter((row) => row.quantity > 0)
    );
  }

  function addProduct(product: ProductOption) {
    const price = Number(product.price) || 0;
    setItems((prev) => {
      const found = prev.find(
        (row) => row.productId === product.id && (row.variantId ?? null) === null
      );
      if (found) {
        return prev.map((row) =>
          row.productId === product.id && (row.variantId ?? null) === null
            ? { ...row, quantity: row.quantity + 1 }
            : row
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          variantId: null,
          variantName: null,
          name: product.name,
          sku: product.sku || "—",
          quantity: 1,
          price,
        },
      ];
    });
  }

  async function saveItems() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/user-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((row) => ({
            productId: row.productId,
            quantity: row.quantity,
            variantId: row.variantId ?? null,
            variantName: row.variantName ?? null,
          })),
          comment: order.comment ?? null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Не удалось сохранить состав");
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    }
    setSaving(false);
  }

  async function removeOrder() {
    if (
      !confirm(
        "Удалить эту заявку у клиента? Она исчезнет из его личного кабинета безвозвратно.\n\n" +
          "Если нужно просто закрыть заявку, оставив её в истории, используйте статус «Отменена»."
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/user-orders/${order.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Не удалось удалить заявку");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      setSaving(false);
    }
  }

  const editedTotal = items.reduce((sum, row) => sum + row.price * row.quantity, 0);

  return (
    <div className="acab-order">
      <button
        type="button"
        className="acab-order__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="acab-order__head-left">
          <span className="acab-order__num">
            #{order.id.slice(0, 8).toUpperCase()}
          </span>
          <span className="acab-order__type">
            {isOrder ? "Заказ" : "Заявка"}
          </span>
        </span>
        <span className="acab-order__head-right">
          <span
            className="acab-order__status"
            style={{ background: st.bg, color: st.color }}
          >
            <span className="acab-order__dot" style={{ background: st.dot }} />
            {CLIENT_STATUS_LABELS[order.status] || "В обработке"}
          </span>
          <span className="acab-order__date">{formatDate(order.createdAt)}</span>
        </span>
      </button>

      {open && (
        <div className="acab-order__body">
          {isOrder && order.items && order.items.length > 0 && (
            <div className="acab-order__box">
              <div className="acab-order__box-title">
                <Package size={13} /> Состав заказа
              </div>
              {order.items.map((item, idx) => (
                <div className="acab-order__item" key={idx}>
                  <div className="acab-order__item-name">
                    {item.name}
                    {item.sku && (
                      <span className="acab-order__item-sku">{item.sku}</span>
                    )}
                  </div>
                  <div className="acab-order__item-right">
                    <span className="acab-order__item-qty">
                      × {item.quantity} шт.
                    </span>
                    <span className="acab-order__item-sum">
                      {money(item.price * item.quantity)} ₽
                    </span>
                  </div>
                </div>
              ))}
              <div className="acab-order__total">
                <span>Итого к оплате:</span>
                <span className="acab-order__total-sum">
                  {money(order.totalSum)} ₽
                </span>
              </div>
            </div>
          )}

          {!isOrder && order.productInfo && (
            <div className="acab-order__meta">
              <div className="acab-order__meta-row">
                <span className="acab-order__meta-label">Интересует:</span>
                <span className="acab-order__meta-val">
                  {order.productInfo}
                  {order.quantity ? ` · ${order.quantity} шт.` : ""}
                </span>
              </div>
            </div>
          )}

          <div className="acab-order__meta">
            {order.communicationChannel && (
              <div className="acab-order__meta-row">
                <span className="acab-order__meta-label">Способ связи:</span>
                <span className="acab-order__meta-val">
                  {commLabels[order.communicationChannel] ||
                    order.communicationChannel}
                </span>
              </div>
            )}
            {order.paymentMethod && (
              <div className="acab-order__meta-row">
                <span className="acab-order__meta-label">Оплата:</span>
                <span className="acab-order__meta-val">
                  {payLabels[order.paymentMethod] || order.paymentMethod}
                </span>
              </div>
            )}
            {order.customerPhone && (
              <div className="acab-order__meta-row">
                <span className="acab-order__meta-label">Телефон:</span>
                <span className="acab-order__meta-val">
                  {order.customerPhone}
                </span>
              </div>
            )}
            {order.comment && (
              <div className="acab-order__meta-row">
                <span className="acab-order__meta-label">Комментарий:</span>
                <span className="acab-order__meta-val">«{order.comment}»</span>
              </div>
            )}
          </div>

          {isOrder && order.pickupCode && order.status !== "rejected" && (
            <div className="acab-order__pickup">
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>
                КОД ВЫДАЧИ ЗАКАЗА
              </div>
              <div className="acab-order__pickup-code">{order.pickupCode}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Назовите код при получении товара на складе
              </div>
            </div>
          )}

          {order.status === "ready" && (
            <div
              className="acab-order__note"
              style={{
                background: "#f5f3ff",
                color: "#5b21b6",
                border: "1px solid #ddd6fe",
              }}
            >
              <strong>Заказ собран и готов к выдаче.</strong> Можно забирать.
            </div>
          )}

          {isClosed && (
            <div
              className="acab-order__note"
              style={{
                background: order.status === "completed" ? "#f0fdf4" : "#fef2f2",
                color: order.status === "completed" ? "#15803d" : "#dc2626",
                border: `1px solid ${
                  order.status === "completed" ? "#bbf7d0" : "#fecaca"
                }`,
              }}
            >
              <strong>
                {order.status === "completed"
                  ? "Заявка выполнена и закрыта."
                  : "Заявка отменена."}
              </strong>
              {order.closeReason ? ` Причина: ${order.closeReason}` : ""}
            </div>
          )}
        </div>
      )}

      {/* ── Панель менеджера. У клиента её нет. ── */}
      <div className="acab-tools">
        <div className="acab-tools__label">
          <Wrench size={12} /> Управление менеджера · служебный статус:{" "}
          {ADMIN_STATUS_LABELS[order.status] || order.status}
        </div>

        <div className="acab-tools__row">
          <OrderStatusUpdater
            orderId={order.id}
            currentStatus={order.status}
            currentCloseReason={order.closeReason}
            onChanged={onChanged}
          />
          <OrderIssueButton
            orderId={order.id}
            status={order.status}
            onChanged={onChanged}
          />
        </div>

        <div className="acab-tools__row">
          {isOrder && !isClosed && (
            <button
              type="button"
              className="admin-btn admin-btn--outline admin-btn--sm"
              onClick={startEdit}
              disabled={saving}
            >
              <Package size={13} /> Изменить состав
            </button>
          )}
          <button
            type="button"
            className="admin-btn admin-btn--danger admin-btn--sm"
            onClick={removeOrder}
            disabled={saving}
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Trash2 size={13} />
            )}
            Удалить у клиента
          </button>
        </div>

        {error && <div className="acab-tools__error">{error}</div>}

        {editing && (
          <div className="acab-editor">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong style={{ fontSize: 13 }}>Ручная правка состава</strong>
              <button
                type="button"
                className="admin-btn admin-btn--icon"
                onClick={() => setEditing(false)}
                aria-label="Закрыть редактор"
              >
                <X size={14} />
              </button>
            </div>

            <div className="acab-editor__list">
              {items.map((item) => (
                <div
                  className="acab-editor__item"
                  key={`${item.productId || ""}::${item.variantId || ""}`}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{item.name}</span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <button
                      type="button"
                      className="admin-btn admin-btn--icon"
                      onClick={() => patchQty(item, -1)}
                      aria-label="Убрать одну штуку"
                    >
                      <Minus size={12} />
                    </button>
                    <span>{item.quantity} шт.</span>
                    <button
                      type="button"
                      className="admin-btn admin-btn--icon"
                      onClick={() => patchQty(item, 1)}
                      aria-label="Добавить одну штуку"
                    >
                      <Plus size={12} />
                    </button>
                  </span>
                </div>
              ))}
              {items.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--adm-muted)" }}>
                  Все позиции убраны — добавьте хотя бы одну, иначе сохранить
                  нельзя.
                </div>
              )}
            </div>

            <div className="admin-field">
              <input
                className="admin-input"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  loadProducts(e.target.value);
                }}
                placeholder="Найти товар и добавить…"
              />
            </div>

            <div className="acab-editor__results">
              {loadingProducts ? (
                <div style={{ fontSize: 12, color: "var(--adm-muted)" }}>
                  Загрузка…
                </div>
              ) : (
                products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    className="acab-editor__result"
                    onClick={() => addProduct(product)}
                  >
                    <span>{product.name}</span>
                    <strong>{money(product.price)} ₽</strong>
                  </button>
                ))
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 13 }}>
                Новая сумма: <strong>{money(editedTotal)} ₽</strong>
              </span>
              <button
                type="button"
                className="admin-btn admin-btn--primary admin-btn--sm"
                onClick={saveItems}
                disabled={saving || items.length === 0}
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                Сохранить состав
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>
              Цены и названия берутся из карточек товаров, вручную их не
              переписать. Статус заявки при правке не меняется.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Экран целиком ── */

export function UserCabinetViewer() {
  const [users, setUsers] = useState<CabUser[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [orders, setOrders] = useState<CabOrder[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch("/api/admin/user-orders", { cache: "no-store" });
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch {
      setUsers([]);
    }
    setLoadingUsers(false);
  }, []);

  const loadOrders = useCallback(async (userId: string) => {
    setLoadingOrders(true);
    try {
      const res = await fetch(
        `/api/admin/user-orders?userId=${encodeURIComponent(userId)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      setOrders([]);
    }
    setLoadingOrders(false);
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (selectedId) loadOrders(selectedId);
    else setOrders([]);
  }, [selectedId, loadOrders]);

  const refresh = useCallback(() => {
    if (selectedId) loadOrders(selectedId);
    loadUsers();
  }, [selectedId, loadOrders, loadUsers]);

  // Клиент оформил или изменил заявку — экран обновляется сам, без F5:
  // иначе «проверка синхронизации» показывала бы устаревший снимок.
  useAdminRealtime({
    tables: ["orders"],
    manual: true,
    onUpdate: refresh,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) =>
      [user.name, user.phone, user.email, user.username, user.companyName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [users, search]);

  const selected = users.find((user) => user.id === selectedId) || null;

  return (
    <div className="acab-layout">
      <div className="acab-users">
        <div className="acab-users__search">
          <div className="admin-field" style={{ marginBottom: 0 }}>
            <input
              className="admin-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: имя, телефон, почта…"
            />
          </div>
        </div>
        <div className="acab-users__list">
          {loadingUsers && (
            <div className="acab-empty">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {!loadingUsers && filtered.length === 0 && (
            <div className="acab-empty">Клиенты не найдены</div>
          )}
          {filtered.map((user) => (
            <button
              type="button"
              key={user.id}
              className={`acab-user${
                user.id === selectedId ? " acab-user--active" : ""
              }`}
              onClick={() => setSelectedId(user.id)}
            >
              <span className="acab-user__avatar">
                {user.customerType === "legal" ? (
                  <Building2 size={15} />
                ) : (
                  <User size={15} />
                )}
              </span>
              <span className="acab-user__main">
                <span className="acab-user__name">{userTitle(user)}</span>
                <span className="acab-user__sub">
                  {user.phone || user.email || user.username || "—"}
                </span>
              </span>
              <span className="acab-user__count">{user.ordersCount}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="acab-screen">
        <div className="acab-screen__bar">
          <div className="acab-screen__title">
            <Eye size={14} />
            {selected
              ? `Личный кабинет: ${userTitle(selected)}`
              : "Выберите клиента слева"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="acab-screen__hint">
              Верх карточки — то, что видит клиент
            </span>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={refresh}
              disabled={!selectedId || loadingOrders}
            >
              <RefreshCw size={13} /> Обновить
            </button>
          </div>
        </div>

        {!selectedId && (
          <div className="acab-empty">
            Слева выберите клиента — здесь откроется его страница «Мои заказы»
            в том виде, в каком её видит он сам.
          </div>
        )}

        {selectedId && (
          <div className="acab-canvas">
            <div className="acab-canvas__head">
              <span>
                {orders.length > 0
                  ? `Ваши заказы: ${orders.length}`
                  : "История заказов"}
              </span>
              {loadingOrders && <Loader2 size={15} className="animate-spin" />}
            </div>

            {!loadingOrders && orders.length === 0 && (
              <div className="acab-empty" style={{ color: "#6b7280" }}>
                Заказов пока нет — именно это видит клиент.
              </div>
            )}

            {orders.map((order) => (
              <CabinetOrderCard
                key={order.id}
                order={order}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
