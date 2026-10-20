// =========================================================
// FILE: src/lib/price-calc.ts
// Расчёты цены для массового изменения цен (админка → «Массовые цены»).
//
// Модуль намеренно без React и без обращений к базе: одни и те же формулы
// используют и интерфейс (мгновенный пересчёт при вводе), и тесты.
//
// ТЕРМИНЫ (как в учёте — «Разница» на складе показывает второе):
//   • Накрутка, %  = (цена − закуп) / закуп × 100     — сколько «сверху» к закупке;
//   • Маржа, %     = (цена − закуп) / цена  × 100     — доля прибыли в цене;
//   • Разница, ₽   = цена − закуп.
// Закупочная цена неизвестна (0 или пусто) → проценты не считаются (null),
// а не превращаются в бесконечность: такую строку интерфейс помечает отдельно.
// =========================================================

export type RoundingMode =
  | "none"
  | "ruble"
  | "ruble_up"
  | "ten_up"
  | "fifty_up"
  | "psych9";

export const ROUNDING_MODES: readonly { value: RoundingMode; label: string }[] = [
  { value: "none", label: "Выключено — без округления (до копейки)" },
  { value: "ruble", label: "До рубля" },
  { value: "ruble_up", label: "До рубля вверх" },
  { value: "ten_up", label: "До 10 ₽ вверх" },
  { value: "fifty_up", label: "До 50 ₽ вверх" },
  { value: "psych9", label: "Заканчивать на 9 (вверх)" },
] as const;

/**
 * Число из значения, которого может и не быть: null, undefined и пустая
 * строка — это «нет данных», а не ноль. Без этой проверки закупка «0 ₽»
 * и «нет закупки» были бы одним и тем же (Number(null) === 0).
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Округление до копеек — деньги нигде не храним с большей точностью. */
export function round2(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Ввод цены из поля: принимает «1 234,56», «1234.56», пустое значение.
 * Возвращает null, если число не разобрать (интерфейс покажет ошибку).
 */
export function parsePriceInput(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/\s|₽/g, "").replace(",", ".").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return round2(n);
}

/**
 * Округление цены по выбранному режиму. «Вверх» не опускает цену ниже
 * расчётной — иначе при наценке 40% округление до 10 ₽ могло бы съесть
 * часть маржи.
 */
export function applyRounding(value: number, mode: RoundingMode = "none"): number {
  const n = Number(value) || 0;
  if (n <= 0) return 0;
  switch (mode) {
    case "ruble":
      return Math.round(n);
    case "ruble_up":
      return Math.ceil(n);
    case "ten_up":
      return Math.ceil(n / 10) * 10;
    case "fifty_up":
      return Math.ceil(n / 50) * 50;
    case "psych9": {
      // Цена заканчивается на 9 и не ниже расчётной: 487 → 489, 490 → 499.
      const whole = Math.ceil(n);
      const base = Math.floor(whole / 10) * 10;
      const candidate = base + 9;
      return candidate >= whole ? candidate : candidate + 10;
    }
    case "none":
    default:
      return round2(n);
  }
}

/** Накрутка к закупке, % (цена 120 при закупе 100 → 20%). */
export function markupPercent(
  price: number | null | undefined,
  purchase: number | null | undefined
): number | null {
  const cost = toNumber(purchase);
  const value = toNumber(price);
  if (cost === null || value === null || cost <= 0) return null;
  return round2(((value - cost) / cost) * 100);
}

/**
 * Маржа от цены, % (цена 120 при закупе 100 → 16,67%).
 * Закупка 0 ₽ — это «цена закупки не указана», а не бесплатный товар:
 * иначе маржа показывала бы 100%, а накрутка — «—».
 */
export function marginPercent(
  price: number | null | undefined,
  purchase: number | null | undefined
): number | null {
  const cost = toNumber(purchase);
  const value = toNumber(price);
  if (cost === null || cost <= 0 || value === null || value <= 0) return null;
  return round2(((value - cost) / value) * 100);
}

/** Разница в рублях: цена − закуп. */
export function profitPerUnit(
  price: number | null | undefined,
  purchase: number | null | undefined
): number | null {
  const cost = toNumber(purchase);
  const value = toNumber(price);
  if (cost === null || value === null) return null;
  return round2(value - cost);
}

/** Цена из наценки: закуп × (1 + % / 100). */
export function priceFromMarkup(
  purchase: number | null | undefined,
  markup: number | null | undefined,
  mode: RoundingMode = "none"
): number | null {
  const cost = toNumber(purchase);
  const percent = toNumber(markup);
  if (cost === null || cost <= 0) return null;
  if (percent === null) return null;
  // Накрутка ниже −100% дала бы отрицательную цену — обрезаем.
  const factor = Math.max(0, 1 + percent / 100);
  return applyRounding(cost * factor, mode);
}

/** Снижение текущей цены на процент: массовое понижение «−10%». */
export function priceFromDecrease(
  price: number | null | undefined,
  percent: number | null | undefined,
  mode: RoundingMode = "none"
): number | null {
  const value = toNumber(price);
  const pct = toNumber(percent);
  if (value === null || value < 0) return null;
  if (pct === null) return null;
  return applyRounding(value * Math.max(0, 1 - pct / 100), mode);
}

/**
 * Цена, которую видит покупатель: цена минус активная скидка товара
 * (та же формула, что в каталоге — getProductEffectivePrice).
 */
export function effectivePrice(
  price: number | null | undefined,
  discountType?: "percent" | "fixed" | null,
  discountValue?: number | null
): number | null {
  const value = toNumber(price);
  if (value === null) return null;
  if (!discountType) return value;
  const discount = toNumber(discountValue);
  if (discount === null) return value;
  if (discountType === "percent") {
    return Math.max(0, Math.round(value * (1 - discount / 100)));
  }
  if (discountType === "fixed") {
    return Math.max(0, round2(value - discount));
  }
  return value;
}

/** Подпись «+120 ₽ / 12%» для строки таблицы. */
export function formatPercent(value: number | null, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const fixed = fractionDigits > 0 ? value.toFixed(fractionDigits) : String(Math.round(value));
  return `${fixed.replace(".", ",")}%`;
}

/**
 * Тон ячейки маржи: красный — торгуем в убыток, янтарный — почти без
 * прибыли, зелёный — нормально. Порог «почти без прибыли» — 10%.
 */
export function marginTone(margin: number | null): "loss" | "thin" | "ok" | "unknown" {
  if (margin === null || margin === undefined || !Number.isFinite(Number(margin))) return "unknown";
  if (margin < 0) return "loss";
  if (margin < 10) return "thin";
  return "ok";
}
