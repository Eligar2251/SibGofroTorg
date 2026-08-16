// src/components/admin/TransportPrintSheet.tsx
// Бланк перевозки: A4, отрывные полоски под УПД.
// Каждая полоска = один заказ (ЗК): номер заказа, товары с количеством
// (ед.) и полная инфа для доставки — телефон и адрес крупнее, клиент
// (название контрагента) и контактное лицо (человек) выделены, + наши
// реквизиты. Полоски не наезжают друг на друга; линия отрыва (✂) —
// отдельный элемент МЕЖДУ полосками.
"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  SITE_PHONE,
  SITE_ADDRESS,
  SITE_HOURS_LABEL,
} from "@/lib/site-config";
import { SITE_NAME } from "@/lib/seo";

export interface TransportPrintData {
  transportNumber: number;
  date: string;
  driverName?: string | null;
  driverPhone?: string | null;
  items: {
    dealNumber: number;
    customerName: string;
    contactName?: string | null;
    address: string | null;
    phone: string | null;
    deliveryNote?: string | null;
    items: { name: string; transportQty: number }[];
    tripType?: "delivery" | "pickup" | "handover" | null;
  }[];
  companyPhone?: string;
  companyAddress?: string;
}

const TRIP_TYPE_LABEL: Record<string, string> = {
  delivery: "Доставка клиенту",
  pickup: "Забор груза",
  handover: "Сдача груза",
};

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}.${m}.${y}` : iso;
}

export function TransportPrintSheet({
  data,
  onDone,
}: {
  data: TransportPrintData;
  onDone?: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  const triggered = useRef(false);

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;
    const prev = document.title;
    document.title = `Перевозка ПЕР-${data.transportNumber}`;
    function onAfter() {
      document.title = prev;
      onDone?.();
    }
    window.addEventListener("afterprint", onAfter);
    return () => {
      document.title = prev;
      window.removeEventListener("afterprint", onAfter);
    };
  }, [data.transportNumber, onDone]);

  function doPrint() {
    setPrinting(true);
    requestAnimationFrame(() => {
      window.print();
    });
  }

  const companyName = SITE_NAME;
  const officePhone = data.companyPhone || SITE_PHONE;
  const officeAddress = data.companyAddress || SITE_ADDRESS;
  const printableItems = data.items
    .map((deal) => ({
      ...deal,
      items: deal.items.filter((item) => Number(item.transportQty) > 0),
    }))
    .filter((deal) => deal.items.length > 0);
  const lastIdx = printableItems.length - 1;

  return (
    <div className="deliv-print-root">
      <style>{PRINT_CSS}</style>
      {!printing && (
        <div className="deliv-print-close" style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={doPrint}
            style={{
              padding: "8px 16px",
              background: "var(--adm-kraft)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            🖨 Печать
          </button>
          <button type="button" onClick={() => onDone?.()}>
            ✕ Закрыть
          </button>
        </div>
      )}

      <div className="transport-sheet">
        {printableItems.map((deal, idx) => {
          const totalQty = deal.items.reduce(
            (s, i) => s + (Number(i.transportQty) || 0),
            0
          );
          // Контактное лицо — человек (из доставки заказа),
          // название фирмы — отдельно в «Клиент».
          const contact =
            deal.contactName && deal.contactName.trim()
              ? deal.contactName.trim()
              : null;
          // Заметка курьеру (пишется в заказе) — важная инфа для доставки.
          const note =
            deal.deliveryNote && deal.deliveryNote.trim()
              ? deal.deliveryNote.trim()
              : null;
          const isLast = idx === lastIdx;
          return (
            <Fragment key={`${deal.dealNumber || "self"}-${idx}`}>
              <div className="transport-strip">
                {/* Шапка: номер заказа + количество товара */}
                <div className="strip-top">
                  <div className="strip-top__left">
                    <span className="strip-deal">{deal.dealNumber ? `ЗК-${deal.dealNumber}` : "Самостоятельная перевозка"}</span>
                    <span className="strip-per">
                      ПЕР-{data.transportNumber} · {fmtDate(data.date)}
                    </span>
                    {deal.tripType && deal.tripType !== "delivery" && (
                      <span className="strip-trip-type">
                        {TRIP_TYPE_LABEL[deal.tripType] || "Перевозка"}
                      </span>
                    )}
                  </div>
                  <div className="strip-top__right">
                    <span className="strip-boxes">{totalQty}</span>
                    <span className="strip-boxes-label">кол-во товара</span>
                  </div>
                </div>

                {/* Информация для доставки: телефон и адрес крупнее,
                    клиент и контактное лицо — выделены */}
                <div className="strip-info">
                  <div className="strip-info__row">
                    <span className="strip-info__k">Тел.</span>
                    <span className="strip-info__v strip-info__v--phone">
                      {deal.phone || "—"}
                    </span>
                  </div>
                  <div className="strip-info__row">
                    <span className="strip-info__k">Адрес</span>
                    <span className="strip-info__v strip-info__v--addr">
                      {deal.address || "Адрес не указан"}
                    </span>
                  </div>
                  <div className="strip-info__row">
                    <span className="strip-info__k">Клиент</span>
                    <span className="strip-info__v">
                      {deal.customerName || "—"}
                    </span>
                  </div>
                  <div className="strip-info__row">
                    <span className="strip-info__k">Контактное лицо</span>
                    <span className="strip-info__v">{contact || "—"}</span>
                  </div>
                </div>

                {/* Заметка курьеру — важная информация из заказа */}
                {note && (
                  <div className="strip-note">
                    <span className="strip-note__k">Заметка курьеру</span>
                    <span className="strip-note__v">{note}</span>
                  </div>
                )}

                {/* Товары */}
                <table className="strip-items">
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th className="strip-items__qty-head">Кол-во</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deal.items.map((item, i) => (
                      <tr key={i}>
                        <td className="strip-items__name">{item.name}</td>
                        <td className="strip-items__qty">
                          <span className="strip-items__num">
                            {item.transportQty}
                          </span>
                          <span className="strip-items__unit">(ед.)</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Наша компания */}
                <div className="strip-company">
                  <strong>{companyName}</strong>
                  <span>офис: {officePhone}</span>
                  <span>{officeAddress}</span>
                  <span>{SITE_HOURS_LABEL}</span>
                </div>
              </div>

              {/* Линия отрыва — отдельный элемент МЕЖДУ полосками,
                  с отступами сверху и снизу, ни к одной не прилипает */}
              {!isLast && (
                <div className="strip-tear">
                  <span className="strip-tear__scissors">✂</span>
                  <span className="strip-tear__text">линия отрыва</span>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

const PRINT_CSS = `
@media screen {
  .deliv-print-root { position: fixed; inset: 0; z-index: 99999; background: #f5f3ee; overflow: auto; padding: 24px; }
  .transport-sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 6mm; box-shadow: 0 2px 20px rgba(0,0,0,0.12); border-radius: 4px; }
  .deliv-print-close { position: fixed; top: 12px; right: 12px; z-index: 100000; display: flex; gap: 8px; }
  .deliv-print-close button { padding: 8px 16px; background: #1a1a18; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: system-ui, sans-serif; }
  .deliv-print-close button:hover { background: #333; }
}
@media print {
  /* Маленькие поля — полоски удобно отрывать от края листа. */
  @page { size: A4 portrait; margin: 5mm 6mm; }
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .admin-sidebar, .admin-mobile-bar, .NavigationProgress { display: none !important; }
  .admin-content, .admin-main { visibility: hidden !important; }
  .deliv-print-root, .deliv-print-root * { visibility: visible !important; }
  .deliv-print-root { position: fixed !important; left: 0 !important; top: 0 !important; width: 100% !important; background: #fff !important; padding: 0 !important; margin: 0 !important; z-index: 999999 !important; }
  .transport-sheet { padding: 0 !important; max-width: none !important; box-shadow: none !important; }
  .deliv-print-close { display: none !important; }
  .transport-strip { break-inside: avoid; }
  .strip-tear { break-inside: avoid; }
}

.transport-sheet { font-family: Arial, Helvetica, sans-serif; color: #2b2b28; }

/* ── Полоска: высота по содержимому, без обрезки ── */
.transport-strip {
  box-sizing: border-box;
  border: 1px solid #ddd8cd;
  border-radius: 2.5mm;
  padding: 3mm 4.5mm;
}

/* Шапка */
.strip-top { display: flex; justify-content: space-between; align-items: flex-start; }
.strip-top__left { display: flex; flex-direction: column; gap: 1mm; }
.strip-deal { font-size: 19px; font-weight: 700; letter-spacing: 0.01em; line-height: 1; color: #2b2b28; }
.strip-trip-type { font-size: 11px; font-weight: 700; color: #fff; background: #1d4ed8; border-radius: 2mm; padding: 1mm 2.5mm; display: inline-block; width: fit-content; }
.strip-per { font-size: 9px; color: #9a948a; font-weight: 500; }
.strip-top__right { display: flex; flex-direction: column; align-items: flex-end; line-height: 1; }
.strip-boxes { font-size: 22px; font-weight: 700; line-height: 1; color: #2b2b28; }
.strip-boxes-label { font-size: 8px; color: #9a948a; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 1mm; }

/* Информация для доставки — всё в одну колонку, значения выровнены */
.strip-info { margin-top: 2.5mm; display: flex; flex-direction: column; gap: 1mm; }
.strip-info__row { display: flex; align-items: baseline; gap: 3mm; }
.strip-info__k {
  flex-shrink: 0; width: 30mm; color: #9a948a; font-size: 8.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.strip-info__v { font-weight: 700; color: #2b2b28; font-size: 11px; line-height: 1.2; }
.strip-info__v--phone { font-size: 16px; letter-spacing: 0.01em; }
.strip-info__v--addr { font-size: 13px; }

/* Заметка курьеру — светлый акцентный блок (важная инфа) */
.strip-note {
  margin-top: 2.5mm;
  padding: 2mm 3mm;
  background: #fdf8ec;
  border: 1px solid #eeddb4;
  border-left: 1.2mm solid #e0b84f;
  border-radius: 1.5mm;
}
.strip-note__k {
  display: block;
  font-size: 8px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: #a97c14; margin-bottom: 1mm;
}
.strip-note__v { font-size: 11.5px; font-weight: 700; color: #2b2b28; line-height: 1.25; white-space: pre-line; }

/* Товары */
.strip-items { width: 100%; border-collapse: collapse; margin-top: 2.5mm; }
.strip-items th {
  text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em;
  color: #9a948a; padding: 0 2mm 1.2mm; border-bottom: 1px solid #e7e3da;
}
.strip-items__qty-head { text-align: right; }
.strip-items td { padding: 1.4mm 2mm; border-bottom: 1px solid #f2efe8; vertical-align: middle; }
.strip-items__name { font-size: 11px; color: #2b2b28; }
.strip-items__qty { text-align: right; white-space: nowrap; width: 24mm; }
.strip-items__num { font-size: 14px; font-weight: 700; color: #2b2b28; }
.strip-items__unit { font-size: 9px; color: #9a948a; margin-left: 1mm; }

/* Наша компания */
.strip-company {
  display: flex; flex-wrap: wrap; gap: 0.8mm 4mm;
  margin-top: 2mm; padding-top: 1.8mm; border-top: 1px solid #eeeae2;
  font-size: 8px; color: #8a847a;
}
.strip-company strong { color: #4a463f; font-weight: 700; }

/* Линия отрыва — между полосками, с отступами с обеих сторон */
.strip-tear {
  position: relative;
  height: 0;
  border-top: 1.5px dashed #b5afa3;
  margin: 3.5mm 0;
}
.strip-tear__scissors {
  position: absolute; left: 4mm; top: -2.8mm;
  font-size: 13px; color: #a49e92; background: #fff; padding: 0 1.5mm; line-height: 1;
}
.strip-tear__text {
  position: absolute; right: 4mm; top: -2.3mm;
  font-size: 8px; color: #b5afa3; text-transform: uppercase; letter-spacing: 0.07em;
  background: #fff; padding: 0 2mm; line-height: 1;
}
`;
