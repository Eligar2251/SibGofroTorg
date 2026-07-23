// src/components/admin/DeliveryPrintSheet.tsx
// Бланк доставок для курьера: A4, жирный 14px, полоски ~5–6 см
"use client";

import { useEffect } from "react";
import { SITE_ADDRESS, SITE_PHONE, SITE_HOURS_LABEL } from "@/lib/site-config";

export type PrintDeliveryItem = {
  label: string;
  customerName: string;
  customerPhone?: string | null;
  contactName?: string | null;
  deliveryAddress?: string | null;
  deliveryNote?: string | null;
  deliveryType?: "free" | "paid" | null;
  deliveryCost?: number | null;
  deliveryPlannedDate?: string | null;
  deliveryDriverName?: string | null;
  items?: { name: string; quantity: number }[] | null;
  totalSum?: number | null;
};

function formatRuDate(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export function DeliveryPrintSheet({
  items,
  title,
  companyPhone,
  companyAddress,
  onDone,
}: {
  items: PrintDeliveryItem[];
  title?: string;
  companyPhone?: string;
  companyAddress?: string;
  onDone?: () => void;
}) {
  useEffect(() => {
    const prev = document.title;
    document.title = title || "Бланк доставок";
    const t = window.setTimeout(() => {
      window.print();
      onDone?.();
    }, 250);
    return () => {
      window.clearTimeout(t);
      document.title = prev;
    };
  }, [title, onDone]);

  const phone = companyPhone || SITE_PHONE;
  const address = companyAddress || SITE_ADDRESS;
  const today = new Date().toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div className="deliv-print-root" aria-hidden={false}>
      <style>{PRINT_CSS}</style>
      <div className="deliv-print-sheet">
        <header className="deliv-print-head">
          <div className="deliv-print-head__brand">СибГофроТорг</div>
          <div className="deliv-print-head__meta">
            <div>{title || "Бланк доставок для курьера"}</div>
            <div>
              {address} · {phone}
            </div>
            <div>
              {SITE_HOURS_LABEL} · печать {today}
            </div>
          </div>
        </header>

        {items.length === 0 ? (
          <div className="deliv-print-empty">Нет доставок для печати</div>
        ) : (
          items.map((it, idx) => (
            <article key={`${it.label}-${idx}`} className="deliv-print-strip">
              <div className="deliv-print-strip__num">{idx + 1}</div>
              <div className="deliv-print-strip__body">
                <div className="deliv-print-strip__row deliv-print-strip__row--main">
                  <span className="deliv-print-strip__label">{it.label}</span>
                  <span className="deliv-print-strip__client">
                    {it.customerName || "—"}
                  </span>
                  {it.deliveryPlannedDate && (
                    <span className="deliv-print-strip__date">
                      {formatRuDate(it.deliveryPlannedDate)}
                    </span>
                  )}
                </div>
                <div className="deliv-print-strip__row">
                  <span className="deliv-print-strip__k">Адрес</span>
                  <span className="deliv-print-strip__v">
                    {it.deliveryAddress || "—"}
                  </span>
                </div>
                <div className="deliv-print-strip__row deliv-print-strip__row--3">
                  <span>
                    <span className="deliv-print-strip__k">Тел.</span>{" "}
                    {it.customerPhone || "—"}
                  </span>
                  <span>
                    <span className="deliv-print-strip__k">Контакт</span>{" "}
                    {it.contactName || "—"}
                  </span>
                  <span>
                    <span className="deliv-print-strip__k">Водитель</span>{" "}
                    {it.deliveryDriverName || "—"}
                  </span>
                </div>
                <div className="deliv-print-strip__row deliv-print-strip__row--3">
                  <span>
                    <span className="deliv-print-strip__k">Оплата доставки</span>{" "}
                    {it.deliveryType === "paid"
                      ? `${(it.deliveryCost || 0).toLocaleString("ru-RU")} ₽`
                      : "бесплатно"}
                  </span>
                  <span>
                    <span className="deliv-print-strip__k">Сумма заказа</span>{" "}
                    {it.totalSum != null
                      ? `${it.totalSum.toLocaleString("ru-RU")} ₽`
                      : "—"}
                  </span>
                  <span>
                    <span className="deliv-print-strip__k">Позиций</span>{" "}
                    {it.items?.length ?? 0}
                  </span>
                </div>
                {it.items && it.items.length > 0 && (
                  <div className="deliv-print-strip__row">
                    <span className="deliv-print-strip__k">Товар</span>
                    <span className="deliv-print-strip__v deliv-print-strip__v--items">
                      {it.items
                        .slice(0, 6)
                        .map((x) => `${x.name} × ${x.quantity}`)
                        .join(" · ")}
                      {it.items.length > 6 ? ` · +${it.items.length - 6}` : ""}
                    </span>
                  </div>
                )}
                {it.deliveryNote && (
                  <div className="deliv-print-strip__row">
                    <span className="deliv-print-strip__k">Заметка</span>
                    <span className="deliv-print-strip__v">{it.deliveryNote}</span>
                  </div>
                )}
                <div className="deliv-print-strip__sign">
                  Получил ________________ / ________________
                </div>
              </div>
            </article>
          ))
        )}

        <footer className="deliv-print-foot">
          Отправитель: СибГофроТорг · {address} · {phone}
        </footer>
      </div>
    </div>
  );
}

const PRINT_CSS = `
@media screen {
  .deliv-print-root {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: #fff;
    overflow: auto;
    padding: 12mm;
  }
}
@media print {
  @page { size: A4 portrait; margin: 8mm 10mm; }
  html, body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  body * { visibility: hidden !important; }
  .deliv-print-root, .deliv-print-root * { visibility: visible !important; }
  .deliv-print-root {
    position: absolute !important;
    left: 0; top: 0; width: 100%;
    background: #fff !important;
    padding: 0 !important;
    margin: 0 !important;
  }
  .admin-shell, .admin-sidebar, .admin-mobile-bar, .admin-content,
  .admin-page-head, .deliv-plan-card, .deliv-days, .admin-filters,
  .admin-stat-grid, .deliv-table-toolbar, .deliv-list,
  .admin-card:not(.deliv-print-root) {
    display: none !important;
  }
}
.deliv-print-sheet {
  font-family: Arial, Helvetica, sans-serif;
  color: #000;
  max-width: 190mm;
  margin: 0 auto;
}
.deliv-print-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 2px solid #000;
  padding-bottom: 6px;
  margin-bottom: 8px;
}
.deliv-print-head__brand {
  font-size: 16px;
  font-weight: 700;
  text-transform: uppercase;
}
.deliv-print-head__meta {
  text-align: right;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
}
.deliv-print-strip {
  display: flex;
  gap: 8px;
  border: 2px solid #000;
  margin: 0 0 6px;
  min-height: 52mm;
  max-height: 58mm;
  page-break-inside: avoid;
  break-inside: avoid;
  overflow: hidden;
}
.deliv-print-strip__num {
  width: 12mm;
  min-width: 12mm;
  background: #000;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.deliv-print-strip__body {
  flex: 1;
  min-width: 0;
  padding: 4px 8px 4px 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  justify-content: center;
}
.deliv-print-strip__row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
}
.deliv-print-strip__row--main {
  border-bottom: 1px solid #222;
  padding-bottom: 2px;
  margin-bottom: 1px;
}
.deliv-print-strip__row--3 {
  display: grid;
  grid-template-columns: 1.1fr 1fr 1fr;
  gap: 6px;
}
.deliv-print-strip__label {
  background: #000;
  color: #fff;
  padding: 1px 6px;
  font-size: 13px;
  white-space: nowrap;
}
.deliv-print-strip__client {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
}
.deliv-print-strip__date {
  white-space: nowrap;
}
.deliv-print-strip__k {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.75;
  white-space: nowrap;
}
.deliv-print-strip__v {
  flex: 1;
  min-width: 0;
}
.deliv-print-strip__v--items {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.deliv-print-strip__sign {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 700;
  border-top: 1px dashed #444;
  padding-top: 2px;
}
.deliv-print-foot {
  margin-top: 8px;
  border-top: 1px solid #000;
  padding-top: 4px;
  font-size: 11px;
  font-weight: 700;
}
.deliv-print-empty {
  font-size: 14px;
  font-weight: 700;
  padding: 24px;
  text-align: center;
}
`;
