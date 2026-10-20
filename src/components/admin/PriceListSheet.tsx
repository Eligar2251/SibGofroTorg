// =========================================================
// FILE: src/components/admin/PriceListSheet.tsx
// Лист А4 «Прайс-лист»: то, что видно в предпросмотре и печатается.
//
// Компонент без состояния — всё приходит готовым из PriceListClient:
// строки с уже посчитанными ценами и настройки оформления. Поэтому
// один и тот же лист используется и на экране, и при печати (никакой
// «второй копии» таблицы, которая могла бы разойтись с первой).
// =========================================================

"use client";

import type { CSSProperties } from "react";
import { formatMoney, tierLabel, type PriceTierConfig } from "@/lib/price-list";

export type PriceListSheetRow = {
  id: string;
  name: string;
  sku: string | null;
  size: string | null;
  packQty: number | null;
  categoryName: string | null;
  /** Закупка (печатается только при showPurchase). */
  purchase: number | null;
  /** Обычная цена (+30% или ручная). */
  base: number | null;
  /** Чистая прибыль с единицы после НДС и налога
   *  на прибыль (печатается только при showNetProfit). */
  netProfit: number | null;
  /** Цены включённых столбцов по id столбца. */
  tierPrices: Record<string, number | null>;
};

export type PriceListOrientation = "portrait" | "landscape";

export type PriceListSheetSettings = {
  orientation: PriceListOrientation;
  title: string;
  subtitle: string;
  company: string;
  contacts: string;
  dateText: string;
  note: string;
  showDate: boolean;
  showSku: boolean;
  showSize: boolean;
  showPack: boolean;
  showPurchase: boolean;
  showRegular: boolean;
  showNetProfit: boolean;
  groupByCategory: boolean;
  fontFamily: string;
  titleSize: number;
  companySize: number;
  headerSize: number;
  bodySize: number;
  rowPadding: number;
  lineWidth: number;
  borders: boolean;
  zebra: boolean;
  headerFill: boolean;
  headerBg: string;
  titleBold: boolean;
  headerBold: boolean;
  priceBold: boolean;
  margins: { top: number; right: number; bottom: number; left: number };
};

type SheetEntry =
  | { kind: "group"; label: string }
  | { kind: "row"; row: PriceListSheetRow; number: number };

/** Непрерывная нумерация строк + заголовки групп категорий. */
function buildEntries(
  rows: readonly PriceListSheetRow[],
  groupByCategory: boolean
): SheetEntry[] {
  if (!groupByCategory) {
    return rows.map((row, index) => ({ kind: "row", row, number: index + 1 }));
  }

  const entries: SheetEntry[] = [];
  let currentGroup: string | null = null;
  let number = 0;
  for (const row of rows) {
    const label = row.categoryName?.trim() || "Без категории";
    if (label !== currentGroup) {
      currentGroup = label;
      entries.push({ kind: "group", label });
    }
    number += 1;
    entries.push({ kind: "row", row, number });
  }
  return entries;
}

/** Ширины колонок, мм. Имя товара забирает всё оставшееся место. */
function columnWidths(settings: PriceListSheetSettings, tierCount: number) {
  const { right, left } = settings.margins;
  const pageWidth = settings.orientation === "landscape" ? 297 : 210;
  const available = Math.max(120, pageWidth - left - right);

  const widths = {
    num: 8,
    sku: 20,
    size: 24,
    pack: 13,
    purchase: 17,
    regular: 20,
    net: 17,
    tier: 20,
  };

  const fixed =
    widths.num +
    (settings.showSku ? widths.sku : 0) +
    (settings.showSize ? widths.size : 0) +
    (settings.showPack ? widths.pack : 0) +
    (settings.showPurchase ? widths.purchase : 0) +
    (settings.showRegular ? widths.regular : 0) +
    (settings.showNetProfit ? widths.net : 0) +
    tierCount * widths.tier;

  // Если включены все колонки, «жёсткие» миллиметры могут не поместиться
  // в поля A4 — тогда ужимаем все колонки пропорционально, иначе таблица
  // вылезет за край листа и последний столбец обрежется при печати.
  const MIN_NAME = 26;
  const rawName = available - fixed;
  const scale = rawName < MIN_NAME ? available / (fixed + MIN_NAME) : 1;
  const fit = (value: number) => Math.round(value * scale * 10) / 10;

  return {
    num: fit(widths.num),
    sku: fit(widths.sku),
    size: fit(widths.size),
    pack: fit(widths.pack),
    purchase: fit(widths.purchase),
    regular: fit(widths.regular),
    net: fit(widths.net),
    tier: fit(widths.tier),
    name: fit(Math.max(MIN_NAME, rawName)),
  };
}

export function PriceListSheet({
  rows,
  tiers,
  settings,
  className = "",
}: {
  rows: readonly PriceListSheetRow[];
  tiers: readonly PriceTierConfig[];
  settings: PriceListSheetSettings;
  className?: string;
}) {
  const activeTiers = tiers.filter((tier) => tier.enabled);
  const widths = columnWidths(settings, activeTiers.length);
  const entries = buildEntries(rows, settings.groupByCategory);
  const totalColumns =
    2 +
    (settings.showSku ? 1 : 0) +
    (settings.showSize ? 1 : 0) +
    (settings.showPack ? 1 : 0) +
    (settings.showPurchase ? 1 : 0) +
    (settings.showRegular ? 1 : 0) +
    (settings.showNetProfit ? 1 : 0) +
    activeTiers.length;

  const style = {
    "--pl-font": settings.fontFamily,
    "--pl-body": `${settings.bodySize}pt`,
    "--pl-head": `${settings.headerSize}pt`,
    "--pl-title": `${settings.titleSize}pt`,
    "--pl-company": `${settings.companySize}pt`,
    "--pl-pad": `${settings.rowPadding}mm`,
    "--pl-line-w": `${settings.lineWidth}pt`,
    "--pl-head-bg": settings.headerFill ? settings.headerBg : "transparent",
    "--pl-title-weight": settings.titleBold ? 800 : 500,
    "--pl-head-weight": settings.headerBold ? 800 : 500,
    "--pl-price-weight": settings.priceBold ? 700 : 400,
    "--pl-mt": `${settings.margins.top}mm`,
    "--pl-mr": `${settings.margins.right}mm`,
    "--pl-mb": `${settings.margins.bottom}mm`,
    "--pl-ml": `${settings.margins.left}mm`,
  } as CSSProperties;

  return (
    <div
      className={`pl-sheet${
        settings.orientation === "landscape" ? " pl-sheet--landscape" : ""
      }${className ? ` ${className}` : ""}`}
      style={style}
      data-orientation={settings.orientation}
    >
      <div className="pl-sheet__top">
        <div>
          <div className="pl-sheet__company">{settings.company}</div>
          {settings.contacts.trim() !== "" && (
            <div className="pl-sheet__contacts">{settings.contacts}</div>
          )}
        </div>
        {settings.showDate && settings.dateText.trim() !== "" && (
          <div className="pl-sheet__date">{settings.dateText}</div>
        )}
      </div>

      <div className="pl-sheet__titles">
        <h1 className="pl-sheet__title">{settings.title || "Прайс-лист"}</h1>
        {settings.subtitle.trim() !== "" && (
          <div className="pl-sheet__subtitle">{settings.subtitle}</div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="pl-empty">
          <b>Товары не выбраны.</b>
          <br />
          Отметьте товары в каталоге — таблица появится здесь.
        </div>
      ) : (
        <table
          className={`pl-table${settings.borders ? "" : " pl-table--plain"}`}
        >
          <colgroup>
            <col style={{ width: `${widths.num}mm` }} />
            <col style={{ width: `${widths.name}mm` }} />
            {settings.showSku && <col style={{ width: `${widths.sku}mm` }} />}
            {settings.showSize && (
              <col style={{ width: `${widths.size}mm` }} />
            )}
            {settings.showPack && (
              <col style={{ width: `${widths.pack}mm` }} />
            )}
            {settings.showPurchase && (
              <col style={{ width: `${widths.purchase}mm` }} />
            )}
            {settings.showRegular && (
              <col style={{ width: `${widths.regular}mm` }} />
            )}
            {settings.showNetProfit && (
              <col style={{ width: `${widths.net}mm` }} />
            )}
            {activeTiers.map((tier) => (
              <col key={tier.id} style={{ width: `${widths.tier}mm` }} />
            ))}
          </colgroup>

          <thead>
            <tr>
              <th>№</th>
              <th>Наименование</th>
              {settings.showSku && <th>Артикул</th>}
              {settings.showSize && <th>Размер</th>}
              {settings.showPack && (
                <th>
                  <span className="pl-th-main">В упак.</span>
                  <span className="pl-th-unit">шт</span>
                </th>
              )}
              {settings.showPurchase && (
                <th>
                  <span className="pl-th-main">Закупка</span>
                  <span className="pl-th-unit">₽</span>
                </th>
              )}
              {settings.showRegular && (
                <th>
                  <span className="pl-th-main">Обычная</span>
                  <span className="pl-th-unit">цена, ₽</span>
                </th>
              )}
              {settings.showNetProfit && (
                <th>
                  <span className="pl-th-main">На руки</span>
                  <span className="pl-th-unit">₽*</span>
                </th>
              )}
              {activeTiers.map((tier) => {
                const index = tiers.indexOf(tier);
                return (
                  <th key={tier.id}>
                    <span className="pl-th-main">{tierLabel(tiers, index)}</span>
                    <span className="pl-th-unit">цена, ₽</span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {entries.map((entry, entryIndex) => {
              if (entry.kind === "group") {
                return (
                  <tr key={`group-${entry.label}-${entryIndex}`} className="pl-group-row">
                    <td colSpan={totalColumns}>{entry.label}</td>
                  </tr>
                );
              }

              const { row, number } = entry;
              return (
                <tr
                  key={`row-${row.id}`}
                  className={
                    settings.zebra && number % 2 === 0 ? "pl-row-alt" : undefined
                  }
                >
                  <td className="pl-col-num">{number}</td>
                  <td className="pl-col-name">{row.name}</td>
                  {settings.showSku && (
                    <td className="pl-col-sku">{row.sku || "—"}</td>
                  )}
                  {settings.showSize && (
                    <td className="pl-col-size">{row.size || "—"}</td>
                  )}
                  {settings.showPack && (
                    <td className="pl-col-size">{row.packQty ?? "—"}</td>
                  )}
                  {settings.showPurchase && (
                    <td className="pl-col-purchase">
                      {formatMoney(row.purchase)}
                    </td>
                  )}
                  {settings.showRegular && (
                    <td
                      className={`pl-col-price${
                        row.base === null ? " pl-col-empty" : ""
                      }`}
                    >
                      {formatMoney(row.base)}
                    </td>
                  )}
                  {settings.showNetProfit && (
                    <td
                      className={`pl-col-price${
                        row.netProfit === null ? " pl-col-empty" : ""
                      }`}
                      title="Чистая прибыль с единицы после НДС и налога на прибыль"
                    >
                      {formatMoney(row.netProfit)}
                    </td>
                  )}
                  {activeTiers.map((tier) => {
                    const price = row.tierPrices[tier.id] ?? null;
                    return (
                      <td
                        key={tier.id}
                        className={`pl-col-price${
                          price === null ? " pl-col-empty" : ""
                        }`}
                      >
                        {formatMoney(price)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {settings.note.trim() !== "" && (
        <div className="pl-sheet__note">{settings.note}</div>
      )}
      {settings.showNetProfit && (
        <div className="pl-sheet__note pl-sheet__note--small">
          * «На руки» — чистая прибыль с единицы после НДС и
          налога на прибыль (внутренний прайс, для клиентов не
          печатайте эту колонку).
        </div>
      )}
    </div>
  );
}

