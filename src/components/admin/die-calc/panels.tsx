// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
/**
 * panels.tsx — левая форма (что считаем) и правая панель (что получилось).
 * Компоненты пропс-дривен, никаких глобальных состояний: можно выдернуть
 * отдельно, если у вас свой стор.
 */

import type { ReactNode } from 'react';
import { CLOSURES, CONSTRUCTIONS, type CalcResult, type ClosureId, type Coef, type ConstructionId } from '@/lib/die-calc/model';
import { LAYER_COLOR, LAYER_NAME } from '@/lib/die-calc/engine';
import { Card, Chk, Num, Sel, fmt2, fmtMm, fmtRub } from './controls';
import type { SettingsState, UseCalc } from './store';

export function FormPanel({ calc }: { calc: UseCalc }): ReactNode {
  const { state, setState, setOptions, setNesting, setDie, settings } = calc;
  const cons = CONSTRUCTIONS.find((c) => c.id === state.construction) as (typeof CONSTRUCTIONS)[number];
  const isBlank = state.construction === 'blank';
  const profile = settings.profiles.find((p) => p.id === state.profileId) ?? settings.profiles[0];

  return (
    <>
      <Card title="Изделие">
        <div className="dgc-seg" style={{ marginBottom: 10 }}>
          {CONSTRUCTIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={state.construction === c.id}
              title={c.hint}
              onClick={() => setState({ construction: c.id as ConstructionId, closure: c.closures.includes(state.closure) ? state.closure : c.closures[0] })}
            >
              {c.name}
            </button>
          ))}
        </div>
        <p className="dgc-notes" style={{ margin: '0 0 8px' }}>
          {cons.lineage}
          {cons.code !== '—' ? ` · код ${cons.code}` : ''}
        </p>

        {isBlank ? (
          <div className="dgc-row">
            <Num label="Заготовка W, мм" value={state.blankW} min={20} onCommit={(n) => setState({ blankW: n })} />
            <Num label="Заготовка H, мм" value={state.blankH} min={20} onCommit={(n) => setState({ blankH: n })} />
            <Num
              label="Площадь, м² (из CAD)"
              value={state.blankAreaM2}
              min={0}
              step={0.0001}
              hint="Если известна точная площадь полигона из чертежа — впишите, по ней считается картон"
              onCommit={(n) => setState({ blankAreaM2: n })}
            />
          </div>
        ) : (
          <>
            <div className="dgc-row">
              <Num label="L внутр., мм" value={state.L} min={20} onCommit={(n) => setState({ L: n })} hint="внутренняя длина (по длинной стороне дна)" />
              <Num label="W внутр., мм" value={state.W} min={20} onCommit={(n) => setState({ W: n })} hint="внутренняя ширина" />
              <Num label="H внутр., мм" value={state.H} min={5} onCommit={(n) => setState({ H: n })} hint="внутренняя высота" />
            </div>
            <div className="dgc-row" style={{ marginTop: 6 }}>
              <Sel
                label="Профиль гофры"
                value={state.profileId}
                onCommit={(v) => setState({ profileId: v })}
                options={settings.profiles.map((p) => ({ id: p.id, name: `${p.name} · ${p.thickness} мм · ${p.priceM2} ₽/м²` }))}
              />
              <Sel
                label="Закрытие / замок"
                value={cons.closures.includes(state.closure) ? state.closure : cons.closures[0]}
                onCommit={(v) => setState({ closure: v as ClosureId })}
                options={cons.closures.map((id) => {
                  const c = CLOSURES.find((x) => x.id === id);
                  return { id, name: c ? c.name : id };
                })}
              />
              <Num label="Тираж, шт" value={state.qty} min={1} step={100} onCommit={(n) => setState({ qty: n })} />
            </div>
            <p className="dgc-notes" style={{ margin: '6px 0 0' }}>
              {CLOSURES.find((c) => c.id === state.closure)?.hint ?? ''} · толщина {profile?.thickness ?? '—'} мм, {profile?.priceM2 ?? '—'} ₽/м²
            </p>
          </>
        )}
        <div className="dgc-row2" style={{ marginTop: 8 }}>
          <Num label="Номер заказа" value={Number(state.orderNo.split('-')[0]) || 0} onCommit={(n) => setState({ orderNo: `${String(Math.round(n)).padStart(4, '0')}-${state.orderNo.split('-').slice(1).join('-')}` })} />
          <Sel
            label="Штук на штампе"
            value={String(state.options.perDie)}
            onCommit={(v) => setOptions({ perDie: Number(v) })}
            options={[1, 2, 3, 4].map((n) => ({ id: String(n), name: `${n} шт (n-up по X)` }))}
          />
        </div>
      </Card>

      <Card title="Опции высечки">
        <div className="dgc-row2">
          <Chk label="Отверстие под ручку" checked={state.options.handle} onChange={(v) => setOptions({ handle: v })} />
          <Chk label="Двойная биговка" checked={state.options.doubleCrease} onChange={(v) => setOptions({ doubleCrease: v })} hint="вторая линия биговки — для BC и жёсткого картона" />
          <Chk label="Перфорация по клапану" checked={state.options.perforation} onChange={(v) => setOptions({ perforation: v })} />
          <Chk label="Техно-уголки" checked={state.options.techCorners} onChange={(v) => setOptions({ techCorners: v })} hint="серые уголки в мусорной зоне штампа" />
          <Chk label="Лицо печати (зеркало)" checked={state.options.mirror} onChange={(v) => setOptions({ mirror: v })} hint="развертка зеркалится — как на ваших чертежах «лицо печати»" />
          <Chk label="Поворот заготовок на листе" checked={state.nesting.allowRotate} onChange={(v) => setNesting({ allowRotate: v })} />
        </div>
        {state.options.handle ? (
          <div className="dgc-row" style={{ marginTop: 6 }}>
            <Num label="ручка W, мм" value={state.options.handleW} min={20} onCommit={(n) => setOptions({ handleW: n })} />
            <Num label="ручка H, мм" value={state.options.handleH} min={6} onCommit={(n) => setOptions({ handleH: n })} />
            <Num label="шаг на штампе, мм" value={state.options.diePitch} min={0} onCommit={(n) => setOptions({ diePitch: n })} />
          </div>
        ) : (
          <div className="dgc-row" style={{ marginTop: 6 }}>
            <Num label="шаг на штампе, мм" value={state.options.diePitch} min={0} onCommit={(n) => setOptions({ diePitch: n })} />
            <span />
            <span />
          </div>
        )}
      </Card>

      <Card title="Штамп и лист">
        <div className="dgc-row">
          <Num label="Запас штампа, мм" value={state.die.frameMargin} min={0} onCommit={(n) => setDie({ frameMargin: n })} hint="по вашим чертежам обычно 40 мм с каждой стороны" />
          <Num label="Шаг перемычек, мм" value={state.die.nickEvery} min={0} onCommit={(n) => setDie({ nickEvery: n })} hint="nicks: сколько ножа «съедается» перемычками" />
          <Num label="Длина перемычки, мм" value={state.die.nickLen} min={0} step={0.5} onCommit={(n) => setDie({ nickLen: n })} />
        </div>
        <div className="dgc-row" style={{ marginTop: 6 }}>
          <Num label="Техно-уголок, мм" value={state.die.techCornerLen} min={0} onCommit={(n) => setDie({ techCornerLen: n })} hint="4 уголка × 199 мм = 0,795 м, как в ваших чертежах" />
          <Num label="Отступ от края листа, мм" value={state.nesting.edgeMargin} min={0} onCommit={(n) => setNesting({ edgeMargin: n })} />
          <Num label="Зазор X × Y, мм" value={state.nesting.gapX} min={0} onCommit={(n) => setNesting({ gapX: n, gapY: n })} />
        </div>
      </Card>
    </>
  );
}

export function ResultPanel({ res, settings }: { res: CalcResult; settings: SettingsState }): ReactNode {
  const a = res.area;
  const k = res.knives;
  const c = res.cost;
  return (
    <>
      <Card title="Площадь штанцформы">
        <div className="dgc-big">
          <div>
            <span>габарит заготовки (по краям коробки)</span>
            <strong>
              {fmtMm(a.blankW)}×{fmtMm(a.blankH)}
            </strong>
            <span>= {a.bboxAreaM2.toFixed(4)} м² под высечку</span>
          </div>
          <div>
            <span>с коробок с листа {res.nest.sheet.name}</span>
            <strong>{res.nest.perSheet} шт</strong>
            <span>выход {(res.nest.utilization * 100).toFixed(1)}%</span>
          </div>
        </div>
        <div className="dgc-kv" style={{ marginTop: 10 }}>
          <div>площадь полигона заготовки</div>
          <b>{a.blankAreaM2.toFixed(4)} м²</b>
          <div>заполнение габарита</div>
          <b>{(a.fillInBbox * 100).toFixed(1)}%</b>
          <div>вырезы (ручка, пазы)</div>
          <b>{a.holesAreaM2.toFixed(5)} м²</b>
          <div>штамп {fmtMm(a.dieW)}×{fmtMm(a.dieH)}</div>
          <b>{a.dieAreaM2.toFixed(4)} м²</b>
          <div>картон на 1 шт (с отходом {(settings.prices.waste * 100).toFixed(0)}%)</div>
          <b>{fmt2(c.cardboardPerPcs)} ₽</b>
        </div>
      </Card>

      <Card title="Ножи">
        <table className="dgc-table">
          <thead>
            <tr>
              <th>слой</th>
              <th>м</th>
              <th>лин.</th>
            </tr>
          </thead>
          <tbody>
            {(['cut', 'crease', 'perf', 'tech', 'mark'] as const).map((kind) => (
              <tr key={kind}>
                <td>
                  <i className="dgc-swatch" style={{ borderTopColor: LAYER_COLOR[kind] }} /> {LAYER_NAME[kind]}
                </td>
                <td>{k.byKind[kind].toFixed(3)}</td>
                <td>{k.segCount[kind]}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>итого (рез+биговка+перф+техно)</b>
              </td>
              <td>
                <b>{k.totalM.toFixed(3)}</b>
              </td>
              <td />
            </tr>
            <tr>
              <td className="dgc-notes">сталь с вычетом перемычек</td>
              <td>{k.steelM.toFixed(3)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </Card>

      <Card title="Стоимость">
        <table className="dgc-table">
          <thead>
            <tr>
              <th>штамп</th>
              <th>₽</th>
            </tr>
          </thead>
          <tbody>
            {c.die.parts.map((p, i) => (
              <tr key={i}>
                <td title={p.label} style={{ whiteSpace: 'normal' }}>
                  {p.label.length > 44 ? p.label.slice(0, 43) + '…' : p.label}
                </td>
                <td>{p.value.toLocaleString('ru-RU')}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>штамп итого</b>
              </td>
              <td>
                <b>{fmtRub(c.die.total)}</b>
              </td>
            </tr>
          </tbody>
        </table>
        <table className="dgc-table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>тираж {res.input.qty.toLocaleString('ru-RU')} шт</th>
              <th>₽</th>
            </tr>
          </thead>
          <tbody>
            {c.batch.parts.map((p, i) => (
              <tr key={i}>
                <td title={p.label} style={{ whiteSpace: 'normal' }}>
                  {p.label.length > 44 ? p.label.slice(0, 43) + '…' : p.label}
                </td>
                <td>{p.value.toLocaleString('ru-RU')}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>тираж итого</b>
              </td>
              <td>
                <b>{fmtRub(c.batch.total)}</b>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="dgc-kv" style={{ marginTop: 8 }}>
          <div>цена за штуку</div>
          <b>{fmt2(c.perPcs)} ₽</b>
          <div>цена за штуку с окупаемой оснасткой</div>
          <b>{fmt2(c.perPcsWithDie)} ₽</b>
          <div>с НДС {(c.vat * 100).toFixed(0)}%</div>
          <b>{fmtRub(c.withVat)}</b>
          <div>чистовое время высечки</div>
          <b>{c.minutes.toFixed(0)} мин</b>
        </div>
      </Card>

      {res.warnings.length > 0 && (
        <Card title="Предупреждения">
          <div className="dgc-warns">
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {res.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </>
  );
}

/** «как считалось»: подстановка в формулы — чтобы технолог сверил с чертежом */
export function DerivationView({ res }: { res: CalcResult }): ReactNode {
  return (
    <Card title="Как считалось">
      <table className="dgc-table">
        <thead>
          <tr>
            <th>размер</th>
            <th style={{ textAlign: 'left' }}>формула</th>
            <th>мм</th>
          </tr>
        </thead>
        <tbody>
          {res.geom.derivation.map((d, i) => (
            <tr key={i}>
              <td>{d.label}</td>
              <td style={{ textAlign: 'left' }} className="dgc-mono">
                {d.formula}
              </td>
              <td>
                <b>{fmtMm(d.value)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dgc-notes" style={{ margin: '8px 0 0' }}>
        Панелей: {res.geom.panels.length}, вырезов: {res.geom.holes.length}. Припуски берутся из таблицы коэффициентов конструкции (вкладка «Калибровка») — их можно
        подогнать по вашим чертежам одной кнопкой.
      </p>
    </Card>
  );
}

/** сетка коэффициентов: припуски + правила клапанов по закрытиям */
export function CoefEditor({
  cons,
  coef,
  onChange,
}: {
  cons: ConstructionId;
  coef: Coef;
  onChange: (patch: Partial<Coef>) => void;
}): ReactNode {
  void cons;
  const setA = (key: 'allowL' | 'allowW' | 'allowH', field: 'k' | 'c' | 'kt', v: number): void => {
    onChange({ [key]: { ...coef[key], [field]: v } } as Partial<Coef>);
  };
  const closureNames: Record<string, string> = Object.fromEntries(CLOSURES.map((c) => [c.id, c.name]));
  return (
    <>
      <table className="dgc-table">
        <thead>
          <tr>
            <th>панель</th>
            <th>k (доля размера)</th>
            <th>c, мм</th>
            <th>kt · толщина</th>
          </tr>
        </thead>
        <tbody>
          {(['allowL', 'allowW', 'allowH'] as const).map((key) => (
            <tr key={key}>
              <td>{key === 'allowL' ? 'дно по длине Lp' : key === 'allowW' ? 'дно по ширине Wp' : 'стенка Hp'}</td>
              {(['k', 'c', 'kt'] as const).map((f) => (
                <td key={f}>
                  <Num
                    label=""
                    value={coef[key][f]}
                    step={f === 'k' ? 0.001 : 0.5}
                    onCommit={(n) => setA(key, f, n)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dgc-row" style={{ marginTop: 8 }}>
        <Num label="ear — ушко, мм" value={coef.ear} step={0.5} onCommit={(n) => onChange({ ear: n })} />
        <Num label="tabW — язычок шир., мм" value={coef.tabW} step={1} onCommit={(n) => onChange({ tabW: n })} />
        <Num label="tabH — язычок выс., мм" value={coef.tabH} step={1} onCommit={(n) => onChange({ tabH: n })} />
      </div>
      <div className="dgc-row" style={{ marginTop: 6 }}>
        <Num label="cornerR — скругление" value={coef.cornerR} step={0.5} onCommit={(n) => onChange({ cornerR: n })} />
        <Num label="overlap — нахлёст" value={coef.overlap} step={1} onCommit={(n) => onChange({ overlap: n })} />
        <Num label="glueFlap — на склейку" value={coef.glueFlap} step={1} onCommit={(n) => onChange({ glueFlap: n })} />
      </div>
      <div className="dgc-row2" style={{ marginTop: 6 }}>
        <Num label="frontK — стенка лотка, доля H" value={coef.frontK} min={0.2} max={1} step={0.02} onCommit={(n) => onChange({ frontK: n })} />
        <Num label="frontCut — вырез лотка, мм" value={coef.frontCut} min={0} step={1} onCommit={(n) => onChange({ frontCut: n })} />
      </div>

      <h4 style={{ margin: '12px 0 6px', fontSize: 12, color: 'var(--dgc-muted)' }}>Правила внешних клапанов (s = доля панели + константа)</h4>
      <table className="dgc-table">
        <thead>
          <tr>
            <th>закрытие</th>
            <th>side·Lp</th>
            <th>+мм</th>
            <th>front·Wp</th>
            <th>+мм</th>
            <th>back·Wp</th>
            <th>+мм</th>
          </tr>
        </thead>
        <tbody>
          {CLOSURES.map((cl) => {
            const r = coef.flaps[cl.id];
            const upd = (field: keyof typeof r, v: number): void =>
              onChange({ flaps: { ...coef.flaps, [cl.id]: { ...r, [field]: v } } });
            return (
              <tr key={cl.id}>
                <td title={cl.name} style={{ textAlign: 'left' }}>
                  {closureNames[cl.id] ?? cl.id}
                </td>
                {(['sideFrac', 'sideAdd', 'frontFrac', 'frontAdd', 'backFrac', 'backAdd'] as const).map((f) => (
                  <td key={f}>
                    <Num label="" value={r[f]} step={f.endsWith('Frac') ? 0.01 : 1} onCommit={(n) => upd(f, n)} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
