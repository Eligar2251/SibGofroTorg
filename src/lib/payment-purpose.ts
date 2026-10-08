// =========================================================
// FILE: src/lib/payment-purpose.ts
// Клиентские/серверные хелперы для формирования строк назначения
// платежа в формате 1С/Клиент-банк (НазначениеПлатежа).
// =========================================================

export const PAYMENT_PRIORITIES = [5, 3, 4, 2, 6, 1] as const;
export type PaymentPriority = (typeof PAYMENT_PRIORITIES)[number];

export const PAYMENT_KINDS = [
  { value: "01", label: "01 — электронно (по умолч.)" },
  { value: "02", label: "02 — почтой" },
  { value: "03", label: "03 — телеграфом" },
  { value: "04", label: "04 — телетайпом" },
  { value: "06", label: "06 — с использованием СВИФТ" },
] as const;

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function formatRuDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? iso + "T00:00:00" : String(iso));
  if (isNaN(d.getTime())) return String(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatMoneyDash(n: number): string {
  const k = Math.round((Number(n) || 0) * 100);
  return `${Math.floor(k / 100)}-${String(k % 100).padStart(2, "0")}`;
}

export function includedVatLocal(total: number, rate: number): number {
  const safeTotal = Math.max(0, Number(total) || 0);
  if (!rate || rate <= 0) return 0;
  return Math.round((safeTotal * rate * 100) / (100 + rate)) / 100;
}

const PART_LABELS = [
  "первая часть", "вторая часть", "третья часть", "четвертая часть",
  "пятая часть", "шестая часть", "седьмая часть", "восьмая часть",
  "девятая часть", "десятая часть",
];

export interface PurposeInput {
  /** Общая сумма платежа. */
  amount: number;
  /** Ставка НДС (22, 20, 10, 0, -1). */
  vatRate: number;
  /** Сумма НДС вручную (если 0/не указана — считается автоматически). */
  vatAmount?: number | null;
  /** Номер документа: счёта или ПО. */
  docNumber?: string | number | null;
  /** Дата документа (ISO YYYY-MM-DD). */
  docDate?: string | null;
  /** Вид документа в тексте: "по счёту" / "по договору" / "по ПО" ... */
  docKind?: string | null;
  /** Индекс части (0-based), если платёж дробный. */
  partIndex?: number | null;
  /** Общее количество частей по документу. */
  partTotal?: number | null;
  /** Основание платежа в свободной форме (если нужно перебить авто-текст). */
  baseText?: string | null;
  /** Без НДС принудительно. */
  withoutVat?: boolean;
}

/**
 * Формирует строки назначения платежа в стиле 1С:
 *   main     — НазначениеПлатежа1 (человеческое описание оплаты + НДС фраза)
 *   sumLine  — НазначениеПлатежа2 ("Сумма 20014-00")
 *   vatLine  — НазначениеПлатежа3 ("В т.ч. НДС(22%) 3609-08" или "Без НДС")
 *   combined — НазначениеПлатежа (как в 1С: main + Сумма + В т.ч. НДС слитно)
 */
export function buildPurposeLines(input: PurposeInput): {
  main: string;
  sumLine: string;
  vatLine: string;
  combined: string;
  vatCalculated: number;
} {
  const amount = Math.max(0, Number(input.amount) || 0);
  const rate = Number(input.vatRate) || 0;
  const withVat = !input.withoutVat && rate > 0;
  let vatSum = Number(input.vatAmount);
  if (!vatSum || vatSum <= 0.009) vatSum = withVat ? includedVatLocal(amount, rate) : 0;

  const sumLine = `Сумма ${formatMoneyDash(amount)}`;
  let vatLine = "Без НДС";
  if (withVat) {
    const rateLabel = Math.round(rate * 100) / 100;
    vatLine = `В т.ч. НДС(${rateLabel}%) ${formatMoneyDash(vatSum)}`;
  }

  let main = (input.baseText || "").trim();
  if (!main) {
    const parts: string[] = [];
    const totalParts = Math.max(1, Number(input.partTotal) || 1);
    if (totalParts > 1 && input.partIndex != null && input.partIndex >= 0) {
      parts.push(`оплата ${PART_LABELS[input.partIndex] || `${input.partIndex + 1}-й части`}`);
    } else {
      parts.push("оплата");
    }
    const docKind = (input.docKind || "по счёту").trim();
    if (input.docNumber) parts.push(`${docKind} № ${input.docNumber}`);
    const dateLabel = formatRuDate(input.docDate);
    if (dateLabel) parts.push(`от ${dateLabel}`);
    let phrase = parts.join(" ").trim();
    if (!/[.!?]$/.test(phrase)) phrase += ".";
    if (withVat) phrase += ` В том числе НДС ${Math.round(rate * 100) / 100}%.`;
    else phrase += " Без НДС.";
    main = phrase;
  }

  // Как в примере 1С: после «Сумма XXXX-YY» сразу «В т.ч. НДС...» без пробела.
  const combined = `${main} ${sumLine}${withVat ? vatLine : ""}`.trim();

  return { main, sumLine, vatLine, combined, vatCalculated: vatSum };
}
