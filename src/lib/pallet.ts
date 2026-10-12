// =========================================================
// FILE: src/lib/pallet.ts
// Кратность коробки паллете 1200×800 мм.
//
// Зачем: у селлеров WB и Ozon тара считается «паллетной», если
// короб укладывается на стандартный поддон 1200×800 мм без
// остатка по сторонам (слой закрывает паллету целиком). Габарит
// 500 мм, 700 мм, 350 мм и подобные не делят ни 1200, ни 800 —
// такие коробки в подборке маркетплейсов показывать нельзя.
//
// Правило двумя условиями:
//   1) габарит — целое число сотен миллиметров;
//   2) вдоль длинной (1200) или короткой (800) стороны паллеты
//      укладывается целое число таких габаритов.
//
// Подходят: 100, 200, 300, 400, 600, 800, 1200 мм.
// Не подходят: 150, 230, 285 (не сотни), 350, 500, 700 (не делят поддон).
//
// Модуль общий для сервера и клиента — без серверных импортов.
// =========================================================

/** Стандартная паллета: длинная сторона, мм. */
export const PALLET_LENGTH_MM = 1200;
/** Стандартная паллета: короткая сторона, мм. */
export const PALLET_WIDTH_MM = 800;

/**
 * Габарит, с которого коробка вообще имеет смысл на паллете.
 * Мельче — это не тара, а вложение (пачка, прокладка).
 */
export const PALLET_MIN_DIMENSION_MM = 100;

/** Габариты, которые селлеры считают «паллетными» — для текстов на сайте. */
export const PALLET_FRIENDLY_MM = [100, 200, 300, 400, 600, 800, 1200] as const;

/** Габариты, которые паллетной кратности не дают — для предупреждений. */
export const PALLET_UNFRIENDLY_MM = [150, 250, 350, 500, 700, 900, 1000] as const;

export interface PalletSizeInput {
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
}

export interface PalletLayout {
  /** Сколько коробов укладывается вдоль длинной стороны (1200 мм). */
  cols: number;
  /** Сколько коробов укладывается вдоль короткой стороны (800 мм). */
  rows: number;
  /** Коробов в одном слое. */
  perLayer: number;
  /** Слой закрывает паллету целиком, без свободной полосы. */
  full: boolean;
  /** Размер короба вдоль длинной стороны паллеты, мм. */
  acrossMm: number;
  /** Размер короба вдоль короткой стороны паллеты, мм. */
  alongMm: number;
  /** Незакрытая полоса вдоль короткой стороны паллеты, мм. */
  leftoverMm: number;
}

function positiveNumber(value: number | null | undefined): number | null {
  const num = Number(value);
  return value == null || !Number.isFinite(num) || num <= 0 ? null : num;
}

/**
 * Габарит коробки кратен паллете: целое число сотен миллиметров,
 * которое делит длинную (1200) или короткую (800) сторону поддона
 * без остатка. Отсюда ровно ряд 100, 200, 300, 400, 600, 800, 1200 мм.
 */
export function fitsPallet(mm: number | null | undefined): boolean {
  const size = positiveNumber(mm);
  if (size == null) return false;
  if (size < PALLET_MIN_DIMENSION_MM || size > PALLET_LENGTH_MM) return false;
  if (size % 100 !== 0) return false;
  return PALLET_LENGTH_MM % size === 0 || PALLET_WIDTH_MM % size === 0;
}

/**
 * Товар показываем как «паллетный», только если известны все три
 * габарита и каждый из них кратен паллете. Нет высоты (или она
 * «неудобная» — 230, 285, 500 мм) — товар в подборку не попадает:
 * лучше не показать, чем показать короб, который не встанет на слой.
 */
export function isPalletBox(size: PalletSizeInput | null | undefined): boolean {
  if (!size) return false;
  return (
    fitsPallet(size.dimensionLength) &&
    fitsPallet(size.dimensionWidth) &&
    fitsPallet(size.dimensionHeight)
  );
}

/**
 * Наименьшая сторона короба, которую считаем отгрузочной тарой.
 * 100×100×100 мм формально кратен паллете, но на поддон такой короб
 * ставит только вложение — в подборке для маркетплейсов ему не место.
 */
export const PALLET_SHIPPING_MIN_SIDE_MM = 300;

/**
 * Коробка для паллетной отгрузки на маркетплейс: все габариты кратны
 * паллете и короб достаточно крупный, чтобы везти в нём товар.
 */
export function isPalletShippingBox(
  size: PalletSizeInput | null | undefined
): boolean {
  if (!isPalletBox(size)) return false;
  const length = positiveNumber(size?.dimensionLength) ?? 0;
  const width = positiveNumber(size?.dimensionWidth) ?? 0;
  return Math.max(length, width) >= PALLET_SHIPPING_MIN_SIDE_MM;
}

/**
 * Раскладка коробов в слое на паллете 1200×800.
 *
 * Пробуем обе ориентации короба и берём ту, что ложится плотнее:
 * сначала «слой без остатка», иначе — где коробов в слое больше.
 * `null` — короб на паллету в принципе не укладывается.
 */
export function palletLayout(
  length: number | null | undefined,
  width: number | null | undefined
): PalletLayout | null {
  const a = positiveNumber(length);
  const b = positiveNumber(width);
  if (a == null || b == null) return null;

  const candidates: PalletLayout[] = [];
  for (const [acrossMm, alongMm] of [
    [a, b],
    [b, a],
  ]) {
    const cols = Math.floor(PALLET_LENGTH_MM / acrossMm);
    const rows = Math.floor(PALLET_WIDTH_MM / alongMm);
    if (cols < 1 || rows < 1) continue;
    const leftoverMm = PALLET_WIDTH_MM - rows * alongMm;
    candidates.push({
      cols,
      rows,
      perLayer: cols * rows,
      full: leftoverMm === 0 && cols * acrossMm === PALLET_LENGTH_MM,
      acrossMm,
      alongMm,
      leftoverMm,
    });
  }
  if (candidates.length === 0) return null;
  return candidates.sort(
    (x, y) =>
      Number(y.full) - Number(x.full) ||
      y.perLayer - x.perLayer ||
      y.acrossMm - x.acrossMm
  )[0];
}

export interface PalletCell {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Координаты коробов в слое для схемы (в процентах от паллеты):
 * рисуем паллету как прямоугольник 1200×800 и раскладываем
 * короба в реальных пропорциях — схема не врёт про остаток.
 */
export function palletCells(
  length: number | null | undefined,
  width: number | null | undefined
): { layout: PalletLayout; cells: PalletCell[] } | null {
  const layout = palletLayout(length, width);
  if (!layout) return null;
  const widthPct = (layout.acrossMm / PALLET_LENGTH_MM) * 100;
  const heightPct = (layout.alongMm / PALLET_WIDTH_MM) * 100;
  const cells: PalletCell[] = [];
  for (let i = 0; i < layout.perLayer; i += 1) {
    cells.push({
      left: (i % layout.cols) * widthPct,
      top: Math.floor(i / layout.cols) * heightPct,
      width: widthPct,
      height: heightPct,
    });
  }
  return { layout, cells };
}

/**
 * Порядок «ходовых» поддонных размеров: 600×400 (самый частый
 * запрос селлеров WB), затем 800×600, 600×300 и так далее.
 * Незнакомый размер — в конце списка.
 */
const FOOTPRINT_ORDER: readonly [number, number][] = [
  [600, 400],
  [800, 600],
  [600, 300],
  [400, 300],
  [600, 200],
  [400, 400],
  [300, 200],
  [1200, 800],
];

export function footprintRank(
  length: number | null | undefined,
  width: number | null | undefined
): number {
  const a = positiveNumber(length);
  const b = positiveNumber(width);
  if (a == null || b == null) return FOOTPRINT_ORDER.length;
  const index = FOOTPRINT_ORDER.findIndex(
    ([l, w]) => (l === a && w === b) || (l === b && w === a)
  );
  return index === -1 ? FOOTPRINT_ORDER.length : index;
}

/** Размеры для схем и таблиц: «600×400» — как в карточках каталога. */
export function formatPalletFootprint(
  length: number | null | undefined,
  width: number | null | undefined
): string {
  return `${length}×${width}`;
}
