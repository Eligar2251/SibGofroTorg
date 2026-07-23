// src/components/admin/DeliveryPrintSheet.tsx
// Бланк доставок для курьера: A4, экономичный по тонеру, полоски ~5–6 см
"use client";

import { useEffect, useRef, useState } from "react";
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
  const [printing, setPrinting] = useState(false);
  const printTriggered = useRef(false);

  useEffect(() => {
    if (printTriggered.current) return;
    printTriggered.current = true;

    const prev = document.title;
    document.title = title || "Бланк доставок";

    // Небольшая задержка для рендера, затем печать
    const t = window.setTimeout(() => {
      setPrinting(true);
      window.print();
    }, 400);

    // Слушаем событие afterprint — когда пользователь нажал Печать или Отмена
    function handleAfterPrint() {
      document.title = prev;
      onDone?.();
    }
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.clearTimeout(t);
      document.title = prev;
      window.removeEventListener("afterprint", handleAfterPrint);
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

      {/* Кнопка «Закрыть» — видна только на экране, не при печати */}
      {!printing && (
        <button
          type="button"
          className="deliv-print-close"
          onClick={() => onDone?.()}
        >
          ✕ Закрыть превью
        </button>
      )}

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
                    <span className="deliv-print-strip__k">Доставка</span>{" "}
                    {it.deliveryType === "paid"
                      ? `${(it.deliveryCost || 0).toLocaleString("ru-RU")} ₽`
                      : "бесплатно"}
                  </span>
                  <span>
                    <span className="deliv-print-strip__k">Сумма</span>{" "}
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
          СибГофроТорг · {address} · {phone}
        </footer>
      </div>
    </div>
  );
}

const PRINT_CSS = `
/* ── Экран: превью ── */
@media screen {
  .deliv-print-root {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: #f5f3ee;
    overflow: auto;
    padding: 24px;
  }
  .deliv-print-sheet {
    max-width: 210mm;
    margin: 0 auto;
    background: #fff;
    padding: 12mm;
    box-shadow: 0 2px 20px rgba(0,0,0,0.12);
    border-radius: 4px;
  }
  .deliv-print-close {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 100000;
    padding: 8px 16px;
    background: #1a1a18;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: system-ui, sans-serif;
  }
  .deliv-print-close:hover {
    background: #333;
  }
}

/* ── Печать ── */
@media print {
  @page { size: A4 portrait; margin: 8mm 10mm; }
  html, body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  /* Скрываем ВСЁ кроме бланка */
  body * { visibility: hidden !important; }
  .deliv-print-root, .deliv-print-root * { visibility: visible !important; }
  .deliv-print-root {
    position: absolute !important;
    left: 0; top: 0; width: 100%;
    background: #fff !important;
    padding: 0 !important;
    margin: 0 !important;
  }
  .deliv-print-sheet {
    padding: 0 !important;
    max-width: none !important;
  }
  .deliv-print-close { display: none !important; }
  /* Скрываем админ-оболочку */
  .admin-shell, .admin-sidebar, .admin-mobile-bar, .admin-content,
  .admin-page-head, .deliv-plan-card, .deliv-days, .admin-filters,
  .admin-stat-grid, .deliv-table-toolbar, .deliv-list,
  .admin-card:not(.deliv-print-root) {
    display: none !important;
  }
  /* Не разрывать полоску внутри */
  .deliv-print-strip {
    page-break-inside: avoid;
    break-inside: avoid;
  }
}

/* ── Общие стили бланка (экран + печать) ── */
.deliv-print-sheet {
  font-family: Arial, Helvetica, sans-serif;
  color: #1a1a18;
  max-width: 190mm;
  margin: 0 auto;
}

/* Шапка — лёгкая, без заливки */
.deliv-print-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1.5px solid #1a1a18;
  padding-bottom: 6px;
  margin-bottom: 10px;
}
.deliv-print-head__brand {
  font-size: 15px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.deliv-print-head__meta {
  text-align: right;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  color: #555;
}

/* Полоска доставки — контурная, без заливки */
.deliv-print-strip {
  display: flex;
  gap: 0;
  border: 1px solid #888;
  margin: 0 0 6px;
  min-height: 50mm;
  max-height: 58mm;
  overflow: hidden;
}

/* Номер — лёгкий фон вместо сплошного чёрного */
.deliv-print-strip__num {
  width: 10mm;
  min-width: 10mm;
  background: #eee;
  border-right: 1px solid #888;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
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
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}

.deliv-print-strip__row--main {
  border-bottom: 1px solid #ccc;
  padding-bottom: 3px;
  margin-bottom: 2px;
}

.deliv-print-strip__row--3 {
  display: grid;
  grid-template-columns: 1.1fr 1fr 1fr;
  gap: 6px;
}

/* Метка заказа — рамка вместо заливки */
.deliv-print-strip__label {
  border: 1px solid #888;
  padding: 1px 6px;
  font-size: 12px;
  white-space: nowrap;
  font-weight: 700;
}

.deliv-print-strip__client {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.deliv-print-strip__date {
  white-space: nowrap;
  font-weight: 700;
}

.deliv-print-strip__k {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #888;
  white-space: nowrap;
}

.deliv-print-strip__v {
  flex: 1;
  min-width: 0;
}

.deliv-print-strip__v--items {
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deliv-print-strip__sign {
  margin-top: 3px;
  font-size: 11px;
  font-weight: 600;
  border-top: 1px dashed #bbb;
  padding-top: 3px;
  color: #555;
}

/* Подвал — тонкая линия */
.deliv-print-foot {
  margin-top: 8px;
  border-top: 1px solid #888;
  padding-top: 4px;
  font-size: 10px;
  font-weight: 600;
  color: #888;
}

.deliv-print-empty {
  font-size: 14px;
  font-weight: 700;
  padding: 24px;
  text-align: center;
  color: #888;
}
`;
