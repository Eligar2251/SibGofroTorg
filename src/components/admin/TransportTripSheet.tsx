// =========================================================
// FILE: src/components/admin/TransportTripSheet.tsx
// ПУТЕВОЙ ЛИСТ водителя: А4, точки маршрута идут СВЕРХУ ВНИЗ по порядку
// (1 → N), как в бланке доставок: крупный номер, пометка операции
// (ЗАБОР / ДОСТАВКА / СДАЧА), адрес, телефон, контактное лицо, груз,
// инструкция водителю и место под отметку «принял/сдал · время».
//
// Логика полей повторяет бланк доставок (DeliveryPrintSheet) и полоски
// под УПД (TransportPrintSheet): адрес и телефон — самыми крупных
// размерами, контакт выделен, заметка курьеру — отдельным блоком.
// Отличие: это один лист на всю перевозку, а не отрывные полоски,
// поэтому карточки плотные и пронумерованы по фактическому маршруту.
//
// Настройки печати (груз подробно/кратко/без грузов, отметки,
// инструкции, «максимально компактно», подвал приём/сдача, шапка
// с реквизитами) запоминаются в localStorage — следующий лист
// печатается так же. Пустые поля (телефон, контакт, инструкция)
// не печатаются вовсе — без прочерков «—».
// =========================================================
"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { SITE_ADDRESS, SITE_HOURS_LABEL, SITE_PHONE } from "@/lib/site-config";
import { SITE_NAME } from "@/lib/seo";
import { ModalPortal } from "./ModalPortal";
import {
  isWpStop,
  stopLoadedLines,
  stopOperation,
  stopTitle,
  stopTotalQty,
  summarizeStops,
  tripTypeDef,
  type TripStop,
} from "@/lib/trip-stops";

export interface TripSheetData {
  transportNumber: number;
  date: string | null;
  /** Заметка ко всей перевозке — печатается в шапке */
  note?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  /** Порядок массива = порядок точек в бланке */
  stops: TripStop[];
  companyPhone?: string;
  companyAddress?: string;
}

type GoodsMode = "full" | "short" | "none";

const OPTIONS_KEY = "trip_sheet_print_options";

interface SheetOptions {
  goods: GoodsMode;
  dense: boolean;
  signs: boolean;
  footSigns: boolean;
  instructions: boolean;
  showTime: boolean;
  contacts: boolean;
  vehicle: string;
  issuedBy: string;
}

const DEFAULT_OPTIONS: SheetOptions = {
  goods: "full",
  dense: false,
  signs: true,
  footSigns: true,
  instructions: true,
  showTime: true,
  contacts: true,
  vehicle: "",
  issuedBy: "",
};

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}.${m}.${y}` : iso;
}

export function TransportTripSheet({
  data,
  onDone,
}: {
  data: TripSheetData;
  onDone?: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  const [opts, setOpts] = useState<SheetOptions>(DEFAULT_OPTIONS);
  const [baseAfter, setBaseAfter] = useState<number[]>([]);
  const triggered = useRef(false);

  // Бланк печатают каждый день по несколько раз — настройки помним.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPTIONS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SheetOptions>;
      setOpts((prev) => ({ ...prev, ...parsed }));
    } catch {
      /* пусто/бито — не страшно */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(opts));
    } catch {
      /* приватный режим — не запоминаем */
    }
  }, [opts]);

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;
    const prev = document.title;
    document.title = data.transportNumber
      ? `Путевой лист ПЕР-${data.transportNumber}`
      : "Путевой лист (черновик)";
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
    requestAnimationFrame(() => window.print());
  }

  function patch(next: Partial<SheetOptions>) {
    setOpts((prev) => ({ ...prev, ...next }));
  }

  const companyName = SITE_NAME;
  const officePhone = data.companyPhone || SITE_PHONE;
  const officeAddress = data.companyAddress || SITE_ADDRESS;

  // Печатаем только то, что реально едет: груз с qty > 0 (или точка,
  // где указали адрес — например, «заехать за поддонами, груз уточним»).
  const stops = data.stops
    .map((stop) => ({ ...stop, lines: stopLoadedLines(stop) }))
    .filter((stop) => stop.lines.length > 0 || !!stop.address?.trim());
  const totals = summarizeStops(stops);

  // Лист живёт в портале у <body>: при печати прячем всё остальное через
  // display:none, а сам лист идёт обычным потоком — страницы нумеруются
  // естественно (1, при переполнении 2, 3), без дублей. Старый подход
  // (position:fixed + visibility) в хроме печатал fixed-блок на КАЖДОЙ
  // странице, а скрытый контент админки под ним создавал лишние листы.
  return (
    <ModalPortal>
    <div className="deliv-print-root tls-root">
      <style>{PRINT_CSS}</style>

      {!printing && (
        <div className="tls-toolbar">
          <button type="button" className="tls-toolbar__print" onClick={doPrint}>
            🖨 Печать путевого листа
          </button>

          <label className="tls-toolbar__group">
            <span>Груз</span>
            <select value={opts.goods} onChange={(e) => patch({ goods: e.target.value as GoodsMode })}>
              <option value="full">— списком</option>
              <option value="short">— одной строкой</option>
              <option value="none">— не печатать (только адреса)</option>
            </select>
          </label>

          <label className="tls-toolbar__check">
            <input type="checkbox" checked={opts.contacts} onChange={(e) => patch({ contacts: e.target.checked })} />
            Телефон и контактное лицо
          </label>
          <label className="tls-toolbar__check">
            <input type="checkbox" checked={opts.instructions} onChange={(e) => patch({ instructions: e.target.checked })} />
            Инструкции и примечания
          </label>
          <label className="tls-toolbar__check">
            <input type="checkbox" checked={opts.signs} onChange={(e) => patch({ signs: e.target.checked })} />
            Строки подписи
          </label>
          <label className="tls-toolbar__check">
            <input type="checkbox" checked={opts.footSigns} onChange={(e) => patch({ footSigns: e.target.checked })} />
            Приём/сдача и выезд в подвале
          </label>
          <label className="tls-toolbar__check">
            <input type="checkbox" checked={opts.showTime} onChange={(e) => patch({ showTime: e.target.checked })} />
            Время
          </label>
          <label className="tls-toolbar__check">
            <input type="checkbox" checked={opts.dense} onChange={(e) => patch({ dense: e.target.checked })} />
            Максимально компактно
          </label>

          <input
            className="tls-toolbar__text"
            placeholder="Авто / гос. номер"
            value={opts.vehicle}
            onChange={(e) => patch({ vehicle: e.target.value })}
          />
          <input
            className="tls-toolbar__text"
            placeholder="Выдал (фамилия)"
            value={opts.issuedBy}
            onChange={(e) => patch({ issuedBy: e.target.value })}
          />

          <button type="button" onClick={() => onDone?.()}>
            ✕ Закрыть
          </button>
        </div>
      )}

      <div className={`tls${opts.dense ? " tls--dense" : ""}`}>
        {/* ── Шапка документа ── */}
        <div className="tls-head">
          <div className="tls-head__left">
            <div className="tls-doct">ПУТЕВОЙ ЛИСТ</div>
            <div className="tls-doct-sub">
              {data.transportNumber ? `№ ПЕР-${data.transportNumber}` : "№ ___ (черновик)"} · дата{" "}
              {fmtDate(data.date)}
            </div>
            <div className="tls-org">
              {companyName} · склад: {officeAddress}
            </div>
            <div className="tls-org">
              Диспетчер: {officePhone} · {SITE_HOURS_LABEL}
            </div>
          </div>
          <div className="tls-head__right">
            <div className="tls-line">
              <span className="tls-k">Водитель</span>
              <span className="tls-v">{data.driverName || "_______________"}</span>
            </div>
            <div className="tls-line">
              <span className="tls-k">Тел. водителя</span>
              <span className="tls-v">{data.driverPhone || "_______________"}</span>
            </div>
            <div className="tls-line">
              <span className="tls-k">Авто / гос. №</span>
              <span className="tls-v">{opts.vehicle || "_______________"}</span>
            </div>
            <div className="tls-line">
              <span className="tls-k">Маршрут</span>
              <span className="tls-v">
                склад → {totals.total} точ. → склад · {totals.qty} ед.
                {totals.kg > 0 ? ` · ${totals.kg} кг макулатуры` : ""}
              </span>
            </div>
          </div>
        </div>

        {data.note && opts.instructions && <div className="tls-note">📝 {data.note}</div>}



        {/* ── Точки по порядку ── */}
        <div className="tls-stops">
          {stops.map((stop, index) => {
            const type = tripTypeDef(stop.tripType);
            // Пометка с предметом операции: «ЗАБОР МАКУЛАТУРЫ»,
            // «ЗАБОР ТОВАРА», «ДОСТАВКА ЗАКАЗА» — водитель видит,
            // что именно он делает в этой точке.
            const op = stopOperation(stop);
            const qty = stopTotalQty(stop);
            const note = stop.deliveryNote?.trim() || null;
            const isLast = index === stops.length - 1;
            const wp = isWpStop(stop);
            return (
              <Fragment key={stop.key}>
              <article className={`tls-strip tls-strip--${type.id}`}>
                {/* Номер точки — читается издалека, через лобовое стекло */}
                <div className="tls-strip__num">
                  <span className="tls-strip__num-big">{index + 1}</span>
                  <span className="tls-strip__num-total">из {stops.length}</span>
                  <span className="tls-strip__num-qty">
                    {wp && qty === 0 ? (
                      <span className="tls-strip__num-qty-hint">вес уточним</span>
                    ) : (
                      <>
                        {qty}
                        <span className="tls-strip__num-qty-unit">{wp ? "кг" : "ед."}</span>
                      </>
                    )}
                  </span>
                </div>

                <div className="tls-strip__body">
                  {/* Кем и зачем приехали */}
                  <div className="tls-strip__row tls-strip__row--head">
                    <span className={`tls-mark tls-mark--${type.id}`}>
                      {op.icon} {op.mark}
                    </span>
                    <span className="tls-strip__client">{stop.customerName || "без названия"}</span>
                    {stop.kind === "deal" && stop.dealNumber ? (
                      <span className="tls-strip__deal">ЗК-{stop.dealNumber}</span>
                    ) : null}
                    {/* Макулатура (ПМ-/СМ-) и забор поставки (ПО-) — номер
                        документа рядом с контрагентом: водитель и приёмка
                        говорят об одном документе. */}
                    {stop.kind !== "deal" && stop.kind !== "custom" ? (
                      <span className="tls-strip__deal">{stopTitle(stop)}</span>
                    ) : null}
                    {opts.showTime && stop.plannedTime ? (
                      <span className="tls-strip__time">⏱ {stop.plannedTime}</span>
                    ) : null}
                  </div>

                  {/* Адрес — самое крупное после номера */}
                  <div className="tls-strip__row tls-strip__row--addr">
                    <span className="tls-strip__k">Адрес</span>
                    <span className="tls-strip__addr">{stop.address || "адрес уточнить у диспетчера"}</span>
                  </div>

                  {/* Связь на точке: показываем только то, что есть.
                      Нет телефона — одно поле «Телефон: ___», чтобы водитель
                      вписал его рукой; нет контакта — блока «Контакт» нет. */}
                  {opts.contacts && (
                    <div className="tls-strip__row tls-strip__row--contacts">
                      {stop.phone?.trim() ? (
                        <span>
                          <span className="tls-strip__k">Тел.</span>{" "}
                          <span className="tls-strip__phone">{stop.phone.trim()}</span>
                        </span>
                      ) : null}
                      {stop.contactName?.trim() ? (
                        <span>
                          <span className="tls-strip__k">Контакт</span>{" "}
                          <span className="tls-strip__contact">{stop.contactName.trim()}</span>
                        </span>
                      ) : null}
                      {!stop.phone?.trim() && (
                        <span className="tls-strip__duty tls-strip__duty--alert">Телефон: __________________</span>
                      )}
                    </div>
                  )}

                  {/* Груз */}
                  {opts.goods !== "none" && stop.lines.length > 0 && (
                    <div className="tls-strip__cargo">
                      {opts.goods === "short" ? (
                        <span className="tls-strip__cargo-line">
                          {stop.lines
                            .map((l) =>
                              wp && l.qty === 0
                                ? `${l.name || "без названия"} — вес уточним`
                                : `${l.name || "без названия"} — ${l.qty}${wp ? " кг" : ""}`
                            )
                            .join(" · ")}
                        </span>
                      ) : (
                        <span className="tls-strip__cargo-list">
                          {stop.lines.map((l, i) => (
                            <span className="tls-strip__cargo-item" key={i}>
                              <span className="tls-strip__cargo-name">{l.name || "без названия"}</span>
                              <span className="tls-strip__cargo-qty">
                                {wp && l.qty === 0 ? (
                                  <span className="tls-strip__cargo-hint">
                                    вес уточним на месте
                                  </span>
                                ) : (
                                  <>
                                    {l.qty}{" "}
                                    <span className="tls-strip__cargo-unit">
                                      {l.unit || (wp ? "кг" : "ед.")}
                                    </span>
                                  </>
                                )}
                              </span>
                              {l.orderedQty != null && l.orderedQty !== l.qty ? (
                                <span className="tls-strip__cargo-ordered">
                                  {wp
                                    ? `в документе ${l.orderedQty} кг · остаток ${l.orderedQty - l.qty} кг`
                                    : `заказано ${l.orderedQty} · не хватает ${l.orderedQty - l.qty}`}
                                </span>
                              ) : null}
                            </span>
                          ))}
                        </span>
                      )}
                      {stop.totalSum ? (
                        <span className="tls-strip__sum">
                          оплата на месте: {Number(stop.totalSum).toLocaleString("ru-RU")} ₽
                        </span>
                      ) : null}
                    </div>
                  )}

                  {/* Инструкция водителю: только если диспетчер что-то написал */}
                  {opts.instructions && note && (
                    <div className="tls-strip__instr">
                      <span className="tls-strip__instr-k">Инструкция</span>
                      <span className="tls-strip__instr-v">
                        <span className="tls-strip__instr-custom">{note}</span>
                      </span>
                    </div>
                  )}

                  {/* Отметка водителя */}
                  {opts.signs && (
                    <div className="tls-strip__signs">
                      <span className="tls-strip__sign">
                        {type.id === "pickup" ? "Груз принял" : "Груз сдал / вручил"}{" "}
                        <span className="tls-strip__underline" />
                      </span>
                      <span className="tls-strip__sign">
                        {opts.showTime && <>Время <span className="tls-strip__underline tls-strip__underline--short" /></>}
                      </span>
                      <span className="tls-strip__sign">
                        Проблемы: <span className="tls-strip__checks">☐ нет ☐ есть</span>
                      </span>
                    </div>
                  )}
                </div>
                {!isLast && !printing && <button type="button" className="tls-base-button" onClick={() => setBaseAfter((v) => v.includes(index) ? v.filter((n) => n !== index) : [...v, index])}>{baseAfter.includes(index) ? "↩ Убрать возврат на базу" : "↩ Вернуться на базу после этой точки"}</button>}
              </article>
              {baseAfter.includes(index) && <div className="tls-base-break">↩ ВЕРНУТЬСЯ НА БАЗУ</div>}
              {!isLast && !baseAfter.includes(index) && (
                <div className="tls-next" aria-hidden>
                  ↓ точка {index + 2}
                </div>
              )}
              </Fragment>
            );
          })}
        </div>

        {/* ── Подвал ── */}
        <div className="tls-foot">
          <div className="tls-totals">
            <span>
              Точек: <strong>{totals.total}</strong>
            </span>
            <span>
              забор: <strong>{totals.byType.pickup}</strong> · доставка:{" "}
              <strong>{totals.byType.delivery}</strong> · сдача: <strong>{totals.byType.handover}</strong>
            </span>
            <span>
              позиций: <strong>{totals.positions}</strong> · единиц: <strong>{totals.qty}</strong>
              {totals.kg > 0 ? (
                <>
                  {" "}· макулатура: <strong>{totals.kg} кг</strong>
                </>
              ) : null}
            </span>
          </div>

          {opts.footSigns && (
            <div className="tls-signs">
              <span className="tls-sign">
                <span className="tls-sign__k">Груз принял/сдал</span>
                <span className="tls-sign__line" />
              </span>
              <span className="tls-sign">
                <span className="tls-sign__k">Тара и возврат ТМЦ</span>
                <span className="tls-sign__checks">☐ нет ☐ есть:</span>
              </span>
              <span className="tls-sign">
                <span className="tls-sign__k">Выдал{opts.issuedBy ? ` ${opts.issuedBy}` : ""}</span>
                <span className="tls-sign__line" />
              </span>
              <span className="tls-sign">
                <span className="tls-sign__k">Выезд</span> ___:___
                <span className="tls-sign__k"> · заезд</span> ___:___
                <span className="tls-sign__k"> · пробег</span> ___ км
              </span>
            </div>
          )}

          <div className="tls-legal">
            Водитель отвечает за сохранность груза с момента получения до выдачи получателю.
            Груз не приняли / адрес не нашли / точку переносят — сразу сообщить диспетчеру:{" "}
            {officePhone}.
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

const PRINT_CSS = `
@media screen {
  /* Лист — полноэкранный оверлей поверх админки (он в портале у body) */
  .deliv-print-root.tls-root { position: fixed; inset: 0; z-index: 100000; overflow-y: auto; -webkit-overflow-scrolling: touch; background: #fff; padding: 76px 24px 24px; }
  .tls { max-width: 210mm; margin: 0 auto; background: #fff; padding: 8mm; box-shadow: 0 2px 20px rgba(0,0,0,0.12); border-radius: 4px; }
  .tls-toolbar { position: fixed; top: 0; left: 0; right: 0; z-index: 100000; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 14px; background: rgba(26,26,24,0.96); color: #fff; font-family: system-ui, sans-serif; font-size: 12px; }
  .tls-toolbar button, .tls-toolbar select, .tls-toolbar input { font: inherit; }
  .tls-toolbar__print { padding: 8px 14px; background: var(--adm-kraft, #c8860a); color: #fff; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; }
  .tls-toolbar button:not(.tls-toolbar__print) { padding: 7px 12px; background: #3a3a36; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  .tls-toolbar__group { display: inline-flex; align-items: center; gap: 6px; }
  .tls-toolbar__group select { padding: 6px 8px; border-radius: 6px; border: 1px solid #55524c; background: #26262a; color: #fff; }
  .tls-toolbar__check { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
  .tls-toolbar__text { padding: 7px 9px; border-radius: 6px; border: 1px solid #55524c; background: #fff; color: #1a1a18; min-width: 120px; }
}
@media print {
  @page { size: A4 portrait; margin: 7mm 8mm; }
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  /* Портал блокирует скролл через body{position:fixed} — в печати это
     режет и дублирует страницы, поэтому возвращаем обычный поток. */
  body:has(.tls-root) { position: static !important; top: auto !important; left: auto !important; right: auto !important; width: auto !important; overflow: visible !important; }
  /* Печатается ТОЛЬКО лист: всё остальное выкидываем из потока.
     visibility здесь не годится — скрытые блоки оставляют высоту и
     дают пустые листы, а fixed-блок хром повторяет на каждой странице. */
  body:has(.tls-root) > :not(#admin-modal-root) { display: none !important; }
  body:has(.tls-root) #admin-modal-root > :not(.tls-root) { display: none !important; }
  .deliv-print-root.tls-root { position: static !important; inset: auto !important; width: auto !important; max-width: none !important; background: #fff !important; padding: 0 !important; margin: 0 !important; overflow: visible !important; z-index: auto !important; }
  .tls { max-width: none !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
  .tls-toolbar, .tls-base-button { display: none !important; }
  .tls-base-break { break-before: auto; page-break-inside: avoid; }
  /* Карточка точки не рвётся между страницами: не влезла — целиком едет
     на следующий лист. Водителю важна целостность точки. */
  .tls-strip { break-inside: avoid; page-break-inside: avoid; }
  .tls-foot { break-inside: avoid; page-break-inside: avoid; }
  .tls-head { break-after: avoid; page-break-after: avoid; }
  .tls-note { break-inside: avoid; page-break-inside: avoid; }
}

.tls { font-family: Arial, Helvetica, sans-serif; color: #211f1c; font-size: 10px; line-height: 1.25; }
.tls--dense { font-size: 9px; }

/* ── Шапка ── */
.tls-head { display: flex; justify-content: space-between; gap: 4mm; align-items: flex-start; border-bottom: 1.6pt solid #211f1c; padding-bottom: 1.8mm; }
.tls-head__left { min-width: 0; }
.tls-doct { font-size: 20px; font-weight: 800; letter-spacing: 0.06em; }
.tls-doct-sub { font-size: 11px; font-weight: 700; margin-top: 0.5mm; }
.tls-org { font-size: 8.5px; color: #6d675e; margin-top: 0.5mm; }
.tls-head__right { flex: 1 1 auto; max-width: 92mm; display: grid; grid-template-columns: 1fr 1fr; gap: 0.3mm 3mm; }
.tls-line { display: flex; align-items: baseline; gap: 1.5mm; border-bottom: 0.3pt dotted #b9b2a6; min-width: 0; }
.tls-line .tls-v { overflow-wrap: anywhere; min-width: 0; }
.tls-k { font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #8c857a; flex-shrink: 0; }
.tls-v { font-size: 10.5px; font-weight: 700; }
.tls-note { margin-top: 1.4mm; padding: 1.2mm 2mm; background: #fdf8ec; border-left: 1mm solid #e0b84f; font-size: 9.5px; font-weight: 700; white-space: pre-line; }

/* ── Карточка точки ── */
.tls-stops { margin-top: 2mm; display: flex; flex-direction: column; gap: 1.6mm; }
.tls--dense .tls-stops { gap: 1mm; }
.tls-strip { display: flex; gap: 0; border: 0.7pt solid #6d675e; border-radius: 1.4mm; overflow: hidden; }
.tls-strip--pickup { border-left: 1.6mm solid #1d4ed8; }
.tls-strip--delivery { border-left: 1.6mm solid #1e4a2d; }
.tls-strip--handover { border-left: 1.6mm solid #6d28d9; }

.tls-strip__num { flex: 0 0 16mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.4mm; border-right: 0.4pt dashed #b9b2a6; padding: 1.2mm 0.5mm; }
.tls-strip__num-big { font-size: 24px; font-weight: 800; line-height: 0.95; letter-spacing: -0.02em; }
.tls-strip__num-total { font-size: 7px; color: #8c857a; text-transform: uppercase; letter-spacing: 0.04em; }
.tls-strip__num-qty { margin-top: 0.8mm; font-size: 14px; font-weight: 800; line-height: 1; }
.tls-strip__num-qty-unit { font-size: 7.5px; font-weight: 600; margin-left: 0.6mm; color: #8c857a; }
.tls--dense .tls-strip__num-big { font-size: 19px; }
.tls--dense .tls-strip__num-qty { font-size: 12px; }
.tls--dense .tls-strip__num { flex-basis: 13mm; }

.tls-strip__body { flex: 1 1 auto; min-width: 0; padding: 1.6mm 2.4mm; display: flex; flex-direction: column; gap: 1mm; }
.tls--dense .tls-strip__body { padding: 1mm 1.8mm; gap: 0.6mm; }

.tls-strip__row { display: flex; align-items: baseline; gap: 2mm; flex-wrap: wrap; }
.tls-strip__row--head { border-bottom: 0.4pt solid #ddd8cd; padding-bottom: 0.8mm; }
.tls-mark { display: inline-block; font-size: 9px; font-weight: 800; letter-spacing: 0.04em; padding: 0.5mm 1.6mm; border-radius: 0.8mm; color: #fff; white-space: nowrap; }
.tls-mark--delivery { background: #1e4a2d; }
.tls-mark--pickup { background: #1d4ed8; }
.tls-mark--handover { background: #6d28d9; }
.tls-strip__client { font-size: 12.5px; font-weight: 800; overflow-wrap: anywhere; }
.tls-strip__deal { font-size: 9px; font-weight: 700; color: #6d675e; border: 0.4pt solid #b9b2a6; border-radius: 0.8mm; padding: 0 1mm; }
.tls-strip__time { margin-left: auto; font-size: 12px; font-weight: 800; color: #b83a1e; white-space: nowrap; }

.tls-strip__k { font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #8c857a; font-weight: 700; white-space: nowrap; }
.tls-strip__addr { font-size: 14px; font-weight: 800; line-height: 1.15; overflow-wrap: anywhere; }
.tls--dense .tls-strip__addr { font-size: 11.5px; }
.tls-strip__phone { font-size: 13px; font-weight: 800; letter-spacing: 0.01em; white-space: nowrap; }
.tls--dense .tls-strip__phone { font-size: 11px; }
.tls-strip__contact { font-size: 11px; font-weight: 700; }
.tls-strip__row--contacts { gap: 4mm; }
.tls-strip__duty { margin-left: auto; }
.tls-strip__duty-action { font-size: 9.5px; font-weight: 700; color: #1e4a2d; }
.tls-strip__duty--alert .tls-strip__k { color: #b83a1e; }
.tls-strip__duty--alert .tls-strip__duty-action { color: #b83a1e; }

.tls-strip__cargo { border-top: 0.4pt dotted #ddd8cd; padding-top: 0.9mm; }
.tls-strip__cargo-list { display: block; }
.tls-strip__cargo-item { display: flex; align-items: baseline; gap: 1.5mm; font-size: 10px; padding: 0.25mm 0; }
.tls-strip__cargo-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.tls-strip__cargo-qty { font-weight: 800; white-space: nowrap; }
.tls-strip__cargo-hint { font-weight: 700; font-style: italic; white-space: nowrap; }
.tls-strip__num-qty-hint { font-size: 8px; font-weight: 700; font-style: italic; }
.tls-strip__cargo-unit { font-size: 7.5px; color: #8c857a; font-weight: 600; }
.tls-strip__cargo-ordered { font-size: 8px; color: #b83a1e; white-space: nowrap; }
.tls-strip__cargo-line { font-size: 10px; font-weight: 600; overflow-wrap: anywhere; }
.tls-strip__sum { display: block; margin-top: 0.5mm; font-size: 8.5px; color: #6d675e; }

.tls-strip__instr { display: flex; gap: 2mm; align-items: baseline; padding: 1mm 1.6mm; background: #fdf8ec; border-left: 0.9mm solid #e0b84f; border-radius: 0.6mm; }
.tls-strip__instr-k { font-size: 7.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #a97c14; flex-shrink: 0; }
.tls-strip__instr-v { font-size: 10px; line-height: 1.2; overflow-wrap: anywhere; min-width: 0; }
.tls-strip__instr-custom { display: block; font-weight: 800; white-space: pre-line; }
.tls--dense .tls-strip__instr-v { font-size: 9px; }

.tls-strip__signs { display: flex; flex-wrap: wrap; gap: 1mm 6mm; border-top: 0.4pt solid #ddd8cd; padding-top: 0.9mm; font-size: 8.5px; color: #6d675e; }
.tls-strip__sign { display: inline-flex; align-items: baseline; gap: 1.2mm; white-space: nowrap; }
.tls-strip__underline { display: inline-block; min-width: 26mm; border-bottom: 0.4pt solid #6d675e; height: 2.6mm; }
.tls-strip__underline--short { min-width: 13mm; }
.tls-strip__checks { font-weight: 700; color: #211f1c; }

.tls-base-button { display: block; width: 100%; margin: 2mm 0; padding: 2mm; border: 1px dashed #1d4ed8; background: #eff6ff; color: #1d4ed8; font-weight: 800; cursor: pointer; }
.tls-base-break { margin: 3mm 0; padding: 4mm; text-align: center; border-top: 2pt solid #111; border-bottom: 2pt solid #111; font-size: 18px; font-weight: 900; letter-spacing: .08em; break-inside: avoid; }
.tls-next { text-align: center; font-size: 7.5px; color: #a29a8d; letter-spacing: 0.06em; }

/* ── Подвал ── */
.tls-foot { margin-top: 2.4mm; border-top: 1.2pt solid #211f1c; padding-top: 1.4mm; }
.tls-totals { display: flex; flex-wrap: wrap; gap: 0.8mm 6mm; font-size: 9.5px; }
/* Подвал — одна компактная строка: подпись идёт рядом с полем,
   а не под ним. Не влезло (длинная фамилия выдавшего) — аккуратно
   переносится целиком следующим блоком, а не рвётся. */
.tls-signs { display: flex; flex-wrap: wrap; align-items: baseline; gap: 1.5mm 5mm; margin-top: 2mm; }
.tls-sign { display: inline-flex; align-items: baseline; gap: 2mm; font-size: 9.5px; font-weight: 700; white-space: nowrap; }
.tls-sign__k { display: inline; font-size: 7.5px; font-weight: 400; text-transform: uppercase; letter-spacing: 0.03em; color: #8c857a; }
.tls-sign__line { display: inline-block; min-width: 20mm; border-bottom: 0.5pt solid #6d675e; height: 3.5mm; }
.tls-sign__checks { font-size: 9.5px; font-weight: 700; white-space: nowrap; }
.tls-legal { margin-top: 1.6mm; font-size: 7.5px; color: #8c857a; }
`;
