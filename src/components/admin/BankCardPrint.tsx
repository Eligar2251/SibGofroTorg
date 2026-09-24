"use client";

import { useState } from "react";
import { Printer, CreditCard, Phone, User, Landmark } from "lucide-react";
import { formatCardHolderName } from "@/lib/warehouse-shared";

export type BankCardPrintCard = {
  /** Идентификатор карты: ym | vm. */
  id: string;
  /** Название счёта: «Карта ЮМ», «Карта В.М.». */
  label: string;
  /** ФИО владельца в свободной форме — приводится к «Вадим Маркович П.». */
  holder: string;
  /** Номер карты. */
  number: string;
  /** Телефон, привязанный к карте. */
  phone: string;
  /** Название банка. */
  bank: string;
};

/** Разбивает номер карты на группы по 4 цифры — так крупнее и читаемее. */
export function formatCardNumber(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return String(raw || "").trim();
  return (digits.match(/.{1,4}/g) || []).join(" ");
}

/**
 * Лист A4 с данными банковской карты: номер, телефон и владелец
 * («Вадим Маркович П.») — крупно, чтобы лист можно было повесить у кассы.
 *
 * Каждая карта печатается отдельным листом; лишние карты снимаются
 * галочками, поэтому на печать уходит только нужное.
 */
export function BankCardPrint({
  cards,
  companyName,
}: {
  cards: BankCardPrintCard[];
  companyName?: string;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(cards.map((card) => [card.id, true]))
  );
  const [copies, setCopies] = useState(1);

  const toPrint = cards.filter((card) => selected[card.id] !== false);
  const sheets = Math.max(1, Math.min(10, copies));

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: prev[id] === false }));
  }

  return (
    <div className="bcp-root">
      <style>{`
        .bcp-root { display: grid; gap: 16px; }
        .bcp-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
        .bcp-pick {
          display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
          border: 1px solid var(--adm-line, #d8d3c8);
          border-radius: 10px; padding: 8px 10px;
        }
        .bcp-stage {
          background: #e6e4de;
          border-radius: 14px;
          padding: 22px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          overflow: auto;
        }
        .bcp-sheet {
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
        .bcp-inner {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 16mm 16mm 14mm;
          min-height: 0;
          gap: 8mm;
        }
        .bcp-head {
          background: #0a0a0a;
          color: #fff;
          margin: -16mm -16mm 0;
          padding: 14mm 16mm 10mm;
          display: grid;
          gap: 4px;
        }
        .bcp-company {
          font-family: "Oswald", "Arial Narrow", sans-serif;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .bcp-title {
          font-family: "Oswald", "Arial Narrow", sans-serif;
          font-size: 54px;
          font-weight: 700;
          letter-spacing: 0.02em;
          line-height: 1;
        }
        .bcp-rows { display: grid; gap: 9mm; flex: 1; align-content: start; }
        .bcp-field { display: grid; gap: 3mm; }
        .bcp-label {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 800; letter-spacing: 0.18em;
          text-transform: uppercase; color: #666;
        }
        .bcp-value {
          font-family: "Oswald", "Arial Narrow", sans-serif;
          font-weight: 700;
          line-height: 1.05;
          letter-spacing: 0.02em;
          word-break: break-word;
        }
        /* Номер карты и телефон — самое крупное, их читают издалека */
        .bcp-value--big { font-size: 62px; }
        .bcp-value--huge { font-size: 76px; letter-spacing: 0.04em; }
        .bcp-foot {
          margin-top: auto;
          border-top: 2px solid #0a0a0a;
          padding-top: 6mm;
          display: flex; justify-content: space-between; gap: 12px;
          font-size: 12px; color: #555; letter-spacing: 0.06em;
          text-transform: uppercase; font-weight: 700;
        }
        .bcp-empty {
          border: 1px dashed var(--adm-line, #d8d3c8);
          border-radius: 10px; padding: 18px; color: var(--adm-muted, #6b6455);
          font-size: 13px; line-height: 1.5;
        }

        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body {
            background: #fff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * { visibility: hidden !important; }
          .bcp-print-area, .bcp-print-area * { visibility: visible !important; }
          .bcp-print-area {
            position: absolute !important;
            left: 0 !important; top: 0 !important;
            width: 100% !important; margin: 0 !important; padding: 0 !important;
            background: #fff !important;
          }
          .bcp-stage {
            background: #fff !important; padding: 0 !important;
            border-radius: 0 !important; box-shadow: none !important;
            display: block !important; overflow: visible !important;
          }
          .bcp-sheet {
            width: 210mm !important; height: 297mm !important;
            max-height: none !important; aspect-ratio: auto !important;
            box-shadow: none !important; margin: 0 !important;
            page-break-after: always; break-after: page;
          }
          .bcp-sheet:last-child { page-break-after: auto; break-after: auto; }
          .bcp-no-print { display: none !important; }
          .admin-sidebar, .admin-mobile-bar, .admin-sidebar-handle,
          .admin-notify, .admin-plans-shortcut, .admin-requests-shortcut {
            display: none !important;
          }
          .admin-content { margin: 0 !important; }
          .admin-main { padding: 0 !important; }
        }
      `}</style>

      <div className="bcp-toolbar bcp-no-print">
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          onClick={() => window.print()}
          disabled={toPrint.length === 0}
        >
          <Printer size={15} /> Печать A4
        </button>
        <div className="bcp-pick">
          <span className="admin-label" style={{ margin: 0 }}>
            Печатать
          </span>
          {cards.map((card) => (
            <label key={card.id} className="admin-check" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={selected[card.id] !== false}
                onChange={() => toggle(card.id)}
              />
              {card.label}
            </label>
          ))}
        </div>
        <label
          className="admin-field"
          style={{ flexDirection: "row", alignItems: "center", gap: 8, margin: 0 }}
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
            onChange={(e) =>
              setCopies(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
            }
            style={{ width: 72 }}
          />
        </label>
      </div>

      {toPrint.length === 0 ? (
        <div className="bcp-empty bcp-no-print">
          Отметьте хотя бы одну карту — и заполните её данные в настройках выше,
          чтобы на листе были номер, телефон и владелец.
        </div>
      ) : (
        <div className="bcp-print-area">
          <div className="bcp-stage">
            {toPrint.flatMap((card) =>
              Array.from({ length: sheets }).map((_, sheetIdx) => (
                <div className="bcp-sheet" key={`${card.id}-${sheetIdx}`}>
                  <div className="bcp-inner">
                    <header className="bcp-head">
                      {companyName ? (
                        <div className="bcp-company">{companyName}</div>
                      ) : null}
                      <div className="bcp-title">{card.label}</div>
                    </header>

                    <div className="bcp-rows">
                      <div className="bcp-field">
                        <div className="bcp-label">
                          <CreditCard size={15} /> Номер карты
                        </div>
                        <div className="bcp-value bcp-value--huge">
                          {formatCardNumber(card.number) || "—"}
                        </div>
                      </div>

                      <div className="bcp-field">
                        <div className="bcp-label">
                          <User size={15} /> Получатель
                        </div>
                        <div className="bcp-value bcp-value--big">
                          {formatCardHolderName(card.holder) || "—"}
                        </div>
                      </div>

                      <div className="bcp-field">
                        <div className="bcp-label">
                          <Phone size={15} /> Телефон
                        </div>
                        <div className="bcp-value bcp-value--big">
                          {String(card.phone || "").trim() || "—"}
                        </div>
                      </div>

                      {String(card.bank || "").trim() ? (
                        <div className="bcp-field">
                          <div className="bcp-label">
                            <Landmark size={15} /> Банк
                          </div>
                          <div className="bcp-value" style={{ fontSize: 40 }}>
                            {String(card.bank).trim()}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <footer className="bcp-foot">
                      <span>Перевод по номеру карты или телефона</span>
                      <span>{card.label}</span>
                    </footer>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
