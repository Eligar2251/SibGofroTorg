"use client";

import { useEffect, useState } from "react";
import { runPcLiveBackup } from "@/lib/pc-live-backup";
import { choosePcScheduleDirectory, confirmPcSchedulePermission, getPcScheduleSettings, getPcScheduleStatus, PC_SCHEDULE_EVENT, runPcScheduledBackups, savePcCurrentBackups, savePcScheduleSettings, type PcScheduleSettings, type PcScheduleStatus } from "@/lib/pc-scheduled-backup";

/** Runs only while an owner is signed in with an admin tab open. */
export function PcScheduledFullBackupRunner({ username }: { username: string }) {
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => { const s = getPcScheduleStatus(username); const cfg = getPcScheduleSettings(username); setError([cfg.enabled ? s.error : "", cfg.liveEnabled && cfg.sources.primary ? s.live?.primary?.error : "", cfg.liveEnabled && cfg.sources.secondary ? s.live?.secondary?.error : ""].filter(Boolean).join("; ")); };
    const tick = () => { runPcScheduledBackups(username).catch(e => setError(e instanceof Error ? e.message : String(e))); };
    const liveTick = () => { runPcLiveBackup(username).catch(e => setError(e instanceof Error ? e.message : String(e))); };
    refresh(); tick(); liveTick();
    window.addEventListener(PC_SCHEDULE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const timer = setInterval(tick, 30_000);
    const liveTimer = setInterval(liveTick, 5_000);
    return () => { clearInterval(timer); clearInterval(liveTimer); window.removeEventListener(PC_SCHEDULE_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, [username]);
  if (!error) return null;
  return <div role="alert" style={{ padding: 10, background: "#fff4e5", color: "#762d0a" }}>Бэкап на ПК: {error} Откройте «База данных» для проверки.</div>;
}

export function PcScheduledFullBackupPanel({ username }: { username: string }) {
  const [config, setConfig] = useState<PcScheduleSettings | null>(null);
  const [status, setStatus] = useState<PcScheduleStatus>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => { setConfig(getPcScheduleSettings(username)); setStatus(getPcScheduleStatus(username)); };
    refresh(); window.addEventListener(PC_SCHEDULE_EVENT, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(PC_SCHEDULE_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, [username]);
  if (!config) return null;
  const set = (patch: Partial<PcScheduleSettings>) => savePcScheduleSettings(username, { ...config, ...patch });
  return <section style={{ padding: 16, border: "1px solid var(--adm-border, #ddd)", borderRadius: 12, marginBottom: 16, display: "grid", gap: 10 }}>
    <strong>Полные архивы на этом ПК по расписанию</strong>
    <div style={{ fontSize: 12, color: "#8b3f00" }}>Автообновление текущей копии экспериментальное: сначала проверьте на тестовой БД; журнал Supabase может расти и создавать нагрузку.</div>
    <div style={{ fontSize: 13 }}>В 18:00 и 23:00 по Новосибирску. Выберите общую папку Z: или любую папку этого ПК. Каждый профиль браузера создаёт отдельную подпапку и не перезаписывает файлы других ПК.</div>
    <div style={{ fontSize: 12 }}>Архив сохраняется только при открытой админке владельца, работающем сайте, доступном диске и разрешении браузера. Он содержит персональные данные и хеши паролей: ограничьте доступ к папке. Автообновление проверяет изменения примерно раз в 5 секунд, пока вкладка и сеть работают; возможны задержки. Файл не является рабочей JSON-БД. Потребуются обе миграции бэкапа на выбранных Supabase.</div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={async () => { try { await choosePcScheduleDirectory(username); setMessage("Папка выбрана. Выберите базы и включите расписание."); } catch (e) { if ((e as Error).name !== "AbortError") setMessage(e instanceof Error ? e.message : String(e)); } }}>Выбрать папку на ПК</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={async () => { try { setMessage(await confirmPcSchedulePermission(username) ? "Доступ к папке разрешён." : "Доступ не разрешён. Выберите папку заново."); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } }}>Подтвердить доступ</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || !config.folderName} onClick={async () => { setBusy(true); try { setMessage((await savePcCurrentBackups(username)).join("; ")); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Сохранить текущую копию сейчас</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || (!config.sources.primary && !config.sources.secondary)} onClick={async () => {
        if (!window.confirm("Подготовить отслеживание для выбранных Supabase? Оно включится для всей БД, не только этого ПК, будет записывать журнал при каждом изменении и может временно блокировать таблицы. Делайте это вне рабочего времени после проверки на тестовой БД.")) return;
        setBusy(true); const results: string[] = [];
        try { for (const source of ["primary", "secondary"] as const) if (config.sources[source]) { try {
          const response = await fetch("/api/admin/database/pc-incremental", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, action: "enable" }) });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
          results.push(`${source}: отслеживание подготовлено`);
        } catch (e) { results.push(`${source}: ${e instanceof Error ? e.message : String(e)}`); } } setMessage(results.join("; ")); } finally { setBusy(false); }
      }}>Подготовить отслеживание Supabase</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || (!config.sources.primary && !config.sources.secondary)} onClick={async () => {
        if (!window.confirm("Отключить журнал отслеживания для выбранных Supabase? Копирование изменений прекратится на ВСЕХ ПК. Файлы и существующий журнал сохранятся; после повторного включения потребуется полный снимок.")) return;
        setBusy(true); const results: string[] = [];
        try { for (const source of ["primary", "secondary"] as const) if (config.sources[source]) { try {
          const response = await fetch("/api/admin/database/pc-incremental", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, action: "disable" }) });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
          results.push(`${source}: отслеживание остановлено`);
        } catch (e) { results.push(`${source}: ${e instanceof Error ? e.message : String(e)}`); } } setMessage(results.join("; ")); } finally { setBusy(false); }
      }}>Остановить журнал в Supabase</button>
    </div>
    <div style={{ fontSize: 12 }}>Папка: {config.folderName || "не выбрана"}{config.computerId ? ` / pc-${config.computerId}` : ""}. Настройки хранятся для вашей учётной записи в этом профиле браузера.</div>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {(["primary", "secondary"] as const).map(source => <label key={source}><input type="checkbox" checked={config.sources[source]} onChange={e => set({ sources: { ...config.sources, [source]: e.target.checked } })} /> {source === "primary" ? "Supabase Cloud" : "Supabase VPS"}</label>)}
      <label><input type="checkbox" checked={config.enabled} disabled={!config.folderName || !config.computerId} onChange={e => set({ enabled: e.target.checked })} /> Включить расписание на этом ПК</label>
      <label><input type="checkbox" checked={config.liveEnabled} disabled={!config.folderName || !config.computerId} onChange={e => { if (e.target.checked && !window.confirm("Будет создан и обновляться файл sgt-live-current.json в отдельной папке этого ПК для каждого выбранного Supabase. Это резервная копия, не рабочая JSON-БД. Продолжить?")) return; set({ liveEnabled: e.target.checked }); }} /> Автообновление текущей копии на этом ПК</label>
    </div>
    <div style={{ fontSize: 12 }}>Последний архив: {status.last || "ещё нет"}. Если время пропущено более чем на 10 минут, автоматический архив за него не создаётся.</div>
    {(["primary", "secondary"] as const).filter(source => config.sources[source]).map(source => <div key={source} style={{ fontSize: 12 }}>{source === "primary" ? "Supabase Cloud" : "Supabase VPS"}: {status.live?.[source]?.error || (status.live?.[source]?.last ? `текущий файл обновлён ${new Date(status.live[source]!.last!).toLocaleString("ru-RU")}` : "текущий файл ещё не обновлялся")}</div>)}
    {status.error && <div className="admin-error" role="alert">{status.error}</div>}
    {message && <div role="status" style={{ fontSize: 12 }}>{message}</div>}
  </section>;
}
