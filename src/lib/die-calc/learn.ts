// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
/**
 * learn.ts — «дообучение» калькулятора на сохранённых расчётах.
 *
 * Идея простая: каждый расчёт, который технолог подтвердил (сделал штамп,
 * выставил счёт), — это готовый эталон. Он хранится в таблице `die_calc_jobs`
 * (колонки `fact_*` — что получилось на самом деле). Здесь из этих записей
 * считаются два поправочных слоя:
 *
 *   1. ГЕОМЕТРИЯ («сама матрица»). Записи той же конструкции превращаются в
 *     Fixture и по ним подгоняется таблица припусков Coef — тем же методом
 *      координатного спуска, что и вкладка «Калибровка». Основой служит НЕ
 *      дефолт, а коэффициент, на котором считалась самая свежая запись,
 *      поэтому обучение накапливается, а не обнуляет ручную подгонку.
 *      Выученный Coef отдаётся в движок как обычный coef: развертка, 3D, DXF и
 *      габарит штампа пересчитываются из него, то есть матрица получается
 *      такой же, как на чертежах цеха, а не «примерной».
 *
 *   2. ЦЕНА («выискивала среднее»). Для группы (конструкция × замок × профиль)
 *      считается медиана отношения «реальная цена за штуку / расчётная».
 *      Медиана, а не среднее арифметическое: один сорванный тираж или скидка
 *      «за знакомство» не должны утаскивать весь прайс. Рядом кладём и
 *      обычное среднее — его видно в интерфейсе, чтобы расхождение было
 *      честно видно.
 *
 * Модуль чистый: никаких Supabase/React/сети, только числа. Тот же код
 * считается на сервере (переобучение по таблице) и в браузере (мгновенный
 * предпросмотр «что даст обучение»).
 */

import { fitCoef, predictBlank } from './calibrate';
import type { Fixture } from './fixtures';
import type { CustomDrawing } from './custom';
import {
  CONSTRUCTIONS,
  CLOSURES,
  DEFAULT_COEF,
  cloneCoef,
  type BoxInput,
  type CalcResult,
  type ClosureId,
  type Coef,
  type ConstructionId,
  type CostResult,
  type PriceSettings,
  type Profile,
  type SheetFormat,
} from './model';

export const MODEL_VERSION = 1;

/** Всё, что нужно для обучения из одной строки таблицы die_calc_jobs. */
export interface DieCalcSample {
  id: string;
  name: string;
  construction: ConstructionId;
  closure: ClosureId;
  profileId: string;
  L: number;
  W: number;
  H: number;
  qty: number;
  /** что посчитал калькулятор в момент сохранения */
  estBlankW: number;
  estBlankH: number;
  estPricePerPcs: number;
  /** на каких коэффициентах считали — от них стартует подгонка */
  estCoef: Coef | null;
  /** ставки на момент расчёта (чтобы сравнивать цены корректно) */
  estPrices: PriceSettings | null;
  /** подтверждённый факт: габарит заготовки с готовой матрицы и реальная цена */
  factBlankW: number | null;
  factBlankH: number | null;
  factPricePerPcs: number | null;
  factPriceBatch: number | null;
  factQty: number | null;
  createdAt: string | null;
}

/** Поправка по геометрии — на конструкцию. */
export interface GeoLesson {
  construction: ConstructionId;
  n: number;
  /** габарит заготовки: средняя ошибка до поправки и после, мм */
  errBeforeMm: number;
  errAfterMm: number;
  /** то же в % от габарита (чтобы сравнивать мелкие и крупные коробки) */
  errAfterPct: number;
  coef: Coef;
  /** данных хватило на подгонку (иначе coef = baseCoef как есть) */
  fitted: boolean;
}

/** Поправка на цену — группа (конструкция|замок|профиль) или шире. */
export interface PriceLesson {
  /** 'lastochkin|tuck|E' | 'lastochkin|*|*' | '*|*|*' */
  key: string;
  construction: ConstructionId | '*';
  closure: ClosureId | '*';
  profileId: string | '*';
  n: number;
  /** медиана факт/расчёт (1.04 = «реально на 4 % дороже») */
  k: number;
  /** то же среднее арифметическое — для справки */
  kMean: number;
  /** разброс: медиана |ln k| в процентах */
  spreadPct: number;
}

export interface DieCalcModel {
  version: number;
  trainedAt: string;
  /** всего записей, из которых учились */
  n: number;
  geo: GeoLesson[];
  price: PriceLesson[];
  notes: string[];
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const isCons = (v: unknown): v is ConstructionId =>
  (CONSTRUCTIONS as Array<{ id: string }>).some((c) => c.id === v);
const isClosure = (v: unknown): v is ClosureId =>
  (CLOSURES as Array<{ id: string }>).some((c) => c.id === v);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (v: number, d = 2): number => {
  const p = 10 ** d;
  return Math.round(v * p) / p;
};

/**
 * Выбросы отбрасываем по MAD (медиане абсолютных отклонений логарифма
 * отношения): |ln k - med| > 3·MAD. MAD = 0 (все отношения одинаковые) —
 * ничего не отбрасываем.
 */
function dropOutliers(ratios: number[]): number[] {
  if (ratios.length < 4) return ratios;
  const logs = ratios.map((x) => Math.log(x));
  const med = median(logs) ?? 0;
  const mad = median(logs.map((x) => Math.abs(x - med))) ?? 0;
  if (mad <= 1e-9) return ratios; // все отношения одинаковые — отбрасывать нечего
  const limit = 3 * mad;
  const kept = ratios.filter((x) => Math.abs(Math.log(x) - med) <= limit);
  return kept.length >= 2 ? kept : ratios;
}

/** строка таблицы (jsonb + колонки) → образец; null, если для обучения не годится */
export function sampleFromRow(row: Record<string, unknown>): DieCalcSample | null {
  if (!row || typeof row !== 'object') return null;
  const construction = row.construction;
  const closure = row.closure;
  if (!isCons(construction) || !isClosure(closure)) return null;
  // packJob кладёт ввод в settings.input; старые строки могли лечиться плоско —
  // читаем и так, и так, чтобы обучение не спотыкалось о формат
  const settings = (row.settings ?? {}) as {
    input?: Partial<BoxInput>;
    prices?: PriceSettings;
    profiles?: Profile[];
  } & Partial<BoxInput>;
  const input: Partial<BoxInput> = settings.input ?? settings;
  const factBlankW = numOrNull(row.fact_blank_w);
  const factBlankH = numOrNull(row.fact_blank_h);
  const factPricePerPcs = numOrNull(row.fact_price_per_pcs);
  const factPriceBatch = numOrNull(row.fact_price_batch);
  const factQty = numOrNull(row.fact_qty);
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    construction,
    closure,
    profileId: String(row.profile_id ?? input.profileId ?? 'E'),
    L: num(row.l_mm, num(input.L)),
    W: num(row.w_mm, num(input.W)),
    H: num(row.h_mm, num(input.H)),
    qty: Math.max(1, Math.round(num(row.qty, num(input.qty, 1)))),
    estBlankW: num(row.blank_w),
    estBlankH: num(row.blank_h),
    estPricePerPcs: num(row.price_per_pcs),
    estCoef: input.coef ? cloneCoef(input.coef) : null,
    // ставки, на которых считали: без них нельзя сравнивать старую цену с новой
    estPrices: settings.prices ? { ...DEFAULT_COEF_PRICES, ...settings.prices } : null,
    factBlankW,
    factBlankH,
    factPricePerPcs,
    factPriceBatch,
    factQty,
    createdAt: row.created_at ? String(row.created_at) : null,
  };
}

/** Дефолт-ставки для строк, где история цен не сохранилась. */
const DEFAULT_COEF_PRICES: PriceSettings = {
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

/** запись → эталон для calibrate.fitCoef (тот же формат, что у FIXTURES) */
export function sampleToFixture(s: DieCalcSample): Fixture | null {
  if (s.construction === 'blank') return null;
  if (!(s.factBlankW! > 0) || !(s.factBlankH! > 0)) return null;
  return {
    id: `job:${s.id}`,
    order: s.name || s.id,
    mark: s.name || `${s.construction}-${s.L}*${s.W}*${s.H}-${s.profileId}`,
    construction: s.construction,
    closure: s.closure,
    L: s.L,
    W: s.W,
    H: s.H,
    profile: s.profileId,
    blankW: s.factBlankW as number,
    blankH: s.factBlankH as number,
    dieW: (s.factBlankW as number) + 80,
    dieH: (s.factBlankH as number) + 80,
    perDie: 1,
    face: 'stamp',
    knives: { cut: 0, crease: 0, perf: 0, tech: 0, total: 0, outline: 0, mark: 0 },
    note: 'из сохранённых расчётов',
  };
}

const thicknessOf = (profileId: string, profiles: Profile[]): number =>
  (profiles.find((p) => p.id === profileId || p.flute === profileId) ?? profiles[0])?.thickness ?? 1.6;

/** средняя |ошибка| предсказания габарита по эталонам, мм (по обеим осям) */
function blankError(coef: Coef, fixtures: Fixture[], profiles: Profile[]): number {
  let sum = 0;
  for (const f of fixtures) {
    const t = thicknessOf(f.profile, profiles);
    const p = predictBlank(f, coef, t);
    sum += Math.abs(p.w - f.blankW) + Math.abs(p.h - f.blankH);
  }
  return fixtures.length ? round(sum / (fixtures.length * 2), 1) : 0;
}

export interface LearnOptions {
  /** сколько записей нужно, чтобы трогать геометрию (по умолчанию 2) */
  minGeoSamples?: number;
  /** сколько записей нужно, чтобы трогать цену (по умолчанию 2) */
  minPriceSamples?: number;
  /** текущая таблица коэффициентов — если у записей она не сохранена */
  baseCoefs?: Record<ConstructionId, Coef>;
}

/**
 * Обучение по подтверждённым записям.
 *
 * Возвращает модель, которую можно положить в `die_calc_models.model` (jsonb):
 * geo — выученные припуски по конструкциям, price — поправочные множители цены
 * по группам, notes — что интерфейс покажет человеком.
 */
export function learnModel(
  samples: DieCalcSample[],
  profiles: Profile[],
  opts: LearnOptions = {},
): DieCalcModel {
  const minGeo = Math.max(1, opts.minGeoSamples ?? 2);
  const minPrice = Math.max(1, opts.minPriceSamples ?? 2);
  const notes: string[] = [];

  /* ————— 1. геометрия ————— */
  const usable = samples.filter((s) => s.construction !== 'blank' && (s.factBlankW ?? 0) > 0 && (s.factBlankH ?? 0) > 0);
  const geo: GeoLesson[] = [];
  for (const cons of CONSTRUCTIONS) {
    if (cons.id === 'blank') continue;
    const list = usable.filter((s) => s.construction === cons.id);
    if (!list.length) continue;
    const fixtures = list.map(sampleToFixture).filter((f): f is Fixture => f !== null);
    if (!fixtures.length) continue;

    // стартуем с коэффициента последней по времени записи (обычно — уже
    // подогнанной вручную), иначе обучение каждый раз обнуляло бы калибровку
    const newest = list.slice().sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0];
    const base = newest?.estCoef ?? opts.baseCoefs?.[cons.id] ?? DEFAULT_COEF[cons.id];

    const errBeforeMm = blankError(base, fixtures, profiles);
    if (fixtures.length < minGeo) {
      geo.push({
        construction: cons.id,
        n: fixtures.length,
        errBeforeMm,
        errAfterMm: errBeforeMm,
        errAfterPct: errPct(errBeforeMm, fixtures),
        coef: cloneCoef(base),
        fitted: false,
      });
      notes.push(`${cons.name}: записей ${fixtures.length}, для подгонки нужно ${minGeo} — геометрию не меняли`);
      continue;
    }
    const fit = fitCoef(base, fixtures, profiles);
    const errAfterMm = blankError(fit.coef, fixtures, profiles);
    // подгонка может чуть ухудшить конкретный набор — тогда не применяем
    const coef = errAfterMm <= errBeforeMm ? fit.coef : cloneCoef(base);
    const errFinal = errAfterMm <= errBeforeMm ? errAfterMm : errBeforeMm;
    geo.push({
      construction: cons.id,
      n: fixtures.length,
      errBeforeMm,
      errAfterMm: errFinal,
      errAfterPct: errPct(errFinal, fixtures),
      coef,
      fitted: errAfterMm <= errBeforeMm,
    });
    notes.push(
      errAfterMm <= errBeforeMm
        ? `${cons.name}: ${fixtures.length} записей, ошибка габарита ${errBeforeMm} мм → ${errAfterMm} мм`
        : `${cons.name}: ${fixtures.length} записей, подгонка не улучшила результат (${errBeforeMm} мм) — оставили ваши коэффициенты`,
    );
  }
  if (!geo.length) notes.push('нет подтверждённых записей с фактическим габаритом заготовки — геометрия не обучается');

  /* ————— 2. цена ————— */
  // отношение «цена за штуку, которую согласовали» / «цена за штуку, которую посчитали».
  // если указана только сумма партии — делим на фактический тираж (или на расчётный)
  const ratios: Array<{ s: DieCalcSample; ratio: number }> = [];
  for (const s of samples) {
    let fact = s.factPricePerPcs;
    if (fact === null && s.factPriceBatch !== null) {
      const q = s.factQty && s.factQty > 0 ? s.factQty : s.qty;
      fact = q > 0 ? s.factPriceBatch / q : null;
    }
    if (fact === null || !(s.estPricePerPcs > 0) || !(fact > 0)) continue;
    ratios.push({ s, ratio: fact / s.estPricePerPcs });
  }
  const price: PriceLesson[] = [];
  if (ratios.length) {
    const groups = new Map<string, Array<{ s: DieCalcSample; ratio: number }>>();
    const put = (key: string, item: { s: DieCalcSample; ratio: number }): void => {
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    };
    for (const item of ratios) {
      const { construction, closure, profileId } = item.s;
      put(`${construction}|${closure}|${profileId}`, item);
      put(`${construction}|*|*`, item);
      put(`*|*|*`, item);
    }
    for (const [key, list] of Array.from(groups)) {
      if (list.length < minPrice) continue;
      const rs = dropOutliers(list.map((x) => x.ratio));
      const k = median(rs) ?? 1;
      const logs = rs.map((r) => Math.abs(Math.log(r)));
      const [construction, closure, profileId] = key.split('|');
      price.push({
        key,
        construction: (isCons(construction) ? construction : '*') as ConstructionId | '*',
        closure: (isClosure(closure) ? closure : '*') as ClosureId | '*',
        profileId: profileId ?? '*',
        n: rs.length,
        k: round(k, 4),
        kMean: round(mean(rs), 4),
        spreadPct: round((median(logs) ?? 0) * 100, 1),
      });
    }
    // точные группы — вверх: они точнее
    price.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
    const top = price.find((p) => !p.key.startsWith('*'));
    if (top) {
      const d = round((top.k - 1) * 100, 1);
      notes.push(`цена: ${top.n} подтверждённых записей (${groupName(top)}), факт ${d >= 0 ? '+' : ''}${d} % к расчёту`);
    }
  } else {
    notes.push('нет записей с подтверждённой ценой — цену не корректируем');
  }

  return {
    version: MODEL_VERSION,
    trainedAt: new Date().toISOString(),
    n: samples.length,
    geo,
    price,
    notes,
  };
}

function errPct(errMm: number, fixtures: Fixture[]): number {
  if (!fixtures.length) return 0;
  const avg = mean(fixtures.map((f) => (f.blankW + f.blankH) / 2)) || 1;
  return round((errMm / avg) * 100, 1);
}

function groupName(p: PriceLesson): string {
  const cons = CONSTRUCTIONS.find((c) => c.id === p.construction);
  const clo = CLOSURES.find((c) => c.id === p.closure);
  const parts = [cons?.name ?? 'все конструкции', clo?.name ?? 'любой замок', p.profileId === '*' ? 'любой профиль' : `профиль ${p.profileId}`];
  return parts.join(' · ');
}

/** выученная геометрия → таблица коэффициентов для движка */
export function learnedCoefs(
  current: Record<ConstructionId, Coef>,
  model: DieCalcModel | null | undefined,
): { coefs: Record<ConstructionId, Coef>; applied: ConstructionId[] } {
  const out = {} as Record<ConstructionId, Coef>;
  for (const k of Object.keys(current) as ConstructionId[]) out[k] = cloneCoef(current[k]);
  const applied: ConstructionId[] = [];
  if (!model) return { coefs: out, applied };
  for (const g of model.geo) {
    if (!g.fitted) continue;
    out[g.construction] = cloneCoef(g.coef);
    applied.push(g.construction);
  }
  return { coefs: out, applied };
}

export function geoLessonFor(model: DieCalcModel | null | undefined, construction: ConstructionId): GeoLesson | null {
  if (!model) return null;
  return model.geo.find((g) => g.construction === construction && g.fitted) ?? null;
}

/**
 * Множитель цены для пары (конструкция, замок, профиль).
 * Цепочка: точная группа → вся конструкция → весь прайс → 1 (правки нет).
 */
export function priceFactorFor(
  model: DieCalcModel | null | undefined,
  sel: { construction: ConstructionId; closure: ClosureId; profileId: string },
): { k: number; n: number; label: string; spreadPct: number } {
  if (!model) return { k: 1, n: 0, label: 'прайс по ставкам', spreadPct: 0 };
  const find = (key: string): PriceLesson | undefined => model.price.find((p) => p.key === key);
  const exact = find(`${sel.construction}|${sel.closure}|${sel.profileId}`);
  if (exact) return { k: exact.k, n: exact.n, label: groupName(exact), spreadPct: exact.spreadPct };
  const cons = find(`${sel.construction}|*|*`);
  if (cons) return { k: cons.k, n: cons.n, label: groupName(cons), spreadPct: cons.spreadPct };
  const all = find('*|*|*');
  if (all) return { k: all.k, n: all.n, label: groupName(all), spreadPct: all.spreadPct };
  return { k: 1, n: 0, label: 'прайс по ставкам', spreadPct: 0 };
}

export interface ScaledCost {
  die: number;
  batch: number;
  perPcs: number;
  perPcsWithDie: number;
  withVat: number;
  k: number;
}

/**
 * Цена «как принято на производстве»: расчёт умножается на выученный
 * множитель. Сами ставки не правим — иначе нельзя показать, что именно
 * дало обучение.
 */
export function applyPriceFactor(cost: CostResult, k: number): ScaledCost {
  const kk = k > 0 ? k : 1;
  return {
    die: round(cost.die.total * kk, 0),
    batch: round(cost.batch.total * kk, 0),
    perPcs: round(cost.perPcs * kk, 2),
    perPcsWithDie: round(cost.perPcsWithDie * kk, 2),
    withVat: round(cost.withVat * kk, 0),
    k: kk,
  };
}

/* ─────────────────────────── пакеты для базы ─────────────────────────── */

/**
 * Что отправляем в POST/PATCH /api/admin/die-calc: колонки таблицы +
 * jsonb, из которого потом можно полностью восстановить расчёт.
 */
export interface JobPayload {
  order_no: string;
  name: string;
  customer: string | null;
  status: string;
  note: string | null;
  construction: ConstructionId;
  closure: ClosureId;
  profile_id: string;
  l_mm: number;
  w_mm: number;
  h_mm: number;
  qty: number;
  blank_w: number;
  blank_h: number;
  die_w: number;
  die_h: number;
  blank_area_m2: number;
  knives_m: number;
  per_sheet: number;
  sheets: number;
  price_die: number;
  price_batch: number;
  price_per_pcs: number;
  price_with_vat: number;
  /** всё для точного повтора: ввод + справочники + коэффициенты */
  settings: { input: BoxInput; prices: PriceSettings; profiles: Profile[]; sheets: SheetFormat[]; customDrawing?: CustomDrawing };
  result: Record<string, unknown>;
}

const r = (v: number, d = 2): number => round(num(v), d);

/** CalcResult → колонки строки die_calc_jobs */
export function packJob(
  res: CalcResult,
  meta: {
    orderNo?: string;
    name?: string;
    customer?: string | null;
    status?: string;
    note?: string | null;
    prices: PriceSettings;
    profiles: Profile[];
    sheets: SheetFormat[];
    customDrawing?: CustomDrawing;
  },
): JobPayload {
  const input = res.input;
  const cons = CONSTRUCTIONS.find((c) => c.id === input.construction);
  const clo = CLOSURES.find((c) => c.id === input.closure);
  const name =
    meta.name?.trim() ||
    (input.construction === 'blank'
      ? `заготовка ${Math.round(res.area.blankW)}*${Math.round(res.area.blankH)}`
      : `${cons?.code ?? input.construction}-${input.L}*${input.W}*${input.H}-${input.profileId} ${clo?.id ?? ''}`.trim());
  return {
    order_no: meta.orderNo ?? '',
    name,
    customer: meta.customer ?? null,
    status: meta.status ?? 'draft',
    note: meta.note ?? null,
    construction: input.construction,
    closure: input.closure,
    profile_id: input.profileId,
    l_mm: r(input.L),
    w_mm: r(input.W),
    h_mm: r(input.H),
    qty: Math.max(1, Math.round(input.qty)),
    blank_w: r(res.area.blankW, 1),
    blank_h: r(res.area.blankH, 1),
    die_w: r(res.area.dieW, 1),
    die_h: r(res.area.dieH, 1),
    blank_area_m2: r(res.area.blankAreaM2, 6),
    knives_m: r(res.knives.totalM, 3),
    per_sheet: Math.max(0, Math.round(res.nest.perSheet)),
    sheets: Math.max(0, Math.round(res.nest.sheets)),
    price_die: r(res.cost.die.total, 2),
    price_batch: r(res.cost.batch.total, 2),
    price_per_pcs: r(res.cost.perPcs, 2),
    price_with_vat: r(res.cost.withVat, 2),
    settings: {
      input: JSON.parse(JSON.stringify(input)) as BoxInput,
      prices: { ...meta.prices },
      profiles: meta.profiles.map((p) => ({ ...p })),
      sheets: meta.sheets.map((s) => ({ ...s })),
      ...(meta.customDrawing ? { customDrawing: JSON.parse(JSON.stringify(meta.customDrawing)) as CustomDrawing } : {}),
    },
    result: {
      version: MODEL_VERSION,
      area: res.area,
      knives: res.knives,
      nest: { sheet: res.nest.sheet, perSheet: res.nest.perSheet, utilization: res.nest.utilization, sheets: res.nest.sheets },
      cost: res.cost,
      warnings: res.warnings,
    },
  };
}

/** одна строка → поля факта (то, что человек подтверждает в таблице) */
export function factFromRow(row: Record<string, unknown>): { blankW: number; blankH: number; pricePerPcs: number | null; priceBatch: number | null; qty: number | null } {
  const blankW = num(row.blank_w);
  const blankH = num(row.blank_h);
  const fw = numOrNull(row.fact_blank_w);
  const fh = numOrNull(row.fact_blank_h);
  return {
    blankW: fw && fw > 0 ? fw : blankW,
    blankH: fh && fh > 0 ? fh : blankH,
    pricePerPcs: numOrNull(row.fact_price_per_pcs),
    priceBatch: numOrNull(row.fact_price_batch),
    qty: numOrNull(row.fact_qty),
  };
}

/**
 * Человекочитаемое резюме модели — для плашки «чему научились» в интерфейсе.
 */
export function describeModel(model: DieCalcModel | null | undefined): string[] {
  if (!model || !model.n) return ['Обучения ещё нет: сохраните расчёт и подтвердите факт (габарит с матрицы, реальную цену).'];
  const lines: string[] = [`записей в модели: ${model.n} (${new Date(model.trainedAt).toLocaleString('ru-RU')})`];
  for (const g of model.geo) {
    const cons = CONSTRUCTIONS.find((c) => c.id === g.construction);
    lines.push(
      g.fitted
        ? `${cons?.name ?? g.construction}: габарит заготовки точнее на ${round(g.errBeforeMm - g.errAfterMm, 1)} мм (${g.errBeforeMm} → ${g.errAfterMm} мм, ${g.n} записей)`
        : `${cons?.name ?? g.construction}: записей ${g.n} — мало для подгонки`,
    );
  }
  for (const p of model.price.slice(0, 3)) {
    const d = round((p.k - 1) * 100, 1);
    lines.push(`${groupName(p)}: цена ${d >= 0 ? '+' : ''}${d} % к расчёту (${p.n} записей, разброс ±${p.spreadPct} %)`);
  }
  return lines;
}
