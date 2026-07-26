// src/components/admin/TransportPrintSheet.tsx
// Бланк перевозки: A4, 4 отрывных полоски на лист.
// Каждая полоска = один заказ (ЗК): номер, товары с количеством
// коробок и полная инфа для доставки (телефон, контактное лицо,
// адрес) + реквизиты компании. Между полосками — линия отрыва.
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

/** Разбить массив на страницы по 4 полоски. */
function chunk4<T>(arr: T[]): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < arr.length; i += 4) pages.push(arr.slice(i, i + 4));
  return pages;
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
  const pages = chunk4(data.items);

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
        {pages.map((pageDeals, pi) => (
          <div
            key={pi}
            className="transport-page"
            style={pi < pages.length - 1 ? { breakAfter: "page" } : undefined}
          >
            {pageDeals.map((deal, idx) => {
              const boxes = deal.items.reduce(
                (s, i) => s + (Number(i.transportQty) || 0),
                0
              );
              const contact =
                deal.contactName && deal.contactName !== deal.customerName
                  ? deal.contactName
                  : null;
              const isLastOnPage = idx === pageDeals.length - 1;
              return (
                <div
                  key={deal.dealNumber}
                  className={`transport-strip${
                    isLastOnPage ? "" : " transport-strip--tear"
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
                      <span className="strip-boxes-label">коробок всего</span>
                    </div>
                  </div>

                  {/* Компания */}
                  <div className="strip-company">
                    <strong>{companyName}</strong>
                    <span>офис: {officePhone}</span>
                    <span>{officeAddress}</span>
                    <span>{SITE_HOURS_LABEL}</span>
                  </div>

                  {/* Доставка — главная информация */}
                  <div className="strip-delivery">
                    <div className="strip-delivery__row">
                      <span className="strip-delivery__label">ТЕЛ</span>
                      <span className="strip-phone">
                        {deal.phone || "—"}
                      </span>
                    </div>
                    <div className="strip-delivery__row">
                      <span className="strip-delivery__label">КОНТАКТ</span>
                      <span className="strip-contact">
                        {deal.customerName}
                        {contact ? ` · ${contact}` : ""}
                      </span>
                    </div>
                    <div className="strip-delivery__row">
                      <span className="strip-delivery__label">АДРЕС</span>
                      <span className="strip-address">
                        {deal.address || "Адрес не указан"}
                      </span>
                    </div>
                  </div>

                  {/* Товары (гибкая зона — при избытке позиций обрезается,
                      линия отрыва всегда остаётся внизу полоски) */}
                  <div className="strip-items-wrap">
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
                              <span className="strip-items__unit">коробок</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Линия отрыва */}
                  {!isLastOnPage && (
                    <div className="strip-tear">
                      <span className="strip-tear__scissors">✂</span>
                      <span className="strip-tear__text">линия отрыва</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
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
  /* Очень маленькие поля — полоски отрываются от края листа. */
  @page { size: A4 portrait; margin: 4mm 5mm; }
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .admin-sidebar, .admin-mobile-bar, .NavigationProgress { display: none !important; }
  .admin-content, .admin-main { visibility: hidden !important; }
  .deliv-print-root, .deliv-print-root * { visibility: visible !important; }
  .deliv-print-root { position: fixed !important; left: 0 !important; top: 0 !important; width: 100% !important; background: #fff !important; padding: 0 !important; margin: 0 !important; z-index: 999999 !important; }
  .transport-sheet { padding: 0 !important; max-width: none !important; box-shadow: none !important; }
  .deliv-print-close { display: none !important; }
  .transport-strip { break-inside: avoid; }
  .transport-page { break-inside: avoid; }
}

.transport-sheet { font-family: Arial, Helvetica, sans-serif; color: #1a1a18; }
.transport-page { display: flex; flex-direction: column; }

/* ── Полоска ── */
.transport-strip {
  box-sizing: border-box;
  height: 68mm;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 2.5mm 3mm;
  border: 1px solid #cfcabf;
  border-radius: 2mm;
  margin-bottom: 1mm;
}
/* Полоска с линией отрыва снизу */
.transport-strip--tear {
  border-bottom: none;
  position: relative;
}

/* Шапка: номер заказа + коробки */
.strip-top { display: flex; justify-content: space-between; align-items: flex-start; }
.strip-top__left { display: flex; flex-direction: column; gap: 1px; }
.strip-deal { font-size: 20px; font-weight: 900; letter-spacing: 0.02em; line-height: 1; }
.strip-per { font-size: 9px; color: #777; font-weight: 600; }
.strip-top__right { display: flex; flex-direction: column; align-items: flex-end; line-height: 1; }
.strip-boxes { font-size: 24px; font-weight: 900; line-height: 1; }
.strip-boxes-label { font-size: 8px; color: #777; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

/* Компания */
.strip-company {
  display: flex; flex-wrap: wrap; gap: 3px 10px;
  font-size: 8.5px; color: #555; margin-top: 2px;
  padding-bottom: 2px; border-bottom: 1px solid #e7e3da;
}
.strip-company strong { color: #1a1a18; }

/* Доставка — главное */
.strip-delivery { margin-top: 2.5mm; display: flex; flex-direction: column; gap: 1.5mm; }
.strip-delivery__row { display: flex; align-items: baseline; gap: 8px; }
.strip-delivery__label {
  flex-shrink: 0; width: 52px; font-size: 9px; font-weight: 800;
  color: #fff; background: #1a1a18; padding: 1px 5px; border-radius: 2px;
  text-align: center; letter-spacing: 0.04em;
}
.strip-phone { font-size: 18px; font-weight: 900; letter-spacing: 0.01em; }
.strip-contact { font-size: 12px; font-weight: 700; }
.strip-address { font-size: 14px; font-weight: 900; line-height: 1.15; }

/* Товары */
.strip-items-wrap { flex: 1; min-height: 0; overflow: hidden; margin-top: 2.5mm; }
.strip-items { width: 100%; border-collapse: collapse; font-size: 11px; }
.strip-items th {
  text-align: left; font-size: 8.5px; text-transform: uppercase;
  letter-spacing: 0.05em; color: #999; padding: 0 4px 2px; border-bottom: 1px solid #e7e3da;
}
.strip-items__qty-head { text-align: right; }
.strip-items td { padding: 2px 4px; border-bottom: 1px solid #f2efe8; vertical-align: middle; }
.strip-items__name { font-size: 11px; }
.strip-items__qty { text-align: right; white-space: nowrap; width: 64px; }
.strip-items__num { font-size: 15px; font-weight: 900; }
.strip-items__unit { display: block; font-size: 7.5px; color: #888; text-transform: uppercase; letter-spacing: 0.04em; }

/* Линия отрыва — всегда внизу полоски */
.strip-tear {
  flex-shrink: 0;
  margin-top: 2mm;
  border-top: 2px dashed #999;
  position: relative;
  height: 0;
}
.strip-tear__scissors {
  position: absolute; left: 4px; top: -9px; font-size: 13px; color: #888;
  background: #fff; padding: 0 2px;
}
.strip-tear__text {
  position: absolute; right: 6px; top: -8px; font-size: 7.5px; color: #aaa;
  text-transform: uppercase; letter-spacing: 0.06em; background: #fff; padding: 0 3px;
}
`;
