"use client";

import { useEffect, useState } from "react";
import { downloadCachedPcCopy } from "@/lib/pc-download-backup";
import { runPcLiveBackup } from "@/lib/pc-live-backup";
import { choosePcScheduleDirectory, confirmPcSchedulePermission, getPcScheduleSettings, getPcScheduleStatus, savePcScheduleStatus, PC_SCHEDULE_EVENT, runPcScheduledBackups, savePcCurrentBackups, savePcScheduleSettings, selectedPcSources, pcSourceLabel, type PcScheduleSettings, type PcScheduleStatus } from "@/lib/pc-scheduled-backup";

/** Runs only while an owner is signed in with an admin tab open. */
export function PcScheduledFullBackupRunner({ username }: { username: string }) {
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => {
      const s = getPcScheduleStatus(username), cfg = getPcScheduleSettings(username);
      const warnings = (["primary", "secondary"] as const).flatMap(source => {
        if (!cfg.liveEnabled || !(cfg.autoActive ? s.activeSource === source : cfg.sources[source])) return [];
        const detail = s.live?.[source]?.downloadError || s.live?.[source]?.error || s.live?.[source]?.trackingWarning;
        return detail ? [`${pcSourceLabel(source)}: ${detail}`] : [];
      });
      setError([cfg.enabled ? s.error : "", cfg.liveEnabled ? s.sourceError : "", ...warnings].filter(Boolean).join("; "));
    };
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
    <strong>Локальная копия и архивы на этом ПК</strong>
    <div style={{ fontSize: 12, color: "#8b3f00" }}>Автообновление текущей копии экспериментальное: сначала проверьте на тестовой БД; журнал Supabase может расти и создавать нагрузку.</div>
    <div style={{ fontSize: 13 }}>По умолчанию создаются отдельные снимки обеих Supabase; при запуске сайта на этом ПК в ту же папку попадает и локальный JSON. На Timeweb локальный файл ПК недоступен. Архивы: 18:00 и 23:00 по Новосибирску, дополнительно ежедневный файл в 18:00 по Москве (22:00 по Новосибирску), который перезаписывается. Без выбранной папки браузер запрашивает загрузку JSON, но не может гарантировать перезапись одного файла. Для одного обновляемого файла выберите папку на ПК или Z:.</div>
    <div style={{ fontSize: 12 }}>Только при открытой админке владельца и работающем сайте. Браузер может блокировать автоматические загрузки, спрашивать разрешение или сохранять в другую папку; сайт не может подтвердить сохранение. Загрузки создают много отдельных файлов. Без папки копия также хранится в IndexedDB этого профиля браузера (на другом сайте или ПК недоступна). Она содержит персональные данные и хеши паролей: ограничьте доступ к профилю и файлам. Для отслеживания изменений нужны обе миграции и подготовка журнала на каждой Supabase. Без журнала доступны полные снимки, но они не обновляются автоматически при изменениях. Офлайн-запись и синхронизация не выполняются.</div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={async () => { try { await choosePcScheduleDirectory(username); setMessage("Папка выбрана. Проверьте настройки и разрешения."); } catch (e) { if ((e as Error).name !== "AbortError") setMessage(e instanceof Error ? e.message : String(e)); } }}>Выбрать папку на ПК</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={async () => { try { setMessage(await confirmPcSchedulePermission(username) ? "Доступ к папке разрешён." : "Доступ не разрешён. Выберите папку заново."); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } }}>Подтвердить доступ</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy} onClick={async () => { setBusy(true); try { setMessage((await savePcCurrentBackups(username)).join("; ")); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Сохранить текущую копию сейчас</button>
      {(["primary","secondary"] as const).map(source => <button key={source} className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || !config.computerId} onClick={async () => { setBusy(true);try {await downloadCachedPcCopy(username,config.computerId,source);const s=getPcScheduleStatus(username);savePcScheduleStatus(username,{...s,live:{...s.live,[source]:{...s.live?.[source],downloadError:"",downloadRequested:new Date().toISOString()}}});setMessage(`${pcSourceLabel(source)}: запрошена загрузка копии из браузера; сохранение не подтверждено.`)}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}}>Скачать копию браузера {source === "primary" ? "#1" : "#2"}</button>)}
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || (!config.autoActive && !config.sources.primary && !config.sources.secondary)} onClick={async () => {
        if (!window.confirm("Подготовить отслеживание для выбранных Supabase? Оно включится для всей БД, не только этого ПК, будет записывать журнал при каждом изменении и может временно блокировать таблицы. Делайте это вне рабочего времени после проверки на тестовой БД.")) return;
        setBusy(true); const results: string[] = [];
        try { for (const source of await selectedPcSources(config)) { try {
          const response = await fetch("/api/admin/database/pc-incremental", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, action: "enable" }) });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
          results.push(`${pcSourceLabel(source)}: отслеживание подготовлено`);
        } catch (e) { results.push(`${pcSourceLabel(source)}: ${e instanceof Error ? e.message : String(e)}`); } } setMessage(results.join("; ") || "В локальном режиме удалённый источник не выбран."); } catch(e) {setMessage(e instanceof Error ? e.message : String(e));} finally { setBusy(false); }
      }}>Подготовить отслеживание Supabase</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || (!config.autoActive && !config.sources.primary && !config.sources.secondary)} onClick={async () => {
        if (!window.confirm("Отключить журнал отслеживания для выбранных Supabase? Копирование изменений прекратится на ВСЕХ ПК. Файлы и существующий журнал сохранятся; после повторного включения потребуется полный снимок.")) return;
        setBusy(true); const results: string[] = [];
        try { for (const source of await selectedPcSources(config)) { try {
          const response = await fetch("/api/admin/database/pc-incremental", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, action: "disable" }) });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
          results.push(`${pcSourceLabel(source)}: отслеживание остановлено`);
        } catch (e) { results.push(`${pcSourceLabel(source)}: ${e instanceof Error ? e.message : String(e)}`); } } setMessage(results.join("; ") || "В локальном режиме удалённый источник не выбран."); } catch(e) {setMessage(e instanceof Error ? e.message : String(e));} finally { setBusy(false); }
      }}>Остановить журнал в Supabase</button>
    </div>
    <div style={{ fontSize: 12 }}>Папка: {config.folderName || "не выбрана"}{config.computerId ? ` / pc-${config.computerId}` : ""}. Настройки хранятся для вашей учётной записи в этом профиле браузера.</div>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      <label><input type="checkbox" checked={!!config.autoActive} onChange={e => set({autoActive:e.target.checked})} /> Активная Supabase автоматически</label>
      {(["primary", "secondary"] as const).map(source => <label key={source}><input type="checkbox" disabled={!!config.autoActive} checked={!config.autoActive && config.sources[source]} onChange={e => set({ autoActive:false, sources: { ...config.sources, [source]: e.target.checked } })} /> {pcSourceLabel(source)}</label>)}
      <label><input type="checkbox" checked={config.enabled} onChange={e => set({ enabled: e.target.checked })} /> Включить расписание на этом ПК</label>
      <label><input type="checkbox" checked={config.liveEnabled} onChange={e => set({ liveEnabled: e.target.checked })} /> Автообновление текущей копии на этом ПК</label>
    </div>
    <div style={{ fontSize: 12 }}>Последний архив: {status.last?.replace(/\bprimary\b/g, "Supabase №1").replace(/\bsecondary\b/g, "Supabase №2") || "ещё нет"}. Прежние архивы создаются в первые 10 минут. Ежедневный файл за Москву создаётся после 18:00 при первой возможности в тот же день.</div>
    {(["primary", "secondary"] as const).filter(source => config.autoActive ? status.activeSource === source : config.sources[source]).map(source => <div key={source} style={{ fontSize: 12 }}>{pcSourceLabel(source)}: {status.live?.[source]?.downloadError || status.live?.[source]?.error || status.live?.[source]?.trackingWarning || (status.live?.[source]?.last ? (config.folderName ? `текущий файл обновлён ${new Date(status.live[source]!.last!).toLocaleString("ru-RU")}` : `копия обновлена в браузере; загрузка запрошена ${new Date(status.live[source]!.downloadRequested || status.live[source]!.last!).toLocaleString("ru-RU")} (сохранение файла не подтверждено)`) : "копии пока нет")}</div>)}
    {status.sourceError && <div className="admin-error" role="alert">{status.sourceError}</div>}
    {status.error && <div className="admin-error" role="alert">{status.error}</div>}
    {message && <div role="status" style={{ fontSize: 12 }}>{message}</div>}
  </section>;
}
