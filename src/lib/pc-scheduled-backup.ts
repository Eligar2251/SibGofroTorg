import { requestPcDownload } from "./pc-download-backup";
import { validatePublicBackup } from "./merge-public-snapshots";
// Scheduled browser backups are separate from the server's local JSON database.
// Defaults apply per browser profile. Files from different profiles never share a path.
export type PcSource = "primary" | "secondary";
export function pcSourceLabel(source: PcSource): string { return source === "primary" ? "Supabase №1 (SUPABASE_URL)" : "Supabase №2 (SUPABASE_SECONDARY_URL)"; }
export type PcScheduleSettings = { enabled: boolean; liveEnabled: boolean; autoActive?: boolean; sources: Record<PcSource, boolean>; folderName: string; computerId: string };
const SETTINGS = "sgt-pc-full-schedule-v1:";
const STATUS = "sgt-pc-full-schedule-status-v1:";
const EVENT = "sgt:pc-full-schedule";
const STORE = "handles";
const DB = "sgt-pc-full-schedule";
export const PC_SCHEDULE_EVENT = EVENT;
const empty: PcScheduleSettings = { enabled: true, liveEnabled: true, autoActive: false, sources: { primary: true, secondary: true }, folderName: "", computerId: "" };
export function getPcScheduleSettings(username: string): PcScheduleSettings {
  try {
    const stored = localStorage.getItem(SETTINGS + username);
    if (!stored) return structuredClone(empty);
    const x = JSON.parse(stored);
    const upgradeActive = x.defaultsVersion !== 2 && x.autoActive === true;
    return { enabled: x.enabled === true, liveEnabled: x.liveEnabled === true, autoActive: upgradeActive ? false : x.autoActive === true, sources: upgradeActive ? { primary: true, secondary: true } : { primary: x.sources?.primary === true, secondary: x.sources?.secondary === true }, folderName: typeof x.folderName === "string" ? x.folderName : "", computerId: typeof x.computerId === "string" && /^[a-f0-9-]{36}$/.test(x.computerId) ? x.computerId : "" };
  } catch { return structuredClone(empty); }
}
export function savePcScheduleSettings(username: string, value: PcScheduleSettings) {
  localStorage.setItem(SETTINGS + username, JSON.stringify({ ...value, defaultsVersion: 2 }));
  window.dispatchEvent(new Event(EVENT));
}
/** Allocate an independent identity even when no folder was chosen. Call under Web Lock. */
export function ensurePcScheduleIdentity(username:string):PcScheduleSettings {
  const settings=getPcScheduleSettings(username);
  if(!settings.computerId) {if(typeof crypto.randomUUID!=="function") throw new Error("Для настройки копии нужны HTTPS или localhost.");settings.computerId=crypto.randomUUID();savePcScheduleSettings(username,settings);}
  return settings;
}
export async function selectedPcSources(settings:PcScheduleSettings):Promise<PcSource[]> {
  const res=await fetch("/api/admin/database/pc-source",{cache:"no-store",signal:AbortSignal.timeout(8_000)});
  const data=await res.json();if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
  if(data.localReadonly===true)return [];
  if(!settings.autoActive) return (["primary","secondary"] as const).filter(s=>settings.sources[s]);
  if(data.source!=="primary" && data.source!=="secondary")throw new Error("Активная Supabase не выбрана.");
  return [data.source];
}
export type PcScheduleStatus = { last?: string; error?: string; sourceError?:string; activeSource?:PcSource | null; completed?: Record<string, string>; live?: Partial<Record<PcSource, { last?: string; error?: string; downloadRequested?:string; downloadError?:string; trackingWarning?:string }>> };
export function getPcScheduleStatus(username: string): PcScheduleStatus {
  try { return JSON.parse(localStorage.getItem(STATUS + username) || "{}"); } catch { return {}; }
}
export function savePcScheduleStatus(username: string, status: PcScheduleStatus) { localStorage.setItem(STATUS + username, JSON.stringify(status)); window.dispatchEvent(new Event(EVENT)); }
function handlesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function directory(username: string, mode: "get" | "put", handle?: unknown): Promise<any> {
  const db = await handlesDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode === "get" ? "readonly" : "readwrite");
      const req = mode === "get" ? tx.objectStore(STORE).get(username) : tx.objectStore(STORE).put(handle, username);
      let value: unknown; req.onsuccess = () => { value = req.result; };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function getPcScheduleDirectory(username: string): Promise<any> { return directory(username, "get"); }
export async function choosePcScheduleDirectory(username: string): Promise<PcScheduleSettings> {
  const picker = (window as any).showDirectoryPicker;
  if (!picker || !navigator.locks) throw new Error("Нужен Chrome или Edge с поддержкой доступа к папкам и блокировки вкладок; используйте HTTPS.");
  const handle = await picker({ id: "sgt-full-scheduled", mode: "readwrite" });
  const update = async () => {
    const current = getPcScheduleSettings(username);
    const previous = await directory(username, "get");
    let sameFolder = false;
    try { sameFolder = !!previous && typeof handle.isSameEntry === "function" && await handle.isSameEntry(previous); } catch { /* treat uncertain handle as a different folder */ }
    await directory(username, "put", handle);
    const computerId = sameFolder && current.computerId ? current.computerId : crypto.randomUUID();
    const settings = { ...current, folderName: handle.name, computerId };
    if (!sameFolder) savePcScheduleStatus(username, {});
    savePcScheduleSettings(username, settings);
    return settings;
  };
  if (!navigator.locks) return update();
  return navigator.locks.request(`sgt-pc-scheduled-full-backup:${username}`, {}, update);
}
export async function confirmPcSchedulePermission(username: string): Promise<boolean> {
  const handle = await directory(username, "get");
  if (!handle) return false;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}
// Explicit zone avoids dependence on Windows/browser timezone or DST settings.
export function novosibirskSlot(now: Date): { date: string; time: "18-00" | "23-00" } | null {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Novosibirsk", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find(x => x.type === type)?.value || "";
  const hour = Number(part("hour")), minute = Number(part("minute"));
  if ((hour !== 18 && hour !== 23) || minute > 10) return null;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: hour === 18 ? "18-00" : "23-00" };
}
/** Additional daily slot, explicit Moscow time. Previous Novosibirsk slots remain unchanged. */
export function moscowDailySlot(now: Date): { date: string; time: "18-00-msk" } | null {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find(x => x.type === type)?.value || "";
  if (Number(part("hour")) < 18) return null;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: "18-00-msk" };
}
async function pcSnapshotAvailable():Promise<boolean> {
  const res=await fetch("/api/admin/database/pc-local",{cache:"no-store",signal:AbortSignal.timeout(8_000)});
  if(!res.ok) throw new Error("Не удалось проверить локальный JSON на этом ПК.");
  const data=await res.json();
  if(data.available && (!data.configured || !data.ready)) throw new Error(`Локальная JSON-БД не готова: ${data.error || "подготовьте копию на этом ПК"}`);
  return data.available===true;
}
export async function writePcFile(dir: any, name: string, text: string) {
  const file = await dir.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  try { await stream.write(text); await stream.close(); }
  catch (e) { await stream.abort().catch(() => {}); throw e; }
}
export async function runPcScheduledBackups(username: string, now = new Date()): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.locks) return;
  const initial = getPcScheduleSettings(username); const slot = novosibirskSlot(now) || moscowDailySlot(now);
  if (!initial.enabled || !slot) return;
  // Web Locks serialize tabs of the same browser profile. Different PCs write
  // separate UUID directories, never the same file.
  await navigator.locks.request(`sgt-pc-scheduled-full-backup:${username}`, { ifAvailable: true }, async lock => {
    if (!lock) return;
    const settings = ensurePcScheduleIdentity(username);
    if (!settings.enabled) return;
    const handle = await directory(username, "get");
    if ((!handle && settings.folderName) || (handle && await handle.queryPermission({ mode: "readwrite" }) !== "granted")) {
      savePcScheduleStatus(username, { ...getPcScheduleStatus(username), error: "Нет доступа к папке: подтвердите разрешение в настройках бэкапа." }); return;
    }
    const errors: string[] = [];
    let sources: Array<PcSource | "local"> = [];
    try {sources=await selectedPcSources(settings)} catch(e) {errors.push(e instanceof Error?e.message:String(e));}
    try {if(await pcSnapshotAvailable()) sources.push("local");} catch(e) {errors.push(e instanceof Error?e.message:String(e));}
    for (const source of sources) {
      const key = `${slot.date}_${slot.time}_${source}`;
      const completeKey = slot.time === "18-00-msk" ? `msk_${source}` : source;
      if (getPcScheduleStatus(username).completed?.[completeKey] === key) continue;
      try {
        const res = await fetch(source === "local" ? "/api/admin/database/pc-local?download=1" : `/api/admin/database/full-backup?download=1&source=${source}`, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `HTTP ${res.status}`); }
        const text = await res.text();
        const snapshot = JSON.parse(text);
        if (snapshot.app !== "SibGofroTorg" || snapshot.backupFormat !== "sgt-public-v1") throw new Error("Сервер вернул не полный бэкап");
        const stillEnabled = getPcScheduleSettings(username);
        if (!stillEnabled.enabled || (source !== "local" && !(stillEnabled.autoActive || stillEnabled.sources[source])) || stillEnabled.computerId !== settings.computerId) continue;
        if (handle) {
          const computer = await handle.getDirectoryHandle(`pc-${settings.computerId}`, { create: true });
          const sourceDir = await computer.getDirectoryHandle(source, { create: true });
          const archives = await sourceDir.getDirectoryHandle("scheduled", { create: true });
          await writePcFile(archives, slot.time === "18-00-msk" ? "sgt-full-daily-msk.json" : `sgt-full-${slot.date}-${slot.time}.json`, text);
        } else { validatePublicBackup(snapshot); requestPcDownload(text,source,settings.computerId,"scheduled",now); }
        const current = getPcScheduleStatus(username);
        savePcScheduleStatus(username, { ...current, last: `${source === "local" ? "Локальная JSON-БД" : pcSourceLabel(source)}: ${handle ? "архив записан" : "запрошена загрузка архива (сохранение не подтверждено)"} · ${slot.date} ${slot.time === "18-00-msk" ? "18:00 (Москва)" : `${slot.time.replace("-", ":")} (Новосибирск)`}`, completed: { ...current.completed, [completeKey]: key } });
      } catch (e) {
        errors.push(`${source === "local" ? "Локальная JSON-БД" : pcSourceLabel(source)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    savePcScheduleStatus(username, { ...getPcScheduleStatus(username), error: errors.join("; ") });
  });
}

/** Explicit on-demand current snapshot. This is not change tracking. */
export async function savePcCurrentBackups(username: string): Promise<string[]> {
  if (!navigator.locks) throw new Error("Браузер не поддерживает безопасную блокировку вкладок.");
  return navigator.locks.request(`sgt-pc-scheduled-full-backup:${username}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Дождитесь завершения другой записи на этот ПК.");
    const settings = ensurePcScheduleIdentity(username);
    const errors: string[] = [];
    let sources: Array<PcSource | "local"> = [], localAvailable = false, localCheckFailed = false;
    try {sources=await selectedPcSources(settings)} catch(e) {errors.push(e instanceof Error?e.message:String(e));}
    try {localAvailable=await pcSnapshotAvailable(); if(localAvailable) sources.push("local");} catch(e) {localCheckFailed=true;errors.push(e instanceof Error?e.message:String(e));}
    if (!sources.length) throw new Error(errors.join("; ") || "Нет выбранного доступного источника для снимка.");
    const root = await directory(username, "get");
    if ((!root && settings.folderName) || (root && await root.queryPermission({ mode: "readwrite" }) !== "granted")) throw new Error("Нет доступа к папке: подтвердите разрешение.");
    const messages: string[] = [];
    for (const source of sources) {
      try {
        const res = await fetch(source === "local" ? "/api/admin/database/pc-local?download=1" : `/api/admin/database/full-backup?download=1&source=${source}`, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `HTTP ${res.status}`); }
        const text = await res.text();
        const snapshot = JSON.parse(text);
        if (snapshot.app !== "SibGofroTorg" || snapshot.backupFormat !== "sgt-public-v1") throw new Error("Сервер вернул не полный бэкап");
        const current = getPcScheduleSettings(username);
        if ((source !== "local" && !(current.autoActive || current.sources[source])) || current.computerId !== settings.computerId) throw new Error("Настройки изменились; повторите сохранение.");
        if(root) {
          const computer = await root.getDirectoryHandle(`pc-${settings.computerId}`, { create: true });
          const dir = await computer.getDirectoryHandle(source, { create: true });
          await writePcFile(dir, "sgt-full-current.json", text);
          messages.push(`${source === "local" ? "Локальная JSON-БД" : pcSourceLabel(source)}: сохранено`);
        } else {validatePublicBackup(snapshot);requestPcDownload(text,source,settings.computerId,"full");messages.push(`${source === "local" ? "Локальная JSON-БД" : pcSourceLabel(source)}: запрошена загрузка (сохранение не подтверждено)`)}
      } catch (e) { errors.push(`${source === "local" ? "Локальная JSON-БД" : pcSourceLabel(source)}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const status = getPcScheduleStatus(username);
    savePcScheduleStatus(username, { ...status, error: errors.join("; "), ...(messages.length ? { last: `Вручную: ${messages.join(", ")} · ${new Date().toLocaleString("ru-RU")}` } : {}) });
    return [...messages, ...errors, ...(!localAvailable && !localCheckFailed ? ["Локальная JSON-БД: доступна только при запуске сайта на этом ПК."] : [])];
  });
}
