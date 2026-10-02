"use client";

// =========================================================
// FILE: src/components/admin/DieCalcJobsClient.tsx
// Журнал сохранённых штанцформ: таблица, в которой правится всё — размеры,
// конструкция/замок/профиль, тираж, статус, цены, фактический габарит с
// матрицы и помеченное участие в обучении.
//
// Правки летят в PATCH /api/admin/die-calc/[id] (белый список колонок на
// сервере), колонки «расчёт» — только чтение: они пересчитываются ядром в
// калькуляторе и пишутся при сохранении расчёта поверх.
// =========================================================

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Save, Scissors, Search, Sparkles, Trash2 } from "lucide-react";
import { JOB_STATUSES, statusName } from "@/components/admin/die-calc/jobs";

export interface JobsTableRow {
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
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface GroupStat {
  construction: string;
  closure: string;
  profile_id: string;
  jobs: number;
  with_fact_geom: number;
  with_fact_price: number;
  mean_blank_err_mm: number | string | null;
  mean_price_k: number | string | null;
}

const CONSTRUCTION_OPTIONS = [
  { id: "lastochkin", name: "Ласточкин хвост" },
  { id: "lotok", name: "Лоток кондитерский" },
  { id: "yazyk", name: "Замочек-язычок" },
  { id: "bokovoy", name: "Замок боковой" },
  { id: "blank", name: "Готовая заготовка" },
];
const CLOSURE_OPTIONS = [
  { id: "none", name: "без закрытия" },
  { id: "half", name: "нахлёст вдвое" },
  { id: "tuck", name: "клапан + язычок" },
  { id: "full", name: "клапан-крышка" },
  { id: "glue", name: "под склейку" },
];

/** поля, которые правятся прямо в таблице */
const EDIT_TEXT = ["name", "customer", "note"] as const;
const EDIT_NUM = [
  "l_mm",
  "w_mm",
  "h_mm",
  "qty",
  "fact_blank_w",
  "fact_blank_h",
  "fact_price_per_pcs",
  "fact_price_batch",
  "fact_qty",
] as const;
const EDIT_SELECT = ["construction", "closure", "status"] as const;

type EditValue = string | boolean;
type Edits = Record<string, Record<string, EditValue>>;

const num = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};
const n2 = (v: unknown, digits = 0): string => {
  const n = num(v, NaN);
  return Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
};
const raw = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const mm = (v: unknown): string => {
  const n = num(v, NaN);
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
};
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("ru-RU") : "—";
};

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Ошибка (${res.status})`);
  return data;
}

export function DieCalcJobsClient({
  adminPath,
  jobs,
  total,
  modelNotes,
  stats,
  canWrite,
}: {
  adminPath: string;
  jobs: JobsTableRow[];
  total: number;
  model: unknown;
  modelNotes: string[];
  stats: GroupStat[];
  canWrite: boolean;
}): ReactNode {
  const [edits, setEdits] = useState<Edits>({});
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  /** значение в строке таблицы: правка пользователя или то, что пришло из базы */
  const originalValue = (row: JobsTableRow, key: string): EditValue =>
    key === "learned" ? row.learned !== false : raw((row as unknown as Record<string, unknown>)[key]);
  const value = (row: JobsTableRow, key: string): EditValue => edits[row.id]?.[key] ?? originalValue(row, key);
  const set = (row: JobsTableRow, key: string, v: EditValue): void =>
    setEdits((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] ?? {}), [key]: v } }));

  const changed = (row: JobsTableRow): string[] => {
    const e = edits[row.id];
    if (!e) return [];
    return Object.keys(e).filter((k) => String(e[k]) !== String(originalValue(row, k)));
  };

  // считать дешевле, чем мемоизировать: строк десятки, полей в правке единицы
  const dirtyIds = jobs.filter((r) => changed(r).length > 0).map((r) => r.id);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((r) => {
      if (status && r.status !== status) return false;
      if (!q) return true;
      return [r.name, r.order_no, r.customer, r.note, r.profile_id].some((x) => String(x ?? "").toLowerCase().includes(q));
    });
  }, [jobs, search, status]);

  function patchBody(row: JobsTableRow): Record<string, unknown> {
    const keys = changed(row);
    const body: Record<string, unknown> = {};
    for (const key of keys) {
      const v = value(row, key);
      if ((EDIT_TEXT as readonly string[]).includes(key)) body[key] = String(v).trim() || null;
      else if ((EDIT_NUM as readonly string[]).includes(key)) body[key] = v === "" ? null : num(v);
      else if (key === "learned") body[key] = Boolean(v);
      else body[key] = String(v);
    }
    return body;
  }

  async function saveRow(row: JobsTableRow): Promise<boolean> {
    const body = patchBody(row);
    if (!Object.keys(body).length) return false;
    await api(`/api/admin/die-calc/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
    // сохранённое становится «исходным»: строка берётся из ответа API
    return true;
  }

  async function saveAll(): Promise<void> {
    setBusy("save");
    setMsg(null);
    let saved = 0;
    const failed: string[] = [];
    for (const row of jobs) {
      if (!dirtyIds.includes(row.id)) continue;
      try {
        if (await saveRow(row)) saved += 1;
      } catch (e) {
        failed.push(`${row.name || row.id}: ${e instanceof Error ? e.message : "ошибка"}`);
      }
    }
    setBusy(null);
    if (failed.length) setMsg({ kind: "err", text: `Сохранено ${saved}, с ошибками: ${failed.slice(0, 3).join("; ")}` });
    else if (saved) setMsg({ kind: "ok", text: `Сохранено строк: ${saved}. Перезагружаем…` });
    else setMsg({ kind: "err", text: "Изменений нет" });
    if (saved) setTimeout(() => window.location.reload(), 700);
  }

  async function saveOne(row: JobsTableRow): Promise<void> {
    setBusy(row.id);
    setMsg(null);
    try {
      await saveRow(row);
      setMsg({ kind: "ok", text: "Строка сохранена" });
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Не удалось сохранить" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: JobsTableRow): Promise<void> {
    if (!window.confirm(`Удалить расчёт «${row.name || row.order_no || row.id}»? Факты для обучения тоже пропадут.`)) return;
    setBusy(row.id);
    try {
      await api(`/api/admin/die-calc/${row.id}`, { method: "DELETE" });
      setMsg({ kind: "ok", text: "Запись удалена" });
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Не удалось удалить" });
      setBusy(null);
    }
  }

  async function train(): Promise<void> {
    setBusy("train");
    setMsg(null);
    try {
      const data = await api("/api/admin/die-calc/train", { method: "POST", body: JSON.stringify({}) });
      const rows = Number(data.rows ?? 0);
      setMsg({ kind: "ok", text: `Модель пересчитана по ${rows} подтверждённым записям. Обновляем…` });
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Не удалось переобучить" });
      setBusy(null);
    }
  }

  const numCell = (row: JobsTableRow, key: (typeof EDIT_NUM)[number], label: string, width = 74, step = 1) => (
    <label className="dcj-field" title={label}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        className="admin-input dcj-input"
        style={{ width }}
        value={String(value(row, key))}
        disabled={!canWrite}
        onChange={(e) => set(row, key, e.target.value)}
      />
    </label>
  );
  const selCell = (row: JobsTableRow, key: (typeof EDIT_SELECT)[number], options: Array<{ id: string; name: string }>, width = 120) => (
    <select
      className="admin-input dcj-input dcj-select"
      style={{ width }}
      value={String(value(row, key))}
      disabled={!canWrite}
      onChange={(e) => set(row, key, e.target.value)}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="admin-stack dcj">
      <div className="admin-card">
        <div className="admin-card__pad dcj__bar">
          <div className="dcj__search">
            <Search size={14} />
            <input className="admin-input" placeholder="поиск: маркировка, заказ, клиент…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="admin-input dcj-select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 170 }}>
            <option value="">все статусы</option>
            {JOB_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="dcj__count">
            в базе <b>{total}</b> · показано <b>{filtered.length}</b>
            {dirtyIds.length ? <> · изменено <b>{dirtyIds.length}</b></> : null}
          </div>
          <div className="dcj__actions">
            <button type="button" className="admin-btn admin-btn--sm admin-btn--ghost" onClick={() => void train()} disabled={busy === "train" || !canWrite}>
              {busy === "train" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Обучить по базе
            </button>
            <button type="button" className="admin-btn admin-btn--sm admin-btn--primary" onClick={() => void saveAll()} disabled={!canWrite || busy === "save" || dirtyIds.length === 0}>
              {busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Сохранить все
            </button>
            <Link href={`/${adminPath}/die-calc`} className="admin-btn admin-btn--sm admin-btn--ghost">
              <Scissors size={12} /> Новый расчёт
            </Link>
          </div>
        </div>
      </div>

      <div className="admin-card dcj__learn">
        <div className="admin-card__pad">
          <b>Чему научилась программа</b>
          <ul className="dcj__notes">
            {modelNotes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <div className="dcj__hint">
            Фактические габарит и цена (колонки «факт») — единственное, что участвует в обучении. Пустой «факт» = запись лежит в журнале, но
            модель не двигает; флажок «в обучении» выключает конкретную строку, не удаляя её.
          </div>
        </div>
      </div>

      {msg ? <div className={`dcj__msg dcj__msg--${msg.kind}`}>{msg.text}</div> : null}

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table dcj-table">
            <thead>
              <tr>
                <th style={{ width: 250 }}>Расчёт</th>
                <th style={{ width: 330 }}>Ввод (правится)</th>
                <th style={{ width: 230 }}>Посчитано калькулятором</th>
                <th style={{ width: 330 }}>Факт (правится, кормит обучение)</th>
                <th style={{ width: 130 }}>Расхождение</th>
                <th style={{ width: 170 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isDirty = dirtyIds.includes(row.id);
                const estW = num(row.blank_w);
                const estH = num(row.blank_h);
                const factW = num(row.fact_blank_w);
                const factH = num(row.fact_blank_h);
                const geomErr = factW > 0 && factH > 0 && estW > 0 ? Math.round(((Math.abs(factW - estW) + Math.abs(factH - estH)) / 2) * 10) / 10 : null;
                const factPcs = num(row.fact_price_per_pcs) || (num(row.fact_price_batch) / (num(row.fact_qty) || num(row.qty, 1) || 1) || 0);
                const estPcs = num(row.price_per_pcs);
                const priceK = factPcs > 0 && estPcs > 0 ? Math.round((factPcs / estPcs) * 1000) / 1000 : null;
                return (
                  <tr key={row.id} className={isDirty ? "dcj-row--changed" : undefined}>
                    <td>
                      <input
                        className="admin-input dcj-input dcj-input--name"
                        value={String(value(row, "name"))}
                        placeholder="маркировка"
                        disabled={!canWrite}
                        onChange={(e) => set(row, "name", e.target.value)}
                      />
                      <input
                        className="admin-input dcj-input dcj-input--name"
                        style={{ marginTop: 4 }}
                        value={String(value(row, "customer"))}
                        placeholder="клиент"
                        disabled={!canWrite}
                        onChange={(e) => set(row, "customer", e.target.value)}
                      />
                      <div className="dcj__meta">
                        заказ {row.order_no || "—"} · {fmtDate(row.created_at)}
                        {row.created_by ? ` · ${row.created_by}` : ""}
                      </div>
                      <input
                        className="admin-input dcj-input dcj-input--note"
                        style={{ marginTop: 4 }}
                        value={String(value(row, "note"))}
                        placeholder="заметка"
                        disabled={!canWrite}
                        onChange={(e) => set(row, "note", e.target.value)}
                      />
                    </td>

                    <td>
                      <div className="dcj__sizes">
                        {numCell(row, "l_mm", "Д, мм")}
                        {numCell(row, "w_mm", "Ш, мм")}
                        {numCell(row, "h_mm", "В, мм")}
                        {numCell(row, "qty", "тираж, шт", 84, 100)}
                      </div>
                      <div className="dcj__selects">
                        {selCell(row, "construction", CONSTRUCTION_OPTIONS, 150)}
                        {selCell(row, "closure", CLOSURE_OPTIONS, 130)}
                        <label className="dcj-field" title="профиль гофрокартона (E, B, BC, C)">
                          <span>профиль</span>
                          <input
                            className="admin-input dcj-input"
                            style={{ width: 84 }}
                            value={String(value(row, "profile_id"))}
                            disabled={!canWrite}
                            onChange={(e) => set(row, "profile_id", e.target.value.toUpperCase().slice(0, 8))}
                          />
                        </label>
                        {selCell(row, "status", JOB_STATUSES, 130)}
                      </div>
                    </td>

                    <td className="dcj__calc">
                      <div>
                        заготовка <b>{mm(estW)}×{mm(estH)}</b> мм
                      </div>
                      <div>
                        штамп <b>{mm(row.die_w)}×{mm(row.die_h)}</b> · ножи {n2(row.knives_m, 2)} м
                      </div>
                      <div>
                        {n2(row.per_sheet)} шт/лист · {n2(row.sheets)} листов
                      </div>
                      <div>
                        ₽/шт <b>{n2(row.price_per_pcs, 2)}</b> · партия <b>{n2(row.price_batch)}</b>
                      </div>
                      <div className="dcj__meta">
                        штамп {n2(row.price_die)} ₽ · с НДС {n2(row.price_with_vat)} ₽
                      </div>
                    </td>

                    <td>
                      <div className="dcj__sizes">
                        {numCell(row, "fact_blank_w", "заготовка W, мм", 80, 0.5)}
                        {numCell(row, "fact_blank_h", "заготовка H, мм", 80, 0.5)}
                        {numCell(row, "fact_price_per_pcs", "₽/шт", 78, 0.1)}
                        {numCell(row, "fact_price_batch", "₽ партия", 92, 100)}
                        {numCell(row, "fact_qty", "тираж факт", 78, 100)}
                      </div>
                      <label className="dcj__learn-flag" title="участвует ли строка в переобучении">
                        <input type="checkbox" checked={Boolean(value(row, "learned"))} disabled={!canWrite} onChange={(e) => set(row, "learned", e.target.checked)} /> в обучении
                      </label>
                    </td>

                    <td className="dcj__delta">
                      {geomErr !== null ? (
                        <>
                          габарит <b>±{geomErr} мм</b>
                        </>
                      ) : (
                        <span className="dcj__none">факта по габариту нет</span>
                      )}
                      {priceK !== null ? (
                        <>
                          цена <b>×{priceK.toFixed(3)}</b>
                        </>
                      ) : (
                        <div className="dcj__none">цены нет</div>
                      )}
                    </td>

                    <td>
                      <div className="dcj__row-actions">
                        <button type="button" className="admin-btn admin-btn--sm admin-btn--primary" disabled={!canWrite || !isDirty || busy === row.id} onClick={() => void saveOne(row)}>
                          {busy === row.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Сохранить
                        </button>
                        <Link href={`/${adminPath}/die-calc?job=${row.id}`} className="admin-btn admin-btn--sm admin-btn--ghost" prefetch={false}>
                          <RefreshCw size={12} /> Пересчитать
                        </Link>
                        <button type="button" className="admin-btn admin-btn--sm admin-btn--ghost" disabled={!canWrite} onClick={() => void remove(row)} title="удалить строку">
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="dcj__meta">{statusName(row.status)}{row.updated_by ? ` · ${row.updated_by}` : ""}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <div className="admin-table__empty" style={{ padding: 24, textAlign: "center", color: "var(--adm-muted)" }}>
              {jobs.length === 0
                ? "Сохранённых расчётов пока нет. Откройте «Штанцформу», посчитайте коробку и нажмите «сохранить в базу» на вкладке «База и обучение»."
                : "Ничего не найдено по фильтру"}
            </div>
          ) : null}
        </div>
      </div>

      {stats.length ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <b>Среднее по группам</b>
            <div className="dcj__hint" style={{ margin: "4px 0 10px" }}>
              Сводка по подтверждённым записям (вьюха die_calc_job_stats): средняя ошибка габарита и средний множитель цены — то, из чего
              складывается выученная модель.
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>конструкция</th>
                    <th>замок</th>
                    <th>профиль</th>
                    <th style={{ textAlign: "right" }}>записей</th>
                    <th style={{ textAlign: "right" }}>с фактом габарита</th>
                    <th style={{ textAlign: "right" }}>с фактом цены</th>
                    <th style={{ textAlign: "right" }}>ошибка, мм</th>
                    <th style={{ textAlign: "right" }}>цена ×</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={`${s.construction}-${s.closure}-${s.profile_id}`}>
                      <td>{CONSTRUCTION_OPTIONS.find((c) => c.id === s.construction)?.name ?? s.construction}</td>
                      <td>{CLOSURE_OPTIONS.find((c) => c.id === s.closure)?.name ?? s.closure}</td>
                      <td>{s.profile_id}</td>
                      <td className="dcj__num">{s.jobs}</td>
                      <td className="dcj__num">{s.with_fact_geom}</td>
                      <td className="dcj__num">{s.with_fact_price}</td>
                      <td className="dcj__num">{s.mean_blank_err_mm === null ? "—" : n2(s.mean_blank_err_mm, 1)}</td>
                      <td className="dcj__num">{s.mean_price_k === null ? "—" : n2(s.mean_price_k, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
