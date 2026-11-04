// Browser-only incremental backup. It is NOT a working database.
import { applyPcDelta, trackedFromInitial, validateTrackedBackup, type PcTrackedBackup } from "./pc-incremental";
import { ensurePcScheduleIdentity, getPcScheduleDirectory, getPcScheduleSettings, getPcScheduleStatus, savePcScheduleStatus, selectedPcSources, writePcFile, type PcSource } from "./pc-scheduled-backup";
import { downloadCopyKey, hashDownloadText, readDownloadCopy, rememberTrackedDownload, requestPcDownload, trackedDownload, writeDownloadCopy, type DownloadCopy } from "./pc-download-backup";
import { validatePublicBackup } from "./merge-public-snapshots";

type Cache = { backup: PcTrackedBackup; text: string; stamp: string };
const caches = new Map<string, Cache>();
const filename = "sgt-live-current.json";
function stamp(file: File) { return `${file.lastModified}:${file.size}`; }
async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,"0")).join("");
}
function stateKey(username: string, computerId: string, source: PcSource) { return `${username}:${computerId}:${source}`; }
function hashKey(key: string) { return `sgt-pc-live-hash:${key}`; }
function pollKey(key: string) { return `sgt-pc-live-poll:${key}`; }
function saveLiveStatus(username: string, source: PcSource, patch: { error?: string; last?: string; downloadRequested?:string; downloadError?:string; trackingWarning?:string }) {
  const status = getPcScheduleStatus(username);
  savePcScheduleStatus(username, { ...status, live: { ...status.live, [source]: { ...status.live?.[source], ...patch } } });
}
async function getLiveDir(username: string, computerId: string, source: PcSource) {
  const handle = await getPcScheduleDirectory(username);
  if (!handle || await handle.queryPermission({ mode:"readwrite" }) !== "granted") throw new Error("Нет доступа к папке: подтвердите разрешение.");
  const computer = await handle.getDirectoryHandle(`pc-${computerId}`, { create:true });
  return computer.getDirectoryHandle(source, { create:true });
}
async function fileIfExists(dir: any): Promise<File | null> {
  try { return await (await dir.getFileHandle(filename)).getFile(); }
  catch (e) { if ((e as Error).name === "NotFoundError") return null; throw e; }
}
async function initial(source: PcSource): Promise<PcTrackedBackup> {
  const res = await fetch(`/api/admin/database/pc-incremental?source=${source}`, { cache:"no-store", signal:AbortSignal.timeout(90_000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return trackedFromInitial(data);
}
function ensureStillEnabled(username: string, computerId: string, source: PcSource) {
  const current = getPcScheduleSettings(username);
  if (!current.liveEnabled || !(current.autoActive || current.sources[source]) || current.computerId !== computerId) throw new Error("Настройки изменились, копирование остановлено.");
}
async function readCache(dir: any, key: string): Promise<Cache | null> {
  const file = await fileIfExists(dir);
  const cached = caches.get(key);
  if (!file) {
    if (cached || localStorage.getItem(hashKey(key))) throw new Error("Текущий файл копии исчез или диск недоступен. Проверьте папку; данные не заменены.");
    return null;
  }
  if (cached && cached.stamp === stamp(file)) return cached;
  const text = await file.text();
  const expected = localStorage.getItem(hashKey(key));
  if (!expected || await digest(text) !== expected) throw new Error("Файл копии изменён вне приложения. Автозапись остановлена, чтобы не потерять данные.");
  const next = { backup: validateTrackedBackup(JSON.parse(text)), text, stamp: stamp(file) };
  caches.set(key,next); return next;
}
async function writeChecked(dir: any, key: string, before: Cache | null, backup: PcTrackedBackup): Promise<Cache> {
  const existing = await fileIfExists(dir);
  if (!before && existing) throw new Error("Файл появился во время записи; автоматическая замена отменена.");
  if (before && (!existing || await existing.text() !== before.text)) throw new Error("Файл изменён во время копирования; автоматическая замена отменена.");
  const text = JSON.stringify(backup);
  await writePcFile(dir, filename, text);
  // On a storage failure do not advance the cursor: a later check fails closed.
  localStorage.setItem(hashKey(key), await digest(text));
  const file = await fileIfExists(dir);
  if (!file || await file.text() !== text) throw new Error("Не удалось проверить записанный файл.");
  const next = { backup, text, stamp:stamp(file) }; caches.set(key,next); return next;
}
async function syncSource(username: string, source: PcSource, computerId: string) {
  const key = stateKey(username,computerId,source);
  if (Date.now() - Number(localStorage.getItem(pollKey(key)) || 0) < 3500) return;
  localStorage.setItem(pollKey(key), String(Date.now()));
  const dir = await getLiveDir(username,computerId,source);
  let cache = await readCache(dir,key);
  if (!cache) {
    const backup = await initial(source);
    ensureStillEnabled(username,computerId,source);
    cache = await writeChecked(dir,key,null,backup);
    saveLiveStatus(username,source,{ last:new Date().toISOString(), error:"" });
    return;
  }
  const tracking = cache.backup.pcTracking;
  const res = await fetch("/api/admin/database/pc-incremental", { method:"POST", headers:{"Content-Type":"application/json"}, cache:"no-store", signal:AbortSignal.timeout(90_000), body:JSON.stringify({source,instance:tracking.instance,cursor:tracking.cursor,catalogHash:tracking.catalogHash}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (data?.reset === true) {
    if (data.reason === "instance_changed") throw new Error("Источник Supabase изменился. Файл старой БД не перезаписан; сохраните его и выберите новую папку.");
    const lastReset = Number(localStorage.getItem(`sgt-pc-live-reset:${key}`) || 0);
    if (Date.now() - lastReset < 60_000) throw new Error("Изменения требуют повторного полного снимка; следующая попытка через минуту. Возможна длительная транзакция.");
    localStorage.setItem(`sgt-pc-live-reset:${key}`, String(Date.now()));
    const backup = await initial(source);
    ensureStillEnabled(username,computerId,source);
    await writeChecked(dir,key,cache,backup);
    saveLiveStatus(username,source,{ last:new Date().toISOString(), error:"" });
    return;
  }
  const applied = applyPcDelta(cache.backup,data);
  if (applied.changed) {
    applied.backup.exportedAt = new Date().toISOString();
    ensureStillEnabled(username,computerId,source);
    await writeChecked(dir,key,cache,applied.backup);
    saveLiveStatus(username,source,{ last:new Date().toISOString(), error:"" });
  } else {
    // Cursor is kept in memory only; an unchanged data file is not rewritten.
    caches.set(key,{ ...cache, backup:applied.backup });
    saveLiveStatus(username,source,{ error:"" });
  }
}
function requestTrackedDownload(username:string,source:PcSource,computerId:string,text:string) {
  try { requestPcDownload(text,source,computerId,"live"); }
  catch(e) {saveLiveStatus(username,source,{downloadError:`Не удалось запросить загрузку; копия осталась в браузере. Скачайте её вручную: ${e instanceof Error?e.message:String(e)}`});throw e;}
}
async function downloadSource(username:string,source:PcSource,computerId:string) {
  const key=downloadCopyKey(username,computerId,source), pk=pollKey(`download:${key}`);
  if(Date.now()-Number(localStorage.getItem(pk)||0)<3500)return;
  localStorage.setItem(pk,String(Date.now()));
  const old=await readDownloadCopy(key);
  let backup:PcTrackedBackup|undefined;
  if(!old || old.kind==="full") {
    const retry=`sgt-pc-download-track-retry:${key}`;
    if(old && Date.now()-Number(localStorage.getItem(retry)||0)<60_000)return;
    localStorage.setItem(retry,String(Date.now()));
    try {backup=await initial(source)} catch(e) {
      const reason=e instanceof Error?e.message:String(e);
      if(old) {saveLiveStatus(username,source,{error:"",trackingWarning:`Изменения пока не отслеживаются: ${reason}. Подготовьте журнал Supabase.`});return;}
      const res=await fetch(`/api/admin/database/full-backup?download=1&source=${source}`,{cache:"no-store",signal:AbortSignal.timeout(90_000)});
      if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.error||`HTTP ${res.status}`)}
      const text=await res.text();validatePublicBackup(JSON.parse(text));
      ensureStillEnabled(username,computerId,source);
      const record:DownloadCopy={version:1,kind:"full",text,hash:await hashDownloadText(text)};
      await writeDownloadCopy(key,record,null);
      requestTrackedDownload(username,source,computerId,text);
      saveLiveStatus(username,source,{downloadError:"",last:new Date().toISOString(),downloadRequested:new Date().toISOString(),error:"",trackingWarning:`Создан только начальный снимок; изменения не отслеживаются: ${reason}. Подготовьте журнал Supabase.`});return;
    }
  } else {
    const current=trackedDownload(old), t=current.pcTracking;
    const res=await fetch("/api/admin/database/pc-incremental",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",signal:AbortSignal.timeout(90_000),body:JSON.stringify({source,instance:t.instance,cursor:t.cursor,catalogHash:t.catalogHash})});
    const data=await res.json();if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
    if(data?.reset===true) {
      if(data.reason==="instance_changed")throw new Error("Источник Supabase изменился. Старая копия не заменена; выберите новую папку или сохраните копию и настройте новый профиль.");
      const reset=`sgt-pc-download-reset:${key}`;if(Date.now()-Number(localStorage.getItem(reset)||0)<60_000)throw new Error("Повторный полный снимок отложен на минуту.");
      localStorage.setItem(reset,String(Date.now()));backup=await initial(source);
      if(backup.pcTracking.instance!==t.instance)throw new Error("Источник Supabase изменился во время снимка; старая копия сохранена.");
    } else {
      const applied=applyPcDelta(current,data);
      if(!applied.changed){rememberTrackedDownload(old,applied.backup);saveLiveStatus(username,source,{error:"",trackingWarning:""});return;}
      backup=applied.backup;backup.exportedAt=new Date().toISOString();
    }
  }
  ensureStillEnabled(username,computerId,source);
  const text=JSON.stringify(backup),record:DownloadCopy={version:1,kind:"tracked",text,hash:await hashDownloadText(text)};
  await writeDownloadCopy(key,record,old);
  requestTrackedDownload(username,source,computerId,text);
  saveLiveStatus(username,source,{downloadError:"",last:new Date().toISOString(),downloadRequested:new Date().toISOString(),error:"",trackingWarning:""});
}
export async function runPcLiveBackup(username: string): Promise<void> {
  if (typeof navigator === "undefined") return;
  if (!navigator.locks) throw new Error("Для автоматической локальной копии нужен браузер с блокировкой вкладок и HTTPS или localhost.");
  const initialSettings = getPcScheduleSettings(username);
  if (!initialSettings.liveEnabled) return;
  await navigator.locks.request(`sgt-pc-scheduled-full-backup:${username}`, { ifAvailable:true }, async lock => {
    if (!lock) return;
    const cfg=ensurePcScheduleIdentity(username);
    let sources:PcSource[];
    try {sources=await selectedPcSources(cfg)} catch(e) {savePcScheduleStatus(username,{...getPcScheduleStatus(username),sourceError:e instanceof Error?e.message:String(e)});return;}
    const status=getPcScheduleStatus(username),activeSource=cfg.autoActive?(sources[0]||null):null;
    if(status.sourceError || status.activeSource!==activeSource) savePcScheduleStatus(username,{...status,sourceError:"",activeSource});
    for (const source of sources) {
      try {
        // An existing, but revoked, folder permission is an error, not a silent move to downloads.
        const handle=await getPcScheduleDirectory(username);
        if(handle) await syncSource(username,source,cfg.computerId);
        else if(cfg.folderName) throw new Error("Доступ к выбранной папке утрачен. Выберите её заново.");
        else await downloadSource(username,source,cfg.computerId);
      } catch (e) { saveLiveStatus(username,source,{ error:e instanceof Error ? e.message : String(e) }); }
    }
  });
}
