'use client';
/**
 * DieCalc.tsx — готовый компонент калькулятора.
 *
 *   // src/app/[adminPath]/die-calc/page.tsx
 *   import { DieCalc } from '@/components/admin/die-calc/DieCalc';
 *   <DieCalc initial={{ L: 240, W: 180, H: 60 }} />
 *
 * В сайте лежит в админке; сюда не дублируем — см. scripts/sync-site.mjs.
 *
 * Всё состояние локальное (useState + localStorage), внешних зависимостей нет,
 * кроме react/react-dom.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { calculateCustomDrawing } from '../core/custom';
import { CONSTRUCTIONS, type CalcResult } from '../core/model';
import { renderUnfold } from '../core/render2d';
import { exportCsv, exportDxf, exportJsonFallback, exportPng, exportReport, exportSvg, printPdf } from './exports';
import { useCalc, type AppState, type SettingsState, type UseCalc } from './store';
import { Card, fmtMm } from './controls';
import { FormPanel, ResultPanel, DerivationView } from './panels';
import { FoldView, NestView, UnfoldView } from './views';
import { CalibrationPanel, SettingsPanel } from './admin';
import type { DieCalcModel } from '../core/learn';
import { CustomDieEditor } from './custom';
import './ui.css';

type KnownTab = 'unfold' | 'fold' | 'sheet' | 'formula' | 'calib' | 'settings';
/** известные вкладки + любые свои (слоты приложения: «База и обучение») */
export type DieCalcTab = KnownTab | (string & {});

/**
 * Слот — вкладка, которую рисует приложение (не ядро и не UI-песочница).
 * Так админка сайта получает доступ к живому состоянию калькулятора
 * (calc.state / calc.result / calc.hydrate), не смешивая Supabase с расчётом.
 */
export interface DieCalcSlot {
  id: string;
  name: string;
  render: (p: { calc: UseCalc; tab: DieCalcTab; setTab: (t: DieCalcTab) => void; customResult: CalcResult | null; isCustomCalculation: boolean; setCustomCalculation: (isCustom: boolean) => void }) => ReactNode;
}

export interface DieCalcProps {
  /** состояние «как на экране» — им можно загрузить сохранённый расчёт */
  initial?: Partial<AppState>;
  /** общие ставки/справочники (в сайте — из die_calc_settings) */
  initialSettings?: Partial<SettingsState>;
  /** выученная модель по сохранённым расчётам (core/learn.ts) */
  model?: DieCalcModel | null;
  tab?: DieCalcTab;
  dark?: boolean;
  /** какие вкладки показывать (по умолчанию все) */
  tabs?: DieCalcTab[];
  /** заголовок шапки */
  title?: string;
  subtitle?: string;
  /** дополнительные вкладки (сохранение, обучение, журнал) */
  slots?: DieCalcSlot[];
}

const ALL_TABS: Array<{ id: DieCalcTab; name: string }> = [
  { id: 'unfold', name: 'Развертка' },
  { id: 'custom', name: 'Своя форма' },
  { id: 'fold', name: 'Сборка 3D' },
  { id: 'sheet', name: 'Раскладка по листу' },
  { id: 'formula', name: 'Как считалось' },
  { id: 'calib', name: 'Калибровка' },
  { id: 'settings', name: 'Настройки и цены' },
];

export function DieCalc(props: DieCalcProps): ReactNode {
  const calc = useCalc({ initial: props.initial, initialSettings: props.initialSettings, model: props.model });
  const [tab, setTabRaw] = useState<DieCalcTab>(props.tab ?? 'unfold');
  const [customCalculation, setCustomCalculation] = useState(props.tab === 'custom');
  const setTab = useCallback((next: DieCalcTab): void => {
    if (next === 'custom') setCustomCalculation(true);
    else if (['unfold', 'fold', 'sheet', 'formula', 'calib', 'settings'].includes(next)) setCustomCalculation(false);
    setTabRaw(next);
  }, []);
  const dark = !!props.dark;
  const { state, setState, result, error, settings } = calc;
  const cons = CONSTRUCTIONS.find((c) => c.id === state.construction);
  const name = `${state.construction === 'blank' ? 'заготовка' : `${cons?.code}-${state.L}*${state.W}*${state.H}-${state.profileId}`}`;
  const profile = settings.profiles.find((p) => p.id === state.profileId) ?? settings.profiles[0];
  const customResult = useMemo<CalcResult | null>(() => {
    const drawing = state.customDrawing;
    if (!drawing || (!drawing.lines.length && !drawing.polygons.length)) return null;
    const selectedSheets = state.sheetId === 'auto' ? settings.sheets : settings.sheets.filter((sheet) => sheet.id === state.sheetId);
    try {
      return calculateCustomDrawing(drawing, calc.input, { ...settings, sheets: selectedSheets.length ? selectedSheets : settings.sheets });
    } catch {
      return null;
    }
  }, [state.customDrawing, state.sheetId, calc.input, settings]);

  const onExport = useCallback(
    (kind: 'svg' | 'dxf' | 'png' | 'pdf' | 'csv' | 'txt' | 'json') => {
      if (!result) return;
      const file = (state.orderNo || 'die') + '-' + name;
      if (kind === 'svg') exportSvg(result, { showDie: state.showDie, showDims: state.showDims, showFills: state.showFills, layers: state.layers, theme: 'light' }, file);
      if (kind === 'dxf') exportDxf(result, file, state.showDie);
      if (kind === 'txt') exportReport(result, file);
      if (kind === 'csv') exportCsv(result, file);
      if (kind === 'json') exportJsonFallback(result, file);
      if (kind === 'png') void exportPng(result, { showDie: state.showDie, showDims: state.showDims, showFills: state.showFills, theme: 'light' }, file, 2);
      if (kind === 'pdf')
        printPdf(
          `${file} — ${fmtMm(result.area.blankW)}×${fmtMm(result.area.blankH)} мм`,
          renderUnfold(result, { showDie: true, showDims: true, showFills: false, theme: 'light' }),
          result.area.dieW,
          result.area.dieH,
        );
    },
    [result, state, name],
  );

  const slots = props.slots ?? [];
  const tabs = ALL_TABS.concat(slots.map((s) => ({ id: s.id, name: s.name }))).filter(
    (t) => !props.tabs || props.tabs.includes(t.id),
  );
  const activeSlot = slots.find((s) => s.id === tab);

  return (
    <div className={'dgc-root' + (dark ? ' dark' : '')}>
      <div className="dgc-header">
        <div>
          <h2>{props.title ?? 'Калькулятор штанцформы'}</h2>
          <p>
            {props.subtitle ??
              'Развертка, сборка, габарит и площадь заготовки по краям коробки, раскладка по листу, длины ножей и примерная стоимость — по внутреннему размеру и профилю.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {tab === 'custom' ? (
            <>
              <span className="dgc-badge">заказ {state.orderNo || '—'}</span>
              <span className="dgc-badge">{customResult ? `${fmtMm(customResult.area.blankW)}×${fmtMm(customResult.area.blankH)} мм` : 'нарисуйте геометрию'}</span>
              <span className="dgc-badge">{customResult ? `${customResult.nest.perSheet} шт/лист` : '—'}</span>
              <span className="dgc-badge">{profile ? `${profile.priceM2} ₽/м²` : '—'}</span>
            </>
          ) : (
            <>
              <span className="dgc-badge">заказ {state.orderNo || '—'}</span>
              <span className="dgc-badge">
                {fmtMm(result?.area.blankW ?? 0)}×{fmtMm(result?.area.blankH ?? 0)} мм
              </span>
              <span className="dgc-badge">{result ? `${result.nest.perSheet} шт/лист` : '—'}</span>
              <span className="dgc-badge">{profile ? `${profile.priceM2} ₽/м²` : '—'}</span>
            </>
          )}
          {tab !== 'custom' && (calc.learn.geo || calc.learn.priceN > 0) ? (
            <span className="dgc-badge dgc-badge--learned" title="к расчёту применена модель, выученная на сохранённых расчётах">
              обучение: {calc.learn.geoN > 0 ? `габарит ±${calc.learn.errAfterMm} мм` : 'габарит — нет'}
              {calc.learn.priceN > 0 ? `, цена ×${calc.learn.priceK.toFixed(3)}` : ''}
            </span>
          ) : null}
        </div>
      </div>

      {error && <div className="dgc-error">Ошибка расчёта: {error}</div>}

      <div className="dgc-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.name}
          </button>
        ))}
      </div>

      {activeSlot ? (
        <div className="dgc-slot">{activeSlot.render({ calc, tab, setTab, customResult, isCustomCalculation: customCalculation, setCustomCalculation })}</div>
      ) : null}

      {result && !activeSlot && (tab === 'unfold' || tab === 'fold' || tab === 'sheet' || tab === 'formula') ? (
        <div className="dgc-shell">
          <div className="dgc-col">
            <FormPanel calc={calc} />
          </div>
          <div className="dgc-col">
            {tab === 'unfold' && <UnfoldView res={result} state={state} setState={setState} name={name} onExport={onExport} dark={dark} />}
            {tab === 'fold' && <FoldView res={result} state={state} setState={setState} dark={dark} />}
            {tab === 'sheet' && (
              <NestView res={result} state={state} setState={setState} sheets={settings.sheets} pricePerM2={profile?.priceM2 ?? 0} waste={settings.prices.waste} />
            )}
            {tab === 'formula' && (
              <>
                <DerivationView res={result} />
                <Card title="Проверка по эталонным чертежам">
                  <p className="dgc-notes" style={{ marginTop: 0 }}>
                    Те же формулы, что считаются здесь, прогоняются против {`9`} ваших чертежей. Суммарная ошибка габарита — на вкладке «Калибровка», там же
                    кнопка «Автоподгонка».
                  </p>
                  <button type="button" className="dgc-btn small" onClick={() => setTab('calib')}>
                    открыть калибровку
                  </button>
                </Card>
              </>
            )}
          </div>
          <div className="dgc-col">
            <ResultPanel res={result} settings={settings} />
          </div>
        </div>
      ) : null}

      {!activeSlot && tab === 'custom' ? <CustomDieEditor calc={calc} result={customResult} /> : null}

      {result && !activeSlot && tab === 'calib' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }} className="dgc-calib">
          <CalibrationPanel calc={calc} />
          <div className="dgc-col">
            <ResultPanel res={result} settings={settings} />
          </div>
        </div>
      ) : null}

      {!activeSlot && tab === 'settings' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }} className="dgc-settings">
          <SettingsPanel calc={calc} />
          <div className="dgc-col">
            <Card title="Как это встроить">
              <p className="dgc-notes" style={{ marginTop: 0 }}>
                Ядро — <code className="dgc-mono">src/core/*</code> — работает без React и без сети: <code className="dgc-mono">quickEstimate({`{L,W,H,profile,...}`})</code>{' '}
                возвращает габарит, площадь, шт/лист, длины ножей и цену. UI — <code className="dgc-mono">src/ui/*</code>. Миграция на Supabase: сохраните{' '}
                <code className="dgc-mono">resultJson(res)</code> в таблицу <code className="dgc-mono">calculations.result</code>.
              </p>
              <button type="button" className="dgc-btn small ghost" onClick={() => setTab('unfold')}>
                назад к расчёту
              </button>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DieCalc;
