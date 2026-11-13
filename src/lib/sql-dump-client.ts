// =========================================================
// FILE: src/lib/sql-dump-client.ts
// Браузерная сторона SQL-дампа: сохранить файл на ПК.
//
// Сохранение ручное: showSaveFilePicker открывает системный диалог, где
// Documents и Downloads всегда под рукой (startIn: "documents"). Если браузер
// API не поддерживает или пользователь отменил диалог — обычная загрузка
// браузера, которая уходит в профильную папку Downloads.
//
// Браузер не может подтвердить, что файл лёг на диск: об этом честно говорит
// статус «запрошено», а не «сохранено».
// =========================================================
import { buildSqlDataDump, type SqlDumpResult } from "./sql-data-dump";

export type SqlDumpBundleJson = SqlDumpResult & { source: string; sourceLabel: string; exportedAt: string };

export function supportsPcSaveDialog(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";
}

/** Скачивание через якорь: папку выбирает браузер, обычно это Downloads. */
export function downloadTextFile(filename: string, text: string, mime = "text/plain;charset=utf-8"): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("Браузер не поддерживает сохранение файла.");
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}

/**
 * Пишет текст на диск ПК. Возвращает, куда именно попал файл; `saved=false`
 * означает «диалог отменён», а не ошибку.
 */
export async function saveTextToPc(filename: string, text: string, accept: Record<string, string[]> = { "text/plain": [".sql", ".txt"] }):
  Promise<{ saved: boolean; where: string }> {
  if (supportsPcSaveDialog()) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        startIn: "documents",
        types: [{ description: "Файл резервной копии", accept }],
      });
      const writable = await handle.createWritable();
      try { await writable.write(text); await writable.close(); }
      catch (e) { await writable.abort?.().catch(() => {}); throw e; }
      return { saved: true, where: handle.name || filename };
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return { saved: false, where: "диалог отменён" };
      throw e;
    }
  }
  downloadTextFile(filename, text);
  return { saved: false, where: "запрошено скачивание браузера (обычно папка Downloads)" };
}

export async function fetchSqlDump(options?: { source?: string; verify?: boolean; signal?: AbortSignal }): Promise<SqlDumpBundleJson> {
  const query = new URLSearchParams({ format: "json" });
  if (options?.source) query.set("source", options.source);
  if (options?.verify === false) query.set("verify", "0");
  const res = await fetch(`/api/admin/database/sql-dump?${query.toString()}`, { cache: "no-store", signal: options?.signal ?? AbortSignal.timeout(120_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as SqlDumpBundleJson;
}

/**
 * Тот же снимок → тот же SQL: файл собирается в браузере из уже скачанного JSON.
 * Частичный или старый снимок (без разделов columns/sequences) возвращает null:
 * SQL по нему собрать нельзя, и это не ошибка копии — JSON пишется как раньше.
 */
export function sqlDumpFromSnapshotText(text: string): SqlDumpResult | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  const s = parsed as { app?: unknown; backupFormat?: unknown; tables?: unknown; columns?: unknown; sequences?: unknown };
  if (!s || typeof s !== "object" || s.app !== "SibGofroTorg" || s.backupFormat !== "sgt-public-v1" ||
      !s.tables || typeof s.tables !== "object" || !s.columns || typeof s.columns !== "object" || !s.sequences || typeof s.sequences !== "object") return null;
  return buildSqlDataDump(s);
}

/** Ручное сохранение дампа: получили файл с сервера → сразу на диск ПК. */
export async function saveSqlDumpToPc(options?: { source?: string }): Promise<{ saved: boolean; where: string; filename: string; totalRows: number; warnings: string[] }> {
  const dump = await fetchSqlDump(options);
  const result = await saveTextToPc(dump.filename, dump.sql, { "text/plain": [".sql"] });
  return { ...result, filename: dump.filename, totalRows: dump.totalRows, warnings: dump.warnings };
}
