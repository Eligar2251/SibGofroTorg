"use client";

// =========================================================
// FILE: src/components/admin/DieCalcDbPanel.tsx
// Вкладка «База и обучение» в калькуляторе штанцформ.
//
// Здесь расчёт превращается в документ: строка в die_calc_jobs (ввод +
// коэффициенты + ставки + снимок результата), тут же технолог подтверждает
// факт (габарит с готовой матрицы и реальную цену),
// оттуда же запускается переобучение модели (die_calc_models), которую
// калькулятор потом применяет сам — припуски по габариту и множитель цены.
//
// Вкладка построена на слотах DieCalc (см. DieCalcWorkbench): ядро и UI
// расчёта про Supabase ничего не знают.
// =========================================================

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { Card, Chk, Num, Sel, fmtMm, fmtRub } from "@/components/admin/die-calc/controls";
import { JOB_STATUSES, jobTitle, jobToPatch, type DieCalcJobRow } from "@/components/admin/die-calc/jobs";
import type { UseCalc } from "@/components/admin/die-calc/store";
import { applyPriceFactor, describeModel, packJob, type DieCalcModel } from "@/lib/die-calc";

export interface DieCalcDbPanelProps {
  calc: UseCalc;
  /** строка, открытая через ?job= (редактируем её, а не плодим новые) */
  job: DieCalcJobRow | null;
  jobId: string | null;
  onJobId: (id: string | null) => void;
  model: DieCalcModel | null;
  onModel: (m: DieCalcModel | null) => void;
  canWrite: boolean;
  jobsHref: string;
  /** последние записи — приходят с сервера, чтобы список был без задержки */
  recent?: DieCalcJobRow[];
}

const numOrNull = (v: string): number | null => {
  const t = v.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("ru-RU") : "—";
};

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(str(data.error) || `Ошибка сети (${res.status})`);
  return data;
}

export function DieCalcDbPanel({
  calc,
  job,
  jobId,
  onJobId,
  model,
  onModel,
  canWrite,
  jobsHref,
  recent,
}: DieCalcDbPanelProps): ReactNode {
  const [meta, setMeta] = useState({
    name: job?.name ?? "",
    customer: job?.customer ?? "",
    status: job?.status ?? "draft",
    note: job?.note ?? "",
  });
  const [fact, setFact] = useState({
    blankW: str(job?.fact_blank_w),
    blankH: str(job?.fact_blank_h),
    pricePerPcs: str(job?.fact_price_per_pcs),
    priceBatch: str(job?.fact_price_batch),
    qty: str(job?.fact_qty),
    learned: job?.learned !== false,
  });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState<DieCalcJobRow[]>(recent ?? []);

  const flash = (kind: "ok" | "err", text: string): void => setMsg({ kind, text });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await api("/api/admin/die-calc?limit=12");
      setRows((data.jobs as DieCalcJobRow[] | undefined) ?? []);
      if (data.model) onModel(data.model as DieCalcModel);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Не удалось обновить список");
    }
  }, [onModel]);

  /** сохранить расчёт: новая строка или правка открытой */
  async function save(): Promise<void> {
    if (!calc.result) {
      flash("err", "Расчёт не готов — сначала исправьте размеры");
      return;
    }
    setBusy("save");
    try {
      const payload = packJob(calc.result, {
        orderNo: calc.state.orderNo,
        name: meta.name,
        customer: meta.customer || null,
        status: meta.status,
        note: meta.note || null,
        prices: calc.settings.prices,
        profiles: calc.settings.profiles,
        sheets: calc.settings.sheets,
      }) as unknown as Record<string, unknown>;
      if (jobId) {
        await api(`/api/admin/die-calc/${jobId}`, { method: "PATCH", body: JSON.stringify(payload) });
        flash("ok", "Расчёт обновлён в базе (фактические колонки не тронуты)");
      } else {
        const data = await api("/api/admin/die-calc", { method: "POST", body: JSON.stringify(payload) });
        const created = data.job as DieCalcJobRow | undefined;
        if (created?.id) onJobId(created.id);
        flash("ok", `Сохранено: ${created ? jobTitle(created) : "расчёт"} — теперь это строка в базе`);
      }
      void refresh();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  }

  /** «взять из расчёта»: фактические габарит = посчитанный (быстрый способ накормить обучение) */
  async function saveFact(copyFromCalc = false): Promise<void> {
    if (!jobId) {
      flash("err", "Сначала сохраните расчёт в базу — факт пишется в строку");
      return;
    }
    const body: Record<string, unknown> = copyFromCalc && calc.result
      ? {
          fact_blank_w: Math.round(calc.result.area.blankW * 10) / 10,
          fact_blank_h: Math.round(calc.result.area.blankH * 10) / 10,
          fact_price_per_pcs: Math.round(calc.result.cost.perPcs * 100) / 100,
          learned: fact.learned,
        }
      : {
          fact_blank_w: numOrNull(fact.blankW),
          fact_blank_h: numOrNull(fact.blankH),
          fact_price_per_pcs: numOrNull(fact.pricePerPcs),
          fact_price_batch: numOrNull(fact.priceBatch),
          fact_qty: numOrNull(fact.qty),
          learned: fact.learned,
        };
    setBusy("fact");
    try {
      await api(`/api/admin/die-calc/${jobId}`, { method: "PATCH", body: JSON.stringify(body) });
      const patch = body as Record<string, number | boolean | null>;
      setFact((f) => ({
        ...f,
        blankW: patch.fact_blank_w != null ? String(patch.fact_blank_w) : f.blankW,
        blankH: patch.fact_blank_h != null ? String(patch.fact_blank_h) : f.blankH,
        pricePerPcs: patch.fact_price_per_pcs != null ? String(patch.fact_price_per_pcs) : f.pricePerPcs,
      }));
      flash("ok", copyFromCalc ? "Факт принят равным расчёту — запись участвует в обучении" : "Факт сохранён — запись участвует в обучении");
      void refresh();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Не удалось сохранить факт");
    } finally {
      setBusy(null);
    }
  }

  async function train(preview: boolean): Promise<void> {
    setBusy(preview ? "preview" : "train");
    try {
      const data = await api("/api/admin/die-calc/train", { method: "POST", body: JSON.stringify({ preview }) });
      const next = (data.model as DieCalcModel | null) ?? null;
      const rowsN = Number(data.rows ?? 0);
      if (preview) {
        flash("ok", `Предпросмотр: ${rowsN} записей. ${next?.notes.join(" · ") ?? "—"}`);
      } else {
        if (next) onModel(next);
        flash("ok", `Модель пересчитана по ${rowsN} записям и применена к расчёту`);
      }
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Не удалось переобучить модель");
    } finally {
      setBusy(null);
    }
  }

  async function pushPrice(): Promise<void> {
    setBusy("price");
    try {
      await api("/api/admin/die-calc/settings", {
        method: "PUT",
        body: JSON.stringify({
          profiles: calc.settings.profiles,
          sheets: calc.settings.sheets,
          prices: calc.settings.prices,
          labelSize: calc.settings.labelSize,
        }),
      });
      flash("ok", "Ваши ставки сохранены как общий прайс калькулятора");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Не удалось сохранить прайс");
    } finally {
      setBusy(null);
    }
  }

  async function pullPrice(): Promise<void> {
    setBusy("price");
    try {
      const data = await api("/api/admin/die-calc/settings");
      const content = data.settings as Record<string, unknown> | null;
      if (!content || !Object.keys(content).length) {
        flash("err", "Общий прайс ещё не сохранён (сначала «сохранить мои ставки в общий» или страница расчётов)");
        return;
      }
      calc.setSettings(content as Parameters<typeof calc.setSettings>[0]);
      flash("ok", "Общий прайс загружен: ставки и справочники теперь как у всех");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Не удалось загрузить прайс");
    } finally {
      setBusy(null);
    }
  }

  function loadJob(row: DieCalcJobRow): void {
    const patch = jobToPatch(row);
    calc.hydrate(patch.initial, patch.initialSettings);
    onJobId(row.id);
    setMeta({ name: row.name ?? "", customer: row.customer ?? "", status: row.status ?? "draft", note: row.note ?? "" });
    setFact({
      blankW: str(row.fact_blank_w),
      blankH: str(row.fact_blank_h),
      pricePerPcs: str(row.fact_price_per_pcs),
      priceBatch: str(row.fact_price_batch),
      qty: str(row.fact_qty),
      learned: row.learned !== false,
    });
    flash("ok", `Загружен расчёт «${jobTitle(row)}» — можно выбрать другой замок и пересчитать`);
  }

  const res = calc.result;
  const cost = res?.cost ?? null;
  const scaled = cost ? applyPriceFactor(cost, calc.learn.priceK) : null;

  return (
    <div className="dgc-db">
      {msg ? <div className={`dgc-note dgc-note--${msg.kind}`}>{msg.text}</div> : null}

      <div className="dgc-db__cols">
        <div className="dgc-col">
          <Card
            title={jobId ? "Расчёт в базе — правка" : "Расчёт в базу"}
            right={
              <span className="dgc-badge">
                {jobId ? "строка найдена, сохраняем поверх" : "новая строка"}
              </span>
            }
          >
            <div className="dgc-row2">
              <label className="dgc-field">
                <label>маркировка / название</label>
                <input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="0427-240*180*60-E" />
              </label>
              <label className="dgc-field">
                <label>заказ</label>
                <input value={calc.state.orderNo} onChange={(e) => calc.setState({ orderNo: e.target.value })} placeholder="1200-10-25" />
              </label>
            </div>
            <div className="dgc-row2" style={{ marginTop: 6 }}>
              <label className="dgc-field">
                <label>клиент</label>
                <input value={meta.customer} onChange={(e) => setMeta({ ...meta, customer: e.target.value })} placeholder="ООО «Ромашка»" />
              </label>
              <Sel
                label="статус"
                value={meta.status}
                onCommit={(v) => setMeta({ ...meta, status: v })}
                options={JOB_STATUSES.map((s) => ({ id: s.id, name: s.name }))}
              />
            </div>
            <label className="dgc-field" style={{ marginTop: 6 }}>
              <label>заметка (что учли: бумага, тираж, сроки)</label>
              <textarea rows={2} value={meta.note} onChange={(e) => setMeta({ ...meta, note: e.target.value })} />
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" className="dgc-btn small" disabled={!canWrite || busy === "save"} onClick={() => void save()}>
                {busy === "save" ? "сохраняем…" : jobId ? "сохранить в базу (обновить)" : "сохранить в базу"}
              </button>
              {jobId ? (
                <button type="button" className="dgc-btn small ghost" onClick={() => onJobId(null)}>
                  сохранить как новую
                </button>
              ) : null}
              <Link href={jobsHref} className="dgc-btn small ghost">
                таблица расчётов
              </Link>
            </div>
            <p className="dgc-notes" style={{ marginTop: 8 }}>
              В строку уходит всё, что нужно для повтора: размеры, конструкция и замок, профиль, тираж, опции, ваши коэффициенты, ставки и
              снимок результата. Откроете позже — получите ровно тот же расчёт, даже если ставки в браузере уже другие.
            </p>
          </Card>

          <Card
            title="Факт: что получилось на самом деле"
            right={<span className="dgc-badge">кормит обучение</span>}
          >
            <p className="dgc-notes" style={{ marginTop: 0 }}>
              Замерили готовую матрицу или клиент подтвердил цену — внесите сюда. Пока факта нет, запись в обучение не попадает.
            </p>
            <div className="dgc-row">
              <Num label="заготовка W, факт, мм" value={numOrNull(fact.blankW) ?? 0} step={0.5} onCommit={(n) => setFact({ ...fact, blankW: n ? String(n) : "" })} />
              <Num label="заготовка H, факт, мм" value={numOrNull(fact.blankH) ?? 0} step={0.5} onCommit={(n) => setFact({ ...fact, blankH: n ? String(n) : "" })} />
              <Num label="тираж факт, шт" value={numOrNull(fact.qty) ?? 0} step={100} onCommit={(n) => setFact({ ...fact, qty: n ? String(n) : "" })} />
            </div>
            <div className="dgc-row" style={{ marginTop: 6 }}>
              <Num label="цена, ₽/шт" value={numOrNull(fact.pricePerPcs) ?? 0} step={0.1} onCommit={(n) => setFact({ ...fact, pricePerPcs: n ? String(n) : "" })} />
              <Num label="партия, ₽" value={numOrNull(fact.priceBatch) ?? 0} step={100} onCommit={(n) => setFact({ ...fact, priceBatch: n ? String(n) : "" })} />
              <span />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" className="dgc-btn small" disabled={!canWrite || busy === "fact"} onClick={() => void saveFact(false)}>
                {busy === "fact" ? "сохраняем…" : "сохранить факт"}
              </button>
              <button
                type="button"
                className="dgc-btn small ghost"
                disabled={!canWrite || !res}
                title="штамп сделали по нашему расчёту и ничего не поправилось — фиксируем это одним нажатием"
                onClick={() => void saveFact(true)}
              >
                факт = расчёт
              </button>
              <Chk
                label="учитывать в обучении"
                checked={fact.learned}
                onChange={(v) => setFact({ ...fact, learned: v })}
                hint="срывные тиражи и «по знакомству» можно выключить, не удаляя запись"
              />
            </div>
            {res ? (
              <p className="dgc-notes" style={{ marginTop: 8 }}>
                Расчёт: заготовка {fmtMm(res.area.blankW)}×{fmtMm(res.area.blankH)} мм, {fmtRub(res.cost.perPcs)}/шт, партия {fmtRub(res.cost.batch.total)}.
              </p>
            ) : null}
          </Card>
        </div>

        <div className="dgc-col">
          <Card
            title="Обучение"
            right={
              <Chk label="применять" checked={calc.learn.on} onChange={(v) => calc.learn.setOn(v)} hint="поправка по выученной модели к этому расчёту" />
            }
          >
            <ul className="dgc-notes" style={{ margin: 0, paddingLeft: 18 }}>
              {describeModel(model).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {cost && scaled ? (
              <table className="dgc-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>цена</th>
                    <th>по ставкам</th>
                    <th>по обучению</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ textAlign: "left" }}>шт</td>
                    <td>{fmtRub(cost.perPcs)}</td>
                    <td>{fmtRub(scaled.perPcs)}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: "left" }}>партия</td>
                    <td>{fmtRub(cost.batch.total)}</td>
                    <td>{fmtRub(scaled.batch)}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: "left" }}>штамп</td>
                    <td>{fmtRub(cost.die.total)}</td>
                    <td>{fmtRub(scaled.die)}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: "left" }}>с НДС</td>
                    <td>{fmtRub(cost.withVat)}</td>
                    <td>{fmtRub(scaled.withVat)}</td>
                  </tr>
                </tbody>
              </table>
            ) : null}
            <p className="dgc-notes" style={{ marginTop: 6 }}>
              Множитель {calc.learn.priceK.toFixed(3)} {calc.learn.priceN > 0 ? `по ${calc.learn.priceN} записям (${calc.learn.priceLabel}, разброс ±${calc.learn.priceSpreadPct} %)` : "— подтверждённых цен пока нет"}.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button type="button" className="dgc-btn small" disabled={!canWrite || busy === "train"} onClick={() => void train(false)}>
                {busy === "train" ? "считаем…" : "обучить по базе и применить"}
              </button>
              <button type="button" className="dgc-btn small ghost" disabled={busy === "preview"} onClick={() => void train(true)}>
                {busy === "preview" ? "считаем…" : "посмотреть без записи"}
              </button>
            </div>
          </Card>

          <Card
            title="Ставки: общий прайс"
            right={<span className="dgc-badge">die_calc_settings</span>}
          >
            <p className="dgc-notes" style={{ marginTop: 0 }}>
              Общий прайс подтягивается автоматически при открытии страницы — если в базе он пустой, работают ставки из localStorage этого браузера.
              Кнопка «сохранить мои в общий» публикует ваши ставки: цена в журнале, в обучении и у коллег начинает считаться по одним цифрам.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="dgc-btn small ghost" disabled={busy === "price"} onClick={() => void pullPrice()}>
                загрузить общий
              </button>
              <button type="button" className="dgc-btn small" disabled={!canWrite || busy === "price"} onClick={() => void pushPrice()}>
                сохранить мои в общий
              </button>
            </div>
          </Card>

          <Card
            title="Сохранённые расчёты"
            right={
              <button type="button" className="dgc-btn small ghost" onClick={() => void refresh()}>
                обновить
              </button>
            }
          >
            {rows.length === 0 ? (
              <p className="dgc-notes" style={{ margin: 0 }}>В базе пока нет ни одного расчёта.</p>
            ) : (
              <table className="dgc-table">
                <thead>
                  <tr>
                    <th>расчёт</th>
                    <th>заготовка</th>
                    <th>₽/шт</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((row) => (
                    <tr key={row.id}>
                      <td style={{ textAlign: "left" }}>
                        <b>{jobTitle(row)}</b>
                        <br />
                        <span className="dgc-muted">
                          {fmtMm(Number(row.l_mm))}×{fmtMm(Number(row.w_mm))}×{fmtMm(Number(row.h_mm))} · {row.closure} · {row.profile_id} · {fmtDate(row.created_at)}
                        </span>
                      </td>
                      <td>
                        {fmtMm(Number(row.blank_w ?? 0))}×{fmtMm(Number(row.blank_h ?? 0))}
                        {row.fact_blank_w ? <span className="dgc-badge"> факт {fmtMm(Number(row.fact_blank_w))}</span> : null}
                      </td>
                      <td>{fmtRub(Number(row.price_per_pcs ?? 0))}</td>
                      <td>
                        <button type="button" className="dgc-btn small" onClick={() => loadJob(row)}>
                          загрузить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="dgc-notes" style={{ marginTop: 8 }}>
              «Загрузить» восстанавливает ввод и коэффициенты — можно выбрать другой вариант замка, и заготовка, 3D и DXF пересчитаются заново.
              Полная таблица с правкой всех полей:{" "}
              <Link href={jobsHref} className="dgc-mono">
                {jobsHref}
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
