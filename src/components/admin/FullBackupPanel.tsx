"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "primary" | "secondary" | "local";
type Config = { enabled: boolean; intervalSec: number; targets: Record<Mode, boolean> };
type Status = { running: boolean; source: Mode; lastRunAt: string | null; error: string | null; settings: Config; targets: Partial<Record<Mode, { state: string; at: string; message: string }>> };
const labels: Record<Mode, string> = { primary: "Supabase Cloud", secondary: "Supabase VPS", local: "Локальная JSON-БД" };
const modes: Mode[] = ["primary", "secondary"];

export function FullBackupPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [targets, setTargets] = useState<Record<Mode, boolean>>({ primary: false, secondary: false, local: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function refresh(initial = false) {
    try {
      const res = await fetch("/api/admin/database/full-backup", { cache: "no-store" });
      if (!res.ok) return;
      const data: Status = await res.json(); setStatus(data);
      if (initial) setConfig(data.settings);
    } catch { /* retain last state */ }
  }
  useEffect(() => { refresh(true); const timer = setInterval(() => refresh(false), 30000); return () => clearInterval(timer); }, []);
  if (!status || !config) return null; // endpoint is restricted to owner

  async function saveSettings(enabled: boolean) {
    if (enabled && !window.confirm("Автокопирование будет полностью заменять данные В ВЫБРАННЫХ РЕЗЕРВНЫХ БАЗАХ снимком рабочей базы. Используйте только базы-копии, где никто отдельно не пишет данные. Продолжить?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/admin/database/full-backup", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...config, enabled, confirmReplace: enabled }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Ошибка настроек");
      setStatus(data); setConfig(data.settings); setMessage(enabled ? "Копирование включено. Первый запуск через указанный интервал или кнопкой ниже." : "Автокопирование остановлено.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function runNow() {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/admin/database/full-backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Ошибка копирования");
      setStatus(data); const failures = Object.values(data.targets as Status["targets"]).filter(x => x?.state === "error");
      if (failures.length) setError(`Не все копии обновлены: ${failures.map(x => x?.message).join("; ")}`);
      else setMessage("Копирование завершено; состояние баз показано ниже.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function download() {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/admin/database/full-backup?download=1", { cache: "no-store" });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Не удалось создать полный бэкап"); }
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `sgt-full-public-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Полный снимок сохранён. Он содержит персональные данные и хеши паролей — храните его защищённо.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    const selected = modes.filter(m => targets[m]);
    if (!selected.length) { setError("Выберите хотя бы одну базу для восстановления."); return; }
    if (status?.settings.enabled) { setError("Сначала остановите автокопирование."); return; }
    if (!window.confirm(`ВСЕ таблицы в выбранных базах (${selected.map(m => labels[m]).join(", ")}) будут заменены данными из файла. Изменения после даты бэкапа будут потеряны. Убедитесь, что к ним никто не пишет. Продолжить?`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const snapshot = JSON.parse(await file.text());
      const res = await fetch("/api/admin/database/full-backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", snapshot, targets: selected, confirmReplace: true }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Ошибка восстановления");
      const failed = (data.results || []).filter((x: { ok: boolean }) => !x.ok);
      const succeeded = (data.results || []).filter((x: { ok: boolean }) => x.ok).map((x: { target: Mode }) => labels[x.target]);
      if (failed.length) setError(`Не восстановлены: ${failed.map((x: { target: Mode; error: string }) => `${labels[x.target]}: ${x.error}`).join("; ")}. Успешно: ${succeeded.join(", ") || "нет"}.`);
      else setMessage(`Восстановлено: ${succeeded.join(", ")}.`);
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return <section style={{ padding: 16, border: "1px solid var(--adm-border, #ddd)", borderRadius: 12, marginBottom: 16, display: "grid", gap: 10 }}>
    <strong>Полные копии всех таблиц приложения — только владелец</strong>
    <div style={{ fontSize: 13 }}>Рабочая база: <b>{labels[status.source]}</b>. Выбранные резервные базы периодически <b>полностью заменяются</b> её снимком. Остановка копирования не выключает сервер БД. Файлы Cloudinary и системные данные Supabase не включены.</div>
    <div style={{ fontSize: 12 }}>Требуется migration_complete_app_backup.sql на обоих Supabase и одинаковая схема таблиц. Снимки содержат персональные данные. Серверные JSON-копии не создаются. Независимая рабочая JSON-БД на ПК пока не реализована.</div>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {modes.map(m => <label key={m}><input type="checkbox" checked={config.targets[m]} onChange={e => setConfig({ ...config, targets: { ...config.targets, [m]: e.target.checked } })} disabled={busy || status.running} /> {labels[m]} — копирование</label>)}
      <label>Интервал (сек.): <input type="number" min={60} max={86400} value={config.intervalSec} onChange={e => setConfig({ ...config, intervalSec: Number(e.target.value) })} style={{ width: 75 }} disabled={busy || status.running} /></label>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="admin-btn admin-btn--primary admin-btn--sm" disabled={busy || status.running} onClick={() => saveSettings(true)}>Включить / сохранить копирование</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || status.running} onClick={() => saveSettings(false)}>Остановить копирование</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || status.running || !status.settings.enabled} onClick={runNow}>Копировать сейчас</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || status.running} onClick={download}>Скачать полный бэкап на ПК</button>
    </div>
    <div style={{ fontSize: 12 }}>Статус: {status.running ? "выполняется" : status.settings.enabled ? "включено" : "остановлено"} · Последний запуск: {status.lastRunAt ? new Date(status.lastRunAt).toLocaleString("ru-RU") : "ещё не выполнялся"}</div>
    {modes.map(m => <div key={m} style={{ fontSize: 12 }}>{labels[m]}: {status.targets[m]?.message || (m === status.source ? "Рабочая база" : "Нет данных о копировании")}{status.targets[m]?.at ? ` (${new Date(status.targets[m]!.at).toLocaleString("ru-RU")})` : ""}</div>)}
    {status.error && <div className="admin-error">Ошибка последнего запуска: {status.error}</div>}
    <strong style={{ fontSize: 13 }}>Восстановить полный файл в выбранные базы</strong>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{modes.map(m => <label key={m}><input type="checkbox" checked={targets[m]} onChange={e => setTargets({ ...targets, [m]: e.target.checked })} disabled={busy || status.running} /> {labels[m]}</label>)}</div>
    <div><input ref={input} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={restore} /><button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || status.running} onClick={() => input.current?.click()}>Выбрать файл и восстановить</button></div>
    {message && <div role="status" style={{ fontSize: 13 }}>{message}</div>}{error && <div className="admin-error" role="alert">{error}</div>}
  </section>;
}
