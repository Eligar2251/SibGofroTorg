// =========================================================
// FILE: src/lib/payment-export.ts
// Логика выгрузки исходящих платежей в Клиент-Банк (1CClientBankExchange).
//
// Зачем отдельный модуль:
//   • список платежей «на выгрузку» и сама выгрузка должны считать части
//     платежа (первая/вторая/...) ОДИНАКОВО — иначе в списке видно
//     «вторая часть», а в файле уедет «первая часть»;
//   • выгрузка теперь выбирается вручную (галочками), поэтому фильтрация
//     по периоду/статусу отделена от построения строк;
//   • модуль НЕ тянет next/server и supabase — его можно проверить тестами.
//
// Что попадает в выгрузку: исходящие платежи поставщикам (type "regular"),
// включая НЕ проведённые (is_paid = false) — платёжку можно отправить
// в банк до того, как платёж проведён в учёте.
// Что НЕ попадает: входящие, наличные/карточные/переводы/реклама и т.п.,
// а также внебалансовые «закрывашки» поставок «без оплаты»
// (exclude_from_balance = true) — реального платежа по ним нет.
// =========================================================

import { buildPurposeLines } from "./payment-purpose";

/**
 * Типы ИСХОДЯЩИХ платежей, которые вообще можно отправить платёжным
 * поручением в банк.
 *
 * Кроме оплаты поставщикам (regular) сюда попадают «сторонние расходники»,
 * которые заводят в банке вручную: реклама, сайт/хостинг, ежемесячные
 * (коммуналка, подписки) и возвраты покупателю.
 * Не попадают: наличные (cash), карты (ym_card, vm_card), внутренний
 * перевод безнала на карту (transfer) и внесение (deposit) — это не
 * расчётный счёт, платёжкой они не уходят.
 */
export const EXPORTABLE_OUTGOING_TYPES = [
  "regular",
  "refund",
  "advertising",
  "website",
  "monthly",
] as const;

/** Пустой тип считаем обычным платежом (так писали старые записи). */
export function isExportableType(type: unknown): boolean {
  const value = type == null || type === "" ? "regular" : String(type);
  return (EXPORTABLE_OUTGOING_TYPES as readonly string[]).includes(value);
}

/** Строка bank_payments в том виде, в каком её читает выгрузка. */
export interface ExportPaymentDbRow {
  id: string;
  number: number | string | null;
  date: string | null;
  type?: string | null;
  counterparty: string | null;
  counterparty_id?: string | null;
  receipt_ids?: string[] | null;
  receipt_numbers?: Array<number | string> | null;
  amount?: number | string | null;
  vat_rate?: number | string | null;
  vat_amount?: number | string | null;
  is_paid?: boolean | null;
  exclude_from_balance?: boolean | null;
  exported_at?: string | null;
  payment_purpose?: string | null;
  payment_priority?: number | string | null;
  payment_kind?: string | null;
  comment?: string | null;
}

/** Карточка контрагента (реквизиты получателя). */
export interface ExportCounterpartyDbRow {
  id: string;
  full_name?: string | null;
  short_name?: string | null;
  bank_account?: string | null;
  bank_name?: string | null;
  bank_city?: string | null;
  bik?: string | null;
  correspondent_account?: string | null;
  inn?: string | null;
  kpp?: string | null;
}

/** Поступление (поставка) — источник счёта и банковских реквизитов. */
export interface ExportReceiptDbRow {
  id: string;
  number?: number | string | null;
  date?: string | null;
  supplier?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  bank_account?: string | null;
  bank_name?: string | null;
  bank_city?: string | null;
  bik?: string | null;
  correspondent_account?: string | null;
  inn?: string | null;
  kpp?: string | null;
}

/** Реквизиты стороны платёжного поручения. */
export interface ExportParty {
  name: string;
  inn: string;
  kpp: string | null;
  account: string;
  bankName: string;
  bankCity: string;
  bik: string;
  corrAccount: string;
}

/** Строка списка «что можно выгрузить» (и одновременно данные для файла). */
export interface ExportPaymentRow {
  id: string;
  number: number;
  date: string;
  counterparty: string;
  counterpartyId: string | null;
  amount: number;
  vatRate: number;
  vatAmount: number;
  isPaid: boolean;
  exportedAt: string | null;
  /** Номер поставки (ПО-…) и номер счёта, если платёж привязан к поставке. */
  receiptNumber: number | string | null;
  invoiceNumber: string | null;
  /** «вторая часть», «третья часть»… — пусто, если платёж один. */
  partLabel: string;
  /** Сколько всего частей у этой поставки (1 = платёж целиком). */
  partTotal: number;
  /** Строка назначения платежа, как она уйдёт в файл. */
  purpose: string;
  /** null — реквизиты полные; иначе текст, чего не хватает. */
  issue: string | null;
  /** Готовые реквизиты получателя (при issue = null). */
  payee: ExportParty | null;
  priority: number;
  paymentKind: string;
  comment: string;
}

/** Ключи группировки частей: по первой привязанной поставке. */
const PART_LABELS = [
  "первая часть", "вторая часть", "третья часть", "четвертая часть",
  "пятая часть", "шестая часть", "седьмая часть", "восьмая часть",
  "девятая часть", "десятая часть",
];

/** Склоняет «часть» по индексу (0-based). Пусто, если часть одна. */
export function partLabelForIndex(index: number, total: number): string {
  if (!total || total <= 1) return "";
  if (index < 0) return "";
  return PART_LABELS[index] || `${index + 1}-я часть`;
}

/**
 * «вторая часть» → «второй части»: порядковое числительное нужно в
 * родительном падеже («оплата второй части»), а метка части хранится
 * в именительном («вторая часть» — так она показывается в списке).
 */
const PART_GENITIVE: Record<string, string> = {
  "первая часть": "первой части",
  "вторая часть": "второй части",
  "третья часть": "третьей части",
  "четвертая часть": "четвертой части",
  "пятая часть": "пятой части",
  "шестая часть": "шестой части",
  "седьмая часть": "седьмой части",
  "восьмая часть": "восьмой части",
  "девятая часть": "девятой части",
  "десятая часть": "десятой части",
};

function partGenitive(label: string): string {
  return PART_GENITIVE[label] || label;
}

/**
 * Заменяет фразу про часть в сохранённом назначении платежа на актуальную
 * («оплата первой части …» → «оплата второй части …») и возвращает результат.
 *
 * Зачем: часть пересчитывается по фактическому количеству платежей поставки.
 * Платёж мог появиться при разбивке на 2 части, а потом поставку
 * отредактировали (или первую часть удалили) — сохранённый в базе текст
 * устарел и отправил бы в банк неверный номер части.
 * Пустая partLabel (платёж один) означает: фразу про часть убираем вовсе.
 */
export function syncPartPhrase(base: string, partLabel: string): string {
  const stripped = stripPartPhraseAny(base);
  if (!stripped) return "";
  if (!partLabel) return stripped;
  // \b после «оплата» не сработает (кириллица — «словесные» символы с обеих
  // сторон пробела), поэтому граница задана явно: пробел или конец строки.
  return stripped.replace(/^оплата(?=\s|$)/iu, `оплата ${partGenitive(partLabel)}`);
}

/**
 * Убирает из сохранённого назначения платежа фразу про часть
 * («оплата второй части по счёту …» → «оплата по счёту …»).
 * Если от текста остаётся одно слово «оплата» — возвращает пустую строку,
 * чтобы назначение построилось автоматически (buildPurposeLines).
 */
export function stripPartPhraseAny(base: string): string {
  const text = (base || "").trim();
  if (!text) return "";
  const cleaned = text.replace(
    /^(оплата)\s+(?:первой|второй|третьей|четвертой|пятой|шестой|седьмой|восьмой|девятой|десятой|\d+-й)\s+части(?=[\s.,;:]|$)/iu,
    "$1"
  );
  return /^оплата[.!?]*$/iu.test(cleaned) ? "" : cleaned;
}

export function isoDay(raw: unknown): string {
  if (!raw) return "";
  return String(raw).slice(0, 10);
}

export function toNum(raw: unknown, fallback = 0): number {
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export function toText(raw: unknown, fallback = ""): string {
  return raw != null ? String(raw) : fallback;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Группирует платежи по поставке, чтобы определить номер части.
 * Важно: группируем ВСЕ исходящие платежи поставки, а не только те,
 * что попали в выборку по дате. Иначе вторая часть, выгруженная
 * отдельно от первой, уехала бы в банк как «первая часть».
 */
export function groupKeyOf(payment: ExportPaymentDbRow): string {
  const ids = Array.isArray(payment.receipt_ids) ? payment.receipt_ids : [];
  return ids[0] ? String(ids[0]) : `free-${payment.id}`;
}

/**
 * Строит строки выгрузки из сырых данных БД.
 * @param options.onlyIds — если задан, в результат попадут только эти id
 *   (но части считаются по всему переданному набору платежей).
 */
export function buildExportRows(
  payments: ExportPaymentDbRow[],
  counterparties: ExportCounterpartyDbRow[],
  receipts: ExportReceiptDbRow[],
  options: { onlyIds?: Iterable<string> } = {}
): ExportPaymentRow[] {
  const only = options.onlyIds ? new Set([...options.onlyIds].map(String)) : null;

  const cpById = new Map<string, ExportCounterpartyDbRow>();
  for (const cp of counterparties || []) cpById.set(String(cp.id), cp);
  const recById = new Map<string, ExportReceiptDbRow>();
  for (const r of receipts || []) recById.set(String(r.id), r);

  // Все исходящие «платёжные» платежи: без внебалансовых «закрывашек»
  // (поставка без оплаты) и без типов, которые не уходят платёжкой
  // (наличные, карты, внутренние переводы). Это полная картина частей
  // по каждой поставке — поэтому фильтр по дате применяется ПОСЛЕ.
  const eligible = (payments || []).filter(
    (p) => p && p.exclude_from_balance !== true && isExportableType(p.type)
  );

  const byReceipt = new Map<string, ExportPaymentDbRow[]>();
  for (const p of eligible) {
    const key = groupKeyOf(p);
    if (!byReceipt.has(key)) byReceipt.set(key, []);
    byReceipt.get(key)!.push(p);
  }
  for (const list of byReceipt.values()) {
    list.sort((a, b) => toNum(a.number) - toNum(b.number));
  }

  const rows: ExportPaymentRow[] = [];
  for (const p of eligible) {
    if (only && !only.has(String(p.id))) continue;

    const receiptIds = Array.isArray(p.receipt_ids) ? p.receipt_ids : [];
    const receiptNumbers = Array.isArray(p.receipt_numbers) ? p.receipt_numbers : [];
    const rid = receiptIds[0] ? String(receiptIds[0]) : null;
    const receipt = rid ? recById.get(rid) : null;
    const cp = p.counterparty_id ? cpById.get(String(p.counterparty_id)) : null;

    const group = byReceipt.get(groupKeyOf(p)) || [p];
    const indexInGroup = Math.max(
      0,
      group.findIndex((x) => String(x.id) === String(p.id))
    );
    const partTotal = group.length;

    // Реквизиты получателя: сначала из поставки, потом из карточки контрагента.
    const account = toText(receipt?.bank_account || cp?.bank_account);
    const bankName = toText(receipt?.bank_name || cp?.bank_name);
    const bik = toText(receipt?.bik || cp?.bik);
    const inn = toText(receipt?.inn || cp?.inn);
    const missing: string[] = [];
    if (!account) missing.push("р/с");
    if (!bik) missing.push("БИК");
    if (!bankName) missing.push("банк");
    if (!inn) missing.push("ИНН");

    const counterparty =
      toText(cp?.full_name) ||
      toText(cp?.short_name) ||
      toText(p.counterparty) ||
      "Поставщик";

    const vatRate = toNum(p.vat_rate, 22);
    const invoiceNumber = receipt?.invoice_number
      ? String(receipt.invoice_number)
      : null;
    const partLabel = partLabelForIndex(indexInGroup, partTotal);
    const comment = toText(p.comment);
    // Основание платежа:
    //   1. свой текст из карточки платежа (фраза про часть синхронизируется
    //      с фактическим количеством частей поставки);
    //   2. для платежа БЕЗ поставки (сторонний расходник: реклама, сайт,
    //      коммуналка…) — комментарий, иначе в банк уехало бы пустое
    //      «оплата.»;
    //   3. иначе строка строится автоматически по счёту/ПО и НДС.
    const baseText =
      syncPartPhrase(toText(p.payment_purpose), partLabel) ||
      (!receipt && comment ? comment : "");
    const purpose = buildPurposeLines({
      amount: toNum(p.amount),
      vatRate,
      vatAmount: toNum(p.vat_amount),
      docNumber: invoiceNumber || (receipt ? String(receipt.number) : null),
      docDate: isoDay(receipt?.invoice_date || receipt?.date) || null,
      docKind: "по счёту",
      partIndex: partTotal > 1 ? indexInGroup : null,
      partTotal: partTotal > 1 ? partTotal : null,
      baseText: baseText || null,
      withoutVat: vatRate <= 0,
    });

    rows.push({
      id: String(p.id),
      number: toNum(p.number),
      date: isoDay(p.date),
      counterparty,
      counterpartyId: p.counterparty_id ? String(p.counterparty_id) : null,
      amount: round2(toNum(p.amount)),
      vatRate,
      vatAmount: round2(toNum(p.vat_amount)),
      isPaid: p.is_paid === true,
      exportedAt: p.exported_at ? isoDay(p.exported_at) : null,
      receiptNumber: receipt
        ? toNum(receipt.number)
        : receiptNumbers[0] != null
          ? toNum(receiptNumbers[0])
          : null,
      invoiceNumber,
      partLabel,
      partTotal,
      purpose: purpose.main,
      issue: missing.length
        ? `Не заполнены реквизиты получателя: ${missing.join(", ")}. Откройте поставку/контрагента и заполните.`
        : null,
      payee: missing.length
        ? null
        : {
            name: counterparty,
            inn,
            kpp: toText(receipt?.kpp || cp?.kpp) || null,
            account,
            bankName,
            bankCity: toText(receipt?.bank_city || cp?.bank_city),
            bik,
            corrAccount: toText(receipt?.correspondent_account || cp?.correspondent_account),
          },
      priority: toNum(p.payment_priority, 5) || 5,
      paymentKind: toText(p.payment_kind, "01") || "01",
      comment,
    });
  }

  return sortExportRows(rows);
}

/** Сортировка списка: сначала свежие даты, внутри даты — по номеру. */
export function sortExportRows(rows: ExportPaymentRow[]): ExportPaymentRow[] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.number - b.number;
  });
}

/** Подходит ли строка под фильтр периода (пустые границы = без ограничения). */
export function matchesDateRange(
  row: ExportPaymentRow,
  from: string | null,
  to: string | null
): boolean {
  if (from && row.date && row.date < from) return false;
  if (to && row.date && row.date > to) return false;
  return true;
}

/** Минимальная и максимальная даты выборки (для шапки файла). */
export function dateSpanOf(
  rows: ExportPaymentRow[]
): { from: string; to: string } {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const from = dates[0] || "";
  const to = dates[dates.length - 1] || from;
  return { from, to };
}

/**
 * Итоги выборки для шапки модалки и для контроля после выгрузки.
 */
export function summarize(rows: ExportPaymentRow[]): {
  count: number;
  total: number;
  unpaid: number;
  unexported: number;
} {
  return {
    count: rows.length,
    total: round2(rows.reduce((s, r) => s + r.amount, 0)),
    unpaid: rows.filter((r) => !r.isPaid).length,
    unexported: rows.filter((r) => !r.exportedAt).length,
  };
}
