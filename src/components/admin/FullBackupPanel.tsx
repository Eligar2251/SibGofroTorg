"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "primary" | "secondary" | "local";
type Config = { enabled: boolean; intervalSec: number; targets: Record<Mode, boolean> };
type Status = { running: boolean; source: Mode; lastRunAt: string | null; error: string | null; settings: Config; targets: Partial<Record<Mode, { state: string; at: string; message: string }>> };
const labels: Record<Mode, string> = { primary: "Supabase #1", secondary: "Supabase #2", local: "Локальная JSON-БД" };
const modes: Mode[] = ["primary", "secondary"];

export function FullBackupPanel({ pcLocalSite = false }: { pcLocalSite?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [targets, setTargets] = useState<Record<Mode, boolean>>({ primary: false, secondary: false, local: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const allInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/admin/database/full-backup", { cache: "no-store" });
      if (!res.ok) return;
      const data: Status = await res.json(); setStatus(data);
    } catch { /* retain last state */ }
  }
  useEffect(() => { refresh(); const timer = setInterval(() => refresh(), 30000); return () => clearInterval(timer); }, []);
  if (!status) return null; // endpoint is restricted to owner

  // Retain an explicit stop control for a previously enabled legacy replica.
  // Merely opening this page must never change an existing server setting.
  async function stopReplication() {
    const settings = status?.settings;
    if (!settings) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/admin/database/full-backup", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, enabled: false }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Ошибка настроек");
      setStatus(data); setMessage("Автокопирование между базами остановлено.");
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
      setMessage("Запрошено скачивание снимка; браузер отвечает за сохранение файла. Он содержит персональные данные и хеши паролей — храните его защищённо.");
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

  async function restoreAll(e: React.ChangeEvent<HTMLInputElement>) {
    const file=e.target.files?.[0]; e.target.value=""; if(!file)return;
    if(file.size>200*1024*1024){setError("Файл больше 200 МБ; восстановление остановлено.");return;}
    if(!window.confirm("Один выбранный файл заменит ВСЕ данные Supabase №1, Supabase №2 и локального JSON на этом ПК. Новые изменения в каждой базе будут потеряны. Остановите работу пользователей и заранее сохраните отдельные резервные копии. Операция может завершиться частично. Продолжить?"))return;
    setBusy(true);setError("");setMessage("");
    try {
      const snapshot=JSON.parse(await file.text());
      const res=await fetch("/api/admin/database/pc-local",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"restore_all",snapshot,confirmReplace:true})});
      const data=await res.json(); if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
      const succeeded=(data.results||[]).filter((x:{ok:boolean})=>x.ok).map((x:{target:Mode})=>labels[x.target]);
      const failed=(data.results||[]).filter((x:{ok:boolean})=>!x.ok).map((x:{target:Mode,error?:string})=>`${labels[x.target]}: ${x.error}`);
      if(failed.length)setError(`Частичное восстановление. Успешно: ${succeeded.join(", ") || "нет"}. Ошибки: ${failed.join("; ")}. Автоматического отката нет.`);
      else setMessage(`Восстановлено: ${succeeded.join(", ")}. Автообновление локальной копии остановлено; подготовьте журнал заново после проверки.`);
      window.dispatchEvent(new Event("sgt-pc-local-status")); window.dispatchEvent(new Event("sgt-pc-working-live"));
      await refresh();
    }catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
  }

  return <section style={{ padding: 16, border: "1px solid var(--adm-border, #ddd)", borderRadius: 12, marginBottom: 16, display: "grid", gap: 10 }}>
    <strong>Скачать или восстановить полный снимок — только владелец</strong>
    <div style={{ fontSize: 13 }}>Рабочая база: <b>{labels[status.source]}</b>. Снимок содержит таблицы приложения, но не файлы Cloudinary, Supabase Auth или Storage.</div>
    <div style={{ fontSize: 12 }}>Для Supabase нужна migration_complete_app_backup.sql и совместимая схема. Снимки содержат персональные данные и хеши паролей. Локальная JSON-копия доступна только при запуске сайта на этом ПК и предназначена для чтения.</div>
    {status.settings.enabled && <div role="alert" className="admin-error">
      Ранее включено автокопирование между базами: выбранные резервные базы могут полностью заменяться снимком рабочей базы.
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || status.running} onClick={stopReplication}>Остановить автокопирование</button>
    </div>}
    {status.error && <div className="admin-error">Ошибка последнего копирования: {status.error}</div>}
    <div><button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || status.running} onClick={download}>Скачать полный бэкап на ПК</button></div>
    <strong style={{ fontSize: 13 }}>Восстановить полный файл в выбранные базы</strong>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{modes.map(m => <label key={m}><input type="checkbox" checked={targets[m]} onChange={e => setTargets({ ...targets, [m]: e.target.checked })} disabled={busy || status.running} /> {labels[m]}</label>)}</div>
    <div><input ref={input} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={restore} /><button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || status.running} onClick={() => input.current?.click()}>Выбрать файл и восстановить</button></div>
    {pcLocalSite && <div>
      <strong style={{fontSize:13}}>Восстановить один файл во все три источника</strong>
      <p style={{fontSize:12}}>На локальном сайте в режиме Supabase. Сначала сохраните отдельные копии обеих баз и локального JSON. Замена полная; в случае ошибки результат может быть частичным. Системные данные Supabase Auth и файлы Storage в JSON не входят.</p>
      <input ref={allInput} type="file" accept=".json,application/json" style={{display:"none"}} onChange={restoreAll} />
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || status.running} onClick={()=>allInput.current?.click()}>Выбрать файл и восстановить все три</button>
    </div>}
    {message && <div role="status" style={{ fontSize: 13 }}>{message}</div>}{error && <div className="admin-error" role="alert">{error}</div>}
  </section>;
}
