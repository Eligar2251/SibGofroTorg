// =========================================================
// FILE: src/components/admin/SqlDataDumpPanel.tsx
// Кнопки полного SQL-дампа данных в админке.
//
// «Сохранить на ПК» открывает системный диалог (обычно сразу Documents или
// Downloads) и пишет файл .sql на диск. «Скачать браузером» работает в любом
// браузере, но папку выбирает браузер. Оба варианта берут один и тот же
// снимок с сервера, поэтому JSON-копия и SQL-файл не расходятся.
// =========================================================
"use client";

import { useState } from "react";
import { downloadTextFile, fetchSqlDump, saveTextToPc, supportsPcSaveDialog, type SqlDumpBundleJson } from "@/lib/sql-dump-client";

type Props = {
  /** Компактный вид для разделов вроде макулатуры. */
  compact?: boolean;
  title?: string;
  note?: string;
};

const SOURCES = [
  { value: "auto", label: "Активная база" },
  { value: "primary", label: "Supabase №1" },
  { value: "secondary", label: "Supabase №2" },
  { value: "local", label: "Локальная копия на ПК" },
] as const;

export function SqlDataDumpPanel({ compact = false, title = "SQL-выгрузка всех данных", note }: Props) {
  const [source, setSource] = useState<(typeof SOURCES)[number]["value"]>("auto");
  const [dump, setDump] = useState<SqlDumpBundleJson | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canPickFolder = supportsPcSaveDialog();

  const guard = async (action: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await action(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const load = async () => {
    const result = await fetchSqlDump({ source: source === "auto" ? undefined : source });
    setDump(result);
    return result;
  };

  return (
    <section style={{ padding: compact ? 10 : 16, border: "1px solid var(--adm-border, #ddd)", borderRadius: 12, marginBottom: 16, display: "grid", gap: 10 }}>
      <strong>{title}</strong>
      <div style={{ fontSize: 12 }}>
        {note || "Один файл со всеми таблицами и всеми строками: вставили целиком в Supabase → SQL Editor → Run — получили данные на момент снимка. Файл не использует временные таблицы и BEGIN/COMMIT, поэтому проходит через пулер."}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12 }}>Откуда: {" "}
          <select value={source} onChange={e => { setSource(e.target.value as typeof source); setDump(null); }}>
            {SOURCES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy} onClick={() => guard(async () => { const result = await load(); setMessage(`Дамп собран: ${result.totalRows} строк в ${result.tables.length} таблицах · ${(result.bytes / 1024).toFixed(0)} КБ`); })}>Собрать и проверить</button>
        <button className="admin-btn admin-btn--sm" disabled={busy} title={canPickFolder ? "Сохранение в Документы или Downloads — что выберете в диалоге" : "Браузер не поддерживает выбор папки: файл уйдёт в папку загрузок браузера"} onClick={() => guard(async () => {
          const result = dump || await load();
          const saved = await saveTextToPc(result.filename, result.sql, { "text/plain": [".sql"] });
          setDump(result);
          setMessage(saved.saved ? `Файл ${result.filename} сохранён на ПК: ${result.totalRows} строк.` : `${result.filename}: ${saved.where}.`);
        })}>Сохранить SQL на ПК</button>
        <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy} onClick={() => guard(async () => {
          const result = dump || await load();
          setDump(result);
          downloadTextFile(result.filename, result.sql);
          setMessage(`${result.filename}: загрузка запрошена браузером (папку выбирает браузер, обычно Downloads).`);
        })}>Скачать SQL браузером</button>
      </div>
      {dump && (
        <div style={{ fontSize: 12 }}>
          Снимок от {dump.exportedAt ? new Date(dump.exportedAt).toLocaleString("ru-RU") : "неизвестно"} · источник: {dump.sourceLabel} · строк: {dump.totalRows} · размер: {(dump.bytes / 1024).toFixed(0)} КБ.
          В конце файла есть сверочный SELECT: «Ожидалось» и «Стало» должны совпасть.
        </div>
      )}
      {dump?.warnings?.length ? <div style={{ fontSize: 12, color: "#8b3f00" }}>{dump.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div> : null}
      {!canPickFolder && !compact ? <div style={{ fontSize: 12, color: "#8b3f00" }}>Браузер без выбора папки: сохранение пойдёт через обычные загрузки. JSON-копия в выбранную папку пишется в блоке «Локальная копия и архивы на этом ПК».</div> : null}
      {message ? <div role="status" style={{ fontSize: 12 }}>{message}</div> : null}
    </section>
  );
}
