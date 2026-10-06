"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CreditCard, Landmark, Phone, Printer, User } from "lucide-react";
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

type Orientation = "portrait" | "landscape";
type PageLayout = "one-page" | "one-card-per-page";
type PrintPage = { cards: BankCardPrintCard[]; key: string };
type VisibleFields = { holder: boolean; phone: boolean; bank: boolean };

function pageWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "листов";
  if (last === 1) return "лист";
  if (last >= 2 && last <= 4) return "листа";
  return "листов";
}

/**
 * Предпросмотр и печать данных карт на A4.
 *
 * По умолчанию все выбранные карты размещаются на одном альбомном листе.
 * Печатная копия рендерится порталом непосредственно в body: она не зависит
 * от overflow/contain/сетки карточки админки, которые раньше обрезали лист.
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
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [layout, setLayout] = useState<PageLayout>("one-page");
  const [copies, setCopies] = useState(1);
  const [pageMarginMm, setPageMarginMm] = useState(10);
  const [numberFontMax, setNumberFontMax] = useState(82);
  const [visibleFields, setVisibleFields] = useState<VisibleFields>({
    holder: true,
    phone: true,
    bank: true,
  });
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
    const clearPrintMode = () => document.body.classList.remove("bcp-print-mode");
    window.addEventListener("afterprint", clearPrintMode);

    return () => {
      window.removeEventListener("afterprint", clearPrintMode);
      clearPrintMode();
    };
  }, []);

  const toPrint = cards.filter((card) => selected[card.id] !== false);
  const pageGroups =
    layout === "one-page"
      ? toPrint.length > 0
        ? [toPrint]
        : []
      : toPrint.map((card) => [card]);
  const copiesCount = Math.max(1, Math.min(10, copies));
  const pages: PrintPage[] = pageGroups.flatMap((cardGroup, groupIndex) =>
    Array.from({ length: copiesCount }, (_, copyIndex) => ({
      cards: cardGroup,
      key: `${groupIndex}-${copyIndex}`,
    }))
  );

  const pageWidthMm = orientation === "landscape" ? 297 : 210;
  const pageHeightMm = orientation === "landscape" ? 210 : 297;
  const pageStyle = {
    "--bcp-page-width": `${pageWidthMm}mm`,
    "--bcp-page-height": `${pageHeightMm}mm`,
    "--bcp-page-ratio": `${pageWidthMm} / ${pageHeightMm}`,
    "--bcp-page-padding": `${pageMarginMm}mm`,
    "--bcp-number-max": `${numberFontMax}px`,
  } as CSSProperties;

  function toggleCard(id: string) {
    setSelected((previous) => ({ ...previous, [id]: previous[id] === false }));
  }

  function setFieldVisible(field: keyof VisibleFields, visible: boolean) {
    setVisibleFields((previous) => ({ ...previous, [field]: visible }));
  }

  function handlePrint() {
    if (!portalTarget || pages.length === 0) return;

    // Печатный лист находится прямым потомком body, а не внутри
    // .admin-card с overflow:hidden/contain:layout.
    document.body.classList.add("bcp-print-mode");
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  function renderSheet(page: PrintPage, keyPrefix: string, isLast: boolean) {
    const columns =
      orientation === "landscape" && page.cards.length > 1
        ? Math.min(2, page.cards.length)
        : 1;

    return (
      <article
        key={`${keyPrefix}-${page.key}`}
        className={`bcp-sheet bcp-sheet--${orientation}${isLast ? " bcp-sheet--last" : ""}`}
        style={{ ...pageStyle, "--bcp-columns": String(columns) } as CSSProperties}
        aria-label={`Лист A4, ${orientation === "landscape" ? "альбомная" : "книжная"} ориентация`}
      >
        <div className="bcp-inner">
          <header className="bcp-page-heading">
            <div className="bcp-brand-block">
              {companyName?.trim() ? <div className="bcp-company">{companyName}</div> : null}
              <div className="bcp-page-title">Реквизиты для перевода</div>
            </div>
            <span className="bcp-page-mark">Банковские карты</span>
          </header>

          <div className="bcp-card-grid">
            {page.cards.map((card) => {
              const number = formatCardNumber(card.number) || "—";
              const numberFit = `${Math.max(3, 145 / Math.max(number.length, 1))}cqw`;
              const holder = formatCardHolderName(card.holder) || "—";
              const phone = String(card.phone || "").trim() || "—";
              const bank = String(card.bank || "").trim();

              return (
                <section className="bcp-card" key={`${keyPrefix}-${page.key}-${card.id}`}>
                  <div className="bcp-card-heading">
                    <CreditCard size={18} aria-hidden="true" />
                    <h2>{card.label}</h2>
                  </div>

                  <div className="bcp-card-fields">
                    <div className="bcp-field bcp-field--number">
                      <div className="bcp-field-label">
                        <CreditCard size={14} aria-hidden="true" /> Номер карты
                      </div>
                      <div
                        className="bcp-value bcp-value--number"
                        style={{ "--bcp-number-fit": numberFit } as CSSProperties}
                      >
                        {number}
                      </div>
                    </div>

                    {visibleFields.holder ? (
                      <div className="bcp-field">
                        <div className="bcp-field-label">
                          <User size={14} aria-hidden="true" /> Получатель
                        </div>
                        <div className="bcp-value bcp-value--regular">{holder}</div>
                      </div>
                    ) : null}

                    {visibleFields.phone ? (
                      <div className="bcp-field">
                        <div className="bcp-field-label">
                          <Phone size={14} aria-hidden="true" /> Телефон
                        </div>
                        <div className="bcp-value bcp-value--regular">{phone}</div>
                      </div>
                    ) : null}

                    {visibleFields.bank && bank ? (
                      <div className="bcp-field">
                        <div className="bcp-field-label">
                          <Landmark size={14} aria-hidden="true" /> Банк
                        </div>
                        <div className="bcp-value bcp-value--regular">{bank}</div>
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>

          <footer className="bcp-page-footer">
            <span>Перевод по номеру карты или телефона</span>
            <span>A4 · {orientation === "landscape" ? "альбомная" : "книжная"}</span>
          </footer>
        </div>
      </article>
    );
  }

  function renderPages(prefix: string) {
    return pages.map((page, index) => renderSheet(page, prefix, index === pages.length - 1));
  }

  return (
    <div className="bcp-root">
      <style>{`
        .bcp-root { display: grid; gap: 14px; min-width: 0; }
        .bcp-controls {
          display: grid;
          gap: 12px;
          padding: 12px;
          border: 1px solid var(--adm-line, #d8d3c8);
          border-radius: 12px;
          background: var(--adm-card, #fff);
        }
        .bcp-toolbar, .bcp-control-row, .bcp-toggles {
          display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
        }
        .bcp-control-group { display: grid; gap: 5px; min-width: 0; }
        .bcp-control-title {
          color: var(--adm-muted, #6b6455);
          font-size: 10px; font-weight: 800; letter-spacing: .08em;
          text-transform: uppercase;
        }
        .bcp-segment { display: flex; flex-wrap: wrap; gap: 5px; }
        .bcp-segment button {
          min-height: 34px; padding: 6px 10px;
          border: 1px solid var(--adm-line, #d8d3c8); border-radius: 8px;
          background: var(--adm-card, #fff); color: var(--adm-ink, #111);
          font: inherit; font-size: 12px; cursor: pointer;
        }
        .bcp-segment button[aria-pressed="true"] {
          border-color: #111; background: #111; color: #fff;
        }
        .bcp-card-picks {
          display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
          padding: 7px 9px; border: 1px solid var(--adm-line, #d8d3c8);
          border-radius: 9px;
        }
        .bcp-card-picks__title { color: var(--adm-muted, #6b6455); font-size: 11px; font-weight: 750; }
        .bcp-simple-label {
          display: inline-flex; align-items: center; gap: 7px;
          color: var(--adm-ink, #222); font-size: 12px; cursor: pointer;
        }
        .bcp-number-input {
          width: 66px; min-height: 34px; padding: 5px 8px;
          border: 1px solid var(--adm-line, #d8d3c8); border-radius: 8px;
          background: var(--adm-card, #fff); color: var(--adm-ink, #111); font: inherit;
        }
        .bcp-range {
          display: grid; grid-template-columns: auto minmax(100px, 170px) auto;
          gap: 8px; align-items: center; min-width: min(100%, 300px);
          color: var(--adm-ink, #222); font-size: 12px;
        }
        .bcp-range input { width: 100%; margin: 0; accent-color: #111; }
        .bcp-range output { min-width: 38px; text-align: right; font-weight: 700; }
        .bcp-print-summary { color: var(--adm-muted, #6b6455); font-size: 12px; }
        .bcp-preview-caption {
          display: flex; flex-wrap: wrap; justify-content: space-between;
          align-items: center; gap: 8px; color: var(--adm-muted, #6b6455); font-size: 12px;
        }
        .bcp-stage {
          display: flex; flex-direction: column; align-items: center; gap: 18px;
          max-height: 76vh; padding: 18px 12px; overflow: auto;
          border-radius: 14px; background: #e6e4de;
        }
        .bcp-sheet {
          box-sizing: border-box;
          position: relative; display: flex; flex-direction: column;
          width: min(100%, var(--bcp-page-width));
          aspect-ratio: var(--bcp-page-ratio);
          max-height: min(90vh, var(--bcp-page-height));
          overflow: hidden; background: #fff; color: #0a0a0a;
          box-shadow: 0 12px 40px rgba(0,0,0,.14);
          font-family: "Inter", Arial, sans-serif;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .bcp-inner {
          box-sizing: border-box; display: flex; flex: 1 1 auto; flex-direction: column;
          gap: 4mm; width: 100%; height: 100%; min-height: 0;
          padding: var(--bcp-page-padding);
        }
        .bcp-page-heading {
          display: flex; flex: 0 0 auto; justify-content: space-between; align-items: flex-end;
          gap: 8mm; min-width: 0; padding-bottom: 3mm; border-bottom: 1px solid #c8c8c8;
        }
        .bcp-brand-block { min-width: 0; }
        .bcp-company {
          max-width: 100%; overflow: hidden; color: #555; font-size: 13px;
          font-weight: 800; letter-spacing: .08em; text-overflow: ellipsis;
          text-transform: uppercase; white-space: nowrap;
        }
        .bcp-page-title {
          margin-top: 2px; font-size: clamp(18px, 2.1vw, 30px);
          font-weight: 800; letter-spacing: .015em; line-height: 1.1;
        }
        .bcp-page-mark {
          flex: 0 0 auto; color: #666; font-size: 10px; font-weight: 800;
          letter-spacing: .12em; text-align: right; text-transform: uppercase;
        }
        .bcp-card-grid {
          display: grid; flex: 1 1 auto; grid-template-columns: repeat(var(--bcp-columns), minmax(0, 1fr));
          grid-auto-rows: minmax(0, 1fr); gap: 5mm; min-width: 0; min-height: 0;
        }
        .bcp-card {
          container-type: inline-size;
          box-sizing: border-box; display: flex; flex-direction: column; gap: 3mm;
          min-width: 0; min-height: 0; padding: clamp(3mm, 1.25cqw, 7mm);
          overflow: hidden; border: 1.2px solid #181818; border-radius: 2mm;
          background: #fff;
        }
        .bcp-card-heading {
          display: flex; flex: 0 0 auto; align-items: center; gap: 2mm;
          min-width: 0; padding-bottom: 2mm; border-bottom: 1px solid #c8c8c8;
        }
        .bcp-card-heading svg { flex: 0 0 auto; }
        .bcp-card-heading h2 {
          min-width: 0; margin: 0; overflow: hidden; font-size: clamp(15px, 3.2cqw, 25px);
          font-weight: 800; letter-spacing: .04em; text-overflow: ellipsis; text-transform: uppercase;
          white-space: nowrap;
        }
        .bcp-card-fields {
          display: grid; align-content: start; gap: clamp(2mm, .75cqw, 4mm);
          min-width: 0; min-height: 0;
        }
        .bcp-field { display: grid; gap: 1mm; min-width: 0; }
        .bcp-field-label {
          display: flex; align-items: center; gap: 1.5mm; min-width: 0;
          color: #666; font-size: clamp(9px, 1.8cqw, 13px); font-weight: 800;
          letter-spacing: .12em; line-height: 1.1; text-transform: uppercase;
        }
        .bcp-field-label svg { flex: 0 0 auto; }
        .bcp-value {
          min-width: 0; color: #090909; font-family: "Oswald", "Arial Narrow", Arial, sans-serif;
          font-weight: 700; line-height: 1.08;
        }
        .bcp-value--number {
          width: 100%; font-size: clamp(14px, var(--bcp-number-fit), var(--bcp-number-max));
          font-variant-numeric: tabular-nums; letter-spacing: .025em;
          white-space: nowrap !important; word-break: normal !important;
          overflow-wrap: normal !important;
        }
        .bcp-value--regular {
          font-size: clamp(15px, 4.4cqw, 42px); overflow-wrap: anywhere;
        }
        .bcp-page-footer {
          display: flex; flex: 0 0 auto; justify-content: space-between; gap: 8px;
          padding-top: 2.5mm; border-top: 1px solid #c8c8c8; color: #555;
          font-size: 10px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase;
        }
        .bcp-empty {
          padding: 14px; border: 1px dashed var(--adm-line, #d8d3c8);
          border-radius: 10px; color: var(--adm-muted, #6b6455); font-size: 13px; line-height: 1.5;
        }
        .bcp-print-host { display: none; }

        @media print {
          @page { size: A4 ${orientation}; margin: 0; }
          html, body {
            display: block !important; width: auto !important; height: auto !important;
            min-height: 0 !important; margin: 0 !important; padding: 0 !important;
            overflow: visible !important; background: #fff !important;
            -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
          }
          body.bcp-print-mode > :not(.bcp-print-host) { display: none !important; }
          body.bcp-print-mode > .bcp-print-host {
            display: block !important; position: static !important; width: 100% !important;
            height: auto !important; max-width: none !important; margin: 0 !important;
            padding: 0 !important; overflow: visible !important; background: #fff !important;
          }
          body.bcp-print-mode .bcp-print-host,
          body.bcp-print-mode .bcp-print-host * { visibility: visible !important; }
          body.bcp-print-mode .bcp-stage--print {
            display: block !important; width: 100% !important; max-height: none !important;
            margin: 0 !important; padding: 0 !important; overflow: visible !important;
            border-radius: 0 !important; background: #fff !important;
          }
          body.bcp-print-mode .bcp-sheet {
            width: var(--bcp-page-width) !important; height: var(--bcp-page-height) !important;
            max-width: none !important; max-height: none !important; min-height: 0 !important;
            aspect-ratio: auto !important; margin: 0 !important; border: 0 !important;
            border-radius: 0 !important; box-shadow: none !important;
            break-inside: avoid; page-break-inside: avoid;
            break-after: page; page-break-after: always;
          }
          body.bcp-print-mode .bcp-sheet--last {
            break-after: auto; page-break-after: auto;
          }
        }

        @media (max-width: 640px) {
          .bcp-controls { padding: 10px; }
          .bcp-range { grid-template-columns: 1fr auto; width: 100%; }
          .bcp-range input { grid-column: 1 / -1; grid-row: 2; }
          .bcp-stage { padding: 10px 6px; }
          .bcp-page-mark { display: none; }
          .bcp-page-title { font-size: 16px; }
        }
      `}</style>

      <section className="bcp-controls bcp-no-print" aria-label="Настройки печати данных карты">
        <div className="bcp-toolbar">
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={handlePrint}
            disabled={!portalTarget || pages.length === 0}
            title="Печать настроенных листов A4"
          >
            <Printer size={15} /> Печать A4 · {pages.length} {pageWord(pages.length)}
          </button>

          <div className="bcp-card-picks" role="group" aria-label="Карты для печати">
            <span className="bcp-card-picks__title">Карты:</span>
            {cards.map((card) => (
              <label key={card.id} className="bcp-simple-label">
                <input
                  type="checkbox"
                  checked={selected[card.id] !== false}
                  onChange={() => toggleCard(card.id)}
                />
                {card.label}
              </label>
            ))}
          </div>
        </div>

        <div className="bcp-control-row">
          <div className="bcp-control-group">
            <span className="bcp-control-title">Ориентация A4</span>
            <div className="bcp-segment" role="group" aria-label="Ориентация листа A4">
              <button
                type="button"
                aria-pressed={orientation === "portrait"}
                onClick={() => setOrientation("portrait")}
              >
                Книжная
              </button>
              <button
                type="button"
                aria-pressed={orientation === "landscape"}
                onClick={() => setOrientation("landscape")}
              >
                Альбомная
              </button>
            </div>
          </div>

          <div className="bcp-control-group">
            <span className="bcp-control-title">Размещение</span>
            <div className="bcp-segment" role="group" aria-label="Размещение карт по страницам">
              <button
                type="button"
                aria-pressed={layout === "one-page"}
                onClick={() => setLayout("one-page")}
              >
                Все на одном листе
              </button>
              <button
                type="button"
                aria-pressed={layout === "one-card-per-page"}
                onClick={() => setLayout("one-card-per-page")}
              >
                Отдельный лист на карту
              </button>
            </div>
          </div>

          <label className="bcp-simple-label">
            Копий
            <input
              className="bcp-number-input"
              type="number"
              min={1}
              max={10}
              value={copies}
              onChange={(event) =>
                setCopies(Math.max(1, Math.min(10, Number(event.target.value) || 1)))
              }
              aria-label="Количество копий"
            />
          </label>
        </div>

        <div className="bcp-control-row">
          <label className="bcp-range">
            <span>Размер номера</span>
            <input
              type="range"
              min={38}
              max={108}
              step={2}
              value={numberFontMax}
              onChange={(event) => setNumberFontMax(Number(event.target.value))}
              aria-label="Максимальный размер номера карты"
            />
            <output>{numberFontMax} px</output>
          </label>
          <label className="bcp-range">
            <span>Поля листа</span>
            <input
              type="range"
              min={4}
              max={20}
              step={1}
              value={pageMarginMm}
              onChange={(event) => setPageMarginMm(Number(event.target.value))}
              aria-label="Внутренние поля листа в миллиметрах"
            />
            <output>{pageMarginMm} мм</output>
          </label>
          <div className="bcp-toggles" role="group" aria-label="Показывать на листе">
            <span className="bcp-control-title">Показывать:</span>
            <label className="bcp-simple-label">
              <input
                type="checkbox"
                checked={visibleFields.holder}
                onChange={(event) => setFieldVisible("holder", event.target.checked)}
              />
              Получателя
            </label>
            <label className="bcp-simple-label">
              <input
                type="checkbox"
                checked={visibleFields.phone}
                onChange={(event) => setFieldVisible("phone", event.target.checked)}
              />
              Телефон
            </label>
            <label className="bcp-simple-label">
              <input
                type="checkbox"
                checked={visibleFields.bank}
                onChange={(event) => setFieldVisible("bank", event.target.checked)}
              />
              Банк
            </label>
          </div>
        </div>

        <div className="bcp-print-summary" aria-live="polite">
          Будет напечатано: <b>{pages.length} {pageWord(pages.length)}</b>. В режиме «Все на одном листе»
          отмеченные карты печатаются на одной странице A4.
        </div>
      </section>

      {toPrint.length === 0 ? (
        <div className="bcp-empty bcp-no-print">Отметьте хотя бы одну карту для печати.</div>
      ) : (
        <>
          <div className="bcp-preview-caption bcp-no-print">
            <strong>Предпросмотр · {pages.length} {pageWord(pages.length)} A4</strong>
            <span>{orientation === "landscape" ? "Альбомная" : "Книжная"} · номер автоматически помещается в одну строку</span>
          </div>
          <div className="bcp-stage bcp-stage--preview bcp-no-print" aria-label="Предпросмотр листов A4">
            {renderPages("preview")}
          </div>
        </>
      )}

      {portalTarget
        ? createPortal(
            <div className="bcp-print-host" aria-hidden="true">
              <div className="bcp-stage bcp-stage--print">{renderPages("print")}</div>
            </div>,
            portalTarget
          )
        : null}
    </div>
  );
}
