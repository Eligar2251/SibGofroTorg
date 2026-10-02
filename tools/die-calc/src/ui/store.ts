/**
 * store.ts — состояние калькулятора + настройки (справочники, цены).
 * Никаких библиотек: useState + localStorage. При интеграции в Next.js
 * замените persist/restore на свой стор (Zustand/RTK) — логика расчёта не изменится.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CONSTRUCTIONS,
  DEFAULT_COEF,
  DEFAULT_DIE,
  DEFAULT_NESTING,
  DEFAULT_OPTIONS,
  DEFAULT_PRICES,
  DEFAULT_PROFILES,
  DEFAULT_SHEETS,
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
import { baseSettings, calcBox, makeInput } from '../core/index';
import type { CalcResult, CalcSettings } from '../core/index';
import type { LineKind } from '../core/geo';
import { calibReport, fitAll, type CalibRow } from '../core/calibrate';
import { geoLessonFor, learnedCoefs, priceFactorFor, type DieCalcModel } from '../core/learn';
import type { Fixture } from '../core/fixtures';
import { emptyCustomDrawing, type CustomDrawing } from '../core/custom';

export interface AppState {
  L: number;
  W: number;
  H: number;
  profileId: string;
  construction: ConstructionId;
  closure: ClosureId;
  qty: number;
  orderNo: string;
  options: Options;
  die: DieSettings;
  nesting: NestingSettings;
  /** чертёж произвольной штанцформы (сетка, линии, контуры, размеры) */
  customDrawing: CustomDrawing;
  /** режим «по чертежу матрицы» */
  blankW: number;
  blankH: number;
  blankAreaM2: number;
  /** коэффициенты по конструкциям (калибровка их правит) */
  coefs: Record<ConstructionId, Coef>;
  /** свои эталонные чертежи для подгонки (L,W,H,профиль, габарит с чертежа) */
  customFixtures: Fixture[];
  /** применять выученную на сохранённых расчётах модель (см. core/learn.ts) */
  useLearned: boolean;
  // вью
  showDie: boolean;
  showDims: boolean;
  showFills: boolean;
  layers: Record<LineKind, boolean>;
  progress: number;
  yaw: number;
  pitch: number;
  sheetId: string;
}

export interface SettingsState {
  profiles: Profile[];
  sheets: SheetFormat[];
  prices: PriceSettings;
  labelSize: { w: number; h: number };
}

export const DEFAULT_STATE: AppState = {
  L: 240,
  W: 180,
  H: 60,
  profileId: 'E',
  construction: 'lastochkin',
  closure: 'tuck',
  qty: 5000,
  orderNo: '',
  options: { ...DEFAULT_OPTIONS },
  die: { ...DEFAULT_DIE },
  nesting: { ...DEFAULT_NESTING },
  blankW: 550,
  blankH: 513,
  blankAreaM2: 0,
  customDrawing: emptyCustomDrawing(),
  customFixtures: [],
  useLearned: true,
  coefs: (() => {
    const o = {} as Record<ConstructionId, Coef>;
    for (const k of Object.keys(DEFAULT_COEF) as ConstructionId[]) o[k] = cloneCoef(DEFAULT_COEF[k]);
    return o;
  })(),
  showDie: false,
  showDims: true,
  showFills: true,
  layers: { cut: true, crease: true, perf: true, tech: true, mark: true },
  progress: 1,
  yaw: -55,
  pitch: 32,
  sheetId: 'auto',
};

export const DEFAULT_SETTINGS: SettingsState = {
  profiles: DEFAULT_PROFILES.map((p) => ({ ...p })),
  sheets: DEFAULT_SHEETS.map((s) => ({ ...s })),
  prices: { ...DEFAULT_PRICES },
  labelSize: { w: 250, h: 200 },
};

const KEY = 'sibgofro-diecalc-v1';

function load(): { state?: Partial<AppState>; settings?: Partial<SettingsState> } {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as { state?: Partial<AppState>; settings?: Partial<SettingsState> }) : {};
  } catch {
    return {};
  }
}

export function makeOrderNo(): string {
  const d = new Date();
  const prev = Number(localStorage.getItem('sibgofro-order-seq') ?? '1199');
  const next = Number.isFinite(prev) ? prev + 1 : 1200;
  try {
    localStorage.setItem('sibgofro-order-seq', String(next));
  } catch {
    /* SSR/no-storage */
  }
  const p = (n: number, l = 2): string => String(n).padStart(l, '0');
  return `${p(next, 4)}-${p(d.getMonth() + 1)}-${p(d.getFullYear() % 100)}`;
}

export interface UseCalc {
  state: AppState;
  setState: (patch: Partial<AppState>) => void;
  setOptions: (patch: Partial<Options>) => void;
  setNesting: (patch: Partial<NestingSettings>) => void;
  setDie: (patch: Partial<DieSettings>) => void;
  setCoef: (cons: ConstructionId, patch: Partial<Coef>) => void;
  settings: SettingsState;
  setSettings: (patch: Partial<SettingsState>) => void;
  input: BoxInput;
  result: CalcResult | null;
  error: string | null;
  calib: { rows: CalibRow[]; run: (extra?: Fixture[]) => void; fitted: boolean };
  resetAll: () => void;
  size: { w: number; h: number };
  /** обучение: выученная модель (из базы) и то, как она применилось к этому расчёту */
  model: DieCalcModel | null;
  learn: {
    /** включать/выключать поправку, не трогая сами коэффициенты */
    on: boolean;
    setOn: (v: boolean) => void;
    /** поправка по габариту действует на этой конструкции */
    geo: boolean;
    geoN: number;
    errBeforeMm: number;
    errAfterMm: number;
    /** множитель цены и откуда он взялся */
    priceK: number;
    priceN: number;
    priceLabel: string;
    priceSpreadPct: number;
    /** коэффициенты, с которыми реально считается (с учётом модели) */
    effectiveCoef: Coef;
  };
  /** залить состояние извне (загрузка сохранённого расчёта из базы) */
  hydrate: (patch: Partial<AppState>, settings?: Partial<SettingsState>) => void;
}

export interface UseCalcOptions {
  /** начальное состояние — напр. сохранённый расчёт из die_calc_jobs */
  initial?: Partial<AppState> | null;
  /** начальные ставки/справочники (общий прайс из базы) */
  initialSettings?: Partial<SettingsState> | null;
  /** выученная модель: die_calc_models.model */
  model?: DieCalcModel | null;
}

export function useCalc(opts: UseCalcOptions = {}): UseCalc {
  const saved = useMemo(() => load(), []);
  // порядок слияния: дефолт → localStorage → то, что принесли снаружи
  // (сохранённый расчёт из базы / общий прайс). Снаружи важнее: иначе
  // «открыть расчёт №1200» показало бы чужой локальный черновик.
  const initial = opts.initial ?? null;
  const initialSettings = opts.initialSettings ?? null;
  const model = opts.model ?? null;
  const [state, setRaw] = useState<AppState>({
    ...DEFAULT_STATE,
    ...(saved.state ?? {}),
    ...(initial ?? {}),
    coefs: { ...DEFAULT_STATE.coefs, ...((saved.state ?? {}).coefs ?? {}), ...((initial ?? {}).coefs ?? {}) },
    options: { ...DEFAULT_STATE.options, ...((saved.state ?? {}).options ?? {}), ...((initial ?? {}).options ?? {}) },
    layers: { ...DEFAULT_STATE.layers, ...((saved.state ?? {}).layers ?? {}), ...((initial ?? {}).layers ?? {}) },
  });
  const [settings, setSettingsRaw] = useState<SettingsState>({
    ...DEFAULT_SETTINGS,
    ...(saved.settings ?? {}),
    ...(initialSettings ?? {}),
    prices: { ...DEFAULT_SETTINGS.prices, ...((saved.settings ?? {}).prices ?? {}), ...((initialSettings ?? {}).prices ?? {}) },
  });
  const [calibRows, setCalibRows] = useState<CalibRow[] | null>(null);
  const [fitted, setFitted] = useState(false);

  useEffect(() => {
    if (!state.orderNo) setRaw((s) => ({ ...s, orderNo: makeOrderNo() }));
  }, [state.orderNo]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ state, settings }));
    } catch {
      /* quota */
    }
  }, [state, settings]);

  const setState = useCallback((patch: Partial<AppState>) => setRaw((s) => ({ ...s, ...patch })), []);
  const setOptions = useCallback((patch: Partial<Options>) => setRaw((s) => ({ ...s, options: { ...s.options, ...patch } })), []);
  const setNesting = useCallback((patch: Partial<NestingSettings>) => setRaw((s) => ({ ...s, nesting: { ...s.nesting, ...patch } })), []);
  const setDie = useCallback((patch: Partial<DieSettings>) => setRaw((s) => ({ ...s, die: { ...s.die, ...patch } })), []);
  const setCoef = useCallback(
    (cons: ConstructionId, patch: Partial<Coef>) =>
      setRaw((s) => ({ ...s, coefs: { ...s.coefs, [cons]: { ...s.coefs[cons], ...patch } } })),
    [],
  );
  const setSettings = useCallback(
    (patch: Partial<SettingsState>) => setSettingsRaw((s) => ({ ...s, ...patch })),
    [],
  );
  const resetAll = useCallback(() => {
    setRaw({ ...DEFAULT_STATE, orderNo: state.orderNo });
    setSettingsRaw(DEFAULT_SETTINGS);
    setCalibRows(null);
    setFitted(false);
  }, [state.orderNo]);

  // выученная модель перекрывает коэффициенты, но НЕ трогает ручную
  // подгонку: state.coefs остаётся как есть, поправка применяется на лету
  const coefsForCalc = useMemo(
    () => (state.useLearned ? learnedCoefs(state.coefs, model).coefs : state.coefs),
    [state.coefs, state.useLearned, model],
  );

  const input = useMemo<BoxInput>(() => {
    const cons = CONSTRUCTIONS.find((c) => c.id === state.construction) as (typeof CONSTRUCTIONS)[number];
    const base = makeInput({
      L: state.L,
      W: state.W,
      H: state.H,
      profile: state.profileId,
      construction: state.construction,
      closure: (cons.closures.includes(state.closure) ? state.closure : cons.closures[0]) as ClosureId,
      qty: state.qty,
      blank: state.construction === 'blank' ? { w: state.blankW, h: state.blankH } : undefined,
    });
    return {
      ...base,
      options: state.options,
      die: state.die,
      nesting: state.nesting,
      coef: coefsForCalc[state.construction] ?? DEFAULT_COEF[state.construction],
      blankArea: state.blankAreaM2 > 0 ? Math.round(state.blankAreaM2 * 1e6) : undefined,
    };
  }, [state, coefsForCalc]);

  const calcSettings = useMemo<CalcSettings>(() => {
    const bs = baseSettings({ prices: settings.prices, profiles: settings.profiles, labelSize: settings.labelSize });
    const sheets = state.sheetId === 'auto' ? settings.sheets : settings.sheets.filter((s) => s.id === state.sheetId);
    return { ...bs, sheets: sheets.length ? sheets : bs.sheets };
  }, [settings, state.sheetId]);

  const { result, error } = useMemo(() => {
    try {
      return { result: calcBox({ input, settings: calcSettings }), error: null as string | null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [input, calcSettings]);

  const run = useCallback(
    (extra: Fixture[] = []) => {
      const fit = fitAll(settings.profiles, state.customFixtures.concat(extra));
      setRaw((s) => ({ ...s, coefs: fit.coefs }));
      setCalibRows(fit.after);
      setFitted(true);
    },
    [settings.profiles, state.customFixtures],
  );

  const hydrate = useCallback((patch: Partial<AppState>, extra?: Partial<SettingsState>) => {
    setRaw((s) => ({
      ...s,
      ...patch,
      coefs: { ...s.coefs, ...(patch.coefs ?? {}) },
      options: { ...s.options, ...(patch.options ?? {}) },
    }));
    if (extra) setSettingsRaw((x) => ({ ...x, ...extra, prices: { ...x.prices, ...(extra.prices ?? {}) } }));
  }, []);

  const learn = useMemo(() => {
    const geo = state.useLearned ? geoLessonFor(model, state.construction) : null;
    const pf = priceFactorFor(state.useLearned ? model : null, {
      construction: state.construction,
      closure: state.closure,
      profileId: state.profileId,
    });
    return {
      on: state.useLearned,
      setOn: (v: boolean) => setRaw((s) => ({ ...s, useLearned: v })),
      geo: !!geo,
      geoN: geo?.n ?? 0,
      errBeforeMm: geo?.errBeforeMm ?? 0,
      errAfterMm: geo?.errAfterMm ?? 0,
      priceK: pf.k,
      priceN: pf.n,
      priceLabel: pf.label,
      priceSpreadPct: pf.spreadPct,
      effectiveCoef: coefsForCalc[state.construction] ?? DEFAULT_COEF[state.construction],
    };
  }, [coefsForCalc, model, state.construction, state.closure, state.profileId, state.useLearned]);

  const size = useMemo(() => {
    const p = settings.profiles.find((x) => x.id === state.profileId) ?? settings.profiles[0];
    void p;
    return { w: result?.area.blankW ?? 0, h: result?.area.blankH ?? 0 };
  }, [result, settings.profiles, state.profileId]);

  return {
    state,
    setState,
    setOptions,
    setNesting,
    setDie,
    setCoef,
    settings,
    setSettings,
    input,
    result,
    error,
    calib: { rows: calibRows ?? defaultRows(settings), run, fitted },
    resetAll,
    size,
    model,
    learn,
    hydrate,
  };
}

/** до подгонки — просто отчёт по дефолтным коэффициентам */
function defaultRows(settings: SettingsState): CalibRow[] {
  try {
    return calibReport(DEFAULT_COEF, settings.profiles);
  } catch {
    return [];
  }
}
