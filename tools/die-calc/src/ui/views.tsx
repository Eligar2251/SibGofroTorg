/**
 * views.tsx — три канваса: развертка (2D), сборка (3D) и раскладка по листу.
 * Канвасы — обёртки над чистыми функциями ядра (renderUnfold / renderFold);
 * React здесь нужен только для тулбара, слоёв и слайдеров.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { LAYER_COLOR, LAYER_NAME } from '../core/engine';
import { renderUnfold, type Render2dOpts } from '../core/render2d';
import { renderFold } from '../core/render3d';
import { allNests } from '../core/nesting';
import type { CalcResult, SheetFormat } from '../core/model';
import type { LineKind } from '../core/geo';
import type { AppState } from './store';
import { Card, Chk, fmtMm, Slider } from './controls';

const KINDS: LineKind[] = ['cut', 'crease', 'perf', 'tech', 'mark'];
const MM_TO_PX = 96 / 25.4;

function svgSize(svg: string): { w: number; h: number } {
  const m = /viewBox="([^"]+)"/.exec(svg);
  if (!m) return { w: 1000, h: 700 };
  const p = m[1].trim().split(/[\s,]+/).map(Number);
  return { w: p[2] || 1000, h: p[3] || 700 };
}

export function UnfoldView({
  res,
  state,
  setState,
  name,
  onExport,
  dark,
}: {
  res: CalcResult;
  state: AppState;
  setState: (p: Partial<AppState>) => void;
  name: string;
  onExport: (kind: 'svg' | 'dxf' | 'png' | 'pdf' | 'csv' | 'txt' | 'json') => void;
  dark: boolean;
}): ReactNode {
  const [zoom, setZoom] = useState<'fit' | '1' | '2' | '0.5'>('fit');
  const opts: Render2dOpts = {
    showDie: state.showDie,
    showDims: state.showDims,
    showFills: state.showFills,
    layers: state.layers,
    theme: dark ? 'dark' : 'light',
    title: `${state.orderNo ? state.orderNo + ' · ' : ''}${name}`,
    note: `внутр. ${fmtMm(res.input.L)}×${fmtMm(res.input.W)}×${fmtMm(res.input.H)} мм · профиль ${res.input.profileId} · заготовка ${fmtMm(
      res.area.blankW,
    )}×${fmtMm(res.area.blankH)} мм · ${res.geom.panels.length} панелей`,
  };
  const svg = useMemo(
    () => renderUnfold(res, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [res, state.showDie, state.showDims, state.showFills, state.layers, dark],
  );
  const size = svgSize(svg);
  const width = zoom === 'fit' ? undefined : `${size.w * (zoom === '2' ? 2 : zoom === '0.5' ? 0.5 : 1) * MM_TO_PX}px`;

  return (
    <Card
      title="Развертка штанцформы"
      right={
        <div className="dgc-seg" role="group" aria-label="Масштаб">
          {(['fit', '0.5', '1', '2'] as const).map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} title={z === 'fit' ? 'По размеру окна' : `Масштаб ${z}:1`}>
              {z === 'fit' ? 'вписать' : `${z}:1`}
            </button>
          ))}
        </div>
      }
    >
      <div className="dgc-toolbar">
        <div className="dgc-legend">
          {KINDS.map((k) => (
            <button
              type="button"
              key={k}
              aria-pressed={state.layers[k]}
              onClick={() => setState({ layers: { ...state.layers, [k]: !state.layers[k] } })}
              title="Показать/скрыть слой"
            >
              <i
                className="dgc-swatch"
                style={{ borderTopColor: LAYER_COLOR[k], borderTopStyle: k === 'crease' || k === 'perf' ? 'dashed' : 'solid' }}
              />
              {LAYER_NAME[k]}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <Chk label="как штамп" checked={state.showDie} onChange={(v) => setState({ showDie: v })} hint="плита штампа: рамка, техно-уголки, рамка маркировки (по умолчанию показываем только вырезанную заготовку)" />
        <Chk label="размеры" checked={state.showDims} onChange={(v) => setState({ showDims: v })} />
        <Chk label="заливка" checked={state.showFills} onChange={(v) => setState({ showFills: v })} />
      </div>

      <div className="dgc-canvas">
        <div className="dgc-scroll">
          <div style={{ width, margin: width ? '0 auto' : undefined }}>
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        </div>
      </div>

      <div className="dgc-toolbar" style={{ marginTop: 8 }}>
        {(['svg', 'dxf', 'png', 'pdf', 'txt', 'csv', 'json'] as const).map((k) => (
          <button key={k} type="button" className="dgc-btn small ghost" onClick={() => onExport(k)}>
            {k === 'pdf' ? 'печать/PDF' : k === 'txt' ? 'отчёт' : k === 'json' ? 'JSON' : k.toUpperCase()}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="dgc-btn small ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(
              `${fmtMm(res.area.blankW)}×${fmtMm(res.area.blankH)} мм; рез ${res.knives.cutM} м; биговка ${res.knives.creaseM} м; перфорация ${res.knives.perfM} м; всего ${res.knives.totalM} м`,
            );
          }}
        >
          копировать размеры
        </button>
      </div>

      <p className="dgc-notes" style={{ margin: '2px 0 0' }}>
        Габарит по краям заготовки <b>{fmtMm(res.area.blankW)}×{fmtMm(res.area.blankH)} мм</b> = {res.area.bboxAreaM2.toFixed(4)} м²; площадь полигона{' '}
        {res.area.blankAreaM2.toFixed(4)} м² ({(res.area.fillInBbox * 100).toFixed(1)}% габарита).
        {state.showDie ? ` Штамп ${fmtMm(res.area.dieW)}×${fmtMm(res.area.dieH)} мм.` : ` Габарит штампа ${fmtMm(res.area.dieW)}×${fmtMm(res.area.dieH)} мм — включите «как штамп».`} Масштаб 1:1 — для печати на листе.
      </p>
    </Card>
  );
}

export function FoldView({
  res,
  state,
  setState,
  dark,
}: {
  res: CalcResult;
  state: AppState;
  setState: (p: Partial<AppState>) => void;
  dark: boolean;
}): ReactNode {
  const svg = useMemo(
    () =>
      renderFold(res, {
        progress: state.progress / 100,
        yaw: state.yaw,
        pitch: state.pitch,
        theme: dark ? 'dark' : 'light',
        size: 620,
      }),
    [res, state.progress, state.yaw, state.pitch, dark],
  );
  return (
    <Card
      title="Сборка — 3D без библиотек"
      right={
        <div className="dgc-seg">
          {[0, 25, 50, 75, 100].map((vv) => (
            <button type="button" key={vv} aria-pressed={state.progress === vv} onClick={() => setState({ progress: vv })}>
              {vv}%
            </button>
          ))}
        </div>
      }
    >
      <div className="dgc-canvas" style={{ background: dark ? '#0d1116' : '#f7f3ec' }}>
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <div className="dgc-row" style={{ marginTop: 8 }}>
        <Slider label="степень сборки" value={state.progress} min={0} max={100} step={1} onChange={(vv) => setState({ progress: vv })} format={(nn) => `${nn}%`} />
        <Slider label="поворот" value={state.yaw} min={-180} max={180} step={5} onChange={(vv) => setState({ yaw: vv })} format={(nn) => `${nn}°`} />
        <Slider label="наклон" value={state.pitch} min={6} max={80} step={1} onChange={(vv) => setState({ pitch: vv })} format={(nn) => `${nn}°`} />
      </div>
      <p className="dgc-notes" style={{ margin: '4px 0 0' }}>
        Панели гнутся вокруг линий биговки (дерево сгиба: parent → hinge → угол), толщина картона показана экструзией. 0% — развертка, 100% — коробка.
      </p>
    </Card>
  );
}

export function NestView({
  res,
  state,
  setState,
  sheets,
  pricePerM2,
  waste,
}: {
  res: CalcResult;
  state: AppState;
  setState: (p: Partial<AppState>) => void;
  sheets: SheetFormat[];
  pricePerM2: number;
  waste: number;
}): ReactNode {
  const sheet = res.nest.sheet;
  const pad = 30;
  const vb = `${-pad} ${-pad} ${sheet.w + pad * 2} ${sheet.h + pad * 2}`;

  const options = useMemo(() => {
    try {
      return allNests(
        { w: res.area.blankW, h: res.area.blankH, areaMm2: (res.area.blankAreaM2 || res.area.bboxAreaM2) * 1e6 },
        res.input.nesting,
        sheets,
        res.input.qty,
      );
    } catch {
      return [];
    }
  }, [res.area.blankW, res.area.blankH, res.area.blankAreaM2, res.area.bboxAreaM2, res.input.nesting, res.input.qty, sheets]);

  const perSheet = res.nest.perSheet;
  const cardboard = perSheet > 0 ? ((sheet.w * sheet.h) / 1e6 / perSheet) * (1 + waste) * pricePerM2 : NaN;

  return (
    <Card
      title="Сколько коробок с листа"
      right={
        <div className="dgc-seg" title="Список листов редактируется в «Настройках»">
          <button type="button" aria-pressed={state.sheetId === 'auto'} onClick={() => setState({ sheetId: 'auto' })}>
            автоподбор
          </button>
          {sheets.map((sh) => (
            <button key={sh.id} type="button" aria-pressed={state.sheetId === sh.id} onClick={() => setState({ sheetId: sh.id })}>
              {sh.name}
            </button>
          ))}
        </div>
      }
    >
      <div className="dgc-big" style={{ marginBottom: 10 }}>
        <div>
          <span>коробок с листа {sheet.name}</span>
          <strong>{perSheet} шт</strong>
        </div>
        <div>
          <span>листов на тираж {res.input.qty.toLocaleString('ru-RU')}</span>
          <strong>{res.nest.sheets}</strong>
        </div>
        <div>
          <span>полезный выход листа</span>
          <strong>{(res.nest.utilization * 100).toFixed(1)}%</strong>
        </div>
        <div>
          <span>картон на 1 коробку</span>
          <strong>{Number.isFinite(cardboard) ? `${cardboard.toFixed(2)} ₽` : '—'}</strong>
        </div>
      </div>

      <div className="dgc-canvas" style={{ padding: 6 }}>
        <svg viewBox={vb} width="100%" style={{ maxHeight: 430 }}>
          <g transform={`translate(0 ${sheet.h}) scale(1 -1)`}>
            <rect x={0} y={0} width={sheet.w} height={sheet.h} fill={state.showFills ? '#f0e6d8' : 'none'} stroke="#8a6a44" strokeWidth={2} />
            {res.nest.layout.map((p, i) => (
              <g key={i}>
                <rect
                  x={p.x}
                  y={p.y}
                  width={p.w}
                  height={p.h}
                  fill={p.rot ? 'rgba(45,106,79,0.20)' : 'rgba(45,106,79,0.10)'}
                  stroke="#2d6a4f"
                  strokeWidth={1}
                />
                {i === 0 ? (
                  <text transform={`translate(${p.x + p.w / 2} ${p.y + p.h / 2}) scale(1 -1)`} fontSize={Math.min(p.w, p.h) * 0.13} textAnchor="middle" fill="#1e4d38">
                    {fmtMm(p.w)}×{fmtMm(p.h)}
                  </text>
                ) : null}
              </g>
            ))}
          </g>
          <g fontSize={15} fill="#6b7480">
            <text x={sheet.w / 2} y={-10} textAnchor="middle">
              {sheet.w} мм
            </text>
            <text x={-12} y={sheet.h / 2} textAnchor="middle" transform={`rotate(-90 -12 ${sheet.h / 2})`}>
              {sheet.h} мм
            </text>
          </g>
        </svg>
      </div>

      <table className="dgc-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>лист</th>
            <th>шт/лист</th>
            <th>ряд×кол</th>
            <th>выход</th>
            <th>листов</th>
            <th>картон ₽/шт</th>
          </tr>
        </thead>
        <tbody>
          {options.map((n) => {
            const pc = n.perSheet > 0 ? ((n.sheet.w * n.sheet.h) / 1e6 / n.perSheet) * (1 + waste) * pricePerM2 : NaN;
            return (
              <tr key={n.sheet.id} className={n.sheet.id === sheet.id ? 'hit' : undefined}>
                <td>{n.sheet.name}</td>
                <td>{n.perSheet}</td>
                <td>
                  {n.rows}×{n.cols}
                </td>
                <td>{(n.utilization * 100).toFixed(0)}%</td>
                <td>{n.sheets}</td>
                <td>{Number.isFinite(pc) ? pc.toFixed(2) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="dgc-notes" style={{ margin: '6px 0 0' }}>
        Раскладка — сетка с поворотом на 90° плюс гильотинная комбинация «2 зоны» (часть колонок в одной ориентации, остаток добирается другой). Отступ от края{' '}
        {fmtMm(res.input.nesting.edgeMargin)} мм, зазор между заготовками {fmtMm(res.input.nesting.gapX)}×{fmtMm(res.input.nesting.gapY)} мм. Зелёным показаны
        перевёрнутые заготовки.
      </p>
    </Card>
  );
}
