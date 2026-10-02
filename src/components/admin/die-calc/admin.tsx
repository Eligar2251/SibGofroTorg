// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
/**
 * admin.tsx — калибровка по эталонным чертежам и настройки (справочники, цены).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { CONSTRUCTIONS, DEFAULT_COEF, DEFAULT_PRICES, type ClosureId, type Coef, type ConstructionId } from '@/lib/die-calc/model';
import type { Fixture } from '@/lib/die-calc/fixtures';
import { calibReport, meanAbsError } from '@/lib/die-calc/calibrate';
import { FIXTURES } from '@/lib/die-calc/fixtures';
import { Card, fmtMm, Num, Sel } from './controls';
import { CoefEditor } from './panels';
import type { UseCalc } from './store';

export function CalibrationPanel({ calc }: { calc: UseCalc }): ReactNode {
  const { state, setState, setCoef, settings } = calc;
  const cons = state.construction;
  const rows = useMemo(() => {
    return calibReport(state.coefs, settings.profiles);
  }, [state.coefs, settings.profiles]);

  const err = meanAbsError(rows);
  const [form, setForm] = useState({
    mark: '',
    L: 200,
    W: 150,
    H: 60,
    profile: 'E',
    construction: 'lastochkin' as ConstructionId,
    closure: 'tuck' as ClosureId,
    blankW: 0,
    blankH: 0,
  });

  const addFixture = (): void => {
    const f: Fixture = {
      id: `c${Date.now().toString(36)}`,
      order: form.mark || 'свой',
      mark: form.mark || `${form.construction}-${form.L}*${form.W}*${form.H}-${form.profile}`,
      construction: form.construction,
      closure: form.closure,
      L: form.L,
      W: form.W,
      H: form.H,
      profile: form.profile,
      blankW: form.blankW,
      blankH: form.blankH,
      dieW: form.blankW + 80,
      dieH: form.blankH + 80,
      perDie: 1,
      face: 'stamp',
      knives: { cut: 0, crease: 0, perf: 0, tech: 0, total: 0, outline: 0, mark: 0 },
      note: 'добавлено вручную',
    };
    setState({ customFixtures: state.customFixtures.concat([f]) });
  };

  return (
    <>
      <Card
        title="Калибровка по эталонным чертежам"
        right={
          <button
            type="button"
            className="dgc-btn small"
            onClick={() => calc.calib.run()}
            title="Метод координатного спуска: подбирает припуски и правила клапанов так, чтобы габарит заготовки совпал с чертежом"
          >
            Автоподгонка по {rows.length + state.customFixtures.length} чертежам
          </button>
        }
      >
        <p className="dgc-notes" style={{ marginTop: 0 }}>
          Целевая функция — <b>габарит заготовки по краям коробки</b> (W×H с чертежа матрицы). Средняя ошибка сейчас: <b>{err} мм</b>. До подгонки по
          дефолтным коэффициентам — {meanAbsError(calibReport(DEFAULT_COEF, settings.profiles))} мм.
        </p>
        <table className="dgc-table">
          <thead>
            <tr>
              <th>чертёж</th>
              <th>внутр. L×W×H</th>
              <th>факт W×H</th>
              <th>расчёт W×H</th>
              <th>Δ</th>
              <th>Δ%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const f = FIXTURES.find((x) => x.id === r.id) ?? state.customFixtures.find((x) => x.id === r.id);
              const bad = Math.abs(r.dW) > 12 || Math.abs(r.dH) > 12;
              return (
                <tr key={r.id} className={f?.construction === cons ? 'hit' : undefined}>
                  <td>{r.mark}</td>
                  <td>
                    {f ? `${f.L}×${f.W}×${f.H} ${f.profile}` : '—'}
                  </td>
                  <td>
                    {fmtMm(r.actualW)}×{fmtMm(r.actualH)}
                  </td>
                  <td>
                    {fmtMm(r.predW)}×{fmtMm(r.predH)}
                  </td>
                  <td className={bad ? 'dgc-warn' : 'dgc-ok'}>
                    {r.dW > 0 ? '+' : ''}
                    {r.dW} / {r.dH > 0 ? '+' : ''}
                    {r.dH}
                  </td>
                  <td className={bad ? 'dgc-warn' : 'dgc-ok'}>{r.errPct}%</td>
                </tr>
              );
            })}
            {state.customFixtures.map((f, i) => {
              const r = rows.find((x) => x.id === f.id);
              return (
                <tr key={f.id}>
                  <td>
                    {f.mark} <button type="button" className="dgc-btn small ghost" onClick={() => setState({ customFixtures: state.customFixtures.filter((_, j) => j !== i) })}>×</button>
                  </td>
                  <td>
                    {f.L}×{f.W}×{f.H} {f.profile}
                  </td>
                  <td>
                    {fmtMm(f.blankW)}×{fmtMm(f.blankH)}
                  </td>
                  <td>{r ? `${fmtMm(r.predW)}×${fmtMm(r.predH)}` : '—'}</td>
                  <td>{r ? `${r.dW} / ${r.dH}` : '—'}</td>
                  <td>{r ? `${r.errPct}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="dgc-notes" style={{ marginBottom: 0 }}>
          Подсвечена строка текущей конструкции. Если у вас чертёж «выбивается» — добавьте его ниже (габарит заготовки с чертежа) и нажмите «Автоподгонка»:
          коэффициенты подстроятся и сохранятся в localStorage / ваш бэкэнд.
        </p>

        <div className="dgc-row2" style={{ marginTop: 10 }}>
          <label className="dgc-field">
            <label>маркировка</label>
            <input value={form.mark} onChange={(e) => setForm({ ...form, mark: e.target.value })} placeholder="0427-240*180*60-E" />
          </label>
          <Sel
            label="конструкция"
            value={form.construction}
            onCommit={(v) => setForm({ ...form, construction: v as ConstructionId })}
            options={CONSTRUCTIONS.filter((c) => c.id !== 'blank').map((c) => ({ id: c.id, name: c.name }))}
          />
        </div>
        <div className="dgc-row" style={{ marginTop: 6 }}>
          <Num label="L внутр." value={form.L} min={20} onCommit={(n) => setForm({ ...form, L: n })} />
          <Num label="W внутр." value={form.W} min={20} onCommit={(n) => setForm({ ...form, W: n })} />
          <Num label="H внутр." value={form.H} min={5} onCommit={(n) => setForm({ ...form, H: n })} />
        </div>
        <div className="dgc-row" style={{ marginTop: 6 }}>
          <Sel label="профиль" value={form.profile} onCommit={(v) => setForm({ ...form, profile: v })} options={settings.profiles.map((p) => ({ id: p.flute, name: `${p.flute} (${p.thickness} мм)` }))} />
          <Num label="заготовка W, мм" value={form.blankW} min={0} onCommit={(n) => setForm({ ...form, blankW: n })} />
          <Num label="заготовка H, мм" value={form.blankH} min={0} onCommit={(n) => setForm({ ...form, blankH: n })} />
        </div>
        <div className="dgc-row2" style={{ marginTop: 6 }}>
          <Sel
            label="закрытие на чертеже"
            value={form.closure}
            onCommit={(v) => setForm({ ...form, closure: v as ClosureId })}
            options={CONSTRUCTIONS.find((c) => c.id === form.construction)!.closures.map((id) => ({ id, name: id }))}
          />
          <button type="button" className="dgc-btn" onClick={addFixture}>
            Добавить эталон
          </button>
        </div>
      </Card>

      <Card
        title={`Коэффициенты: ${CONSTRUCTIONS.find((c) => c.id === cons)?.name ?? cons}`}
        right={
          <button type="button" className="dgc-btn small ghost" onClick={() => setCoef(cons, DEFAULT_COEF[cons])}>
            сбросить
          </button>
        }
      >
        <CoefEditor coef={state.coefs[cons]} onChange={(patch: Partial<Coef>) => setCoef(cons, patch)} cons={cons} />
      </Card>
    </>
  );
}

export function SettingsPanel({ calc }: { calc: UseCalc }): ReactNode {
  const { settings, setSettings, resetAll } = calc;
  const p = settings.prices;
  const setP = (patch: Partial<typeof p>): void => setSettings({ prices: { ...p, ...patch } });
  const setProfile = (i: number, patch: Partial<(typeof settings.profiles)[number]>): void =>
    setSettings({ profiles: settings.profiles.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setSheet = (i: number, patch: Partial<(typeof settings.sheets)[number]>): void =>
    setSettings({ sheets: settings.sheets.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <>
      <Card title="Профили гофрокартона (цены за м²)">
        <table className="dgc-table">
          <thead>
            <tr>
              <th>профиль</th>
              <th>толщина, мм</th>
              <th>цена, ₽/м²</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {settings.profiles.map((pr, i) => (
              <tr key={pr.id}>
                <td style={{ textAlign: 'left' }}>
                  <input value={pr.name} onChange={(e) => setProfile(i, { name: e.target.value, flute: pr.flute })} />
                </td>
                <td>
                  <Num label="" value={pr.thickness} step={0.1} onCommit={(n) => setProfile(i, { thickness: n })} />
                </td>
                <td>
                  <Num label="" value={pr.priceM2} step={1} onCommit={(n) => setProfile(i, { priceM2: n })} />
                </td>
                <td>
                  <button type="button" className="dgc-btn small ghost" onClick={() => setSettings({ profiles: settings.profiles.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="dgc-btn small ghost"
          style={{ marginTop: 6 }}
          onClick={() =>
            setSettings({
              profiles: settings.profiles.concat([{ id: `P${settings.profiles.length + 1}`, flute: `P${settings.profiles.length + 1}`, name: 'Новый профиль', thickness: 2, priceM2: 40, crush: 0.8 }]),
            })
          }
        >
          + профиль
        </button>
      </Card>

      <Card title="Форматы листа">
        <table className="dgc-table">
          <thead>
            <tr>
              <th>лист</th>
              <th>W, мм</th>
              <th>H, мм</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {settings.sheets.map((sh, i) => (
              <tr key={sh.id}>
                <td style={{ textAlign: 'left' }}>
                  <input value={sh.name} onChange={(e) => setSheet(i, { name: e.target.value })} />
                </td>
                <td>
                  <Num label="" value={sh.w} step={10} onCommit={(n) => setSheet(i, { w: n })} />
                </td>
                <td>
                  <Num label="" value={sh.h} step={10} onCommit={(n) => setSheet(i, { h: n })} />
                </td>
                <td>
                  <button type="button" className="dgc-btn small ghost" onClick={() => setSettings({ sheets: settings.sheets.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="dgc-btn small ghost"
          style={{ marginTop: 6 }}
          onClick={() => setSettings({ sheets: settings.sheets.concat([{ id: `s${Date.now().toString(36)}`, name: '1250×2050', w: 1250, h: 2050 }]) })}
        >
          + лист
        </button>
      </Card>

      <Card title="Ставки: штамп">
        <div className="dgc-row">
          <Num label="фанера, ₽/м²" value={p.plywoodM2} step={50} onCommit={(n) => setP({ plywoodM2: n })} />
          <Num label="лазер, ₽/м" value={p.laserPerM} step={5} onCommit={(n) => setP({ laserPerM: n })} />
          <Num label="нож рез, ₽/м" value={p.knifeCutPerM} step={5} onCommit={(n) => setP({ knifeCutPerM: n })} />
        </div>
        <div className="dgc-row" style={{ marginTop: 6 }}>
          <Num label="биговка, ₽/м" value={p.knifeCreasePerM} step={5} onCommit={(n) => setP({ knifeCreasePerM: n })} />
          <Num label="перфорация, ₽/м" value={p.knifePerfPerM} step={5} onCommit={(n) => setP({ knifePerfPerM: n })} />
          <Num label="техно, ₽/м" value={p.knifeTechPerM} step={5} onCommit={(n) => setP({ knifeTechPerM: n })} />
        </div>
        <div className="dgc-row" style={{ marginTop: 6 }}>
          <Num label="гибка ножей, ₽/м" value={p.bendPerM} step={5} onCommit={(n) => setP({ bendPerM: n })} />
          <Num label="резина, ₽/м²" value={p.rubberPerM2} step={10} onCommit={(n) => setP({ rubberPerM2: n })} />
          <Num label="сборка штампа, ₽" value={p.dieSetup} step={100} onCommit={(n) => setP({ dieSetup: n })} />
        </div>
        <div className="dgc-row" style={{ marginTop: 6 }}>
          <Num label="наценка штампа, доля" value={p.dieMargin} step={0.05} onCommit={(n) => setP({ dieMargin: n })} />
          <Num label="маркировка W, мм" value={settings.labelSize.w} step={10} onCommit={(n) => setSettings({ labelSize: { ...settings.labelSize, w: n } })} />
          <Num label="маркировка H, мм" value={settings.labelSize.h} step={10} onCommit={(n) => setSettings({ labelSize: { ...settings.labelSize, h: n } })} />
        </div>
      </Card>

      <Card title="Ставки: тираж">
        <div className="dgc-row">
          <Num label="высечка, ₽/1000 уд." value={p.cutPer1000} step={10} onCommit={(n) => setP({ cutPer1000: n })} />
          <Num label="ударов в час" value={p.strokesPerHour} step={100} onCommit={(n) => setP({ strokesPerHour: n })} />
          <Num label="наладка, ₽" value={p.pressSetup} step={100} onCommit={(n) => setP({ pressSetup: n })} />
        </div>
        <div className="dgc-row" style={{ marginTop: 6 }}>
          <Num label="склейка, ₽/шт" value={p.gluePerPcs} step={0.1} onCommit={(n) => setP({ gluePerPcs: n })} />
          <Num label="упаковка, ₽/шт" value={p.packPerPcs} step={0.1} onCommit={(n) => setP({ packPerPcs: n })} />
          <Num label="отход, доля" value={p.waste} step={0.01} onCommit={(n) => setP({ waste: n })} />
        </div>
        <div className="dgc-row" style={{ marginTop: 6 }}>
          <Num label="маржа, доля" value={p.batchMargin} step={0.05} onCommit={(n) => setP({ batchMargin: n })} />
          <Num label="НДС, доля" value={p.vat} step={0.05} onCommit={(n) => setP({ vat: n })} />
          <span />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="dgc-btn small ghost" onClick={() => setSettings({ prices: { ...DEFAULT_PRICES } })}>
            вернуть ставки по умолчанию
          </button>
          <button type="button" className="dgc-btn small ghost" onClick={resetAll}>
            сбросить всё (калькулятор + настройки)
          </button>
          <span style={{ flex: 1 }} />
          <span className="dgc-badge">всё хранится локально (localStorage), сервер не нужен</span>
        </div>
      </Card>
    </>
  );
}
