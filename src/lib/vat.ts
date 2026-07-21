export const VAT_RATE = 22; // Стандартная ставка с 2026 года

export const VAT_RATES = [
  { value: 22, label: "22% (основная)" },
  { value: 20, label: "20% (старая)" },
  { value: 10, label: "10% (льготная)" },
  { value: 7, label: "7% (спец. УСН)" },
  { value: 5, label: "5% (спец. УСН)" },
  { value: 0, label: "0%" },
  { value: -1, label: "Без НДС" },
] as const;

/** Возвращает сумму НДС, уже включённую в итог документа. */
export function includedVat(total: number, rate = VAT_RATE): number {
  const safeTotal = Math.max(0, Number(total) || 0);
  if (rate <= 0) return 0;
  return Math.round((safeTotal * rate * 100) / (100 + rate)) / 100;
}
