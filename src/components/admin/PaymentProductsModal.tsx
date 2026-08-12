// src/components/admin/PaymentProductsModal.tsx
// Модальное окно с подробным составом позиций (коробок) по документу оплаты.
// Отображает название, артикул, количество, цену и сумму каждой позиции.

"use client";

import { X, Package } from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { type BankPayment } from "@/lib/warehouse-shared";

export interface PaymentProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  payment: BankPayment | null;
  itemsList: {
    name: string;
    sku?: string | null;
    qty: number;
    unitLabel?: string;
    price?: number;
  }[];
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

function fmtDate(raw: string): string {
  if (!raw) return "—";
  const [y, m, d] = raw.split("-");
  return d && m && y ? `${d}.${m}.${y}` : raw;
}

export function PaymentProductsModal({
  isOpen,
  onClose,
  payment,
  itemsList,
}: PaymentProductsModalProps) {
  if (!isOpen || !payment) return null;

  const titleStr = payment.invoiceNumber || `ПЛ-${payment.number}`;

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
        <div
          className="admin-modal wh-modal"
          style={{ maxWidth: 680, width: "95%" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="admin-modal__head">
            <h3 className="admin-modal__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Package size={18} style={{ color: "var(--adm-primary)" }} />
              Состав позиций — {titleStr}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="admin-modal__close"
              aria-label="Закрыть"
            >
              <X size={14} />
            </button>
          </div>

          <div style={{ fontSize: 13, color: "var(--adm-muted)", marginBottom: 12 }}>
            Контрагент: <strong>{payment.counterparty || "—"}</strong> · Дата:{" "}
            <strong>{fmtDate(payment.date)}</strong> · Сумма платежа:{" "}
            <strong>{fmt(payment.amount)} ₽</strong>
            {payment.comment ? ` · ${payment.comment}` : ""}
          </div>

          {itemsList.length === 0 ? (
            <div className="admin-empty" style={{ padding: 24 }}>
              <p>В счёте не указан подробный состав позиций</p>
              <p style={{ fontSize: 12, color: "var(--adm-muted)" }}>
                Платёж заведён общей суммой или привязан к документу без детализации коробок
              </p>
            </div>
          ) : (
            <div className="admin-table-wrap" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>№</th>
                    <th>Название коробки / товара</th>
                    <th>Артикул</th>
                    <th style={{ textAlign: "right" }}>Кол-во</th>
                    <th style={{ textAlign: "right" }}>Цена</th>
                    <th style={{ textAlign: "right" }}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsList.map((item, idx) => {
                    const sum = Math.round(item.qty * (item.price || 0) * 100) / 100;
                    return (
                      <tr key={`${item.name}-${idx}`}>
                        <td>{idx + 1}</td>
                        <td style={{ fontWeight: 650 }}>{item.name}</td>
                        <td>{item.sku || "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>
                          {item.qty} {item.unitLabel || "шт."}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {item.price ? `${fmt(item.price)} ₽` : "—"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>
                          {sum > 0 ? `${fmt(sum)} ₽` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              borderTop: "1px solid var(--adm-border)",
              paddingTop: 12,
              marginTop: 16,
            }}
          >
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={onClose}
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
