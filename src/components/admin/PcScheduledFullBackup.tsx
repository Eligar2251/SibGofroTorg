"use client";

import { useEffect, useState } from "react";
import { choosePcScheduleDirectory, confirmPcSchedulePermission, getPcScheduleSettings, getPcScheduleStatus, PC_SCHEDULE_EVENT, runPcScheduledBackups, savePcScheduleSettings, type PcScheduleSettings, type PcScheduleStatus } from "@/lib/pc-scheduled-backup";

/** Runs only while an owner is signed in with an admin tab open. */
export function PcScheduledFullBackupRunner({ username }: { username: string }) {
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => setError(getPcScheduleStatus(username).error || "");
    const tick = () => { runPcScheduledBackups(username).catch(e => setError(e instanceof Error ? e.message : String(e))); };
    refresh(); tick();
    window.addEventListener(PC_SCHEDULE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const timer = setInterval(tick, 30_000);
    return () => { clearInterval(timer); window.removeEventListener(PC_SCHEDULE_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, [username]);
  if (!error) return null;
  return <div role="alert" style={{ padding: 10, background: "#fff4e5", color: "#762d0a" }}>Бэкап на ПК: {error} Откройте «База данных» для проверки.</div>;
}

export function PcScheduledFullBackupPanel({ username }: { username: string }) {
  const [config, setConfig] = useState<PcScheduleSettings | null>(null);
  const [status, setStatus] = useState<PcScheduleStatus>({});
  const [message, setMessage] = useState("");
  useEffect(() => {
    const refresh = () => { setConfig(getPcScheduleSettings(username)); setStatus(getPcScheduleStatus(username)); };
    refresh(); window.addEventListener(PC_SCHEDULE_EVENT, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(PC_SCHEDULE_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, [username]);
  if (!config) return null;
  const set = (patch: Partial<PcScheduleSettings>) => savePcScheduleSettings(username, { ...config, ...patch });
  return <section style={{ padding: 16, border: "1px solid var(--adm-border, #ddd)", borderRadius: 12, marginBottom: 16, display: "grid", gap: 10 }}>
    <strong>Полные архивы на этом ПК по расписанию</strong>
    <div style={{ fontSize: 13 }}>В 18:00 и 23:00 по Новосибирску. Выберите общую папку Z: или любую папку этого ПК. Каждый профиль браузера создаёт отдельную подпапку и не перезаписывает файлы других ПК.</div>
    <div style={{ fontSize: 12 }}>Архив сохраняется только при открытой админке владельца, работающем сайте, доступном диске и разрешении браузера. Он содержит персональные данные и хеши паролей: ограничьте доступ к папке. Это архив, не рабочая локальная БД. Мгновенное копирование изменений и объединение независимых локальных БД здесь ещё не реализованы.</div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={async () => { try { await choosePcScheduleDirectory(username); setMessage("Папка выбрана. Выберите базы и включите расписание."); } catch (e) { if ((e as Error).name !== "AbortError") setMessage(e instanceof Error ? e.message : String(e)); } }}>Выбрать папку на ПК</button>
      <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={async () => { try { setMessage(await confirmPcSchedulePermission(username) ? "Доступ к папке разрешён." : "Доступ не разрешён. Выберите папку заново."); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } }}>Подтвердить доступ</button>
    </div>
    <div style={{ fontSize: 12 }}>Папка: {config.folderName || "не выбрана"}{config.computerId ? ` / pc-${config.computerId}` : ""}. Настройки хранятся для вашей учётной записи в этом профиле браузера.</div>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {(["primary", "secondary"] as const).map(source => <label key={source}><input type="checkbox" checked={config.sources[source]} onChange={e => set({ sources: { ...config.sources, [source]: e.target.checked } })} /> {source === "primary" ? "Supabase Cloud" : "Supabase VPS"}</label>)}
      <label><input type="checkbox" checked={config.enabled} disabled={!config.folderName || !config.computerId} onChange={e => set({ enabled: e.target.checked })} /> Включить расписание на этом ПК</label>
    </div>
    <div style={{ fontSize: 12 }}>Последний архив: {status.last || "ещё нет"}. Если время пропущено более чем на 10 минут, автоматический архив за него не создаётся.</div>
    {status.error && <div className="admin-error" role="alert">{status.error}</div>}
    {message && <div role="status" style={{ fontSize: 12 }}>{message}</div>}
  </section>;
}
