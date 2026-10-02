'use client';

/**
 * SimpleDieCalc.tsx — упрощённый калькулятор штанцформы.
 *
 * Ввод: тип коробки, L, W, H  →  вывод: размер заготовки, площадь, раскладка.
 * Система обучается на реальных данных (чертежах матриц), которые вы вводите сами.
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import { packOnce } from '@/lib/die-calc/nesting';
import '@/app/admin-die-calc.css';

/* ═══════════════════ Типы ═══════════════════ */

type BoxTypeId = 'lastochkin' | 'yazyk' | 'ushki' | 'lotok';

interface BoxType {
  id: BoxTypeId;
  name: string;
  code: string;
}

interface TrainingPoint {
  id: string;
  boxType: BoxTypeId;
  L: number;
  W: number;
  H: number;
  blankW: number;
  blankH: number;
  date: string;
  note?: string;
}

interface Prediction {
  blankW: number;
  blankH: number;
  areaM2: number;
  source: string;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  dataCount: number;
}

/* ═══════════════════ Константы ═══════════════════ */

const BOX_TYPES: BoxType[] = [
  { id: 'lastochkin', name: 'Ласточкин хвост', code: '0215' },
  { id: 'yazyk', name: 'Крышка с язычком', code: '0470' },
  { id: 'ushki', name: 'Крышка с ушками', code: '0427' },
  { id: 'lotok', name: 'Лоток телевизор (без крышки)', code: '0436' },
];

/** Ваши эталонные данные из чертежей */
const DEFAULT_TRAINING: TrainingPoint[] = [
  // Ласточкин хвост
  { id: 'd1', boxType: 'lastochkin', L: 90, W: 90, H: 120, blankW: 387, blankH: 303, date: '2025-01-01', note: 'E' },
  { id: 'd2', boxType: 'lastochkin', L: 110, W: 110, H: 120, blankW: 471, blankH: 343, date: '2025-01-01', note: 'E' },
  // Крышка с язычком
  { id: 'd3', boxType: 'yazyk', L: 240, W: 180, H: 60, blankW: 610, blankH: 518, date: '2025-01-01', note: 'E' },
  { id: 'd4', boxType: 'yazyk', L: 235, W: 103, H: 60, blankW: 451, blankH: 459, date: '2025-01-01', note: 'E' },
  // Крышка с ушками
  { id: 'd5', boxType: 'ushki', L: 125, W: 110, H: 125, blankW: 575, blankH: 618, date: '2025-01-01', note: 'E' },
  { id: 'd6', boxType: 'ushki', L: 240, W: 180, H: 60, blankW: 550, blankH: 513, date: '2025-01-01', note: 'E' },
  { id: 'd7', boxType: 'ushki', L: 100, W: 100, H: 350, blankW: 849, blankH: 610, date: '2025-01-01', note: 'BC' },
  // Лоток телевизор
  { id: 'd8', boxType: 'lotok', L: 380, W: 280, H: 60, blankW: 666, blankH: 480, date: '2025-01-01', note: 'B' },
  { id: 'd9', boxType: 'lotok', L: 255, W: 190, H: 60, blankW: 513, blankH: 400, date: '2025-01-01', note: 'B' },
];

const STORAGE_KEY = 'sibgofro-simple-die-v3';

/* ═══════════════════ Утилиты ═══════════════════ */

const r2 = (n: number): number => Math.round(n * 100) / 100;
const rnd = (n: number): number => Math.round(n);

function decl(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m100 >= 11 && m100 <= 19) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
}

function genId(): string {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ═══════════════════ Линейная алгебра ═══════════════════ */

/** Решение СЛАУ методом Гаусса с выбором главного элемента */
function solve(A: number[][], b: number[]): number[] {
  const n = A.length, m = A[0].length;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < Math.min(n, m); c++) {
    let mx = Math.abs(aug[c][c]), mr = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(aug[r][c]) > mx) { mx = Math.abs(aug[r][c]); mr = r; }
    }
    if (mr !== c) [aug[c], aug[mr]] = [aug[mr], aug[c]];
    if (Math.abs(aug[c][c]) < 1e-12) continue;
    for (let r = c + 1; r < n; r++) {
      const f = aug[r][c] / aug[c][c];
      for (let j = c; j <= m; j++) aug[r][j] -= f * aug[c][j];
    }
  }
  const x = new Array(m).fill(0);
  for (let i = Math.min(n, m) - 1; i >= 0; i--) {
    if (Math.abs(aug[i][i]) < 1e-12) continue;
    x[i] = aug[i][m];
    for (let j = i + 1; j < m; j++) x[i] -= aug[i][j] * x[j];
    x[i] /= aug[i][i];
  }
  return x;
}

/** Метод наименьших квадратов через нормальные уравнения */
function lsq(A: number[][], b: number[]): number[] {
  const n = A.length, m = A[0].length;
  const M: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < n; k++) M[i][j] += A[k][i] * A[k][j];
    }
    for (let k = 0; k < n; k++) M[i][m] += A[k][i] * b[k];
  }
  return solve(M, M.map(row => row[m]));
}

/* ═══════════════════ Предсказание ═══════════════════ */

/**
 * Формулы по умолчанию — подогнаны по начальным данным.
 * Используются, когда данных для обучения нет или мало.
 *
 * blankW = a*(L+W) + b*H + c
 * blankH = d*(L+W) + e*H + f
 */
const DEFS: Record<BoxTypeId, {
  w: (l: number, w: number, h: number) => number;
  h: (l: number, w: number, h: number) => number;
}> = {
  lastochkin: {
    // Из 90×90×120→387×303 и 110×110×120→471×343
    w: (l, w, h) => 2.1 * (l + w) + 9,
    h: (l, w, h) => l + w + h + 3,
  },
  yazyk: {
    // Из 240×180×60→610×518 и 235×103×60→451×459
    w: (l, w, _h) => l + 2 * w + 10,
    h: (_l, w, h) => 0.77 * w + 2 * h + 260,
  },
  ushki: {
    // Из 3 точек: blankW = 0.31*(L+W) + 1.27*H + 344
    w: (l, w, h) => 0.31 * (l + w) + 1.27 * h + 344,
    h: (l, w, h) => l + w + h + 3, // запасной вариант, корректируется данными
  },
  lotok: {
    // Из 380×280×60→666×480 и 255×190×60→513×400 (оба H=60)
    w: (l, w, _h) => 0.712 * (l + w) + 196,
    h: (l, w, h) => 0.372 * (l + w) + 2 * h + 114,
  },
};

function predictBlank(
  bt: BoxTypeId,
  L: number, W: number, H: number,
  data: TrainingPoint[],
): Prediction {
  const td = data.filter(d => d.boxType === bt);
  const def = DEFS[bt];

  // Точное совпадение
  const exact = td.find(d => d.L === L && d.W === W && d.H === H);
  if (exact) {
    return {
      blankW: exact.blankW, blankH: exact.blankH,
      areaM2: r2(exact.blankW * exact.blankH / 1e6),
      source: 'точное совпадение',
      confidence: 'exact',
      dataCount: td.length,
    };
  }

  // Нет данных — формула по умолчанию
  if (td.length === 0) {
    const w = rnd(def.w(L, W, H)), h = rnd(def.h(L, W, H));
    return {
      blankW: w, blankH: h,
      areaM2: r2(w * h / 1e6),
      source: 'формула по умолчанию',
      confidence: 'low',
      dataCount: 0,
    };
  }

  // Подгонка по данным
  const fit = (key: 'blankW' | 'blankH'): number => {
    const vals = td.map(d => d[key]);
    const n = td.length;
    const defFn = key === 'blankW' ? def.w : def.h;

    // 1 точка: масштабируем формулу
    if (n === 1) {
      const defVal = defFn(td[0].L, td[0].W, td[0].H);
      const ratio = defVal > 0 ? vals[0] / defVal : 1;
      return rnd(defFn(L, W, H) * ratio);
    }

    // 2 точки: value = a*(L+W) + d или a*(L+W) + H + d
    if (n === 2) {
      const sameH = Math.abs(td[0].H - td[1].H) < 1;
      const x1 = td[0].L + td[0].W, x2 = td[1].L + td[1].W;
      if (Math.abs(x2 - x1) < 0.5) return rnd(defFn(L, W, H));
      if (sameH) {
        const a = (vals[1] - vals[0]) / (x2 - x1);
        return rnd(a * (L + W) + vals[0] - a * x1);
      }
      const y1 = vals[0] - td[0].H, y2 = vals[1] - td[1].H;
      const a = (y2 - y1) / (x2 - x1);
      return rnd(a * (L + W) + H + y1 - a * x1);
    }

    // 3 точки: value = a*(L+W) + c*H + d
    if (n === 3) {
      const A = td.map(d => [d.L + d.W, d.H, 1]);
      try {
        const x = solve(A, vals);
        const v = rnd(x[0] * (L + W) + x[1] * H + x[2]);
        if (isFinite(v) && Math.abs(v) < 15000) return v;
      } catch { /* fallback to IDW */ }
    }

    // 4+ точки: value = a*L + b*W + c*H + d
    if (n >= 4) {
      const A = td.map(d => [d.L, d.W, d.H, 1]);
      try {
        const x = lsq(A, vals);
        const v = rnd(x[0] * L + x[1] * W + x[2] * H + x[3]);
        if (isFinite(v) && Math.abs(v) < 15000) return v;
      } catch { /* fallback to IDW */ }
    }

    // IDW — обратно-взвешенное расстояние
    const dists = td.map(d => ({
      v: d[key],
      dist: Math.sqrt((L - d.L) ** 2 + (W - d.W) ** 2 + (H - d.H) ** 2),
    }));
    dists.sort((a, b) => a.dist - b.dist);
    const K = Math.min(3, dists.length);
    let sw = 0, swt = 0;
    for (let i = 0; i < K; i++) {
      const wt = 1 / (dists[i].dist ** 2 + 1);
      sw += dists[i].v * wt;
      swt += wt;
    }
    return rnd(sw / swt);
  };

  const w = fit('blankW');
  const h = fit('blankH');
  const minDist = Math.min(...td.map(d =>
    Math.sqrt((L - d.L) ** 2 + (W - d.W) ** 2 + (H - d.H) ** 2)
  ));
  const conf: Prediction['confidence'] =
    minDist < 10 ? 'high' : td.length >= 3 ? 'medium' : 'low';

  return {
    blankW: w, blankH: h,
    areaM2: r2(w * h / 1e6),
    source: `обучение (${td.length} ${decl(td.length, 'запись', 'записи', 'записей')})`,
    confidence: conf,
    dataCount: td.length,
  };
}

/* ═══════════════════ Компонент ═══════════════════ */

export function SimpleDieCalc() {
  // ── Ввод коробки ──
  const [boxType, setBoxType] = useState<BoxTypeId>('lotok');
  const [L, setL] = useState(255);
  const [W, setW] = useState(190);
  const [H, setH] = useState(60);

  // ── Лист ──
  const [sheetW, setSheetW] = useState(1200);
  const [sheetH, setSheetH] = useState(800);
  const [rotSheet, setRotSheet] = useState(false);
  const [margin, setMargin] = useState(12);
  const [gap, setGap] = useState(4);
  const [allowRot, setAllowRot] = useState(true);
  const [qty, setQty] = useState(1000);

  // ── Обучающие данные ──
  const [training, setTraining] = useState<TrainingPoint[]>(DEFAULT_TRAINING);
  const [showTrain, setShowTrain] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [addForm, setAddForm] = useState({
    boxType: 'lotok' as BoxTypeId,
    L: 0, W: 0, H: 0, blankW: 0, blankH: 0, note: '',
  });

  // ── Загрузка / сохранение ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { custom?: TrainingPoint[] };
        if (saved.custom?.length) setTraining([...DEFAULT_TRAINING, ...saved.custom]);
      }
    } catch { /* SSR */ }
  }, []);

  const customOnly = training.filter(d => !DEFAULT_TRAINING.some(dd => dd.id === d.id));
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ custom: customOnly })); } catch {}
  }, [customOnly]);

  // ── Расчёт ──
  const pred = useMemo(
    () => predictBlank(boxType, L, W, H, training),
    [boxType, L, W, H, training],
  );

  const sw = rotSheet ? sheetH : sheetW;
  const sh = rotSheet ? sheetW : sheetH;

  const nest = useMemo(() => {
    if (pred.blankW <= 0 || pred.blankH <= 0) return null;
    try {
      return packOnce(
        { w: pred.blankW, h: pred.blankH, areaMm2: pred.blankW * pred.blankH },
        sw, sh,
        { edgeMargin: margin, gapX: gap, gapY: gap, allowRotate: allowRot, trimWaste: false },
      );
    } catch { return null; }
  }, [pred, sw, sh, margin, gap, allowRot]);

  const perSheet = nest?.perSheet ?? 0;
  const sheetsNeeded = perSheet > 0 ? Math.ceil(qty / perSheet) : 0;
  const util = perSheet > 0 ? r2(perSheet * pred.blankW * pred.blankH / (sw * sh)) : 0;

  // ── Обработчики ──
  const addTrainingPoint = useCallback(() => {
    const { boxType: bt, L: l, W: w, H: h, blankW: bw, blankH: bh, note } = addForm;
    if (!l || !w || !h || !bw || !bh) return;
    const point: TrainingPoint = {
      id: genId(), boxType: bt,
      L: l, W: w, H: h, blankW: bw, blankH: bh,
      date: new Date().toISOString().slice(0, 10),
      note: note || undefined,
    };
    setTraining(prev => [...prev, point]);
    setAddMode(false);
    setAddForm({ boxType: 'lotok', L: 0, W: 0, H: 0, blankW: 0, blankH: 0, note: '' });
  }, [addForm]);

  const deletePoint = useCallback((id: string) => {
    setTraining(prev => prev.filter(d => d.id !== id));
  }, []);

  const resetTraining = useCallback(() => {
    if (!confirm('Сбросить все данные к начальным? Пользовательские записи удалятся.')) return;
    setTraining(DEFAULT_TRAINING);
  }, []);

  // ── Вспомогательные ──
  const confIcon: Record<string, string> = { exact: '◉', high: '●', medium: '◐', low: '○' };
  const confColor: Record<string, string> = {
    exact: 'var(--dgc-green)', high: 'var(--dgc-green)',
    medium: 'var(--dgc-warn)', low: 'var(--dgc-bad)',
  };
  const confLabel: Record<string, string> = {
    exact: 'точное', high: 'высокая', medium: 'средняя', low: 'низкая',
  };

  const quickExamples = DEFAULT_TRAINING.filter(d =>
    ['d1', 'd3', 'd6', 'd9'].includes(d.id),
  );

  // ── Рендер ──
  return (
    <div className="dgc-root">
      {/* ── Шапка ── */}
      <div className="dgc-header">
        <div>
          <h2>Калькулятор штанцформы</h2>
          <p>
            Введите размеры коробки → получите размер заготовки и раскладку по листу.
            Система обучается на ваших реальных данных с чертежей.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="dgc-badge" style={{ fontWeight: 600 }}>
            {pred.blankW}×{pred.blankH} мм
          </span>
          <span className="dgc-badge">{pred.areaM2} м²</span>
          <span className="dgc-badge">{perSheet} шт/лист</span>
          <span
            className="dgc-badge"
            style={{ color: confColor[pred.confidence] }}
            title={pred.source}
          >
            {confIcon[pred.confidence]} {confLabel[pred.confidence]}
          </span>
        </div>
      </div>

      {/* ── Основная область: 3 колонки ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 300px) minmax(0, 1fr) minmax(260px, 300px)',
        gap: 12,
        alignItems: 'start',
      }}>

        {/* ═══ Левая колонка: Ввод ═══ */}
        <div className="dgc-col">
          <div className="dgc-card">
            <h3>Параметры коробки</h3>
            <div className="dgc-field" style={{ marginBottom: 8 }}>
              <label>Тип конструкции</label>
              <select value={boxType} onChange={e => setBoxType(e.target.value as BoxTypeId)}>
                {BOX_TYPES.map(bt => (
                  <option key={bt.id} value={bt.id}>{bt.code} — {bt.name}</option>
                ))}
              </select>
            </div>
            <div className="dgc-row">
              <div className="dgc-field">
                <label>Длина L (мм)</label>
                <input type="number" value={L || ''} onChange={e => setL(+e.target.value)} min={10} max={2000} />
              </div>
              <div className="dgc-field">
                <label>Ширина W (мм)</label>
                <input type="number" value={W || ''} onChange={e => setW(+e.target.value)} min={10} max={2000} />
              </div>
              <div className="dgc-field">
                <label>Высота H (мм)</label>
                <input type="number" value={H || ''} onChange={e => setH(+e.target.value)} min={10} max={2000} />
              </div>
            </div>
          </div>

          <div className="dgc-card">
            <h3>Лист картона</h3>
            <div className="dgc-row2">
              <div className="dgc-field">
                <label>Ширина (мм)</label>
                <input type="number" value={sheetW || ''} onChange={e => setSheetW(+e.target.value)} min={100} max={5000} />
              </div>
              <div className="dgc-field">
                <label>Высота (мм)</label>
                <input type="number" value={sheetH || ''} onChange={e => setSheetH(+e.target.value)} min={100} max={5000} />
              </div>
            </div>
            <div className="dgc-check" style={{ marginTop: 6 }}>
              <input
                type="checkbox" id="rotSheet"
                checked={rotSheet} onChange={e => setRotSheet(e.target.checked)}
              />
              <label htmlFor="rotSheet">
                Повернуть лист ({sh}×{sw} мм)
              </label>
            </div>
            <div className="dgc-row" style={{ marginTop: 6 }}>
              <div className="dgc-field">
                <label>Отступ (мм)</label>
                <input type="number" value={margin || ''} onChange={e => setMargin(+e.target.value)} min={0} max={100} />
              </div>
              <div className="dgc-field">
                <label>Зазор (мм)</label>
                <input type="number" value={gap || ''} onChange={e => setGap(+e.target.value)} min={0} max={50} />
              </div>
              <div className="dgc-field">
                <label>Тираж (шт)</label>
                <input type="number" value={qty || ''} onChange={e => setQty(+e.target.value)} min={1} max={1000000} />
              </div>
            </div>
            <div className="dgc-check" style={{ marginTop: 6 }}>
              <input
                type="checkbox" id="allowRot"
                checked={allowRot} onChange={e => setAllowRot(e.target.checked)}
              />
              <label htmlFor="allowRot">Поворот заготовки на листе</label>
            </div>
          </div>

          <div className="dgc-card">
            <h3>Быстрые примеры</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {quickExamples.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className="dgc-btn small ghost"
                  style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                  onClick={() => { setBoxType(d.boxType); setL(d.L); setW(d.W); setH(d.H); }}
                >
                  {BOX_TYPES.find(b => b.id === d.boxType)?.code} {d.L}×{d.W}×{d.H} → {d.blankW}×{d.blankH}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ Центральная колонка: Раскладка ═══ */}
        <div className="dgc-col">
          <div className="dgc-card">
            <h3>Раскладка на листе {sw}×{sh} мм</h3>
            {perSheet > 0 ? (
              <div className="dgc-canvas">
                <svg viewBox={`0 0 ${sw} ${sh}`} style={{ width: '100%', height: 'auto', maxHeight: 480 }}>
                  {/* Лист */}
                  <rect x={0} y={0} width={sw} height={sh} fill="#f8f9fa" stroke="#adb5bd" strokeWidth={2} rx={4} />
                  {/* Зона отступа */}
                  <rect
                    x={margin} y={margin}
                    width={sw - 2 * margin} height={sh - 2 * margin}
                    fill="none" stroke="#dee2e6" strokeWidth={1} strokeDasharray="8 4" rx={2}
                  />
                  {/* Заготовки */}
                  {(nest?.placements ?? []).map((p, i) => (
                    <g key={i}>
                      <rect
                        x={p.x} y={p.y} width={p.w} height={p.h}
                        fill="rgba(82, 183, 136, 0.22)"
                        stroke="#2d6a4f" strokeWidth={1.5} rx={2}
                      />
                      {p.rot && (
                        <line
                          x1={p.x + 2} y1={p.y + 2}
                          x2={p.x + p.w - 2} y2={p.y + p.h - 2}
                          stroke="#2d6a4f" strokeWidth={0.5} strokeDasharray="4 3"
                        />
                      )}
                    </g>
                  ))}
                  {/* Подпись */}
                  <text
                    x={sw / 2} y={margin > 24 ? 16 : sh - 10}
                    textAnchor="middle" fontSize={Math.max(10, Math.min(16, sw / 50))}
                    fill="#6b7480"
                  >
                    {perSheet} шт · заполнение {(util * 100).toFixed(0)}%
                  </text>
                </svg>
              </div>
            ) : (
              <div className="dgc-warns">
                Заготовка {pred.blankW}×{pred.blankH} мм не влезает в лист {sw}×{sh} мм.
                Увеличьте лист или уменьшите коробку.
              </div>
            )}
          </div>
        </div>

        {/* ═══ Правая колонка: Результат ═══ */}
        <div className="dgc-col">
          <div className="dgc-card">
            <h3>Результат расчёта</h3>
            <div className="dgc-big">
              <div>
                <span>Размер заготовки</span>
                <strong>{pred.blankW} × {pred.blankH} мм</strong>
              </div>
              <div>
                <span>Площадь заготовки</span>
                <strong>{pred.areaM2} м²</strong>
              </div>
            </div>
            <div className="dgc-kv" style={{ marginTop: 12 }}>
              <div>Коробка (внутр.)</div>
              <div><b>{L} × {W} × {H} мм</b></div>
              <div>На листе</div>
              <div><b>{perSheet} шт</b></div>
              <div>Заполнение</div>
              <div><b>{(util * 100).toFixed(1)}%</b></div>
              <div>Листов на тираж {qty}</div>
              <div><b>{sheetsNeeded} шт</b></div>
              <div>Источник</div>
              <div><b>{pred.source}</b></div>
              <div>Точность</div>
              <div style={{ color: confColor[pred.confidence] }}>
                <b>{confIcon[pred.confidence]} {confLabel[pred.confidence]}</b>
              </div>
            </div>
            <p className="dgc-notes" style={{ marginTop: 8 }}>
              {pred.confidence === 'low' && pred.dataCount === 0
                ? 'Нет данных для обучения. Добавьте реальные размеры заготовок с чертежей матриц.'
                : pred.confidence === 'low'
                  ? 'Данных мало — результат приблизительный. Добавьте ещё замеров для этой конструкции.'
                  : pred.confidence === 'medium'
                    ? 'Есть данные для обучения. Больше записей = выше точность.'
                    : 'Точность хорошая — много данных похожего размера.'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Обучающие данные ── */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button
            type="button" className="dgc-btn ghost"
            onClick={() => setShowTrain(!showTrain)}
          >
            {showTrain ? '▼' : '▶'} Обучающие данные
            <span className="dgc-badge" style={{ marginLeft: 6 }}>{training.length}</span>
          </button>
          {showTrain && (
            <>
              <button type="button" className="dgc-btn small" onClick={() => setAddMode(!addMode)}>
                {addMode ? '✕ Отмена' : '＋ Добавить данные'}
              </button>
              <button type="button" className="dgc-btn small ghost" onClick={resetTraining}>
                Сбросить к начальным
              </button>
            </>
          )}
        </div>

        {showTrain && (
          <div className="dgc-card">
            {/* Форма добавления */}
            {addMode && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                gap: 6,
                marginBottom: 12,
                padding: 10,
                background: 'var(--dgc-bg)',
                borderRadius: 8,
              }}>
                <div className="dgc-field" style={{ gridColumn: 'span 2' }}>
                  <label>Тип конструкции</label>
                  <select
                    value={addForm.boxType}
                    onChange={e => setAddForm(f => ({ ...f, boxType: e.target.value as BoxTypeId }))}
                  >
                    {BOX_TYPES.map(bt => (
                      <option key={bt.id} value={bt.id}>{bt.code} — {bt.name}</option>
                    ))}
                  </select>
                </div>
                <div className="dgc-field">
                  <label>Длина L</label>
                  <input type="number" value={addForm.L || ''} onChange={e => setAddForm(f => ({ ...f, L: +e.target.value }))} placeholder="мм" />
                </div>
                <div className="dgc-field">
                  <label>Ширина W</label>
                  <input type="number" value={addForm.W || ''} onChange={e => setAddForm(f => ({ ...f, W: +e.target.value }))} placeholder="мм" />
                </div>
                <div className="dgc-field">
                  <label>Высота H</label>
                  <input type="number" value={addForm.H || ''} onChange={e => setAddForm(f => ({ ...f, H: +e.target.value }))} placeholder="мм" />
                </div>
                <div className="dgc-field">
                  <label>Заг. W</label>
                  <input type="number" value={addForm.blankW || ''} onChange={e => setAddForm(f => ({ ...f, blankW: +e.target.value }))} placeholder="мм" />
                </div>
                <div className="dgc-field">
                  <label>Заг. H</label>
                  <input type="number" value={addForm.blankH || ''} onChange={e => setAddForm(f => ({ ...f, blankH: +e.target.value }))} placeholder="мм" />
                </div>
                <div className="dgc-field" style={{ gridColumn: 'span 2' }}>
                  <label>Заметка (профиль и т.п.)</label>
                  <input type="text" value={addForm.note} onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))} placeholder="E, B, BC..." />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="dgc-btn small" onClick={addTrainingPoint}>
                    Сохранить
                  </button>
                </div>
              </div>
            )}

            {/* Таблица данных */}
            <div style={{ overflowX: 'auto' }}>
              <table className="dgc-table">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>L</th>
                    <th>W</th>
                    <th>H</th>
                    <th>Заг. W</th>
                    <th>Заг. H</th>
                    <th>Площадь м²</th>
                    <th>Заметка</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {training.map(d => {
                    const isDefault = DEFAULT_TRAINING.some(dd => dd.id === d.id);
                    const isActive = d.boxType === boxType;
                    return (
                      <tr
                        key={d.id}
                        className={isActive ? 'hit' : ''}
                        style={{ opacity: isActive ? 1 : 0.6 }}
                      >
                        <td style={{ textAlign: 'left' }}>
                          {BOX_TYPES.find(b => b.id === d.boxType)?.code}
                        </td>
                        <td>{d.L}</td>
                        <td>{d.W}</td>
                        <td>{d.H}</td>
                        <td><b>{d.blankW}</b></td>
                        <td><b>{d.blankH}</b></td>
                        <td>{r2(d.blankW * d.blankH / 1e6)}</td>
                        <td style={{
                          textAlign: 'left', maxWidth: 100,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {d.note || ''}
                        </td>
                        <td>
                          {!isDefault && (
                            <button
                              type="button" className="dgc-btn small ghost"
                              onClick={() => deletePoint(d.id)}
                              title="Удалить"
                              style={{ padding: '2px 6px' }}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="c-notes" style={{ marginTop: 8 }}>
              Данные хранятся в браузере. Добавляйте реальные размеры заготовок с чертежей матриц —
              чем больше данных, тем точнее расчёт. Каждая новая запись сразу улучшает предсказание.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SimpleDieCalc;