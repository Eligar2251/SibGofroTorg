// src/components/admin/TransportPrintSheet.tsx
// Бланк перевозки: A4, отрывные полоски под УПД.
// Каждая полоска = один заказ (ЗК): номер заказа, товары с
// количеством коробок и полная инфа для доставки (телефон и адрес —
// крупно/жирно, клиент и контактное лицо отдельно) + реквизиты нашей
// компании. Полоски идут с запасом по высоте и НЕ наезжают друг на
// друга; между ними — линия отрыва (✂).
"use client";

import { useEffect, useRef, useState } from "react";
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
    items: { name: string; transportQty: number }[];
  }[];
  companyPhone?: string;
  companyAddress?: string;
}

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
  const lastIdx = data.items.length - 1;

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
        {data.items.map((deal, idx) => {
          const boxes = deal.items.reduce(
            (s, i) => s + (Number(i.transportQty) || 0),
            0
          );
          // Контактное лицо — это человек (из доставки заказа),
          // а НЕ название фирмы. Название фирмы — в «Клиент».
          const contact =
            deal.contactName && deal.contactName.trim()
              ? deal.contactName.trim()
              : null;
          const isLast = idx === lastIdx;
          return (
            <div
              key={`${deal.dealNumber}-${idx}`}
              className={`transport-strip${
                isLast ? "" : " transport-strip--tear"
              }`}
            >
              {/* Шапка: номер заказа + количество коробок */}
              <div className="strip-top">
                <div className="strip-top__left">
                  <span className="strip-deal">ЗК-{deal.dealNumber}</span>
                  <span className="strip-per">
                    ПЕР-{data.transportNumber} · {fmtDate(data.date)}
                  </span>
                </div>
                <div className="strip-top__right">
                  <span className="strip-boxes">{boxes}</span>
                  <span className="strip-boxes-label">коробок</span>
                </div>
              </div>

              {/* Доставка — главная информация (телефон и адрес крупно) */}
              <div className="strip-delivery">
                <div className="strip-delivery__row">
                  <span className="strip-delivery__label">ТЕЛ</span>
                  <span className="strip-phone">{deal.phone || "—"}</span>
                </div>
                <div className="strip-delivery__row">
                  <span className="strip-delivery__label">АДРЕС</span>
                  <span className="strip-address">
                    {deal.address || "Адрес не указан"}
                  </span>
                </div>
              </div>

              {/* Клиент (название компании) и контактное лицо (человек) */}
              <div className="strip-people">
                <div className="strip-people__row">
                  <span className="strip-people__k">Клиент</span>
                  <span className="strip-people__v">
                    {deal.customerName || "—"}
                  </span>
                </div>
                <div className="strip-people__row">
                  <span className="strip-people__k">Контактное лицо</span>
                  <span className="strip-people__v">{contact || "—"}</span>
                </div>
              </div>

              {/* Товары */}
              <table className="strip-items">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th className="strip-items__qty-head">Кол-во, коробок</th>
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

              {/* Линия отрыва — последний элемент, ни на что не наезжает */}
              {!isLast && (
                <div className="strip-tear">
                  <span className="strip-tear__scissors">✂</span>
                  <span className="strip-tear__text">линия отрыва</span>
                </div>
              )}
            </div>
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
}

.transport-sheet { font-family: Arial, Helvetica, sans-serif; color: #1a1a18; }

/* ── Полоска: высота по содержимому, без обрезки — элементы не наезжают ── */
.transport-strip {
  box-sizing: border-box;
  border: 1px solid #d8d3c8;
  border-radius: 2.5mm;
  padding: 3mm 4mm;
  margin-bottom: 2mm;
}
.transport-strip--tear { border-bottom: none; }

/* Шапка */
.strip-top { display: flex; justify-content: space-between; align-items: flex-start; }
.strip-top__left { display: flex; flex-direction: column; gap: 0.8mm; }
.strip-deal { font-size: 19px; font-weight: 900; letter-spacing: 0.02em; line-height: 1; }
.strip-per { font-size: 9px; color: #888; font-weight: 600; }
.strip-top__right { display: flex; flex-direction: column; align-items: flex-end; line-height: 1; }
.strip-boxes { font-size: 24px; font-weight: 900; line-height: 1; }
.strip-boxes-label { font-size: 8px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 0.8mm; }

/* Доставка — телефон и адрес (главное) */
.strip-delivery { margin-top: 2.5mm; display: flex; flex-direction: column; gap: 1.5mm; }
.strip-delivery__row { display: flex; align-items: baseline; gap: 2.5mm; }
.strip-delivery__label {
  flex-shrink: 0; width: 14mm; font-size: 9px; font-weight: 800;
  color: #fff; background: #1a1a18; padding: 0.8mm 0; border-radius: 1mm;
  text-align: center; letter-spacing: 0.05em;
}
.strip-phone { font-size: 17px; font-weight: 900; letter-spacing: 0.01em; }
.strip-address { font-size: 13px; font-weight: 900; line-height: 1.2; }

/* Клиент + контактное лицо */
.strip-people { margin-top: 2mm; display: flex; flex-direction: column; gap: 1mm; }
.strip-people__row { display: flex; align-items: baseline; gap: 2.5mm; font-size: 10px; }
.strip-people__k {
  flex-shrink: 0; width: 26mm; color: #888; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em; font-size: 8px;
}
.strip-people__v { font-weight: 700; }

/* Товары */
.strip-items { width: 100%; border-collapse: collapse; margin-top: 2mm; }
.strip-items th {
  text-align: left; font-size: 8px; text-transform: uppercase;
  letter-spacing: 0.05em; color: #999; padding: 0 2mm 1.2mm; border-bottom: 1px solid #e7e3da;
}
.strip-items__qty-head { text-align: right; }
.strip-items td { padding: 1.3mm 2mm; border-bottom: 1px solid #f2efe8; vertical-align: middle; }
.strip-items__name { font-size: 11px; }
.strip-items__qty { text-align: right; white-space: nowrap; width: 18mm; }
.strip-items__num { font-size: 14px; font-weight: 900; }

/* Наша компания */
.strip-company {
  display: flex; flex-wrap: wrap; gap: 0.8mm 4mm;
  margin-top: 2mm; font-size: 8px; color: #666;
}
.strip-company strong { color: #1a1a18; }

/* Линия отрыва — отдельный элемент в потоке, ни на что не накладывается */
.strip-tear {
  position: relative;
  height: 0;
  border-top: 2px dashed #999;
  margin: 4mm -4mm 0;
}
.strip-tear__scissors {
  position: absolute; left: 5mm; top: -2.6mm;
  font-size: 13px; color: #777; background: #fff; padding: 0 1.5mm; line-height: 1;
}
.strip-tear__text {
  position: absolute; right: 5mm; top: -2.2mm;
  font-size: 8px; color: #aaa; text-transform: uppercase; letter-spacing: 0.07em;
  background: #fff; padding: 0 2mm; line-height: 1;
}
`;
