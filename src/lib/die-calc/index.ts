// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
/**
 * Публичный API калькулятора.
 *
 *   import { calcBox, quickEstimate, DEFAULT_COEF } from './core';
 *
 * Ядро не зависит от React, Vite и Supabase — его можно запускать в node
 * (API-роут, батч-расчёт прайса, генерация превью).
 */

export * from './geo';
export * from './model';
export * from './templates';
export * from './engine';
export * from './nesting';
export * from './cost';
export * from './calibrate';
export { FIXTURES, CALIBRATABLE, type Fixture } from './fixtures';
export { renderUnfold, type Render2dOpts } from './render2d';
export { renderFold, foldTransforms, type V3, type Fold3dOpts } from './render3d';
export { toDxf, DXF_LAYER } from './export/dxf';
export { specText, specCsv, quickCard } from './export/report';
export * from './learn';

import { calcBox, type CalcSettings } from './engine';
import {
  CONSTRUCTIONS,
  DEFAULT_COEF,
  DEFAULT_DIE,
  DEFAULT_NESTING,
  DEFAULT_OPTIONS,
  DEFAULT_PROFILES,
  DEFAULT_PRICES,
  DEFAULT_SHEETS,
  type BoxInput,
  type ClosureId,
  type ConstructionId,
} from './model';
import { CLOSURES } from './model';

export interface QuickParams {
  L: number;
  W: number;
  H: number;
  /** профиль: E | B | BC | C (или свой id из settings.profiles) */
  profile?: string;
  construction?: ConstructionId;
  closure?: ClosureId;
  qty?: number;
  handle?: boolean;
  /** принудительный габарит заготовки (режим «по чертежу матрицы») */
  blank?: { w: number; h: number };
  sheets?: Array<{ name: string; w: number; h: number }>;
  settings?: Partial<CalcSettings>;
}

/** дефолтные настройки: справочники из model.ts */
export function baseSettings(extra?: Partial<CalcSettings>): CalcSettings {
  return {
    profiles: DEFAULT_PROFILES.map((p) => ({ ...p })),
    sheets: DEFAULT_SHEETS.map((s) => ({ ...s })),
    prices: { ...DEFAULT_PRICES },
    labelSize: { w: 250, h: 200 },
    ...extra,
  };
}

export function makeInput(params: QuickParams): BoxInput {
  const construction: ConstructionId = params.blank ? 'blank' : params.construction ?? 'lastochkin';
  const def = CONSTRUCTIONS.find((c) => c.id === construction) as (typeof CONSTRUCTIONS)[number];
  const closure = params.closure ?? def.closures[0] ?? 'none';
  return {
    L: params.L,
    W: params.W,
    H: params.H,
    profileId: params.profile ?? 'E',
    construction,
    closure: CLOSURES.some((c) => c.id === closure) ? closure : 'none',
    options: { ...DEFAULT_OPTIONS, handle: !!params.handle },
    coef: DEFAULT_COEF[construction],
    die: { ...DEFAULT_DIE },
    nesting: { ...DEFAULT_NESTING },
    qty: params.qty ?? 1000,
    blankW: params.blank?.w,
    blankH: params.blank?.h,
  };
}

/**
 * Быстрая оценка «в одну строку» — то, что обычно нужно менеджеру:
 * габарит и площадь заготовки, сколько штук с листа, цена за штуку.
 */
export function quickEstimate(params: QuickParams): {
  blank: { w: number; h: number; areaM2: number; polyAreaM2: number };
  die: { w: number; h: number; areaM2: number };
  sheet: { name: string; perSheet: number; utilization: number; sheets: number };
  knives: { cutM: number; creaseM: number; perfM: number; techM: number; totalM: number };
  price: { die: number; batch: number; perPcs: number; perPcsWithDie: number; cardboardPerPcs: number };
  warnings: string[];
} {
  const input = makeInput(params);
  const settings = baseSettings({
    ...(params.settings ?? {}),
    sheets: params.sheets ? params.sheets.map((s, i) => ({ id: `u${i}`, ...s })) : baseSettings().sheets,
  });
  const res = calcBox({ input, settings });
  return {
    blank: {
      w: res.area.blankW,
      h: res.area.blankH,
      areaM2: res.area.bboxAreaM2,
      polyAreaM2: res.area.blankAreaM2,
    },
    die: { w: res.area.dieW, h: res.area.dieH, areaM2: res.area.dieAreaM2 },
    sheet: {
      name: res.nest.sheet.name,
      perSheet: res.nest.perSheet,
      utilization: res.nest.utilization,
      sheets: res.nest.sheets,
    },
    knives: {
      cutM: res.knives.cutM,
      creaseM: res.knives.creaseM,
      perfM: res.knives.perfM,
      techM: res.knives.techM,
      totalM: res.knives.totalM,
    },
    price: {
      die: res.cost.die.total,
      batch: res.cost.batch.total,
      perPcs: res.cost.perPcs,
      perPcsWithDie: res.cost.perPcsWithDie,
      cardboardPerPcs: res.cost.cardboardPerPcs,
    },
    warnings: res.warnings,
  };
}
