// =========================================================
// FILE: src/lib/die-calc-db.ts
// Сохранённые расчёты штанцформ (die_calc_jobs), выученная модель
// (die_calc_models) и общий прайс калькулятора (die_calc_settings).
//
// Слои: ядро расчёта (src/lib/die-calc) про базу не знает, UI (src/components/
// admin/die-calc) тоже. Всё взаимодействие с Supabase — здесь и в
// /api/admin/die-calc/*. Пишем только от service_role (getAdminDb), RLS на
// таблицах включена без политик.
//
// Обучение (trainDieCalcModel) считает ТЕМ ЖЕ ядром, что и калькулятор на
// экране: строки таблицы превращаются в DieCalcSample, из них learnModel()
// собирает поправку по габариту (FitCoef по подтверждённым записям) и
// множители цены. Поэтому «предпросмотр на клиенте» и «переобучение на
// сервере» не могут разойтись.
// =========================================================

import { getAdminDb } from "./supabase";
import {
  DEFAULT_PROFILES,
  learnModel,
  sampleFromRow,
  type DieCalcModel,
  type DieCalcSample,
} from "@/lib/die-calc";

/** строка die_calc_jobs — как её отдаёт Supabase (numeric приходит строкой) */
export interface DieCalcJobRow {
  id: string;
  order_no: string;
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
  blank_area_m2: number | string | null;
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
  settings: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** колонки, которые разрешено писать из админки (всё остальное игнорируем) */
const JOB_TEXT_COLUMNS = [
  "order_no",
  "name",
  "customer",
  "note",
  "status",
  "construction",
  "closure",
  "profile_id",
] as const;
const JOB_NUM_COLUMNS = [
  "l_mm",
  "w_mm",
  "h_mm",
  "qty",
  "blank_w",
  "blank_h",
  "die_w",
  "die_h",
  "blank_area_m2",
  "knives_m",
  "per_sheet",
  "sheets",
  "price_die",
  "price_batch",
  "price_per_pcs",
  "price_with_vat",
  "fact_blank_w",
  "fact_blank_h",
  "fact_price_per_pcs",
  "fact_price_batch",
  "fact_qty",
] as const;
const JOB_BOOL_COLUMNS = ["learned"] as const;
const JOB_JSON_COLUMNS = ["settings", "result"] as const;

const CONSTRUCTIONS = ["lastochkin", "lotok", "yazyk", "bokovoy", "blank"];
const CLOSURES = ["none", "half", "tuck", "full", "glue"];
const STATUSES = ["draft", "quoted", "approved", "in_work", "done", "rejected", "archived"];

/** максимальный размер jsonb в одной строке (250 КБ — больше снимок не бывает) */
const MAX_JSON_CHARS = 250_000;

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  // в колонках numeric(14,2)/(12,2) — дробей дальше сотых всё равно не будет
  return Math.round(n * 1e6) / 1e6;
};

const textOrNull = (v: unknown, max = 500): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
};

const dieCalcError = (message: string) => {
  const e = new Error(message) as Error & { status?: number };
  e.status = 400;
  return e;
};

/** тело запроса → колонки вставки; неизвестные ключи отбрасываем */
function jobValuesFromBody(body: Record<string, unknown>, actor: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const key of JOB_TEXT_COLUMNS) {
    if (!(key in body)) continue;
    if (key === "status") {
      const s = String(body.status ?? "draft");
      if (!STATUSES.includes(s)) throw dieCalcError(`Неизвестный статус расчёта: ${s}`);
      out.status = s;
      continue;
    }
    if (key === "construction") {
      const s = String(body.construction ?? "");
      if (!CONSTRUCTIONS.includes(s)) throw dieCalcError(`Неизвестная конструкция: ${s}`);
      out.construction = s;
      continue;
    }
    if (key === "closure") {
      const s = String(body.closure ?? "");
      if (!CLOSURES.includes(s)) throw dieCalcError(`Неизвестный замок: ${s}`);
      out.closure = s;
      continue;
    }
    out[key] = textOrNull(body[key], key === "note" ? 2000 : 300) ?? (key === "name" || key === "order_no" ? "" : null);
  }

  for (const key of JOB_NUM_COLUMNS) {
    if (!(key in body)) continue;
    const n = numOrNull(body[key]);
    if (["l_mm", "w_mm", "h_mm", "qty"].includes(key) && (n === null || n <= 0)) {
      throw dieCalcError(`Поле «${key}» должно быть положительным числом`);
    }
    out[key] = n;
  }

  for (const key of JOB_BOOL_COLUMNS) {
    if (key in body) out[key] = Boolean(body[key]);
  }

  for (const key of JOB_JSON_COLUMNS) {
    if (!(key in body)) continue;
    const raw = body[key];
    const value = typeof raw === "string" ? safeParse(raw) : raw;
    if (value === null || typeof value !== "object") {
      throw dieCalcError(`Поле «${key}» должно быть объектом`);
    }
    const text = JSON.stringify(value);
    if (text.length > MAX_JSON_CHARS) {
      throw dieCalcError(`Снимок расчёта слишком большой (${Math.round(text.length / 1024)} КБ)`);
    }
    out[key] = value;
  }

  const safeActor = textOrNull(actor, 120) ?? "admin";
  out.created_by = out.created_by ?? safeActor;
  out.updated_by = safeActor;
  return out;
}

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** есть ли таблицы в базе (иначе подсказываем, какую миграцию выполнить) */
export async function dieCalcTablesExist(): Promise<boolean> {
  try {
    const db = getAdminDb();
    const { error } = await db.from("die_calc_jobs").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

const HINT =
  "Таблиц расчётов штанцформ нет в базе. Выполните supabase/migration_die_calc.sql в Supabase → SQL Editor.";

function hintIfMissing(error: unknown): string | null {
  const msg = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  if (msg.includes("die_calc_") || msg.includes("schema cache") || msg.includes("does not exist")) {
    return HINT;
  }
  return null;
}

export function dieCalcTableHint(error: unknown): string | null {
  return hintIfMissing(error);
}

const JOB_SELECT = `
  id, order_no, name, customer, note, status,
  construction, closure, profile_id, l_mm, w_mm, h_mm, qty,
  blank_w, blank_h, die_w, die_h, blank_area_m2, knives_m, per_sheet, sheets,
  price_die, price_batch, price_per_pcs, price_with_vat,
  fact_blank_w, fact_blank_h, fact_price_per_pcs, fact_price_batch, fact_qty,
  learned, settings, result, created_by, updated_by, created_at, updated_at
`;

export interface ListJobsOptions {
  q?: string;
  status?: string;
  construction?: string;
  profileId?: string;
  /** только те, что участвуют в обучении */
  onlyLearned?: boolean;
  limit?: number;
  offset?: number;
}

export async function listDieCalcJobs(opts: ListJobsOptions = {}): Promise<{ jobs: DieCalcJobRow[]; total: number }> {
  const db = getAdminDb();
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const offset = Math.max(0, opts.offset ?? 0);

  let query = db.from("die_calc_jobs").select(JOB_SELECT, { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  if (opts.status && STATUSES.includes(opts.status)) query = query.eq("status", opts.status);
  if (opts.construction && CONSTRUCTIONS.includes(opts.construction)) query = query.eq("construction", opts.construction);
  if (opts.profileId) query = query.eq("profile_id", String(opts.profileId).slice(0, 20));
  if (opts.onlyLearned) query = query.eq("learned", true);
  const search = String(opts.q ?? "").trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,order_no.ilike.%${safe}%,customer.ilike.%${safe}%`);
  }

  const { data, count, error } = await query;
  if (error) throw dieCalcError(hintIfMissing(error) ?? `Не удалось прочитать расчёты: ${error.message}`);
  return { jobs: (data ?? []) as DieCalcJobRow[], total: count ?? (data?.length ?? 0) };
}

export async function getDieCalcJob(id: string): Promise<DieCalcJobRow | null> {
  const uuid = String(id).trim();
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return null;
  const db = getAdminDb();
  const { data, error } = await db.from("die_calc_jobs").select(JOB_SELECT).eq("id", uuid).maybeSingle();
  if (error) throw dieCalcError(hintIfMissing(error) ?? error.message);
  return (data as DieCalcJobRow | null) ?? null;
}

export async function createDieCalcJob(body: Record<string, unknown>, actor: string): Promise<DieCalcJobRow> {
  const values = jobValuesFromBody(body, actor);
  if (!values.name) values.name = autoName(values);
  if (!values.l_mm || !values.w_mm || !values.h_mm || !values.qty) {
    throw dieCalcError("Не хватает размеров или тиража: заполните L, W, H и количество");
  }
  if (!values.construction || !values.closure) {
    throw dieCalcError("Не указаны конструкция и замок");
  }
  const db = getAdminDb();
  const { data, error } = await db.from("die_calc_jobs").insert(values).select(JOB_SELECT).single();
  if (error) throw dieCalcError(hintIfMissing(error) ?? error.message);
  return data as DieCalcJobRow;
}

const autoName = (values: Record<string, unknown>): string => {
  const code: Record<string, string> = { lastochkin: "ЛХ-0427", lotok: "ЛК-0436", yazyk: "ЗЯ-0427", bokovoy: "БЗ-0470", blank: "заготовка" };
  return `${code[String(values.construction)] ?? values.construction}-${values.l_mm}*${values.w_mm}*${values.h_mm}-${values.profile_id ?? "E"}`;
};

export async function updateDieCalcJob(id: string, body: Record<string, unknown>, actor: string): Promise<DieCalcJobRow | null> {
  const uuid = String(id).trim();
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw dieCalcError("Некорректный id записи");
  const values = jobValuesFromBody(body, actor);
  delete values.created_by;
  // патч может быть частичным: обязательные поля не обнуляем
  for (const key of ["l_mm", "w_mm", "h_mm", "qty", "construction", "closure"]) {
    if (values[key] === null || values[key] === undefined || values[key] === "") delete values[key];
  }
  if (Object.keys(values).length <= 1) throw dieCalcError("Нечего сохранять: изменений нет");

  const db = getAdminDb();
  const { data, error } = await db.from("die_calc_jobs").update(values).eq("id", uuid).select(JOB_SELECT).maybeSingle();
  if (error) throw dieCalcError(hintIfMissing(error) ?? error.message);
  return (data as DieCalcJobRow | null) ?? null;
}

export async function deleteDieCalcJob(id: string): Promise<boolean> {
  const uuid = String(id).trim();
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw dieCalcError("Некорректный id записи");
  const db = getAdminDb();
  const { error, count } = await db.from("die_calc_jobs").delete({ count: "exact" }).eq("id", uuid);
  if (error) throw dieCalcError(hintIfMissing(error) ?? error.message);
  return (count ?? 0) > 0;
}

/* ─────────────────────────── обучение ─────────────────────────── */

export async function getActiveDieCalcModel(): Promise<DieCalcModel | null> {
  try {
    const db = getAdminDb();
    const { data, error } = await db
      .from("die_calc_models")
      .select("model, n, notes, trained_at, created_by")
      .eq("is_active", true)
      .order("trained_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      const hint = hintIfMissing(error);
      if (hint) return null; // без базы калькулятор живёт на localStorage — не роняем страницу
      return null;
    }
    const model = (data as { model?: DieCalcModel } | null)?.model;
    return model && typeof model === "object" ? model : null;
  } catch {
    return null;
  }
}

/** строки, из которых учимся: только «подтверждённые» (есть хоть один факт) */
export async function learnedSamples(limit = 2000): Promise<DieCalcSample[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("die_calc_jobs")
    .select(JOB_SELECT)
    .eq("learned", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw dieCalcError(hintIfMissing(error) ?? error.message);
  const rows = (data ?? []) as DieCalcJobRow[];
  return rows
    .map((r) => sampleFromRow(r as unknown as Record<string, unknown>))
    .filter((s): s is DieCalcSample => s !== null)
    .filter((s) => (s.factBlankW ?? 0) > 0 || (s.factBlankH ?? 0) > 0 || s.factPricePerPcs !== null || s.factPriceBatch !== null);
}

/** посчитать модель по базе, ничего не сохраняя (предпросмотр «что даст обучение») */
export async function buildDieCalcModel(): Promise<{ model: DieCalcModel; rows: number }> {
  const samples = await learnedSamples();
  const profiles = await getDieCalcProfiles();
  return { model: learnModel(samples, profiles, { minGeoSamples: 2, minPriceSamples: 2 }), rows: samples.length };
}

/**
 * Переобучение: читаем подтверждённые записи, считаем модель тем же ядром,
 * что и калькулятор на экране, и кладём новой активной строкой
 * (старые остаются историей — есть чем откатить неудачную подгонку).
 */
export async function trainDieCalcModel(actor: string): Promise<{ model: DieCalcModel; rows: number }> {
  const { model, rows } = await buildDieCalcModel();

  const db = getAdminDb();
  const { error: deactError } = await db.from("die_calc_models").update({ is_active: false }).eq("is_active", true);
  if (deactError && !hintIfMissing(deactError)) throw dieCalcError(deactError.message);

  const { error } = await db.from("die_calc_models").insert({
    is_active: true,
    n: model.n,
    model: model as unknown as Record<string, unknown>,
    notes: model.notes.slice(0, 40),
    trained_at: model.trainedAt,
    created_by: textOrNull(actor, 120) ?? "admin",
  });
  if (error) throw dieCalcError(hintIfMissing(error) ?? error.message);
  return { model, rows };
}

/** справочник профилей: из общего прайса, иначе — дефолты ядра */
async function getDieCalcProfiles(): Promise<typeof DEFAULT_PROFILES> {
  const content = await getDieCalcSettings();
  const profiles = (content as { profiles?: typeof DEFAULT_PROFILES } | null)?.profiles;
  return profiles?.length ? profiles : DEFAULT_PROFILES;
}

/* ─────────────────────────── общий прайс ─────────────────────────── */

export async function getDieCalcSettings(): Promise<Record<string, unknown> | null> {
  try {
    const db = getAdminDb();
    const { data, error } = await db.from("die_calc_settings").select("content").eq("key", "default").maybeSingle();
    if (error || !data) return null;
    const content = (data as { content?: Record<string, unknown> }).content;
    return content && typeof content === "object" ? content : null;
  } catch {
    return null;
  }
}

export async function saveDieCalcSettings(content: Record<string, unknown>, actor: string): Promise<void> {
  const text = JSON.stringify(content ?? {});
  if (text.length > MAX_JSON_CHARS) throw dieCalcError("Прайс получился слишком большим");
  const db = getAdminDb();
  const { error } = await db
    .from("die_calc_settings")
    .upsert({ key: "default", content, updated_by: textOrNull(actor, 120) ?? "admin", updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw dieCalcError(hintIfMissing(error) ?? error.message);
}

/* ─────────────────────────── сводка по группам ─────────────────────────── */

export interface DieCalcGroupStat {
  construction: string;
  closure: string;
  profile_id: string;
  jobs: number;
  with_fact_geom: number;
  with_fact_price: number;
  mean_blank_err_mm: number | string | null;
  mean_price_k: number | string | null;
  sum_price_batch: number | string | null;
  sum_fact_price_batch: number | string | null;
}

export async function getDieCalcStats(): Promise<DieCalcGroupStat[]> {
  try {
    const db = getAdminDb();
    const { data, error } = await db.from("die_calc_job_stats").select("*").order("jobs", { ascending: false }).limit(200);
    if (error) return [];
    return (data ?? []) as DieCalcGroupStat[];
  } catch {
    return [];
  }
}
