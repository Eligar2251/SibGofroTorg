// =========================================================
// FILE: src/app/[adminPath]/orders/page.tsx
// =========================================================

import { getOrders } from "@/lib/firestore-queries";
import Link from "next/link";
import { OrderStatusUpdater } from "@/components/admin/OrderStatusUpdater";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

const statusLabels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Выполнена",
  rejected: "Отклонена",
};

const statusBadge: Record<string, string> = {
  new: "admin-badge admin-badge--amber",
  in_progress: "admin-badge admin-badge--blue",
  completed: "admin-badge admin-badge--green",
  rejected: "admin-badge admin-badge--red",
};

const commLabels: Record<string, string> = {
  call: "📞 Звонок",
  whatsapp: "💬 WhatsApp",
  telegram: "💬 Telegram",
  max: "💬 Макс",
  email: "✉️ Почта",
};

const paymentLabels: Record<string, string> = {
  transfer: "💳 Перевод",
  cash: "💵 Наличные",
  invoice: "🧾 Счет",
};

const filterOptions = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "in_progress", label: "В работе" },
  { value: "completed", label: "Выполненные" },
  { value: "rejected", label: "Отклонённые" },
];

function formatDate(raw: any): string {
  if (!raw) return "—";
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  if (typeof raw === "number") return new Date(raw).toLocaleString("ru-RU");
  if (raw?.seconds !== undefined) {
    return new Date(raw.seconds * 1000).toLocaleString("ru-RU");
  }
  return "—";
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filterStatus } = await searchParams;
  const activeFilter = filterStatus || "all";
  const allOrders = await getOrders({ status: activeFilter });

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Заявки и Заказы</h1>
          <p className="admin-sub">
            Всего: <strong style={{ color: "var(--adm-navy)" }}>{allOrders.length}</strong>{" "}
            обращений
          </p>
        </div>
      </div>

      <div className="admin-filters">
        {filterOptions.map((opt) => (
          <Link
            key={opt.value}
            href={`/${ADMIN_PATH}/orders?status=${opt.value}`}
            className={`admin-filter${activeFilter === opt.value ? " admin-filter--active" : ""}`}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      <div className="admin-card">
        {allOrders.length > 0 ? (
          <div>
            {allOrders.map((order: any) => {
              const isOrder = order.type === "order";
              return (
                <div key={order.id} className="admin-order">
                  <div className="admin-order__row">
                    <div className="admin-order__main">
                      <div className="admin-order__top">
                        <span className="admin-order__id">#{order.id.slice(0, 8)}</span>
                        <span
                          className={
                            isOrder
                              ? "admin-badge admin-badge--indigo"
                              : "admin-badge admin-badge--teal"
                          }
                        >
                          {isOrder ? "📦 Заказ" : "💬 Заявка"}
                        </span>
                        <span className={statusBadge[order.status ?? "new"]}>
                          {statusLabels[order.status ?? "new"]}
                        </span>
                        <span className="admin-order__date">
                          {formatDate(order.createdAt)}
                        </span>
                      </div>

                      <div className="admin-order__grid">
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">Клиент:</span>
                          <span className="admin-order__meta-val">
                            {order.customerName}{" "}
                            <span className="admin-badge admin-badge--muted">
                              {order.customerType === "legal" ? "🏢 Юр." : "👤 Физ."}
                            </span>
                          </span>
                        </div>
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">Телефон:</span>
                          <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>
                        </div>
                        {order.customerEmail && (
                          <div className="admin-order__meta" style={{ gridColumn: "1 / -1" }}>
                            <span className="admin-order__meta-label">Почта:</span>
                            <a href={`mailto:${order.customerEmail}`}>{order.customerEmail}</a>
                          </div>
                        )}
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">Связь:</span>
                          <span className="admin-order__meta-val" style={{ fontWeight: 500, fontSize: 13 }}>
                            {commLabels[order.communicationChannel] ??
                              order.communicationChannel ??
                              "—"}
                          </span>
                        </div>
                        {order.paymentMethod && (
                          <div className="admin-order__meta">
                            <span className="admin-order__meta-label">Оплата:</span>
                            <span className="admin-order__meta-val" style={{ fontWeight: 500, fontSize: 13 }}>
                              {paymentLabels[order.paymentMethod] ?? order.paymentMethod}
                            </span>
                          </div>
                        )}
                      </div>

                      {isOrder && order.items && order.items.length > 0 && (
                        <div className="admin-order__items">
                          <div className="admin-order__items-title">Позиции</div>
                          {order.items.map(
                            (
                              item: {
                                name: string;
                                quantity: number;
                                price: number;
                              },
                              idx: number
                            ) => (
                              <div key={idx} className="admin-order__item">
                                <span>
                                  {item.name}
                                  <span className="admin-muted"> × {item.quantity} шт.</span>
                                </span>
                                <span className="admin-order__item-sum">
                                  {(item.price * item.quantity).toLocaleString("ru-RU")} ₽
                                </span>
                              </div>
                            )
                          )}
                          <div className="admin-order__total">
                            <span>Итого:</span>
                            <span>{order.totalSum?.toLocaleString("ru-RU")} ₽</span>
                          </div>
                        </div>
                      )}

                      {!isOrder && order.productInfo && (
                        <div style={{ fontSize: 14 }}>
                          <span className="admin-muted">Интересует: </span>
                          <strong style={{ color: "var(--adm-navy)" }}>{order.productInfo}</strong>
                          {order.quantity && (
                            <span className="admin-muted"> ({order.quantity} шт.)</span>
                          )}
                        </div>
                      )}

                      {order.comment && (
                        <div className="admin-order__comment">
                          <strong>Комментарий:</strong>
                          <span style={{ fontStyle: "italic", color: "var(--adm-navy)" }}>
                            «{order.comment}»
                          </span>
                        </div>
                      )}

                      {order.closeReason && (
                        <div className="admin-order__close-reason">
                          <strong style={{ display: "block", marginBottom: 4 }}>
                            Причина закрытия:
                          </strong>
                          {order.closeReason}
                        </div>
                      )}
                    </div>

                    <div className="admin-order__side">
                      <OrderStatusUpdater
                        orderId={order.id}
                        currentStatus={order.status ?? "new"}
                        currentCloseReason={order.closeReason ?? null}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="admin-empty">
            <div className="admin-empty__icon">📋</div>
            <p>
              {activeFilter === "all"
                ? "Заявок пока нет"
                : `Нет заявок со статусом «${statusLabels[activeFilter]}»`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}