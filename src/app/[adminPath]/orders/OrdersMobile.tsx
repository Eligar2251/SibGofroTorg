// =========================================================
// FILE: src/app/[adminPath]/orders/OrdersMobile.tsx
// Мобильный экран «Заявки» — карточки вместо таблицы/строк.
//
// Дизайн «как в приложении»:
//  • липкая строка поиска + чипы статусов с горизонтальным скроллом;
//  • каждая заявка — карточка: номер, чипы типа/статуса, клиент,
//    сумма; телефон — сразу кнопка звонка;
//  • раскрытие деталей по тапу (мгновенно, без анимации высоты —
//    анимация height = layout = дёрганье на 120 Гц);
//  • карточки с content-visibility: браузер не рендерит свернутые
//    элементы за экраном — список из 200 заявок листается так же
//    легко, как из 20.
//
// Десктопная вёрстка страницы (orders/page.tsx) не меняется:
// сервер отдаёт те же данные, ветка выбора — OrdersMobileGate.
// Фильтрация остаётся серверной (ссылки с ?status=...), поэтому
// realtime-обновления и сортировка работают как раньше.
// =========================================================

"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Phone,
  Printer,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { useIsMobile } from "@/hooks/use-is-mobile";
import {
  ORDER_COMM_LABELS,
  ORDER_FILTER_OPTIONS,
  ORDER_PAYMENT_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  formatOrderDate,
  orderTypeMeta,
  type OrderStatusTone,
} from "@/lib/orders-labels";
import { ORDER_SORT_OPTIONS, type OrderSortId } from "@/lib/orders-sort";
import { OrderStatusUpdater } from "@/components/admin/OrderStatusUpdater";
import { OrderIssueButton } from "@/components/admin/OrderIssueButton";
import { OrderDeleteButton } from "@/components/admin/OrderDeleteButton";
import styles from "./OrdersMobile.module.css";

type AnyOrder = Record<string, any> & { id: string; type?: string };

/**
 * Выбор слоя: телефон/планшет → карточки, десктоп → прежняя вёрстка.
 * Рендерится СТРАНИЦЕЙ: <OrdersMobileGate ...>{десктопный JSX}</OrdersMobileGate>
 */
export function OrdersMobileGate({
  orders,
  adminPath,
  status,
  q,
  sort,
  children,
}: {
  orders: AnyOrder[];
  adminPath: string;
  status: string;
  q: string;
  sort: OrderSortId;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  if (!isMobile) return <>{children}</>;
  return (
    <OrdersMobile
      orders={orders}
      adminPath={adminPath}
      status={status}
      q={q}
      sort={sort}
    />
  );
}

function OrdersMobile({
  orders,
  adminPath,
  status,
  q,
  sort,
}: {
  orders: AnyOrder[];
  adminPath: string;
  status: string;
  q: string;
  sort: OrderSortId;
}) {
  const router = useRouter();
  // Локальный поиск поверх уже загруженного списка: результат
  // фильтруется без перезагрузки страницы (useDeferredValue — ввод
  // не блокируется перерисовкой длинного списка).
  const [search, setSearch] = useState(q);
  const deferred = useDeferredValue(search);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = deferred.toLowerCase().trim();
  const filtered = useMemo(
    () =>
      orders.filter((order) => {
        if (!query) return true;
        const itemText = Array.isArray(order.items)
          ? order.items
              .map((it: any) => `${it.name || ""} ${it.sku || ""}`)
              .join(" ")
          : "";
        return (
          (order.customerName &&
            order.customerName.toLowerCase().includes(query)) ||
          (order.customerPhone && order.customerPhone.includes(query)) ||
          (order.customerEmail &&
            order.customerEmail.toLowerCase().includes(query)) ||
          (order.pickupCode &&
            order.pickupCode.toLowerCase().includes(query)) ||
          (order.id && order.id.toLowerCase().includes(query)) ||
          (order.productInfo &&
            order.productInfo.toLowerCase().includes(query)) ||
          (order.wastepaperType &&
            order.wastepaperType.toLowerCase().includes(query)) ||
          (order.deliveryAddress &&
            order.deliveryAddress.toLowerCase().includes(query)) ||
          itemText.toLowerCase().includes(query)
        );
      }),
    [orders, query],
  );

  const hrefBase = `/${adminPath}/orders`;
  const qSuffix = deferred ? `&q=${encodeURIComponent(deferred)}` : "";
  const sortSuffix = sort !== "date_desc" ? `&sort=${sort}` : "";

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={styles.page}>
      {/* ── Поиск ── */}
      <div className={styles.searchRow}>
        <label className={styles.searchField}>
          <Search size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="search"
            inputMode="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Код, имя, телефон…"
            className={styles.searchInput}
            aria-label="Поиск по заявкам"
          />
          {search && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setSearch("")}
              aria-label="Очистить поиск"
            >
              <X size={15} />
            </button>
          )}
        </label>
        {q && (
          <Link
            href="#"
            onClick={(event) => {
              event.preventDefault();
              setSearch("");
            }}
            className={styles.resetChip}
          >
            <RotateCcw size={13} /> Сброс
          </Link>
        )}
      </div>

      {/* ── Чипы статусов (горизонтальный скролл) ── */}
      <div className={styles.chips} role="tablist" aria-label="Фильтр по статусу">
        {ORDER_FILTER_OPTIONS.map((opt) => {
          const active = status === opt.value;
          return (
            <Link
              key={opt.value}
              href={`${hrefBase}?status=${opt.value}${qSuffix}${sortSuffix}`}
              prefetch={false}
              role="tab"
              aria-selected={active}
              className={`${styles.chip}${active ? ` ${styles.chipActive}` : ""}`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      {/* ── Сортировка + счётчик ── */}
      <div className={styles.metaRow}>
        <span className={styles.count}>
          {filtered.length}
          {filtered.length !== orders.length ? ` из ${orders.length}` : ""} заявок
        </span>
        <label className={styles.sortWrap}>
          <SlidersHorizontal size={14} aria-hidden="true" />
          <select
            className={styles.sortSelect}
            value={sort}
            onChange={(event) => {
              const params = new URLSearchParams();
              params.set("status", status);
              if (deferred) params.set("q", deferred);
              params.set("sort", event.target.value);
              router.push(`${hrefBase}?${params.toString()}`);
            }}
            aria-label="Сортировка заявок"
          >
            {ORDER_SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── Карточки ── */}
      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <GlyphIcon value="clipboard" size={34} />
          </div>
          <p>
            {deferred
              ? `По запросу «${deferred}» ничего не найдено`
              : status === "all"
                ? "Заявок пока нет"
                : `Нет заявок со статусом «${ORDER_STATUS_LABELS[status] ?? status}»`}
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((order) => (
            <OrderCard
              key={`${order.type}-${order.id}`}
              order={order}
              adminPath={adminPath}
              expanded={expanded.has(`${order.type}-${order.id}`)}
              onToggle={() => toggle(`${order.type}-${order.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Карточка одной заявки ── */

function OrderCard({
  order,
  adminPath,
  expanded,
  onToggle,
}: {
  order: AnyOrder;
  adminPath: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = orderTypeMeta(order);
  const statusKey = order.status ?? "new";
  const statusTone = ORDER_STATUS_TONE[statusKey] ?? "amber";
  const isSiteOrder = order.type === "order";
  const isWastepaper = order.type === "wastepaper";
  const endpoint = isWastepaper
    ? `/api/admin/wastepaper/${order.id}`
    : undefined;

  const summary = isWastepaper
    ? `${order.wastepaperType || "Макулатура"}${order.weight ? ` · ${order.weight} кг` : ""}`
    : isSiteOrder && order.items?.length
      ? `${order.items.length} поз. · ${(order.totalSum || 0).toLocaleString("ru-RU")} ₽`
      : order.productInfo || "Заявка на уточнение";

  return (
    <article className={`${styles.card}${expanded ? ` ${styles.cardOpen}` : ""}`}>
      <button type="button" className={styles.cardHead} onClick={onToggle}>
        <span className={styles.cardTop}>
          <span className={styles.orderId}>#{order.id.slice(0, 8)}</span>
          <ToneChip tone={meta.tone}>
            <GlyphIcon value={meta.icon} size={11} />
            {meta.label}
          </ToneChip>
          <ToneChip tone={statusTone}>
            {ORDER_STATUS_LABELS[statusKey] ?? statusKey}
          </ToneChip>
        </span>

        <span className={styles.customer}>
          <span className={styles.customerName}>
            {order.customerName || "Без имени"}
          </span>
          {order.customerPhone && (
            <a
              href={`tel:${order.customerPhone}`}
              className={styles.callBtn}
              aria-label={`Позвонить: ${order.customerPhone}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Phone size={15} />
            </a>
          )}
        </span>

        <span className={styles.summary}>{summary}</span>

        <span className={styles.cardBottom}>
          <span className={styles.date}>{formatOrderDate(order.createdAt)}</span>
          {order.pickupCode && (
            <span className={styles.pickup}>
              <Printer size={12} aria-hidden="true" />
              {order.pickupCode}
            </span>
          )}
          <ChevronDown
            size={17}
            className={`${styles.chevron}${expanded ? ` ${styles.chevronUp}` : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded && (
        <div className={styles.cardBody}>
          <dl className={styles.facts}>
            <Fact label="Телефон" wide={false}>
              {order.customerPhone ? (
                <a href={`tel:${order.customerPhone}`} className={styles.link}>
                  {order.customerPhone}
                </a>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Клиент">
              <span className={styles.factRow}>
                {order.customerName || "—"}
                <ToneChip tone="muted">
                  <GlyphIcon
                    value={order.customerType === "legal" ? "building" : "user"}
                    size={11}
                  />
                  {order.customerType === "legal" ? "Юр. лицо" : "Физ. лицо"}
                </ToneChip>
              </span>
            </Fact>
            {order.customerEmail && (
              <Fact label="Почта">
                <a href={`mailto:${order.customerEmail}`} className={styles.link}>
                  {order.customerEmail}
                </a>
              </Fact>
            )}
            {(() => {
              const c = ORDER_COMM_LABELS[order.communicationChannel];
              return c ? (
                <Fact label="Связь">
                  <span className={styles.factRow}>
                    <GlyphIcon value={c.token} size={13} />
                    {c.text}
                  </span>
                </Fact>
              ) : null;
            })()}
            {(() => {
              const pm = ORDER_PAYMENT_LABELS[order.paymentMethod];
              return order.paymentMethod ? (
                <Fact label="Оплата">
                  <span className={styles.factRow}>
                    {pm ? (
                      <>
                        <GlyphIcon value={pm.token} size={13} />
                        {pm.text}
                      </>
                    ) : (
                      order.paymentMethod
                    )}
                  </span>
                </Fact>
              ) : null;
            })()}
            {!isWastepaper && order.deliveryAddress && (
              <Fact label="Адрес" wide>
                {order.deliveryAddress}
              </Fact>
            )}
            {isWastepaper && (
              <Fact label="Доставка" wide>
                {order.deliveryMethod === "self" ? "Привезут сами" : "Нужен вывоз"}
              </Fact>
            )}
          </dl>

          {isSiteOrder && order.items?.length > 0 && (
            <div className={styles.items}>
              <div className={styles.itemsTitle}>
                Позиции ({order.items.length})
              </div>
              {order.items.map(
                (item: { name: string; quantity: number; price: number }, idx: number) => (
                  <div key={idx} className={styles.item}>
                    <span>
                      {item.name}
                      <span className={styles.itemQty}> × {item.quantity} шт.</span>
                    </span>
                    <span className={styles.itemSum}>
                      {(item.price * item.quantity).toLocaleString("ru-RU")} ₽
                    </span>
                  </div>
                ),
              )}
              <div className={styles.total}>
                <span>Итого</span>
                <span>{order.totalSum?.toLocaleString("ru-RU")} ₽</span>
              </div>
            </div>
          )}

          {isWastepaper && Number(order.estimatedPayout) > 0 && (
            <div className={styles.total}>
              <span>Ориентировочная выплата</span>
              <span>{Number(order.estimatedPayout).toLocaleString("ru-RU")} ₽</span>
            </div>
          )}

          {!isSiteOrder && !isWastepaper && order.productInfo && (
            <p className={styles.note}>
              Интересует: <strong>{order.productInfo}</strong>
              {order.quantity ? ` (${order.quantity} шт.)` : ""}
            </p>
          )}

          {order.comment && (
            <p className={styles.comment}>«{order.comment}»</p>
          )}

          {order.closeReason && (
            <p className={styles.closeReason}>
              Причина закрытия: {order.closeReason}
            </p>
          )}

          {/* Действия — крупные кнопки, хватает пальцем. */}
          <div className={styles.actions}>
            <OrderStatusUpdater
              orderId={order.id}
              currentStatus={order.status ?? "new"}
              currentCloseReason={order.closeReason ?? null}
              dealNumber={order.dealNumber ?? null}
              adminPath={adminPath}
              endpoint={endpoint}
            />
            {!isWastepaper && (
              <OrderIssueButton orderId={order.id} status={order.status ?? "new"} />
            )}
            <OrderDeleteButton orderId={order.id} endpoint={endpoint} />
          </div>
        </div>
      )}
    </article>
  );
}

/* ── Мелкие детали ── */

const TONE_CLASS: Record<OrderStatusTone | "muted", string> = {
  amber: "toneAmber",
  blue: "toneBlue",
  indigo: "toneIndigo",
  teal: "toneTeal",
  green: "toneGreen",
  red: "toneRed",
  muted: "toneMuted",
};

function ToneChip({
  tone,
  children,
}: {
  tone: OrderStatusTone | "muted";
  children: React.ReactNode;
}) {
  return (
    <span className={`${styles.tone} ${styles[TONE_CLASS[tone]]}`}>{children}</span>
  );
}

function Fact({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${styles.fact}${wide ? ` ${styles.factWide}` : ""}`}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{children}</dd>
    </div>
  );
}
