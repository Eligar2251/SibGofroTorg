// =========================================================
// FILE: src/components/admin/ClientOrdersManager.tsx
// Заявки одного клиента с полным управлением.
//
// Ключевое отличие от общего списка заявок: рядом со служебным статусом
// показывается формулировка, которую в этот момент видит сам клиент в
// личном кабинете. Так менеджер понимает, что именно человек читает у
// себя на экране, прежде чем что-то менять.
// =========================================================

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  Eye,
  ExternalLink,
  MapPin,
  MessageSquareText,
  Package,
  Recycle,
} from "lucide-react";
import { OrderStatusUpdater } from "@/components/admin/OrderStatusUpdater";
import { OrderDeleteButton } from "@/components/admin/OrderDeleteButton";
import { useAdminRealtime } from "@/lib/use-admin-realtime";
import {
  adminStatusBadge,
  adminStatusLabel,
  clientStatusLabel,
  WASTEPAPER_STATUS_LABELS,
} from "@/lib/order-status";

export interface ClientOrderItem {
  productId?: string | null;
  name?: string | null;
  sku?: string | null;
  quantity?: number | null;
  price?: number | null;
}

export interface ClientOrderRow {
  id: string;
  type: string;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  totalSum: number | null;
  productInfo: string | null;
  quantity: number | null;
  comment: string | null;
  deliveryAddress: string | null;
  paymentMethod: string | null;
  items: ClientOrderItem[] | null;
  dealId: string | null;
  dealNumber: number | null;
  createdAt: string | null;
  /** Заявка оформлена без входа в аккаунт, найдена по номеру телефона. */
  guest: boolean;
}

export interface ClientWasteRow {
  id: string;
  status: string;
  wastepaperType: string | null;
  weight: number | null;
  deliveryMethod: string | null;
  estimatedPayout: number | null;
  comment: string | null;
  createdAt: string | null;
}

const money = (value: number | null | undefined) =>
  (Number(value) || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

function formatDateTime(raw: string | null): string {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OrderCard({
  order,
  adminPath,
}: {
  order: ClientOrderRow;
  adminPath: string;
}) {
  const [open, setOpen] = useState(false);
  const isOrder = order.type === "order";
  const itemsCount = order.items?.length || 0;

  return (
    <div className="admin-order" id={`order-${order.id}`}>
      <button
        type="button"
        className="receipt-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="admin-order__id">#{order.id.slice(0, 8)}</span>

        <span
          className={`admin-badge ${
            isOrder ? "admin-badge--indigo" : "admin-badge--teal"
          }`}
        >
          {isOrder ? <Package size={10} /> : <MessageSquareText size={10} />}
          {isOrder ? "Заказ" : "Вопрос о цене"}
        </span>

        {/* Служебный статус */}
        <span className={adminStatusBadge(order.status)}>
          {adminStatusLabel(order.status)}
        </span>

        {/* Что в этот момент читает клиент у себя в кабинете */}
        <span
          className="admin-badge admin-badge--muted"
          title="Именно так статус этой заявки выглядит у клиента в личном кабинете"
        >
          <Eye size={10} /> клиент видит: {clientStatusLabel(order.status)}
        </span>

        {order.guest && (
          <span
            className="admin-badge admin-badge--gray"
            title="Заявка оформлена без входа в кабинет — сопоставлена с клиентом по номеру телефона"
          >
            без входа
          </span>
        )}

        {order.dealNumber != null && (
          <span className="admin-badge admin-badge--blue">ЗК-{order.dealNumber}</span>
        )}

        <span className="admin-order__spacer" />
        {isOrder && order.totalSum != null && (
          <strong className="admin-order__sum">{money(order.totalSum)} ₽</strong>
        )}
        <span className="admin-order__date">{formatDateTime(order.createdAt)}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="admin-order__body">
          {isOrder && itemsCount > 0 && (
            <div className="admin-order__items">
              {order.items!.map((item, index) => (
                <div key={`${item.productId || index}`} className="admin-order__item">
                  <span className="admin-order__item-name">
                    {item.name || "Товар"}
                    {item.sku ? ` · ${item.sku}` : ""}
                  </span>
                  <span className="admin-order__item-qty">
                    {item.quantity ?? 0} × {money(item.price)} ₽
                  </span>
                  <span className="admin-order__item-sum">
                    {money((item.quantity || 0) * (item.price || 0))} ₽
                  </span>
                </div>
              ))}
            </div>
          )}

          {!isOrder && order.productInfo && (
            <div className="admin-order__note">
              <Boxes size={13} /> {order.productInfo}
              {order.quantity ? ` · ${order.quantity} шт` : ""}
            </div>
          )}

          {order.deliveryAddress && (
            <div className="admin-order__note">
              <MapPin size={13} /> {order.deliveryAddress}
            </div>
          )}

          {order.comment && (
            <div className="admin-order__note">
              <MessageSquareText size={13} /> {order.comment}
            </div>
          )}

          <div className="admin-order__controls">
            <OrderStatusUpdater
              orderId={order.id}
              currentStatus={order.status}
              dealNumber={order.dealNumber}
              adminPath={adminPath}
            />
            <div className="admin-order__controls-side">
              <Link
                href={`/${adminPath}/orders?status=all#order-${order.id}`}
                prefetch={false}
                className="admin-btn admin-btn--ghost admin-btn--sm"
                title="Открыть в общем списке заявок"
              >
                <ExternalLink size={13} /> В списке заявок
              </Link>
              {order.dealId && (
                <Link
                  href={`/${adminPath}/warehouse?tab=deals&deal=${order.dealId}`}
                  prefetch={false}
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  title="Открыть связанный заказ в учёте"
                >
                  <ExternalLink size={13} /> Заказ в учёте
                </Link>
              )}
              <OrderDeleteButton orderId={order.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ClientOrdersManager({
  orders,
  wastepaper,
  adminPath,
}: {
  orders: ClientOrderRow[];
  wastepaper: ClientWasteRow[];
  adminPath: string;
}) {
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");

  // Изменения статусов приходят сразу — в том числе когда заявку
  // закрыл другой менеджер или её закрыл учёт при проведении заказа.
  useAdminRealtime({
    tables: ["orders", "wastepaper_requests"],
    pollIntervalMs: 60_000,
  });

  const visible = useMemo(() => {
    if (filter === "active") {
      return orders.filter(
        (order) => order.status !== "completed" && order.status !== "rejected"
      );
    }
    if (filter === "done") {
      return orders.filter(
        (order) => order.status === "completed" || order.status === "rejected"
      );
    }
    return orders;
  }, [orders, filter]);

  const activeCount = orders.filter(
    (order) => order.status !== "completed" && order.status !== "rejected"
  ).length;

  return (
    <div className="admin-stack">
      <div className="admin-card">
        <div className="admin-card__head">
          <h3 className="admin-card__title">
            Заявки клиента ({orders.length})
          </h3>
          <div className="admin-filters">
            {(
              [
                ["all", `Все ${orders.length}`],
                ["active", `В работе ${activeCount}`],
                ["done", `Закрытые ${orders.length - activeCount}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`admin-filter${filter === value ? " admin-filter--active" : ""}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-card__pad">
          {visible.length === 0 ? (
            <div className="admin-empty">
              <Package size={28} />
              <p>
                {orders.length === 0
                  ? "У клиента ещё нет заявок"
                  : "В этом фильтре пусто"}
              </p>
            </div>
          ) : (
            <div className="admin-stack">
              {visible.map((order) => (
                <OrderCard key={order.id} order={order} adminPath={adminPath} />
              ))}
            </div>
          )}
        </div>
      </div>

      {wastepaper.length > 0 && (
        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">
              <Recycle size={15} /> Заявки на макулатуру ({wastepaper.length})
            </h3>
          </div>
          <div className="admin-card__pad admin-stack">
            {wastepaper.map((request) => (
              <div key={request.id} className="admin-order">
                <div className="receipt-head" style={{ cursor: "default" }}>
                  <span className="admin-order__id">#{request.id.slice(0, 8)}</span>
                  <span className="admin-badge admin-badge--teal">
                    {WASTEPAPER_STATUS_LABELS[request.status] || request.status}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--adm-muted)" }}>
                    {request.wastepaperType || "макулатура"}
                    {request.weight ? ` · ${request.weight} кг` : ""}
                    {request.deliveryMethod === "pickup" ? " · вывоз" : " · самовывоз"}
                  </span>
                  <span className="admin-order__spacer" />
                  {request.estimatedPayout ? (
                    <strong className="admin-order__sum">
                      ≈ {money(request.estimatedPayout)} ₽
                    </strong>
                  ) : null}
                  <span className="admin-order__date">
                    {formatDateTime(request.createdAt)}
                  </span>
                </div>
                <div className="admin-order__body">
                  {request.comment && (
                    <div className="admin-order__note">
                      <MessageSquareText size={13} /> {request.comment}
                    </div>
                  )}
                  <div className="admin-order__controls">
                    <OrderStatusUpdater
                      orderId={request.id}
                      currentStatus={request.status}
                      adminPath={adminPath}
                      endpoint={`/api/admin/wastepaper/${request.id}`}
                    />
                    <div className="admin-order__controls-side">
                      <OrderDeleteButton
                        orderId={request.id}
                        endpoint={`/api/admin/wastepaper/${request.id}`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
