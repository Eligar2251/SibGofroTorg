/**
 * jobs.ts — мост «строка базы ↔ состояние калькулятора».
 *
 * Сохранённый расчёт (таблица die_calc_jobs) грузится одним движком:
 * в `settings` лежит тот самый BoxInput со справочниками, поэтому «открыть
 * снова» = восстановить ввод, коэффициенты и ставки, а не пересчитывать
 * по памяти. Никакого Supabase здесь нет — только преобразование данных,
 * поэтому файл работает и в песочнице, и в админке сайта.
 */

import {
  CONSTRUCTIONS,
  CLOSURES,
  cloneCoef,
  type BoxInput,
  type ClosureId,
  type Coef,
  type ConstructionId,
  type DieSettings,
  type NestingSettings,
  type Options,
  type PriceSettings,
  type Profile,
  type SheetFormat,
} from '../core/model';
import { parseCustomDrawing, type CustomDrawing } from '../core/custom';
import type { AppState, SettingsState } from './store';

/** строка die_calc_jobs ровно в том виде, в каком её отдаёт API */
export interface DieCalcJobRow {
  id: string;
  order_no: string | null;
  name: string;
  customer: string | null;
  note: string | null;
  status: string;
  construction: string;
  closure: string;
  profile_id: string;
  l_mm: number | string;
  w_mm: number | string;
  h_mm: number | string;
  qty: number;
  blank_w: number | string | null;
  blank_h: number | string | null;
  die_w: number | string | null;
  die_h: number | string | null;
  blank_area_m2: number | string | null;
  knives_m: number | string | null;
  per_sheet: number | null;
  sheets: number | null;
  price_die: number | string | null;
  price_batch: number | string | null;
  price_per_pcs: number | string | null;
  price_with_vat: number | string | null;
  fact_blank_w: number | string | null;
  fact_blank_h: number | string | null;
  fact_price_per_pcs: number | string | null;
  fact_price_batch: number | string | null;
  fact_qty: number | null;
  learned: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  settings?: {
    input?: BoxInput;
    prices?: PriceSettings;
    profiles?: Profile[];
    sheets?: SheetFormat[];
    customDrawing?: CustomDrawing;
  } | null;
  result?: Record<string, unknown> | null;
}

const num = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const isCons = (v: unknown): v is ConstructionId => CONSTRUCTIONS.some((c) => c.id === v);
const isClosure = (v: unknown): v is ClosureId => CLOSURES.some((c) => c.id === v);

export const JOB_STATUSES: Array<{ id: string; name: string }> = [
  { id: 'draft', name: 'черновик' },
  { id: 'quoted', name: 'счёт отправлен' },
  { id: 'approved', name: 'согласован' },
  { id: 'in_work', name: 'в работе' },
  { id: 'done', name: 'штамп сделан' },
  { id: 'rejected', name: 'отказ' },
  { id: 'archived', name: 'архив' },
];

export const statusName = (id: string): string => JOB_STATUSES.find((s) => s.id === id)?.name ?? id;

/** «габарит штампа» и прочее из строки — для подписей в интерфейсе */
export function jobTitle(row: DieCalcJobRow): string {
  if (row.name?.trim()) return row.name.trim();
  const cons = CONSTRUCTIONS.find((c) => c.id === row.construction);
  return `${cons?.code ?? row.construction}-${num(row.l_mm)}*${num(row.w_mm)}*${num(row.h_mm)}-${row.profile_id}`;
}

/** строка → то, чем можно залить калькулятор */
export function jobToPatch(row: DieCalcJobRow): { initial: Partial<AppState>; initialSettings: Partial<SettingsState> } {
  const input = row.settings?.input;
  const construction: ConstructionId = isCons(input?.construction)
    ? (input?.construction as ConstructionId)
    : isCons(row.construction)
      ? (row.construction as ConstructionId)
      : 'lastochkin';
  const closure: ClosureId = isClosure(input?.closure)
    ? (input?.closure as ClosureId)
    : isClosure(row.closure)
      ? (row.closure as ClosureId)
      : (CONSTRUCTIONS.find((c) => c.id === construction)?.closures[0] ?? 'none');
  const coef: Coef | undefined = input?.coef ? cloneCoef(input.coef) : undefined;
  const opts = input?.options as Options | undefined;
  const die = input?.die as DieSettings | undefined;
  const nesting = input?.nesting as NestingSettings | undefined;

  const initial: Partial<AppState> = {
    L: num(input?.L, num(row.l_mm, 240)),
    W: num(input?.W, num(row.w_mm, 180)),
    H: num(input?.H, num(row.h_mm, 60)),
    profileId: input?.profileId ?? row.profile_id ?? 'E',
    construction,
    closure,
    qty: Math.max(1, Math.round(num(input?.qty, num(row.qty, 1000)))),
    orderNo: row.order_no ?? '',
    blankW: num(row.blank_w, num(input?.blankW)),
    blankH: num(row.blank_h, num(input?.blankH)),
    blankAreaM2: input?.blankArea ? Math.round((input.blankArea / 1e6) * 1e6) / 1e6 : 0,
  };
  const customDrawing = row.settings?.customDrawing ? parseCustomDrawing(row.settings.customDrawing) : null;
  if (customDrawing) initial.customDrawing = customDrawing;
  if (opts) initial.options = { ...opts };
  if (die) initial.die = { ...die };
  if (nesting) initial.nesting = { ...nesting };
  // только одна конструкция: остальное store смешает со своим (hydrate / DEFAULT)
  if (coef) initial.coefs = { [construction]: coef } as Partial<Record<ConstructionId, Coef>> as Record<ConstructionId, Coef>;

  const initialSettings: Partial<SettingsState> = {};
  if (row.settings?.prices) initialSettings.prices = { ...row.settings.prices };
  if (row.settings?.profiles?.length) initialSettings.profiles = row.settings.profiles.map((p) => ({ ...p }));
  if (row.settings?.sheets?.length) initialSettings.sheets = row.settings.sheets.map((s) => ({ ...s }));

  return { initial, initialSettings };
}

/** строка → короткая подпись «было/стало» для подсказок в таблице */
export function jobDelta(row: DieCalcJobRow): { mm: number | null; pct: number | null } {
  const fw = num(row.fact_blank_w);
  const fh = num(row.fact_blank_h);
  const ew = num(row.blank_w);
  const eh = num(row.blank_h);
  if (!(fw > 0) || !(fh > 0) || !(ew > 0) || !(eh > 0)) return { mm: null, pct: null };
  const mm = Math.round(((Math.abs(fw - ew) + Math.abs(fh - eh)) / 2) * 10) / 10;
  const pct = Math.round((mm / ((ew + eh) / 2)) * 1000) / 10;
  return { mm, pct };
}
