// =========================================================
// FILE: src/lib/dimension-search.ts
// Поиск по размерам. Пользователь вводит габариты в разных форматах:
//   «180*180*180», «180 180 180», «180 х 180 х 180», «180х180х180»,
//   «180x180» и т.п. — парсим числа и ищем ближайшие по размерам товары.
// =========================================================

/** Приводит разделители размеров (*, x, ×, х и пробелы вокруг них) к единому «x» */
export function normalizeDimString(s: string): string {
  return s
    .toLocaleLowerCase("ru-RU")
    .replace(/\s*[*×хx]\s*/gi, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNum(t: string): number {
  return parseFloat(t.trim().replace(",", "."));
}

/**
 * Извлекает размеры (2–3 числа) из строки, если она похожа на запрос размеров.
 * Возвращает null, если это обычный текстовый запрос.
 */
export function extractQueryDims(query: string): number[] | null {
  const q = query.trim();
  // 1) Числа, соединённые разделителем * x × х: «180*180*180», «180 х 180», «180x180x180»
  const sep = q.match(/\d[\d.,]*(?:\s*[*×хx]\s*\d[\d.,]*){1,}/i);
  if (sep) {
    const nums = sep[0]
      .split(/[*×хx]/i)
      .map(parseNum)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length >= 2) return nums.slice(0, 3);
  }
  // 2) Три числа через пробел: «180 180 180»
  const spaced = q.match(/\d[\d.,]*/g);
  if (spaced && spaced.length >= 3) {
    const nums = spaced.map(parseNum).filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length >= 3) return nums.slice(0, 3);
  }
  return null;
}

/**
 * Близость двух наборов размеров: 1 — полное совпадение всех чисел,
 * 0 — ничего общего. Каждое искомое число матчится с ближайшим свободным
 * числом товара (поэтому порядок Д×Ш×В не критичен).
 */
export function dimensionScore(
  queryDims: number[],
  productDims: number[]
): number {
  if (queryDims.length === 0 || productDims.length === 0) return 0;
  const q = [...queryDims].sort((a, b) => a - b);
  const p = [...productDims].sort((a, b) => a - b);
  const used = new Array(p.length).fill(false);
  let total = 0;
  for (const qd of q) {
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < p.length; i++) {
      if (used[i]) continue;
      const diff = Math.abs(p[i] - qd);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used[bestIdx] = true;
      const rel = bestDiff / Math.max(qd, 1);
      total += Math.max(0, 1 - rel);
    }
  }
  return total / q.length;
}
