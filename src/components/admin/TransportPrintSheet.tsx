// src/components/admin/TransportPrintSheet.tsx
// Бланк перевозки для водителя: A4, чистый дизайн
"use client";

import { useEffect, useRef, useState } from "react";
import { SITE_HOURS_LABEL } from "@/lib/site-config";

export interface TransportPrintData {
  transportNumber: number;
  date: string;
  driverName?: string | null;
  driverPhone?: string | null;
  items: {
    dealNumber: number;
    customerName: string;
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

export function TransportPrintSheet({ data, onDone }: { data: TransportPrintData; onDone?: () => void }) {
  const [printing, setPrinting] = useState(false);
  const triggered = useRef(false);

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;
    const prev = document.title;
    document.title = `Перевозка ПЕР-${data.transportNumber}`;
    const t = window.setTimeout(() => { setPrinting(true); window.print(); }, 400);
    function onAfter() { document.title = prev; onDone?.(); }
    window.addEventListener("afterprint", onAfter);
    return () => { window.clearTimeout(t); document.title = prev; window.removeEventListener("afterprint", onAfter); };
  }, [data.transportNumber, onDone]);

  const totalQty = data.items.reduce((s, d) => s + d.items.reduce((s2, i) => s2 + i.transportQty, 0), 0);

  return (
    <div className="deliv-print-root">
      <style>{PRINT_CSS}</style>
      {!printing && (
        <button type="button" className="deliv-print-close" onClick={() => onDone?.()}>✕ Закрыть превью</button>
      )}
      <div className="transport-sheet">
        <header className="transport-head">
          <div className="transport-head__left">
            <div className="transport-head__title">ПЕРЕВОЗКА ПЕР-{data.transportNumber}</div>
            <div className="transport-head__date">{fmtDate(data.date)}</div>
          </div>
          <div className="transport-head__right">
            {data.driverName && <div><strong>Водитель:</strong> {data.driverName}</div>}
            {data.driverPhone && <div><strong>Тел. водителя:</strong> {data.driverPhone}</div>}
            <div><strong>Контакт офиса:</strong> {data.companyPhone || "—"}</div>
            <div>{SITE_HOURS_LABEL}</div>
          </div>
        </header>

        <div className="transport-summary">
          Заказов: <strong>{data.items.length}</strong> · Позиций: <strong>{totalQty}</strong>
        </div>

        {data.items.map((deal, idx) => (
          <div key={deal.dealNumber} className="transport-deal">
            <div className="transport-deal__head">
              <span className="transport-deal__num">{idx + 1}</span>
              <span className="transport-deal__label">ЗК-{deal.dealNumber}</span>
              <span className="transport-deal__client">{deal.customerName}</span>
              {deal.phone && <span className="transport-deal__phone">тел: {deal.phone}</span>}
            </div>
            <div className="transport-deal__addr">{deal.address || "Адрес не указан"}</div>
            <table className="transport-deal__table">
              <thead><tr><th>Товар</th><th>Кол-во</th><th>Принял</th></tr></thead>
              <tbody>
                {deal.items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.name}</td>
                    <td className="transport-deal__qty">{item.transportQty} шт.</td>
                    <td className="transport-deal__sign">__________</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <footer className="transport-foot">
          <div>Водитель: ________________ / ________________</div>
          <div>Дата и время выезда: ________  Возврат: ________</div>
        </footer>
      </div>
    </div>
  );
}

const PRINT_CSS = `
@media screen {
  .deliv-print-root { position: fixed; inset: 0; z-index: 99999; background: #f5f3ee; overflow: auto; padding: 24px; }
  .transport-sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 14mm; box-shadow: 0 2px 20px rgba(0,0,0,0.12); border-radius: 4px; }
  .deliv-print-close { position: fixed; top: 12px; right: 12px; z-index: 100000; padding: 8px 16px; background: #1a1a18; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: system-ui; }
  .deliv-print-close:hover { background: #333; }
}
@media print {
  @page { size: A4 portrait; margin: 8mm 10mm; }
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .admin-shell, .admin-sidebar, .admin-mobile-bar, .admin-content,
  .admin-main, .NavigationProgress { display: none !important; }
  .deliv-print-root { position: fixed !important; left: 0 !important; top: 0 !important; width: 100% !important; background: #fff !important; padding: 0 !important; margin: 0 !important; z-index: 999999 !important; }
  .transport-sheet { padding: 0 !important; max-width: none !important; }
  .deliv-print-close { display: none !important; }
  .transport-deal { page-break-inside: avoid; }
}
.transport-sheet { font-family: Arial, Helvetica, sans-serif; color: #1a1a18; }
.transport-head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #1a1a18; padding-bottom: 8px; margin-bottom: 12px; }
.transport-head__title { font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
.transport-head__date { font-size: 13px; color: #555; margin-top: 2px; }
.transport-head__right { text-align: right; font-size: 11px; line-height: 1.6; color: #555; }
.transport-head__right strong { color: #1a1a18; }
.transport-summary { font-size: 12px; font-weight: 700; color: #555; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
.transport-deal { border: 1px solid #888; margin-bottom: 10px; border-radius: 4px; overflow: hidden; }
.transport-deal__head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #f5f5f5; border-bottom: 1px solid #ddd; }
.transport-deal__num { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #eee; border-radius: 50%; font-size: 14px; font-weight: 800; color: #555; }
.transport-deal__label { font-size: 13px; font-weight: 800; border: 1px solid #888; padding: 1px 6px; border-radius: 3px; }
.transport-deal__client { font-size: 14px; font-weight: 700; }
.transport-deal__phone { font-size: 11px; color: #555; margin-left: auto; }
.transport-deal__addr { padding: 6px 12px; font-size: 12px; color: #555; border-bottom: 1px solid #eee; }
.transport-deal__table { width: 100%; border-collapse: collapse; font-size: 12px; }
.transport-deal__table th { text-align: left; padding: 6px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; border-bottom: 1px solid #eee; }
.transport-deal__table td { padding: 6px 12px; border-bottom: 1px solid #f0f0f0; }
.transport-deal__qty { font-weight: 700; text-align: right; white-space: nowrap; }
.transport-deal__sign { width: 120px; color: #aaa; }
.transport-foot { margin-top: 20px; border-top: 2px solid #1a1a18; padding-top: 10px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
`;
