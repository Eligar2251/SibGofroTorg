"use client";

import { useRef, useState } from "react";
import { Printer, MapPin, Phone, Mail, Globe, Clock, Package, Recycle } from "lucide-react";

export type BusinessCardData = {
  companyName: string;
  tagline?: string;
  siteUrl: string;
  phoneSales: string;
  phoneWastepaper?: string;
  email?: string;
  address?: string;
  hours?: string;
  legalName?: string;
  inn?: string;
};

/**
 * Вертикальная визитка / плакат A4 (книжная).
 * Ч/б печать: только чёрный, серый и белый — без цветных заливок.
 */
export function BusinessCardPrint({ data }: { data: BusinessCardData }) {
  const printRef = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(1);

  const siteDisplay = (data.siteUrl || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");

  function handlePrint() {
    window.print();
  }

  const sheets = Math.max(1, Math.min(10, copies));

  return (
    <div className="bc-root">
      <style>{`
        .bc-root { display: grid; gap: 16px; }
        .bc-toolbar {
          display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
        }
        .bc-stage {
          background: #e6e4de;
          border-radius: 14px;
          padding: 22px 16px;
          display: flex;
          justify-content: center;
          overflow: auto;
        }
        .bc-sheet {
          width: min(100%, 210mm);
          aspect-ratio: 210 / 297;
          max-height: min(92vh, 297mm);
          background: #fff;
          color: #0a0a0a;
          box-shadow: 0 12px 40px rgba(0,0,0,.14);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          font-family: "Inter", system-ui, sans-serif;
        }

        /* ── Фоновая фактура «гофры» (ч/б) ── */
        .bc-sheet::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image:
            repeating-linear-gradient(
              90deg,
              transparent 0,
              transparent 11px,
              rgba(0,0,0,.035) 11px,
              rgba(0,0,0,.035) 12px
            );
          pointer-events: none;
          z-index: 0;
        }

        .bc-inner {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 14mm 16mm 12mm;
          min-height: 0;
        }

        /* Верхняя чёрная плашка */
        .bc-topbar {
          background: #0a0a0a;
          color: #fff;
          margin: -14mm -16mm 0;
          padding: 18mm 16mm 14mm;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .bc-mark {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .bc-mark__sign {
          width: 52px;
          height: 52px;
          border: 2.5px solid #fff;
          display: grid;
          place-items: center;
          font-family: "Oswald", "Arial Narrow", sans-serif;
          font-weight: 700;
          font-size: 26px;
          letter-spacing: -0.02em;
          flex-shrink: 0;
        }
        .bc-mark__text {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .bc-mark__name {
          font-family: "Oswald", "Arial Narrow", sans-serif;
          font-weight: 700;
          font-size: 28px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          line-height: 1.05;
        }
        .bc-mark__tag {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          opacity: .72;
          font-weight: 600;
        }

        .bc-url-band {
          margin-top: 6px;
          border-top: 1px solid rgba(255,255,255,.22);
          padding-top: 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .bc-url-band__icon {
          width: 34px;
          height: 34px;
          border: 1.5px solid rgba(255,255,255,.55);
          border-radius: 50%;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .bc-url-band__url {
          font-family: "Oswald", "Arial Narrow", sans-serif;
          font-size: 22px;
          font-weight: 600;
          letter-spacing: 0.04em;
          word-break: break-all;
        }

        /* Основной блок */
        .bc-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0;
          padding-top: 12mm;
          min-height: 0;
        }

        .bc-section {
          padding: 11px 0;
          border-bottom: 1px solid #d0cec8;
        }
        .bc-section:last-of-type { border-bottom: none; }

        .bc-section__label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #666;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .bc-section__label svg { opacity: .7; }

        .bc-phone {
          font-family: "Oswald", "Arial Narrow", sans-serif;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 0.02em;
          line-height: 1.15;
          color: #0a0a0a;
        }
        .bc-phone + .bc-phone { margin-top: 6px; }
        .bc-phone__hint {
          display: block;
          font-family: "Inter", system-ui, sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #666;
          margin-bottom: 2px;
        }

        .bc-row {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          font-size: 15px;
          line-height: 1.4;
          color: #1a1a1a;
        }
        .bc-row + .bc-row { margin-top: 8px; }
        .bc-row svg {
          flex-shrink: 0;
          margin-top: 2px;
          color: #0a0a0a;
        }
        .bc-row strong {
          font-weight: 700;
        }

        .bc-services {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 4px;
        }
        .bc-service {
          border: 1.5px solid #0a0a0a;
          padding: 12px 12px 11px;
          display: grid;
          gap: 6px;
          min-height: 88px;
        }
        .bc-service__icon {
          width: 28px;
          height: 28px;
          border: 1.5px solid #0a0a0a;
          display: grid;
          place-items: center;
        }
        .bc-service__title {
          font-family: "Oswald", "Arial Narrow", sans-serif;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          line-height: 1.15;
        }
        .bc-service__desc {
          font-size: 11px;
          color: #444;
          line-height: 1.35;
        }

        .bc-footer {
          margin-top: auto;
          padding-top: 10mm;
          border-top: 2px solid #0a0a0a;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bc-footer__legal {
          font-size: 11px;
          color: #444;
          line-height: 1.4;
        }
        .bc-footer__bar {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-top: 4px;
        }
        .bc-footer__city {
          font-family: "Oswald", "Arial Narrow", sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .bc-footer__inn {
          font-size: 11px;
          color: #555;
          font-variant-numeric: tabular-nums;
        }

        /* Уголки-рамка */
        .bc-frame {
          position: absolute;
          inset: 7mm;
          border: 1px solid rgba(0,0,0,.18);
          pointer-events: none;
          z-index: 2;
        }
        .bc-frame::before,
        .bc-frame::after {
          content: "";
          position: absolute;
          width: 18px;
          height: 18px;
          border: 2px solid #0a0a0a;
        }
        .bc-frame::before {
          top: -1px; left: -1px;
          border-right: none; border-bottom: none;
        }
        .bc-frame::after {
          bottom: -1px; right: -1px;
          border-left: none; border-top: none;
        }

        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body {
            background: #fff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * { visibility: hidden !important; }
          .bc-print-area,
          .bc-print-area * { visibility: visible !important; }
          .bc-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .bc-stage {
            background: #fff !important;
            padding: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            display: block !important;
            overflow: visible !important;
          }
          .bc-sheet {
            width: 210mm !important;
            height: 297mm !important;
            max-height: none !important;
            aspect-ratio: auto !important;
            box-shadow: none !important;
            page-break-after: always;
            break-after: page;
          }
          .bc-sheet:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .bc-no-print { display: none !important; }
          .admin-sidebar,
          .admin-mobile-bar,
          .admin-sidebar-handle,
          .admin-notify,
          .admin-plans-shortcut,
          .admin-requests-shortcut { display: none !important; }
          .admin-content { margin: 0 !important; }
          .admin-main { padding: 0 !important; }
        }

        @media (max-width: 640px) {
          .bc-stage { padding: 12px 8px; }
          .bc-mark__name { font-size: 22px; }
          .bc-url-band__url { font-size: 16px; }
          .bc-phone { font-size: 22px; }
        }
      `}</style>

      <div className="bc-toolbar bc-no-print">
        <button type="button" className="admin-btn admin-btn--primary" onClick={handlePrint}>
          <Printer size={15} /> Печать A4
        </button>
        <label
          className="admin-field"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            margin: 0,
          }}
        >
          <span className="admin-label" style={{ margin: 0 }}>
            Копий
          </span>
          <input
            className="admin-input"
            type="number"
            min={1}
            max={10}
            value={copies}
            onChange={(e) => setCopies(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            style={{ width: 72 }}
          />
        </label>
        <span className="admin-hint" style={{ margin: 0 }}>
          Книжная A4 · ч/б · данные из «Контакты» и «Макулатура»
        </span>
      </div>

      <div className="bc-print-area" ref={printRef}>
        <div className="bc-stage">
          {Array.from({ length: sheets }).map((_, sheetIdx) => (
            <div className="bc-sheet" key={sheetIdx} style={sheetIdx > 0 ? { marginTop: 18 } : undefined}>
              <div className="bc-frame" aria-hidden />
              <div className="bc-inner">
                <header className="bc-topbar">
                  <div className="bc-mark">
                    <div className="bc-mark__sign" aria-hidden>
                      С
                    </div>
                    <div className="bc-mark__text">
                      <div className="bc-mark__name">{data.companyName}</div>
                      <div className="bc-mark__tag">
                        {data.tagline || "Гофротара · Упаковка · Макулатура"}
                      </div>
                    </div>
                  </div>
                  <div className="bc-url-band">
                    <span className="bc-url-band__icon" aria-hidden>
                      <Globe size={16} strokeWidth={2.2} />
                    </span>
                    <span className="bc-url-band__url">{siteDisplay}</span>
                  </div>
                </header>

                <div className="bc-body">
                  <section className="bc-section">
                    <div className="bc-section__label">
                      <Phone size={12} /> Телефоны
                    </div>
                    <div className="bc-phone">
                      <span className="bc-phone__hint">Отдел продаж · гофротара</span>
                      {data.phoneSales}
                    </div>
                    {data.phoneWastepaper &&
                      data.phoneWastepaper !== data.phoneSales && (
                        <div className="bc-phone">
                          <span className="bc-phone__hint">Приём макулатуры</span>
                          {data.phoneWastepaper}
                        </div>
                      )}
                  </section>

                  {(data.address || data.hours) && (
                    <section className="bc-section">
                      <div className="bc-section__label">
                        <MapPin size={12} /> Склад-магазин
                      </div>
                      {data.address && (
                        <div className="bc-row">
                          <MapPin size={16} strokeWidth={2} />
                          <strong>{data.address}</strong>
                        </div>
                      )}
                      {data.hours && (
                        <div className="bc-row">
                          <Clock size={16} strokeWidth={2} />
                          <span>{data.hours}</span>
                        </div>
                      )}
                      {data.email && (
                        <div className="bc-row">
                          <Mail size={16} strokeWidth={2} />
                          <span>{data.email}</span>
                        </div>
                      )}
                    </section>
                  )}

                  <section className="bc-section">
                    <div className="bc-section__label">Направления</div>
                    <div className="bc-services">
                      <div className="bc-service">
                        <span className="bc-service__icon" aria-hidden>
                          <Package size={15} strokeWidth={2.2} />
                        </span>
                        <div className="bc-service__title">Гофротара</div>
                        <div className="bc-service__desc">
                          Коробки от 1 шт. · Т-22, Т-23, Т-24 · 3 и 5 слой
                        </div>
                      </div>
                      <div className="bc-service">
                        <span className="bc-service__icon" aria-hidden>
                          <Recycle size={15} strokeWidth={2.2} />
                        </span>
                        <div className="bc-service__title">Макулатура</div>
                        <div className="bc-service__desc">
                          Приём картона и бумаги · вывоз · оплата на месте
                        </div>
                      </div>
                    </div>
                  </section>

                  <footer className="bc-footer">
                    {(data.legalName || data.inn) && (
                      <div className="bc-footer__legal">
                        {data.legalName}
                        {data.legalName && data.inn ? " · " : ""}
                        {data.inn ? `ИНН ${data.inn}` : ""}
                      </div>
                    )}
                    <div className="bc-footer__bar">
                      <span className="bc-footer__city">Новосибирск</span>
                      <span className="bc-footer__inn">{siteDisplay}</span>
                    </div>
                  </footer>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
