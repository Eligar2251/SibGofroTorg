'use client';
/**
 * DieCalc.tsx — готовый компонент калькулятора.
 *
 *   'use client';
 *   import { DieCalc } from '@/features/die-calc/ui/DieCalc';
 *   <DieCalc initial={{ L: 240, W: 180, H: 60 }} />
 *
 * Всё состояние локальное (useState + localStorage), внешних зависимостей нет,
 * кроме react/react-dom.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { CONSTRUCTIONS } from '../core/model';
import { renderUnfold } from '../core/render2d';
import { exportCsv, exportDxf, exportJsonFallback, exportPng, exportReport, exportSvg, printPdf } from './exports';
import { useCalc, type AppState } from './store';
import { Card, fmtMm } from './controls';
import { FormPanel, ResultPanel, DerivationView } from './panels';
import { FoldView, NestView, UnfoldView } from './views';
import { CalibrationPanel, SettingsPanel } from './admin';
import './ui.css';

export type DieCalcTab = 'unfold' | 'fold' | 'sheet' | 'formula' | 'calib' | 'settings';

export interface DieCalcProps {
  initial?: Partial<AppState>;
  tab?: DieCalcTab;
  dark?: boolean;
  /** какие вкладки показывать (по умолчанию все) */
  tabs?: DieCalcTab[];
  /** заголовок шапки */
  title?: string;
  subtitle?: string;
}

const ALL_TABS: Array<{ id: DieCalcTab; name: string }> = [
  { id: 'unfold', name: 'Развертка' },
  { id: 'fold', name: 'Сборка 3D' },
  { id: 'sheet', name: 'Раскладка по листу' },
  { id: 'formula', name: 'Как считалось' },
  { id: 'calib', name: 'Калибровка' },
  { id: 'settings', name: 'Настройки и цены' },
];

export function DieCalc(props: DieCalcProps): ReactNode {
  const calc = useCalc();
  const [tab, setTab] = useState<DieCalcTab>(props.tab ?? 'unfold');
  const dark = !!props.dark;
  const { state, setState, result, error, settings } = calc;
  const cons = CONSTRUCTIONS.find((c) => c.id === state.construction);
  const name = `${state.construction === 'blank' ? 'заготовка' : `${cons?.code}-${state.L}*${state.W}*${state.H}-${state.profileId}`}`;
  const profile = settings.profiles.find((p) => p.id === state.profileId) ?? settings.profiles[0];

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

  const tabs = ALL_TABS.filter((t) => !props.tabs || props.tabs.includes(t.id));

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
          <span className="dgc-badge">заказ {state.orderNo || '—'}</span>
          <span className="dgc-badge">
            {fmtMm(result?.area.blankW ?? 0)}×{fmtMm(result?.area.blankH ?? 0)} мм
          </span>
          <span className="dgc-badge">{result ? `${result.nest.perSheet} шт/лист` : '—'}</span>
          <span className="dgc-badge">{profile ? `${profile.priceM2} ₽/м²` : '—'}</span>
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

      {result && (tab === 'unfold' || tab === 'fold' || tab === 'sheet' || tab === 'formula') ? (
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

      {result && tab === 'calib' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }} className="dgc-calib">
          <CalibrationPanel calc={calc} />
          <div className="dgc-col">
            <ResultPanel res={result} settings={settings} />
          </div>
        </div>
      ) : null}

      {tab === 'settings' ? (
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
