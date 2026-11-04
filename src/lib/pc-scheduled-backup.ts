// Scheduled browser backups are separate from the server's local JSON database.
// Opt in per browser profile. Files from different profiles never share a path.
export type PcSource = "primary" | "secondary";
export type PcScheduleSettings = { enabled: boolean; sources: Record<PcSource, boolean>; folderName: string; computerId: string };
const SETTINGS = "sgt-pc-full-schedule-v1:";
const STATUS = "sgt-pc-full-schedule-status-v1:";
const EVENT = "sgt:pc-full-schedule";
const STORE = "handles";
const DB = "sgt-pc-full-schedule";
export const PC_SCHEDULE_EVENT = EVENT;
const empty: PcScheduleSettings = { enabled: false, sources: { primary: true, secondary: false }, folderName: "", computerId: "" };
export function getPcScheduleSettings(username: string): PcScheduleSettings {
  try {
    const stored = localStorage.getItem(SETTINGS + username);
    if (!stored) return structuredClone(empty);
    const x = JSON.parse(stored);
    return { enabled: x.enabled === true, sources: { primary: x.sources?.primary === true, secondary: x.sources?.secondary === true }, folderName: typeof x.folderName === "string" ? x.folderName : "", computerId: typeof x.computerId === "string" && /^[a-f0-9-]{36}$/.test(x.computerId) ? x.computerId : "" };
  } catch { return structuredClone(empty); }
}
export function savePcScheduleSettings(username: string, value: PcScheduleSettings) {
  localStorage.setItem(SETTINGS + username, JSON.stringify(value));
  window.dispatchEvent(new Event(EVENT));
}
export type PcScheduleStatus = { last?: string; error?: string; completed?: Record<string, string> };
export function getPcScheduleStatus(username: string): PcScheduleStatus {
  try { return JSON.parse(localStorage.getItem(STATUS + username) || "{}"); } catch { return {}; }
}
function saveStatus(username: string, status: PcScheduleStatus) { localStorage.setItem(STATUS + username, JSON.stringify(status)); window.dispatchEvent(new Event(EVENT)); }
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
export async function choosePcScheduleDirectory(username: string): Promise<PcScheduleSettings> {
  const picker = (window as any).showDirectoryPicker;
  if (!picker || !navigator.locks) throw new Error("Нужен Chrome или Edge с поддержкой доступа к папкам и блокировки вкладок; используйте HTTPS.");
  const handle = await picker({ id: "sgt-full-scheduled", mode: "readwrite" });
  await directory(username, "put", handle);
  const current = getPcScheduleSettings(username);
  const settings = { ...current, folderName: handle.name, computerId: current.computerId || crypto.randomUUID() };
  savePcScheduleSettings(username, settings);
  return settings;
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
async function writeFile(dir: any, name: string, text: string) {
  const file = await dir.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  try { await stream.write(text); await stream.close(); }
  catch (e) { await stream.abort().catch(() => {}); throw e; }
}
export async function runPcScheduledBackups(username: string, now = new Date()): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.locks) return;
  const initial = getPcScheduleSettings(username); const slot = novosibirskSlot(now);
  if (!initial.enabled || !initial.computerId || !slot) return;
  // Web Locks serialize tabs of the same browser profile. Different PCs write
  // separate UUID directories, never the same file.
  await navigator.locks.request(`sgt-pc-scheduled-full-backup:${username}`, { ifAvailable: true }, async lock => {
    if (!lock) return;
    const settings = getPcScheduleSettings(username);
    if (!settings.enabled || !settings.computerId) return;
    const handle = await directory(username, "get");
    if (!handle || await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
      saveStatus(username, { ...getPcScheduleStatus(username), error: "Нет доступа к папке: подтвердите разрешение в настройках бэкапа." }); return;
    }
    const errors: string[] = [];
    for (const source of ["primary", "secondary"] as const) {
      if (!settings.sources[source]) continue;
      const key = `${slot.date}_${slot.time}_${source}`;
      if (getPcScheduleStatus(username).completed?.[source] === key) continue;
      try {
        const res = await fetch(`/api/admin/database/full-backup?download=1&source=${source}`, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `HTTP ${res.status}`); }
        const text = await res.text();
        const snapshot = JSON.parse(text);
        if (snapshot.app !== "SibGofroTorg" || snapshot.backupFormat !== "sgt-public-v1") throw new Error("Сервер вернул не полный бэкап");
        const stillEnabled = getPcScheduleSettings(username);
        if (!stillEnabled.enabled || !stillEnabled.sources[source] || stillEnabled.computerId !== settings.computerId) continue;
        const computer = await handle.getDirectoryHandle(`pc-${settings.computerId}`, { create: true });
        const sourceDir = await computer.getDirectoryHandle(source, { create: true });
        const archives = await sourceDir.getDirectoryHandle("scheduled", { create: true });
        const filename = `sgt-full-${slot.date}-${slot.time}.json`;
        await writeFile(archives, filename, text);
        const current = getPcScheduleStatus(username);
        saveStatus(username, { ...current, last: `${source}: ${slot.date} ${slot.time.replace("-", ":")} (Новосибирск), ${new Date().toLocaleString("ru-RU")}`, completed: { ...current.completed, [source]: key } });
      } catch (e) {
        errors.push(`${source}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    saveStatus(username, { ...getPcScheduleStatus(username), error: errors.join("; ") });
  });
}
