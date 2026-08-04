"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  CreditCard,
  FileText,
  Loader2,
  MapPin,
  PackageCheck,
  ReceiptText,
  UserRound,
  X,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import type {
  BankPayment,
  CustomerDeal,
  WarehouseReceipt,
} from "@/lib/warehouse-shared";

interface PaymentDetailsPayload {
  payment: BankPayment;
  deals: CustomerDeal[];
  receipts: WarehouseReceipt[];
}

const fmt = (value: number) => value.toLocaleString("ru-RU");

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("ru-RU");
}

const paymentTypeLabel: Record<string, string> = {
  regular: "Обычная оплата",
  refund: "Возврат",
  cash: "Наличные",
  transfer: "Перевод",
  deposit: "Внесение",
};

const dealStatusLabel: Record<string, string> = {
  new: "Новый",
  completed: "Отпущен",
  cancelled: "Отменён",
};

export function PaymentDetailsModal({
  paymentId,
  adminPath,
  onClose,
  allowDocumentNavigation = true,
  onNavigate,
}: {
  paymentId: string | null;
  adminPath: string;
  onClose: () => void;
  allowDocumentNavigation?: boolean;
  /** Клик по документу (ЗК/ПО): вызывается после onClose — родитель
      закрывает свою модалку, если эта открыта поверх неё (например,
      сдача кассы), иначе переход выглядел «нерабочим» под оверлеем. */
  onNavigate?: () => void;
}) {
  const [data, setData] = useState<PaymentDetailsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!paymentId) {
      setData(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/admin/warehouse/payments/${encodeURIComponent(paymentId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить платёж");
        return body as PaymentDetailsPayload;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Ошибка загрузки");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  if (!paymentId) return null;

  const payment = data?.payment;
  const accountLabel = payment?.type === "cash" ? "Касса" : "Расчётный счёт";

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
        <div
          className="admin-modal payment-details-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="admin-modal__head payment-details-modal__head">
            <div>
              <span className="payment-details-modal__eyebrow">Подробная информация</span>
              <h3 className="admin-modal__title">
                {payment ? `Платёж ПЛ-${payment.number}` : "Платёж"}
              </h3>
            </div>
            <button type="button" className="admin-modal__close" onClick={onClose} aria-label="Закрыть">
              <X size={17} />
            </button>
          </div>

          {loading && (
            <div className="payment-details-modal__state">
              <Loader2 size={22} className="animate-spin" /> Загружаем платёж…
            </div>
          )}
          {error && <div className="wh-form-error">{error}</div>}

          {payment && data && (
            <div className="payment-details">
              <div className="payment-details__hero">
                <span className={`payment-details__direction payment-details__direction--${payment.direction}`}>
                  {payment.direction === "incoming" ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                </span>
                <div>
                  <span>{payment.direction === "incoming" ? "Приход от" : "Оплата / расход для"}</span>
                  <strong>{payment.counterparty || "Без контрагента"}</strong>
                </div>
                <b className={payment.direction === "incoming" ? "payment-details__amount--in" : "payment-details__amount--out"}>
                  {payment.direction === "incoming" ? "+" : "−"}{fmt(payment.amount)} ₽
                </b>
              </div>

              <div className="payment-details__facts">
                <Fact icon={payment.type === "cash" ? <Banknote size={14} /> : <CreditCard size={14} />} label="Счёт" value={accountLabel} />
                <Fact icon={<FileText size={14} />} label="Тип" value={paymentTypeLabel[payment.type || "regular"] || payment.type || "Оплата"} />
                <Fact icon={<CheckCircle2 size={14} />} label="Статус" value={payment.isPaid ? `Проведён${payment.paidAt ? ` · ${fmtDate(payment.paidAt)}` : ""}` : "Ожидает проведения"} />
                <Fact icon={<UserRound size={14} />} label="Дата документа" value={fmtDate(payment.date)} />
              </div>

              <dl className="payment-details__meta">
                <div><dt>Внешний номер / счёт</dt><dd>{payment.invoiceNumber || "—"}</dd></div>
                <div><dt>НДС</dt><dd>{payment.vatRate}% · {fmt(payment.vatAmount)} ₽</dd></div>
                <div><dt>Внутренний ID</dt><dd>{payment.id}</dd></div>
                <div><dt>Баланс</dt><dd>{payment.excludeFromBalance ? "Вне текущего баланса" : "Учитывается"}</dd></div>
                <div className="payment-details__meta-wide"><dt>Комментарий</dt><dd>{payment.comment || "—"}</dd></div>
              </dl>

              <section className="payment-details__section">
                <div className="payment-details__section-head">
                  <ReceiptText size={15} />
                  <strong>К каким документам относится</strong>
                  <span>{data.deals.length + data.receipts.length}</span>
                </div>

                {data.deals.map((deal) => (
                  <article key={deal.id} className="payment-details__document">
                    <div className="payment-details__document-head">
                      <div>
                        <span>Заказ покупателя</span>
                        {allowDocumentNavigation ? (
                          <Link
                            href={`/${adminPath}/warehouse?tab=deals&deal=${deal.id}`}
                            prefetch={false}
                            onClick={() => {
                              onClose();
                              onNavigate?.();
                            }}
                          >
                            ЗК-{deal.number} →
                          </Link>
                        ) : (
                          <strong>ЗК-{deal.number}</strong>
                        )}
                      </div>
                      <span className="admin-badge admin-badge--blue">{dealStatusLabel[deal.status] || deal.status}</span>
                      <strong>{fmt(deal.total)} ₽</strong>
                    </div>
                    <div className="payment-details__document-party">
                      <UserRound size={13} /> {deal.customerName}
                      {(deal.deliveryAddress || deal.address) && <><MapPin size={13} /> {deal.deliveryAddress || deal.address}</>}
                    </div>
                    <Items rows={deal.items} />
                  </article>
                ))}

                {data.receipts.map((receipt) => (
                  <article key={receipt.id} className="payment-details__document">
                    <div className="payment-details__document-head">
                      <div>
                        <span>Поступление от поставщика</span>
                        {allowDocumentNavigation ? (
                          <Link
                            href={`/${adminPath}/warehouse?tab=receipts&receipt=${receipt.id}`}
                            prefetch={false}
                            onClick={() => {
                              onClose();
                              onNavigate?.();
                            }}
                          >
                            ПО-{receipt.number} →
                          </Link>
                        ) : (
                          <strong>ПО-{receipt.number}</strong>
                        )}
                      </div>
                      <span className={receipt.status === "posted" ? "admin-badge admin-badge--green" : "admin-badge admin-badge--amber"}>
                        {receipt.status === "posted" ? "Проведено" : "Активное"}
                      </span>
                      <strong>{fmt(receipt.total)} ₽</strong>
                    </div>
                    <div className="payment-details__document-party">
                      <PackageCheck size={13} /> {receipt.supplier}
                    </div>
                    <Items rows={receipt.items} />
                  </article>
                ))}

                {data.deals.length === 0 && data.receipts.length === 0 && (
                  <div className="payment-details__empty">
                    Самостоятельная операция — к заказам и поступлениям не привязана.
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="payment-details__fact">
      <span>{icon}</span>
      <div><small>{label}</small><strong>{value}</strong></div>
    </div>
  );
}

function Items({ rows }: { rows: { name: string; sku?: string | null; quantity: number; price: number; lineTotal: number }[] }) {
  return (
    <div className="payment-details__items">
      {rows.map((item, index) => (
        <div key={`${item.sku || item.name}-${index}`}>
          <span>{item.name}{item.sku ? ` · ${item.sku}` : ""}</span>
          <span>{fmt(item.quantity)} × {fmt(item.price)} ₽</span>
          <strong>{fmt(item.lineTotal)} ₽</strong>
        </div>
      ))}
    </div>
  );
}
