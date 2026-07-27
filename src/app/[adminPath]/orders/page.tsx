// src/app/[adminPath]/orders/page.tsx
import { getOrders, getWastepaperRequests } from "@/lib/supabase-queries";
import Link from "next/link";
import { OrderStatusUpdater } from "@/components/admin/OrderStatusUpdater";
import { OrderDeleteButton } from "@/components/admin/OrderDeleteButton";
import { GlyphIcon } from "@/components/ui/Glyph";
import { OrdersRealtime } from "@/components/admin/OrdersRealtime";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

const statusLabels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Проведена",
  rejected: "Отменена",
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
  self: { token: "truck", text: "Привезут сами" },
  pickup: { token: "truck", text: "Нужен вывоз" },
};

const paymentLabels: Record<string, { token: string; text: string }> = {
  transfer: { token: "card", text: "Перевод" },
  cash: { token: "cash", text: "Наличные" },
  invoice: { token: "receipt", text: "Счет" },
};

const filterOptions = [
  { value: "new", label: "Новые" },
  { value: "in_progress", label: "В работе" },
  { value: "rejected", label: "Отменённые" },
  { value: "all", label: "Все" },
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

function createdMs(raw: any): number {
  if (!raw) return 0;
  if (typeof raw === "string") return Date.parse(raw) || 0;
  if (typeof raw === "number") return raw;
  if (raw?.seconds !== undefined) return raw.seconds * 1000;
  return 0;
}

function typeMeta(order: any) {
  if (order.type === "wastepaper") {
    return { label: "За макулатуру", icon: "recycle", cls: "admin-badge admin-badge--green" };
  }
  if (order.type === "order") {
    return { label: "Заявка-заказ", icon: "box", cls: "admin-badge admin-badge--indigo" };
  }
  return { label: "На уточнение", icon: "chat", cls: "admin-badge admin-badge--teal" };
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; q?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedStatus = firstParam(params.status);
  const activeFilter = ["new", "in_progress", "rejected", "all"].includes(requestedStatus)
    ? requestedStatus
    : "new";
  const searchQuery = firstParam(params.q);
  const query = searchQuery.toLowerCase().trim();

  const [siteOrders, wastepaperRequests] = await Promise.all([
    getOrders({ status: activeFilter, limit: 200 }),
    getWastepaperRequests({ status: activeFilter, limit: 200 }),
  ]);

  const allOrders = [...siteOrders, ...wastepaperRequests];

  const filteredOrders = allOrders
    .filter((order: any) => {
      if (!query) return true;
      const itemText = Array.isArray(order.items)
        ? order.items.map((it: any) => `${it.name || ""} ${it.sku || ""}`).join(" ")
        : "";
      return (
        (order.customerName && order.customerName.toLowerCase().includes(query)) ||
        (order.customerPhone && order.customerPhone.includes(query)) ||
        (order.customerEmail && order.customerEmail.toLowerCase().includes(query)) ||
        (order.id && order.id.toLowerCase().includes(query)) ||
        (order.productInfo && order.productInfo.toLowerCase().includes(query)) ||
        (order.wastepaperType && order.wastepaperType.toLowerCase().includes(query)) ||
        (order.deliveryAddress && order.deliveryAddress.toLowerCase().includes(query)) ||
        itemText.toLowerCase().includes(query)
      );
    })
    .sort((a: any, b: any) => createdMs(b.createdAt) - createdMs(a.createdAt));

  const hrefBase = `/${ADMIN_PATH}/orders`;
  const qSuffix = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : "";

  return (
    <div>
      <OrdersRealtime />
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Заявки</h1>
          <p className="admin-sub">
            Показано: <strong style={{ color: "var(--adm-navy)" }}>{filteredOrders.length}</strong>
            {allOrders.length !== filteredOrders.length ? ` из ${allOrders.length}` : ""}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <form method="GET" action={hrefBase} style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="status" defaultValue={activeFilter} />
            <input
              type="text"
              name="q"
              defaultValue={searchQuery}
              placeholder="Поиск по имени, телефону, почте, ID, товару..."
              className="admin-input"
            />
            <button type="submit" className="admin-btn admin-btn--navy">Найти</button>
            {searchQuery && (
              <Link href={`${hrefBase}?status=${activeFilter}`} className="admin-btn admin-btn--ghost" prefetch={false}>
                Сбросить
              </Link>
            )}
          </form>
        </div>
      </div>

      <div className="admin-filters">
        {filterOptions.map((opt) => (
          <Link
            key={opt.value}
            href={`${hrefBase}?status=${opt.value}${qSuffix}`}
            className={`admin-filter${activeFilter === opt.value ? " admin-filter--active" : ""}`}
            prefetch={false}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      <div className="admin-card">
        {filteredOrders.length > 0 ? (
          <div>
            {filteredOrders.map((order: any) => {
              const meta = typeMeta(order);
              const isSiteOrder = order.type === "order";
              const isWastepaper = order.type === "wastepaper";
              const endpoint = isWastepaper ? `/api/admin/wastepaper/${order.id}` : undefined;
              return (
                <details key={`${order.type}-${order.id}`} className="admin-order" style={{ display: "block" }}>
                  <summary style={{ listStyle: "none", cursor: "pointer" }}>
                    <div className="admin-order__row">
                      <div className="admin-order__main">
                        <div className="admin-order__top">
                          <span className="admin-order__id">#{order.id.slice(0, 8)}</span>
                          <span className={meta.cls}>
                            <GlyphIcon value={meta.icon} size={11} />
                            {meta.label}
                          </span>
                          <span className={statusBadge[order.status ?? "new"]}>{statusLabels[order.status ?? "new"]}</span>
                          <span className="admin-order__date">{formatDate(order.createdAt)}</span>
                          <span className="admin-muted" style={{ marginLeft: "auto", fontSize: 12 }}>Нажмите, чтобы раскрыть</span>
                        </div>
                        <div style={{ fontSize: 14, color: "var(--adm-navy)", fontWeight: 700 }}>
                          {order.customerName || "Без имени"} · {order.customerPhone || "—"}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--adm-muted)", marginTop: 4 }}>
                          {isWastepaper
                            ? `${order.wastepaperType || "Макулатура"}${order.weight ? ` · ${order.weight} кг` : ""}`
                            : isSiteOrder && order.items?.length
                            ? `${order.items.length} поз. · ${(order.totalSum || 0).toLocaleString("ru-RU")} ₽`
                            : order.productInfo || "Заявка на уточнение"}
                          {!isWastepaper && order.deliveryAddress && (
                            <span> · {order.deliveryAddress}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </summary>

                  <div className="admin-order__row" style={{ borderTop: "1px solid rgba(200,196,188,0.35)", paddingTop: 14, marginTop: 12 }}>
                    <div className="admin-order__main">
                      <div className="admin-order__grid">
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">Клиент:</span>
                          <span className="admin-order__meta-val">
                            {order.customerName}{" "}
                            <span className="admin-badge admin-badge--muted">
                              <GlyphIcon value={order.customerType === "legal" ? "building" : "user"} size={11} />
                              {order.customerType === "legal" ? "Юр. лицо" : "Физ. лицо"}
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
                            {(() => {
                              const c = commLabels[order.communicationChannel];
                              return c ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}><GlyphIcon value={c.token} size={13} />{c.text}</span> : order.communicationChannel ?? "—";
                            })()}
                          </span>
                        </div>
                        {order.paymentMethod && (
                          <div className="admin-order__meta">
                            <span className="admin-order__meta-label">Оплата:</span>
                            <span className="admin-order__meta-val" style={{ fontWeight: 500, fontSize: 13 }}>
                              {(() => {
                                const pm = paymentLabels[order.paymentMethod];
                                return pm ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}><GlyphIcon value={pm.token} size={13} />{pm.text}</span> : order.paymentMethod;
                              })()}
                            </span>
                          </div>
                        )}
                        {!isWastepaper && order.deliveryAddress && (
                          <div className="admin-order__meta" style={{ gridColumn: "1 / -1" }}>
                            <span className="admin-order__meta-label">Адрес:</span>
                            <span className="admin-order__meta-val" style={{ whiteSpace: "normal" }}>
                              {order.deliveryAddress}
                            </span>
                          </div>
                        )}
                      </div>

                      {isSiteOrder && order.items && order.items.length > 0 && (
                        <div className="admin-order__items">
                          <div className="admin-order__items-title">Позиции заявки-заказа ({order.items.length})</div>
                          {order.items.map((item: { name: string; quantity: number; price: number }, idx: number) => (
                            <div key={idx} className="admin-order__item">
                              <span>{item.name}<span className="admin-muted"> × {item.quantity} шт.</span></span>
                              <span className="admin-order__item-sum">{(item.price * item.quantity).toLocaleString("ru-RU")} ₽</span>
                            </div>
                          ))}
                          <div className="admin-order__total">
                            <span>Итоговая сумма:</span>
                            <span>{order.totalSum?.toLocaleString("ru-RU")} ₽</span>
                          </div>
                        </div>
                      )}

                      {!isSiteOrder && !isWastepaper && order.productInfo && (
                        <div style={{ fontSize: 14 }}>
                          <span className="admin-muted">Интересует товар: </span>
                          <strong style={{ color: "var(--adm-navy)" }}>{order.productInfo}</strong>
                          {order.quantity && <span className="admin-muted"> ({order.quantity} шт.)</span>}
                        </div>
                      )}

                      {isWastepaper && (
                        <div className="admin-order__items">
                          <div className="admin-order__items-title">Заявка за макулатуру</div>
                          <div className="admin-order__item"><span>Сырьё</span><strong>{order.wastepaperType || "—"}</strong></div>
                          <div className="admin-order__item"><span>Вес</span><strong>{order.weight ? `${order.weight} кг` : "—"}</strong></div>
                          <div className="admin-order__item"><span>Доставка</span><strong>{order.deliveryMethod === "self" ? "Привезут сами" : "Нужен вывоз"}</strong></div>
                          {order.estimatedPayout > 0 && <div className="admin-order__total"><span>Ориентировочная выплата:</span><span>{order.estimatedPayout.toLocaleString("ru-RU")} ₽</span></div>}
                        </div>
                      )}

                      {order.comment && (
                        <div className="admin-order__comment">
                          <strong>Комментарий клиента:</strong>
                          <span style={{ fontStyle: "italic", color: "var(--adm-navy)" }}>«{order.comment}»</span>
                        </div>
                      )}

                      {order.closeReason && (
                        <div className="admin-order__close-reason">
                          <strong style={{ display: "block", marginBottom: 4 }}>Причина закрытия / отмены:</strong>
                          {order.closeReason}
                        </div>
                      )}
                    </div>

                    <div className="admin-order__side">
                      <OrderStatusUpdater
                        orderId={order.id}
                        currentStatus={order.status ?? "new"}
                        currentCloseReason={order.closeReason ?? null}
                        dealNumber={order.dealNumber ?? null}
                        adminPath={ADMIN_PATH}
                        endpoint={endpoint}
                      />
                      <OrderDeleteButton orderId={order.id} endpoint={endpoint} />
                    </div>
                  </div>
                </details>
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
                ? "Заявок пока нет"
                : `Нет заявок со статусом «${statusLabels[activeFilter]}»`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
