/**
 * model.ts — все входные данные, справочники и коэффициенты.
 *
 * ВАЖНО ДЛЯ ИНТЕГРАЦИИ: никаких вычислений здесь нет, только данные и типы.
 * Цены/ставки меняются в UI (вкладка «Настройки») и сохраняются в localStorage,
 * в коде их править не обязательно.
 */

import type { Vec2, LineKind, Seg, Box } from './geo';

/* ─────────────────────────── профиль гофры ─────────────────────────── */

export interface Profile {
  id: string;
  /** короткое имя для маркировки: E, B, BC… */
  flute: string;
  name: string;
  /** толщина картона, мм */
  thickness: number;
  /** цена за 1 м² листа, ₽ */
  priceM2: number;
  /** сколько мм «съедает» гофра на сгибе (для припусков) */
  crush: number;
}

/** Дефолты по данным заказчика: B = 38 ₽/м², микрогофра E = 36 ₽/м². */
export const DEFAULT_PROFILES: Profile[] = [
  { id: 'E', flute: 'E', name: 'Микрогофра E (275/275)', thickness: 1.6, priceM2: 36, crush: 0.6 },
  { id: 'B', flute: 'B', name: 'Гофра B (330/330)', thickness: 3.0, priceM2: 38, crush: 1.0 },
  { id: 'BC', flute: 'BC', name: 'Двухслойная BC (евроборт)', thickness: 4.8, priceM2: 62, crush: 1.5 },
  { id: 'C', flute: 'C', name: 'Гофра C (330/330)', thickness: 3.9, priceM2: 40, crush: 1.2 },
];

/* ───────────────────────── формат листа ───────────────────────── */

export interface SheetFormat {
  id: string;
  name: string;
  w: number;
  h: number;
}

/** Типовые форматы резки гофрокартона (подставьте свои — поле редактируемое). */
export const DEFAULT_SHEETS: SheetFormat[] = [
  { id: 's1', name: '1000×1200', w: 1000, h: 1200 },
  { id: 's2', name: '1200×1400', w: 1200, h: 1400 },
  { id: 's3', name: '1400×1600', w: 1400, h: 1600 },
  { id: 's4', name: '1500×1800', w: 1500, h: 1800 },
  { id: 's5', name: '1600×2000', w: 1600, h: 2000 },
  { id: 's6', name: '1800×2400', w: 1800, h: 2400 },
];

export interface NestingSettings {
  /** отступ от края листа до заготовки, мм */
  edgeMargin: number;
  /** минимальный просвет между заготовками по X/Y, мм */
  gapX: number;
  gapY: number;
  /** разрешить поворот заготовки на 90° */
  allowRotate: boolean;
  /** резать лист «в ноль» (false — считать только целые ряды) */
  trimWaste: boolean;
}

export const DEFAULT_NESTING: NestingSettings = {
  edgeMargin: 12,
  gapX: 4,
  gapY: 4,
  allowRotate: true,
  trimWaste: false,
};

/* ───────────────────────── конструкции ───────────────────────── */

export type ConstructionId = 'lastochkin' | 'lotok' | 'yazyk' | 'bokovoy' | 'blank';

export interface ClosureDef {
  id: ClosureId;
  name: string;
  hint: string;
}

export type ClosureId = 'none' | 'half' | 'tuck' | 'full' | 'glue';

export const CLOSURES: ClosureDef[] = [
  { id: 'none', name: 'Без закрытия (лоток)', hint: 'Клапаны-пыльники, коробка не закрывается' },
  { id: 'half', name: 'Нахлёст вдвое (замок с ушками)', hint: 'Два клапана по 1/2 верха, встречаются внахлёст' },
  { id: 'tuck', name: 'Клапан с замковым язычком', hint: 'Один клапан перекрывает верх, язычок в паз' },
  { id: 'full', name: 'Клапан-крышка (футляр)', hint: 'Клапаны закрывают верх и бока, тип 0470' },
  { id: 'glue', name: 'Под склейку', hint: 'Клапан на склейку/фурнитуру, перфорация по сгибу' },
];

export interface ConstructionDef {
  id: ConstructionId;
  code: string;
  name: string;
  lineage: string;
  closures: ClosureId[];
  hint: string;
}

/**
 * `blank` — режим «готовая заготовка»: шаблон не строится, пользователь вводит
 * габарит развертки (и, опционально, площадь полигона) — площадь, раскладка и
 * цена считаются так же. Нужно, чтобы сверяться с готовыми чертежами матриц.
 */
export const CONSTRUCTIONS: ConstructionDef[] = [
  {
    id: 'lastochkin',
    code: 'ЛХ-0427',
    name: 'Ласточкин хвост',
    lineage: 'самосборный лоток, угловые клапаны «ласточкин хвост»',
    closures: ['none', 'half', 'tuck', 'full'],
    hint: 'Четыре стенки + донышко, углы закрываются трапециевидными клапанами',
  },
  {
    id: 'lotok',
    code: 'ЛК-0436',
    name: 'Лоток кондитерский',
    lineage: 'низкий лоток, передняя стенка с фигурным вырезом',
    closures: ['none', 'tuck', 'glue'],
    hint: 'Передняя стенка ниже (коэффициент frontK) и с вырезом-полукругом',
  },
  {
    id: 'yazyk',
    code: 'ЗЯ-0427',
    name: 'С замочком-язычком',
    lineage: 'самосборная коробка, язычок в паз передней стенки',
    closures: ['tuck', 'none', 'half', 'glue'],
    hint: 'Клапан с язычком + паз в стенке, возможна перфорация по линии отрыва',
  },
  {
    id: 'bokovoy',
    code: 'БЗ-0470',
    name: 'Замок боковой с ушками',
    lineage: 'клапаны от боковых стенок смыкаются сверху, ушки в пазы',
    closures: ['half', 'full', 'none', 'glue'],
    hint: 'Замок по бокам: ушки цепляются за стенки, верх перекрывается полностью',
  },
  {
    id: 'blank',
    code: '—',
    name: 'Готовая заготовка (по габариту)',
    lineage: 'без шаблона: только габарит развертки',
    closures: ['none'],
    hint: 'Введите ширину и высоту заготовки по краям коробки — площадь/раскладка/цена',
  },
];

/* ───────────────────────── коэффициенты (припуски) ───────────────────────── */

/**
 * Панель = размер + k·размер + c + kt·толщина.
 * Все припуски живут здесь, а не в геометрии: их калибруют по чертежам
 * (calibrate.ts и вкладка «Калибровка»), не трогая код построения.
 */
export interface Allowance {
  /** доля от самого размера */
  k: number;
  /** константа, мм */
  c: number;
  /** множитель толщины картона */
  kt: number;
}

/**
 * Правило внешних клапанов для одного варианта закрытия.
 *   sSide  = Lp·sideFrac + sideAdd   — клапан от боковой стенки (накрывает верх поперёк L)
 *   sFront = Wp·frontFrac + frontAdd  — короткий клапан/пыльник спереди
 *   sBack  = Wp·backFrac + backAdd    — клапан сзади (крышка/язычок)
 */
export interface FlapRule {
  sideFrac: number;
  sideAdd: number;
  frontFrac: number;
  frontAdd: number;
  backFrac: number;
  backAdd: number;
}

export const CLOSURE_IDS: ClosureId[] = ['none', 'half', 'tuck', 'full', 'glue'];

export interface Coef {
  allowL: Allowance;
  allowW: Allowance;
  allowH: Allowance;
  /** ушко замка, мм */
  ear: number;
  /** язычок: ширина/высота, мм */
  tabW: number;
  tabH: number;
  /** скругление наружных углов клапанов, мм */
  cornerR: number;
  /** высота передней стенки лотка, доля Hf = frontK·Hp */
  frontK: number;
  /** глубина фигурного выреза лотка, мм */
  frontCut: number;
  /** клеевой клапан, мм */
  glueFlap: number;
  /** нахлёст смыкающихся клапанов, мм */
  overlap: number;
  /** правила клапанов по вариантам закрытия */
  flaps: Record<ClosureId, FlapRule>;
}

const rule = (
  sideFrac: number,
  sideAdd: number,
  frontFrac: number,
  frontAdd: number,
  backFrac: number,
  backAdd: number,
): FlapRule => ({ sideFrac, sideAdd, frontFrac, frontAdd, backFrac, backAdd });

/**
 * Значения по умолчанию сняты с 9 эталонных чертежей (см. fixtures.ts):
 * напри­мер для 0427 240×180×60 E заготовка 550×513, для 0436 255×190×60 B — 513×400.
 * После подгонки по своим чертежам пересохраните — см. вкладку «Калибровка».
 */
export const DEFAULT_FLAPS: Record<ClosureId, FlapRule> = {
  // доли сняты с эталонных чертежей: 0436 255×190×60 → клапаны 57/38 при Lp=263/Wp=194
  none: rule(0.21, 2, 0.19, 2, 0.19, 2),
  half: rule(0.55, 6, 0.55, 6, 0.55, 6),
  // 0427 240×180×60 → 550×513: sSide = 89.5 при Lp = 245
  tuck: rule(0.365, 0, 0.27, 2, 0.8, 18),
  full: rule(0.5, 10, 0.5, 10, 1.0, 14),
  glue: rule(0.28, 2, 0.28, 2, 0.28, 2),
};

const baseAllow: Record<'L' | 'W' | 'H', Allowance> = {
  L: { k: 0.012, c: 1.5, kt: 0.5 },
  W: { k: 0, c: 1.5, kt: 1 },
  H: { k: 0, c: 1, kt: 1.4 },
};

const coef = (over: Partial<Coef> = {}): Coef => ({
  allowL: { ...baseAllow.L },
  allowW: { ...baseAllow.W },
  allowH: { ...baseAllow.H },
  ear: 16,
  tabW: 52,
  tabH: 14,
  cornerR: 3,
  frontK: 1,
  frontCut: 0,
  glueFlap: 0,
  overlap: 6,
  flaps: { ...DEFAULT_FLAPS },
  ...over,
});

export const DEFAULT_COEF: Record<ConstructionId, Coef> = {
  /* Значения по умолчанию — результат автоподгонки по 6 эталонным чертежам
   * (`npm run check`): средняя ошибка габарита заготовки 5,8 мм при том, что
   * одинаковые по размерам коробки в ваших же чертежах расходятся на 10–60 мм.
   * Осознанно НЕ запечено правило «half» (ушки-«ласточкин хвост») — его тянет
   * единственный чертёж 0427-125×110×115, правило получается нефизичным
   * (передний клапан 1,1·Wp + 61). Для закрытия «half» нажмите «Автоподгонка»
   * на вкладке «Калибровка», когда появится второй чертёж. */
  lastochkin: coef({
    // панель стенки/дна по ширине на чертежах меньше внутреннего размера
    allowW: { k: 0, c: -10, kt: 0.4 },
  }),
  lotok: coef({
    allowL: { k: 0, c: 1.5, kt: 0.5 },
    allowW: { k: 0, c: 2.5, kt: 1 },
    frontK: 0.62,
    frontCut: 22,
    overlap: 4,
    ear: 14,
    tabW: 48,
    tabH: 12,
    flaps: { ...DEFAULT_FLAPS, none: rule(0.2, 2, 0.11, 2, 0.19, 2) },
  }),
  yazyk: coef({ tabW: 56, tabH: 16, overlap: 6 }),
  bokovoy: coef({
    // единственный чертёж бокового замка (0470-240×180×60): по нему подогнаны
    // припуски, поэтому для других размеров точность ниже — проверяйте по DXF
    allowL: { k: 0.001, c: -10, kt: 0.5 },
    allowW: { k: 0, c: 24, kt: 2.1 },
    overlap: 8,
    ear: 18,
    flaps: { ...DEFAULT_FLAPS, full: rule(0.5, 11, 0.43, 9, 0.34, 2) },
  }),
  blank: coef({
    allowL: { k: 0, c: 0, kt: 0 },
    allowW: { k: 0, c: 0, kt: 0 },
    allowH: { k: 0, c: 0, kt: 0 },
    ear: 0,
    tabW: 0,
    tabH: 0,
    cornerR: 0,
    glueFlap: 0,
    overlap: 0,
  }),
};

export function cloneCoef(c: Coef): Coef {
  return {
    ...c,
    allowL: { ...c.allowL },
    allowW: { ...c.allowW },
    allowH: { ...c.allowH },
    flaps: {
      none: { ...c.flaps.none },
      half: { ...c.flaps.half },
      tuck: { ...c.flaps.tuck },
      full: { ...c.flaps.full },
      glue: { ...c.flaps.glue },
    },
  };
}

/* ───────────────────────── опции изделия ───────────────────────── */

export interface Options {
  /** высечка отверстия под ручку */
  handle: boolean;
  /** ширина/высота отверстия под ручку, мм */
  handleW: number;
  handleH: number;
  /** двойная биговка (для BC/жёсткого картона) */
  doubleCrease: boolean;
  /** перфорация по линии отрыва клапана */
  perforation: boolean;
  /** технологические уголки на штампе (серые) */
  techCorners: boolean;
  /** сторона печати/штампа: зеркалить развертку */
  mirror: boolean;
  /** сколько изделий размещать на одном штампе (n-up по X) */
  perDie: number;
  /** шаг между изделиями на штампе, мм */
  diePitch: number;
}

export const DEFAULT_OPTIONS: Options = {
  handle: false,
  handleW: 60,
  handleH: 18,
  doubleCrease: false,
  perforation: false,
  techCorners: true,
  mirror: false,
  perDie: 1,
  diePitch: 12,
};

/* ───────────────────────── штанцформа и цены ───────────────────────── */

export interface DieSettings {
  /** запас рамки штампа от края заготовки с каждой стороны, мм */
  frameMargin: number;
  /** шаг перемычек (nicks) на длинных ножах, мм */
  nickEvery: number;
  /** длина одной перемычки, мм */
  nickLen: number;
  /** длина одного технологического уголка, мм */
  techCornerLen: number;
}

export const DEFAULT_DIE: DieSettings = {
  frameMargin: 40,
  nickEvery: 100,
  nickLen: 3.5,
  techCornerLen: 199,
};

export interface PriceSettings {
  currency: string;
  /** фанера для штампа, ₽/м² */
  plywoodM2: number;
  /** лазерная резка фанеры, ₽/м реза */
  laserPerM: number;
  /** нож рез, ₽/м */
  knifeCutPerM: number;
  /** нож биговки (правило), ₽/м */
  knifeCreasePerM: number;
  /** перфорационный нож, ₽/м */
  knifePerfPerM: number;
  /** технологические ножи, ₽/м */
  knifeTechPerM: number;
  /** гибка+установка ножа, ₽/м (на все типы) */
  bendPerM: number;
  /** микро-резина и выталкиватели, ₽/м² площади штампа */
  rubberPerM2: number;
  /** изготовление/наладка штампа, ₽ за штамп */
  dieSetup: number;
  /** наценка на штамп, доля */
  dieMargin: number;
  /** высечка, ₽ за 1000 ударов */
  cutPer1000: number;
  /** ударов в час на прессе (для срока) */
  strokesPerHour: number;
  /** склейка/сборка, ₽/шт (0 — нет) */
  gluePerPcs: number;
  /** упаковка, ₽/шт */
  packPerPcs: number;
  /** переналадка пресса на заказ, ₽ */
  pressSetup: number;
  /** отход картона, доля */
  waste: number;
  /** НДС, доля (0.2 = 20%) */
  vat: number;
  /** маржа на тираж, доля */
  batchMargin: number;
}

/** Ставки ориентировочные — правятся в UI и в SUPABASE-таблице price_settings. */
export const DEFAULT_PRICES: PriceSettings = {
  currency: '₽',
  plywoodM2: 1500,
  laserPerM: 90,
  knifeCutPerM: 260,
  knifeCreasePerM: 180,
  knifePerfPerM: 230,
  knifeTechPerM: 150,
  bendPerM: 130,
  rubberPerM2: 350,
  dieSetup: 2500,
  dieMargin: 0.25,
  cutPer1000: 480,
  strokesPerHour: 3000,
  gluePerPcs: 0,
  packPerPcs: 1.2,
  pressSetup: 1800,
  waste: 0.05,
  vat: 0.2,
  batchMargin: 0.3,
};

/* ───────────────────────── вход расчёта ───────────────────────── */

export interface BoxInput {
  /** внутренняя длина (по длинной стороне дна), мм */
  L: number;
  /** внутренняя ширина, мм */
  W: number;
  /** внутренняя высота, мм */
  H: number;
  profileId: string;
  construction: ConstructionId;
  closure: ClosureId;
  options: Options;
  coef: Coef;
  die: DieSettings;
  nesting: NestingSettings;
  qty: number;
  /** режим «готовая заготовка»: габарит развертки */
  blankW?: number;
  blankH?: number;
  /** площадь полигона заготовки, мм² (если известна из CAD; иначе = bbox) */
  blankArea?: number;
}

export interface Panel {
  id: string;
  role: 'bottom' | 'wall' | 'front' | 'back' | 'side' | 'flap' | 'lid' | 'dust' | 'ear' | 'glue';
  pts: Vec2[];
  /** родитель в дереве сгиба (для 3D) */
  parent?: string;
  /** ось сгиба: отрезок в плоскости развертки */
  hinge?: { p: Vec2; q: Vec2 };
  /** угол сгиба в собранном виде, градусы */
  fold?: number;
  /** порядок складывания в анимации */
  step?: number;
}

export interface DimensionMark {
  a: Vec2;
  b: Vec2;
  /** подпись размерной линии (если пусто — её длина) */
  label?: string;
}

export interface BuiltGeom {
  panels: Panel[];
  /** дополнительные линии (пазы, перфорация, разметка) */
  extra: Seg[];
  /** вырезы внутри панелей (ручка, пазы) — вычитаются из площади, добавляют рез */
  holes: Vec2[][];
  /** формулы «как считалось» для вывода в UI */
  derivation: Array<{ label: string; formula: string; value: number; unit?: string }>;
  /** ручные подписи размеров; шаблонные конструкции поле не заполняют */
  dimensions?: DimensionMark[];
  /** пользовательская геометрия: её TECH-линии относятся к изделию, а не к плите */
  custom?: boolean;
  /** заметки/предупреждения */
  warnings: string[];
  /** для 3D: сколько мм составляет «дно» и где оно */
  meta: Record<string, number>;
}

export interface KnifeStats {
  cutM: number;
  creaseM: number;
  perfM: number;
  techM: number;
  markM: number;
  totalM: number;
  /** контурный рез (периметр наружного контура), м */
  outlineM: number;
  /** длина ножей с учётом перемычек (меньше на nicks), м */
  steelM: number;
  byKind: Record<LineKind, number>;
  segCount: Record<LineKind, number>;
}

export interface AreaStats {
  /** габарит заготовки по краям коробки, мм */
  blankW: number;
  blankH: number;
  /** площадь габарита (под высечку), м² */
  bboxAreaM2: number;
  /** площадь полигона заготовки (полезная), м² */
  blankAreaM2: number;
  /** площадь отверстий, м² */
  holesAreaM2: number;
  /** заполнение габарита */
  fillInBbox: number;
  /** штамп (заготовка + frameMargin*2) */
  dieW: number;
  dieH: number;
  dieAreaM2: number;
}

export interface NestPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: boolean;
}

export interface NestResult {
  sheet: SheetFormat;
  cols: number;
  rows: number;
  perSheet: number;
  /** сколько листов нужно на тираж */
  sheets: number;
  utilization: number;
  layout: NestPlacement[];
  sheetBox: Box;
}

export interface CostResult {
  die: { parts: Array<{ label: string; value: number }>; total: number };
  batch: { parts: Array<{ label: string; value: number }>; total: number };
  perPcs: number;
  perPcsWithDie: number;
  withVat: number;
  sheetsNeeded: number;
  cardboardPerPcs: number;
  /** НДС, доля */
  vat: number;
  /** чистовое время высечки, мин */
  minutes: number;
}

export interface CalcResult {
  input: BoxInput;
  geom: BuiltGeom;
  /** линии для рендера/экспорта, уже без дублей общих рёбер */
  segs: Seg[];
  /** те же линии, разложенные по слоям */
  segMap: Record<LineKind, Seg[]>;
  bbox: Box;
  /** габарит штампа (заготовка + frameMargin с каждой стороны, n-up) */
  die: Box;
  outline: Vec2[][];
  area: AreaStats;
  knives: KnifeStats;
  nest: NestResult;
  cost: CostResult;
  warnings: string[];
}
