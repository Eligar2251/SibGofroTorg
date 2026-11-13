/** Per-machine configuration for a deliberately started local server only. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createPcWorkingStore, readPcWorkingStore, replacePcCleanBaseline, restorePcWorkingSnapshot, copyPcWorkingStore, type PcWorkingStore } from "./pc-working-store";
import { buildSqlDataDump, sqlDumpFilename } from "./sql-data-dump";
import type { PublicBackup } from "./merge-public-snapshots";

export type PcLocalSettings = { version:1; root:string; computerId:string; source:"primary"|"secondary"; mode:"remote"|"readonly"; liveEnabled?:boolean; archivesEnabled?:boolean; autoManaged?:boolean };
export type PcLocalRoute = { kind:"disabled"|"remote" } | { kind:"readonly"; settings:PcLocalSettings } | { kind:"error"; message:string };
const idFormat=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isPcLocalServer() { return process.env.SGT_PC_LOCAL_SERVER === "1"; }
function configPath() { return path.join(process.env.SGT_PC_CONFIG_DIR || path.join(os.homedir(),".sibgofrotorg-pc"),"pc-readonly-settings.json"); }
function loadSettings(): PcLocalSettings | null {
  if (!isPcLocalServer()) return null;
  let raw:string;
  try { raw=fs.readFileSync(configPath(),"utf8"); }
  catch(e) { if((e as NodeJS.ErrnoException).code==="ENOENT") return null; throw e; }
  const c=JSON.parse(raw);
  if (!c || c.version!==1 || typeof c.root!=="string" || !path.isAbsolute(c.root) || typeof c.computerId!=="string" || !idFormat.test(c.computerId) || !["primary","secondary"].includes(c.source) || !["remote","readonly"].includes(c.mode) || (c.liveEnabled !== undefined && typeof c.liveEnabled !== "boolean") || (c.archivesEnabled !== undefined && typeof c.archivesEnabled !== "boolean") || (c.autoManaged !== undefined && typeof c.autoManaged !== "boolean")) throw new Error("Настройки локального сервера повреждены; автоматическое переключение остановлено.");
  return c;
}
function writeSettings(c:PcLocalSettings) {
  const file=configPath(); fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=`${file}.${crypto.randomUUID()}.tmp`; let fd:number|undefined;
  try { fd=fs.openSync(tmp,"wx",0o600); fs.writeFileSync(fd,JSON.stringify(c)); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined; fs.renameSync(tmp,file); }
  finally { if(fd!==undefined) fs.closeSync(fd); try {fs.unlinkSync(tmp)} catch(e) {if((e as NodeJS.ErrnoException).code!=="ENOENT") throw e} }
}
function configLock<T>(action:()=>T):T {
  const file=configPath(); fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const lock=`${file}.lock`; let fd:number;
  try {fd=fs.openSync(lock,"wx",0o600)} catch(e) {if((e as NodeJS.ErrnoException).code==="EEXIST") throw new Error("Настройки ПК заняты или осталась блокировка после сбоя."); throw e}
  try {return action()} finally {fs.closeSync(fd);fs.unlinkSync(lock)}
}
export function pcLocalRoute():PcLocalRoute {
  if (!isPcLocalServer()) return {kind:"disabled"};
  try { const c=loadSettings(); return c?.mode==="readonly" ? {kind:"readonly",settings:c} : {kind:"remote"}; }
  catch(e) { return {kind:"error",message:e instanceof Error?e.message:String(e)}; }
}
export function pcLocalStatus() {
  if (!isPcLocalServer()) return {available:false as const};
  const c=loadSettings(); if(!c) return {available:true as const,configured:false as const};
  let store:PcWorkingStore|null=null, error:string|null=null;
  try {store=readPcWorkingStore(c.root,c.computerId);} catch(e) {error=e instanceof Error?e.message:String(e)}
  return {available:true as const,configured:true as const,root:c.root,computerId:c.computerId,source:c.source,mode:c.mode,liveEnabled:c.liveEnabled===true,autoManaged:c.autoManaged===true,archivesEnabled:c.archivesEnabled===true,archiveStatus:readPcArchiveStatus(),ready:!!store,error,createdAt:store?.createdAt??null,updatedAt:store?.current.exportedAt??null,revision:store?.revision??null,totalRows:store?.current.totalRows??null};
}
/** Configuration is stored first; if interrupted after file creation it remains recoverable. */
export function initializePcLocal(root:string,source:"primary"|"secondary",snapshot:PublicBackup, options?:{autoManaged?:boolean}) {
  if(!isPcLocalServer()) throw new Error("Рабочая папка доступна только на локальном сервере ПК.");
  if(typeof root!=="string" || !path.isAbsolute(root)) throw new Error("Введите абсолютный путь к существующей папке ПК.");
  if(source!=="primary" && source!=="secondary") throw new Error("Неизвестный источник.");
  if(!fs.statSync(root).isDirectory()) throw new Error("Выберите существующую папку на ПК.");
  return configLock(()=>{
    let c=loadSettings();
    if(c && (c.root!==root || c.source!==source)) throw new Error("У этого ПК уже выбраны папка или источник. Старые файлы не перезаписаны.");
    if(!c) { c={version:1,root,computerId:crypto.randomUUID(),source,mode:"remote",...(options?.autoManaged ? {autoManaged:true,archivesEnabled:true} : {})}; writeSettings(c); }
    createPcWorkingStore(c.root,c.computerId,snapshot,{source,instanceId:null});
    return pcLocalStatus();
  });
}
export function setPcLocalMode(mode:"remote"|"readonly") {
  if(!isPcLocalServer()) throw new Error("Локальный режим не включён на этом сервере.");
  if(mode!=="remote" && mode!=="readonly") throw new Error("Некорректный режим.");
  return configLock(()=>{
    const c=loadSettings(); if(!c) throw new Error("Сначала подготовьте локальную копию.");
    if(mode==="readonly") readPcWorkingStore(c.root,c.computerId);
    writeSettings({...c,mode});
    return pcLocalStatus();
  });
}
/** Стандартная папка пользователя на этом ПК: Documents, иначе Downloads. */
function standardPcUserRoot():string {
  for (const name of ["Documents","Downloads"]) {
    const candidate=path.join(os.homedir(),name);
    try { if (fs.statSync(candidate).isDirectory()) return candidate; } catch { /* берём следующую */ }
  }
  throw new Error("На этом ПК не найдены ни Documents, ни Downloads. Укажите папку для локальной копии вручную в админке.");
}
/** Существующие Documents/Downloads: отсутствующая или перенаправленная папка не угадывается. */
export function defaultPcDownloadsRoot():string {
  if(!isPcLocalServer())throw new Error("Путь ПК доступен только при запуске сайта на этом компьютере.");
  // По умолчанию — стандартная папка пользователя: Documents, иначе Downloads
  // (порядок задает defaultPcBackupRoot). Переопределение — SGT_PC_BACKUP_DIR.
  const root=process.env.SGT_PC_BACKUP_DIR || process.env.SGT_PC_DOWNLOADS_DIR || standardPcUserRoot();
  if(!path.isAbsolute(root))throw new Error("Путь папки резервных копий на ПК должен быть абсолютным.");
  try {if(!fs.statSync(root).isDirectory())throw new Error("not directory");} catch {throw new Error("Папка Documents или Downloads не найдена или недоступна. Укажите существующую папку ПК в админке.");}
  return root;
}

/** Avoid switching into a snapshot that cannot authenticate this owner. */
export function assertPcOwner(snapshot:PublicBackup,username:string) {
  const admins=snapshot.tables.admins;
  if (!Array.isArray(admins) || !username.trim()) throw new Error("В снимке нет владельца; подключение остановлено.");
  const matches=admins.filter(row=>typeof row.username==="string" && row.username.trim().toLowerCase()===username.trim().toLowerCase());
  const owner=matches[0];
  if(matches.length!==1 || owner.is_active===false || owner.role!=="owner" || !((typeof owner.password_hash==="string" && owner.password_hash.length>0) || (typeof owner.password==="string" && owner.password.length>0))) throw new Error("В снимке нет активной учётной записи текущего владельца с паролем; подключение остановлено.");
}
export function readConfiguredPcSnapshot():PublicBackup {
  const c=loadSettings(); if(!c) throw new Error("Сначала подготовьте локальную копию.");
  return readPcWorkingStore(c.root,c.computerId).current;
}
export function readActivePcSnapshot():PublicBackup {
  const state=pcLocalRoute();
  if(state.kind!=="readonly") throw new Error(state.kind==="error"?state.message:"Просмотр локальной копии не включён.");
  return readPcWorkingStore(state.settings.root,state.settings.computerId).current;
}

/** Commit a received update only if settings and file have not changed during the network call. */
export function commitPcLiveBaseline(computerId:string,source:"primary"|"secondary",revision:number,tracked:unknown,enable:boolean, automatic=false) {
  return configLock(()=>{
    const c=loadSettings();
    if (!c || c.mode!=="remote" || c.computerId!==computerId || c.source!==source || (!enable && c.liveEnabled!==true) || (automatic && c.autoManaged!==true)) throw new Error("Настройки или режим ПК изменились; обновление отменено.");
    const store=replacePcCleanBaseline(c.root,c.computerId,revision,tracked);
    if(enable) writeSettings({...c,liveEnabled:true});
    return store;
  });
}
/** Only a remote-authenticated local owner may explicitly replace this PC file. */
export function restoreConfiguredPcSnapshot(snapshot:PublicBackup,username:string) {
  if(!isPcLocalServer()) throw new Error("Восстановление файла ПК доступно только на локальном сайте.");
  assertPcOwner(snapshot,username);
  return configLock(()=>{
    const c=loadSettings();
    if(!c || c.mode!=="remote") throw new Error("Для восстановления нужен локальный сайт в режиме Supabase и подготовленный JSON на ПК.");
    const old=readPcWorkingStore(c.root,c.computerId);
    // Disable the runner first, including after a write failure. A request that
    // was in flight cannot commit because it checks settings and revision.
    writeSettings({...c,liveEnabled:false,autoManaged:false});
    restorePcWorkingSnapshot(c.root,c.computerId,old.revision,snapshot);
    return pcLocalStatus();
  });
}
export function setPcLiveDisabled() {
  if(!isPcLocalServer()) throw new Error("Локальный сервер ПК не включён.");
  return configLock(()=>{const c=loadSettings();if(!c) throw new Error("Локальная копия не настроена.");writeSettings({...c,liveEnabled:false,autoManaged:false});return pcLocalStatus();});
}
export function readConfiguredPcStore():PcWorkingStore {
  const c=loadSettings();if(!c)throw new Error("Локальная копия не настроена.");return readPcWorkingStore(c.root,c.computerId);
}

/** Archive a consistent local snapshot in the scheduled Novosibirsk window. */
export function archivePcSnapshotAt(now:Date):{created:boolean;file?:string;reason?:string} {
  if(!isPcLocalServer()) return {created:false,reason:"disabled"};
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Novosibirsk',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=(type:string)=>parts.find(p=>p.type===type)?.value || '';
  const hour=get('hour'),minute=Number(get('minute'));
  // 18:00 Moscow is 22:00 Novosibirsk. Keep the two previous archives.
  const moscow = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const mg=(type:string)=>moscow.find(p=>p.type===type)?.value || '';
  const oldSlot=['18','23'].includes(hour) && Number.isInteger(minute) && minute<10;
  const dailyMoscow=Number(mg('hour'))>=18 && !oldSlot;
  if((!['18','23'].includes(hour) || !Number.isInteger(minute) || minute>=10) && !dailyMoscow) return {created:false,reason:'outside_window'};
  return configLock(()=>{
    const c=loadSettings();if(!c || c.archivesEnabled!==true) return {created:false,reason:'disabled'};
    const store=readPcWorkingStore(c.root,c.computerId);
    const base=path.join(c.root,`pc-${c.computerId.toLowerCase()}`), dir=path.join(base,'scheduled');
    try {fs.mkdirSync(dir,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    const st=fs.lstatSync(dir);if(!st.isDirectory() || st.isSymbolicLink())throw new Error('Каталог архивов должен быть обычной папкой, не ссылкой.');
    const file=path.join(dir,dailyMoscow ? `sgt-pc-${mg('year')}-${mg('month')}-${mg('day')}-1800-msk.json` : `sgt-pc-${get('year')}-${get('month')}-${get('day')}-${hour}00.json`);
    try {fs.lstatSync(file);return {created:false,file,reason:'already_exists'};} catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const temp=path.join(dir,`.sgt-archive-${crypto.randomUUID()}.tmp`);let fd:number|undefined;
    try {
      fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(store.current));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      if (dailyMoscow) {
        // The dated file is retained as history; this additional stable name is
        // replaced only after a complete snapshot was flushed to disk.
        const daily=path.join(dir,'sgt-pc-daily-msk.json');
        try {const old=fs.lstatSync(daily); if(!old.isFile() || old.isSymbolicLink()) throw new Error('Ежедневный файл не является обычным файлом.');}
        catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        const dailyTemp=path.join(dir,`.sgt-daily-${crypto.randomUUID()}.tmp`);let dailyFd:number|undefined;
        try {dailyFd=fs.openSync(dailyTemp,'wx',0o600);fs.writeFileSync(dailyFd,JSON.stringify(store.current));fs.fsyncSync(dailyFd);fs.closeSync(dailyFd);dailyFd=undefined;fs.renameSync(dailyTemp,daily);}
        finally {if(dailyFd!==undefined)fs.closeSync(dailyFd);try{fs.unlinkSync(dailyTemp)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
      }
      // Hard-link is a create-if-absent operation; rename can silently replace a file.
      try {fs.linkSync(temp,file);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return {created:false,file,reason:'already_exists'};throw e;}
      return {created:true,file};
    } finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  });
}
export function setPcArchivesEnabled(enabled:boolean) {
  if(!isPcLocalServer() || typeof enabled!=='boolean')throw new Error('Некорректная настройка архивов ПК.');
  return configLock(()=>{const c=loadSettings();if(!c)throw new Error('Локальная копия не настроена.');if(enabled)readPcWorkingStore(c.root,c.computerId);writeSettings({...c,archivesEnabled:enabled});return pcLocalStatus();});
}

export type PcArchiveStatus={lastSuccessAt?:string;lastFile?:string;error?:string;errorAt?:string};
function archiveStatusPath(){return path.join(path.dirname(configPath()),"pc-archive-status.json");}
export function readPcArchiveStatus():PcArchiveStatus {
  if(!isPcLocalServer())return {};
  try {const raw=JSON.parse(fs.readFileSync(archiveStatusPath(),"utf8"));return {lastSuccessAt:typeof raw.lastSuccessAt==="string"?raw.lastSuccessAt:undefined,lastFile:typeof raw.lastFile==="string"?raw.lastFile:undefined,error:typeof raw.error==="string"?raw.error:undefined,errorAt:typeof raw.errorAt==="string"?raw.errorAt:undefined};}
  catch{return {};}
}
/** Status lives on the PC, not the site server; no repeated writes for the same error. */
export function recordPcArchiveStatus(now:Date,result:{created:boolean;file?:string}|null,error?:unknown) {
  if(!isPcLocalServer())return;
  const previous=readPcArchiveStatus();let next:PcArchiveStatus;
  if(error) {const message=error instanceof Error?error.message:String(error);if(previous.error===message)return;next={...previous,error:message,errorAt:now.toISOString()};}
  else if(result?.created) next={lastSuccessAt:now.toISOString(),lastFile:result.file};
  else return;
  const file=archiveStatusPath();fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${crypto.randomUUID()}.tmp`;let fd:number|undefined;
  try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);}
  finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
}

/** Atomic single-file write with the same guarantees as the working database file. */
function writePcText(file: string, text: string, onlyIfMissing = false): boolean {
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Папка копии на ПК должна быть обычной папкой, не ссылкой.");
  if (onlyIfMissing) {
    try { fs.lstatSync(file); return false; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  } else {
    try { const old = fs.lstatSync(file); if (!old.isFile() || old.isSymbolicLink()) throw new Error("Файл копии должен быть обычным файлом, не ссылкой."); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  const temp = path.join(dir, `.sgt-dump-${crypto.randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    if (onlyIfMissing) {
      // Жёсткая связь создаёт файл только если его нет — replace невозможна.
      try { fs.linkSync(temp, file); } catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return false; throw e; }
    } else fs.renameSync(temp, file);
    return true;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
}

/**
 * Полный SQL-дамп данных из рабочей копии на этом ПК. Работает без Supabase и
 * без интернета: текст берётся из того же файла, из которого админка читает
 * данные в режиме локальной копии. Файлы кладутся рядом с sgt-working-db.json —
 * в выбранную папку (по умолчанию Documents, затем Downloads; можно указать свою).
 */
export function writePcSqlDumpFiles(): { root: string; files: string[]; totalRows: number; bytes: number; exportedAt: string; warnings: string[] } {
  if (!isPcLocalServer()) throw new Error("Локальный сервер ПК не включён.");
  const c = loadSettings();
  if (!c) throw new Error("Локальная копия не настроена.");
  const store = readPcWorkingStore(c.root, c.computerId);
  const dump = buildSqlDataDump(store.current, { sourceLabel: `Локальная копия на этом ПК · снимок ${c.source === "primary" ? "Supabase №1" : "Supabase №2"}` });
  const dir = path.join(c.root, `pc-${c.computerId.toLowerCase()}`);
  const files: string[] = [];
  writePcText(path.join(dir, "sgt-full-data-current.sql"), dump.sql);
  files.push(path.join(dir, "sgt-full-data-current.sql"));
  // Датированная копия не перезаписывается: история снимков остаётся на диске.
  // Время в имени нужно, чтобы два снимка одного дня не сливались в один файл.
  const stamp = new Date(store.current.exportedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const datedName = Number.isFinite(stamp.getTime())
    ? `sgt-full-data-${stamp.getUTCFullYear()}-${pad(stamp.getUTCMonth() + 1)}-${pad(stamp.getUTCDate())}-${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}.sql`
    : dump.filename;
  const dated = path.join(dir, datedName);
  if (writePcText(dated, dump.sql, true)) files.push(dated);
  return { root: c.root, files, totalRows: dump.totalRows, bytes: dump.bytes, exportedAt: store.current.exportedAt, warnings: dump.warnings };
}

/** Change the per-PC root only after a verified copy has been made; old data is retained. */
export function changePcRoot(root:string) {
  if(!isPcLocalServer()) throw new Error("Папка настраивается только на локальном сервере ПК.");
  if(typeof root!=="string" || !path.isAbsolute(root)) throw new Error("Введите абсолютный путь к существующей папке ПК.");
  if(!fs.statSync(root).isDirectory()) throw new Error("Выберите существующую папку на ПК.");
  return configLock(()=>{
    const c=loadSettings();if(!c)throw new Error("Сначала подготовьте локальную копию.");
    return copyPcWorkingStore(c.root,root,c.computerId,()=>{
      // Keep the source locked until config points to the verified copy.
      // If this write fails both full copies remain intact, and retry is safe.
      writeSettings({...c,root});return pcLocalStatus();
    });
  });
}
