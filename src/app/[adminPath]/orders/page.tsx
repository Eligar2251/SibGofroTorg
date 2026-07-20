// src/app/[adminPath]/orders/page.tsx
import { getOrders } from "@/lib/firestore-queries";
import Link from "next/link";
import { OrderStatusUpdater } from "@/components/admin/OrderStatusUpdater";
import { OrderDeleteButton } from "@/components/admin/OrderDeleteButton";
import { GlyphIcon } from "@/components/ui/Glyph";
import { OrdersAutoRefresh } from "@/components/admin/OrdersAutoRefresh";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

const statusLabels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Проведена",
  rejected: "Отклонена",
};

const statusBadge: Record<string, string> = {
  new: "admin-badge admin-badge--amber",
  in_progress: "admin-badge admin-badge--blue",
  completed: "admin-badge admin-badge--green",
  rejected: "admin-badge admin-badge--red",
};

const commLabels: Record<string, { token: string; text: string }> = {
  call: { token: "phone", text: "Звонок" },
  whatsapp: { token: "chat", text: "WhatsApp" },
  telegram: { token: "send", text: "Telegram" },
  max: { token: "chats", text: "Макс" },
  email: { token: "mail", text: "Почта" },
};

const paymentLabels: Record<string, { token: string; text: string }> = {
  transfer: { token: "card", text: "Перевод" },
  cash: { token: "cash", text: "Наличные" },
  invoice: { token: "receipt", text: "Счет" },
};

const filterOptions = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "in_progress", label: "В работе" },
  { value: "completed", label: "Проведённые" },
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
  if (raw?.seconds !== undefined)
    return new Date(raw.seconds * 1000).toLocaleString("ru-RU");
  return "—";
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; type?: string }>;
}) {
  const { status: filterStatus, q: searchQuery, type: typeQuery } = await searchParams;
  const activeFilter = filterStatus || "all";
  const activeType = typeQuery || "all";
  const query = searchQuery ? searchQuery.toLowerCase().trim() : "";

  const allOrders = await getOrders({ status: activeFilter, limit: 50 });

  const filteredOrders = allOrders.filter((order: any) => {
    if (activeType !== "all" && order.type !== activeType) return false;
    if (!query) return true;
    return (
      (order.customerName && order.customerName.toLowerCase().includes(query)) ||
      (order.customerPhone && order.customerPhone.includes(query)) ||
      (order.customerEmail && order.customerEmail.toLowerCase().includes(query)) ||
      (order.id && order.id.toLowerCase().includes(query)) ||
      (order.productInfo && order.productInfo.toLowerCase().includes(query))
    );
  });

  return (
    <div>
      <OrdersAutoRefresh intervalMs={10000} />
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Заявки и Заказы</h1>
          <p className="admin-sub">
            Всего обращений:{" "}
            <strong style={{ color: "var(--adm-navy)" }}>
              {filteredOrders.length}
            </strong>{" "}
            {allOrders.length !== filteredOrders.length ? `(из ${allOrders.length})` : ""}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <form method="GET" action={`/${ADMIN_PATH}/orders`} style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="status" value={activeFilter} />
            <input type="hidden" name="type" value={activeType} />
            <input
              type="text"
              name="q"
              defaultValue={searchQuery || ""}
              placeholder="Поиск по имени, телефону, почте, ID..."
              className="admin-input"
            />
            <button type="submit" className="admin-btn admin-btn--navy">
              Найти
            </button>
            {searchQuery && (
              <Link href={`/${ADMIN_PATH}/orders?status=${activeFilter}&type=${activeType}`} className="admin-btn admin-btn--ghost" prefetch={false}>
                Сбросить
              </Link>
            )}
          </form>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {[
            { value: "all", label: "Все типы", token: "" },
            { value: "order", label: "Заказы", token: "box" },
            { value: "inquiry", label: "Заявки", token: "chat" },
          ].map((t) => (
            <Link
              key={t.value}
              href={`/${ADMIN_PATH}/orders?status=${activeFilter}&type=${t.value}${searchQuery ? `&q=${searchQuery}` : ""}`}
              className={`admin-filter${activeType === t.value ? " admin-filter--active" : ""}`}
             prefetch={false}>
              {t.token && (
                <GlyphIcon value={t.token} size={13} />
              )}
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="admin-filters">
        {filterOptions.map((opt) => (
          <Link
            key={opt.value}
            href={`/${ADMIN_PATH}/orders?status=${opt.value}&type=${activeType}${searchQuery ? `&q=${searchQuery}` : ""}`}
            className={`admin-filter${activeFilter === opt.value ? " admin-filter--active" : ""}`}
           prefetch={false}>
            {opt.label}
          </Link>
        ))}
      </div>

      <div className="admin-card">
        {filteredOrders.length > 0 ? (
          <div>
            {filteredOrders.map((order: any) => {
              const isOrder = order.type === "order";
              return (
                <div key={order.id} className="admin-order">
                  <div className="admin-order__row">
                    <div className="admin-order__main">
                      <div className="admin-order__top">
                        <span className="admin-order__id">
                          #{order.id.slice(0, 8)}
                        </span>
                        <span
                          className={
                            isOrder
                              ? "admin-badge admin-badge--indigo"
                              : "admin-badge admin-badge--teal"
                          }
                        >
                          <GlyphIcon value={isOrder ? "box" : "chat"} size={11} />
                          {isOrder ? "Заказ" : "Заявка"}
                        </span>
                        <span
                          className={statusBadge[order.status ?? "new"]}
                        >
                          {statusLabels[order.status ?? "new"]}
                        </span>
                        <span className="admin-order__date">
                          {formatDate(order.createdAt)}
                        </span>
                      </div>

                      <div className="admin-order__grid">
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">
                            Клиент:
                          </span>
                          <span className="admin-order__meta-val">
                            {order.customerName}{" "}
                            <span className="admin-badge admin-badge--muted">
                              <GlyphIcon
                                value={order.customerType === "legal" ? "building" : "user"}
                                size={11}
                              />
                              {order.customerType === "legal"
                                ? "Юр. лицо"
                                : "Физ. лицо"}
                            </span>
                          </span>
                        </div>
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">
                            Телефон:
                          </span>
                          <a href={`tel:${order.customerPhone}`}>
                            {order.customerPhone}
                          </a>
                        </div>
                        {order.customerEmail && (
                          <div
                            className="admin-order__meta"
                            style={{ gridColumn: "1 / -1" }}
                          >
                            <span className="admin-order__meta-label">
                              Почта:
                            </span>
                            <a href={`mailto:${order.customerEmail}`}>
                              {order.customerEmail}
                            </a>
                          </div>
                        )}
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">
                            Связь:
                          </span>
                          <span
                            className="admin-order__meta-val"
                            style={{ fontWeight: 500, fontSize: 13 }}
                          >
                            {(() => {
                              const c =
                                commLabels[order.communicationChannel];
                              return c ? (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  <GlyphIcon value={c.token} size={13} />
                                  {c.text}
                                </span>
                              ) : (
                                order.communicationChannel ?? "—"
                              );
                            })()}
                          </span>
                        </div>
                        {order.paymentMethod && (
                          <div className="admin-order__meta">
                            <span className="admin-order__meta-label">
                              Оплата:
                            </span>
                            <span
                              className="admin-order__meta-val"
                              style={{ fontWeight: 500, fontSize: 13 }}
                            >
                              {(() => {
                                const pm =
                                  paymentLabels[order.paymentMethod];
                                return pm ? (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 5,
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    <GlyphIcon value={pm.token} size={13} />
                                    {pm.text}
                                  </span>
                                ) : (
                                  order.paymentMethod
                                );
                              })()}
                            </span>
                          </div>
                        )}
                      </div>

                      {isOrder &&
                        order.items &&
                        order.items.length > 0 && (
                          <div className="admin-order__items">
                            <div className="admin-order__items-title">
                              Позиции заказа ({order.items.length})
                            </div>
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
                                    <span className="admin-muted">
                                      {" "}
                                      × {item.quantity} шт.
                                    </span>
                                  </span>
                                  <span className="admin-order__item-sum">
                                    {(
                                      item.price * item.quantity
                                    ).toLocaleString("ru-RU")}{" "}
                                    ₽
                                  </span>
                                </div>
                              )
                            )}
                            <div className="admin-order__total">
                              <span>Итоговая сумма:</span>
                              <span>
                                {order.totalSum?.toLocaleString("ru-RU")} ₽
                              </span>
                            </div>
                          </div>
                        )}

                      {!isOrder && order.productInfo && (
                        <div style={{ fontSize: 14 }}>
                          <span className="admin-muted">Интересует товар: </span>
                          <strong style={{ color: "var(--adm-navy)" }}>
                            {order.productInfo}
                          </strong>
                          {order.quantity && (
                            <span className="admin-muted">
                              {" "}
                              ({order.quantity} шт.)
                            </span>
                          )}
                        </div>
                      )}

                      {order.comment && (
                        <div className="admin-order__comment">
                          <strong>Комментарий клиента:</strong>
                          <span
                            style={{
                              fontStyle: "italic",
                              color: "var(--adm-navy)",
                            }}
                          >
                            «{order.comment}»
                          </span>
                        </div>
                      )}

                      {order.closeReason && (
                        <div className="admin-order__close-reason">
                          <strong style={{ display: "block", marginBottom: 4 }}>
                            Причина закрытия / отклонения:
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
                      <OrderDeleteButton orderId={order.id} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="admin-empty">
            <div className="admin-empty__icon"><GlyphIcon value="clipboard" size={40} /></div>
            <p>
              {searchQuery
                ? `По запросу «${searchQuery}» ничего не найдено`
                : activeFilter === "all"
                ? "Заявок и заказов пока нет"
                : `Нет обращений со статусом «${statusLabels[activeFilter]}»`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
