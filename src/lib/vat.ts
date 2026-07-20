export const VAT_RATE = 22;

/** Возвращает сумму НДС, уже включённую в итог документа. */
export function includedVat(total: number, rate = VAT_RATE): number {
  const safeTotal = Math.max(0, Number(total) || 0);
  return Math.round((safeTotal * rate * 100) / (100 + rate)) / 100;
}
