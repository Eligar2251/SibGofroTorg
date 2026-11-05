/**
 * Experimental persistence primitive for a future per-PC working database.
 * This is deliberately not connected to application queries or exposed by an API.
 * One PC gets one directory; separate machines must never share its identifier.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stable, validatePublicBackup, type PublicBackup } from "./merge-public-snapshots";
import { validateTrackedBackup, type PcTracking } from "./pc-incremental";

export type PcOrigin = { source: "primary" | "secondary"; instanceId: string | null };
export type PcWorkingStore = {
  format: "sgt-pc-working-v1";
  computerId: string;
  origin: PcOrigin;
  createdAt: string;
  revision: number;
  baseHash: string;
  currentHash: string;
  base: PublicBackup;
  current: PublicBackup;
  tracking?: PcTracking;
  trackingHash?: string;
};
const name = "sgt-working-db.json";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function ensurePcMode() {
  if (process.env.SGT_PC_LOCAL_SERVER !== "1") throw new Error("Хранилище рабочей БД доступно только в явно включённом режиме локального сервера ПК.");
}
function location(root: string, computerId: string): string {
  ensurePcMode();
  if (!root || !path.isAbsolute(root)) throw new Error("Укажите абсолютный путь к существующей папке ПК.");
  if (!uuid.test(computerId)) throw new Error("Недопустимый идентификатор ПК.");
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error("Выбранный путь не является папкой.");
  return path.join(root, `pc-${computerId.toLowerCase()}`, name);
}
function validateOrigin(origin: PcOrigin) {
  if (!origin || (origin.source !== "primary" && origin.source !== "secondary") || (origin.instanceId !== null && !/^[a-f0-9]{32}$/.test(origin.instanceId))) throw new Error("Некорректное происхождение локальной БД.");
}
function validateSnapshot(value: unknown): PublicBackup {
  const result = validatePublicBackup(value);
  if (typeof result.exportedAt !== "string" || !Number.isFinite(Date.parse(result.exportedAt))) throw new Error("Некорректная дата снимка.");
  // Tracking metadata belongs to the backup process, not to the working DB.
  return { app:result.app, backupFormat:result.backupFormat, version:result.version, exportedAt:result.exportedAt, totalRows:result.totalRows, tables:result.tables, columns:result.columns, sequences:result.sequences };
}
function validateStore(raw: unknown, computerId: string): PcWorkingStore {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Файл рабочей БД повреждён.");
  const s = raw as PcWorkingStore;
  if (s.format !== "sgt-pc-working-v1" || s.computerId !== computerId.toLowerCase() || !Number.isSafeInteger(s.revision) || s.revision < 0 || typeof s.createdAt !== "string" || !Number.isFinite(Date.parse(s.createdAt))) throw new Error("Метаданные рабочей БД повреждены.");
  validateOrigin(s.origin);
  validateSnapshot(s.base); validateSnapshot(s.current);
  if (s.baseHash !== digest(s.base) || s.currentHash !== digest(s.current)) throw new Error("Контрольная сумма рабочей БД не совпадает; файл не будет изменён.");
  if (s.tracking || s.trackingHash) {
    if (!s.tracking || s.trackingHash !== digest(s.tracking) || s.origin.instanceId !== s.tracking.instance) throw new Error("Метаданные обновления повреждены; автоматическая запись остановлена.");
    validateTrackedBackup({...s.current,pcTracking:s.tracking});
  }
  if (stable(s.base.columns) !== stable(s.current.columns)) throw new Error("Схема рабочей БД не совпадает с исходным снимком.");
  return s;
}
function assertWorkingDirectory(file: string) {
  const stat = fs.lstatSync(path.dirname(file));
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Подпапка ПК должна быть обычной папкой, не ссылкой.");
}
function readExisting(file: string, computerId: string): PcWorkingStore {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Рабочий файл должен быть обычным файлом, не ссылкой.");
  return validateStore(JSON.parse(fs.readFileSync(file, "utf8")), computerId);
}
function withLock<T>(file: string, action: () => T): T {
  const lock = `${file}.lock`;
  let fd: number;
  try { fd = fs.openSync(lock, "wx", 0o600); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Рабочая БД занята или осталась блокировка после сбоя; автоматическая замена запрещена.");
    throw e;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    fs.fsyncSync(fd);
    return action();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
function writeAtomic(file: string, store: PcWorkingStore) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(store), "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
}
/** Create only: never replaces even an invalid or empty existing file. */
export function createPcWorkingStore(root: string, computerId: string, snapshot: unknown, origin: PcOrigin): PcWorkingStore {
  const file = location(root, computerId);
  validateOrigin(origin);
  // Validate before creating anything on disk.
  const copy = clone(validateSnapshot(snapshot));
  const store: PcWorkingStore = { format:"sgt-pc-working-v1", computerId: computerId.toLowerCase(), origin:clone(origin), createdAt:new Date().toISOString(), revision:0, baseHash:digest(copy), currentHash:digest(copy), base:copy, current:clone(copy) };
  try { fs.mkdirSync(path.dirname(file), { mode:0o700 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  assertWorkingDirectory(file);
  return withLock(file, () => {
    try { fs.lstatSync(file); throw new Error("Рабочий файл уже существует и не будет перезаписан."); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    writeAtomic(file, store);
    return clone(store);
  });
}
export function readPcWorkingStore(root: string, computerId: string): PcWorkingStore {
  const file = location(root, computerId);
  assertWorkingDirectory(file);
  return clone(readExisting(file, computerId));
}
/** Optimistic revision plus a filesystem lock prevents cooperating processes from overwriting one another. */
export function updatePcWorkingStore(root: string, computerId: string, expectedRevision: number, next: unknown): PcWorkingStore {
  const file = location(root, computerId);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Некорректная версия рабочей БД.");
  const nextSnapshot = clone(validateSnapshot(next));
  assertWorkingDirectory(file);
  return withLock(file, () => {
    const current = readExisting(file, computerId);
    if (current.revision !== expectedRevision) throw new Error("Рабочая БД изменилась в другом процессе; обновите данные перед записью.");
    if (stable(current.base.columns) !== stable(nextSnapshot.columns)) throw new Error("Изменение схемы локальной БД не поддерживается.");
    const hash = digest(nextSnapshot);
    if (hash === current.currentHash) return clone(current);
    if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error("Исчерпан диапазон версий рабочей БД.");
    const updated = { ...current, revision:current.revision + 1, current:nextSnapshot, currentHash:hash };
    writeAtomic(file, updated);
    return clone(updated);
  });
}

/** Replace a clean read-only baseline atomically; local edits are never overwritten. */
export function replacePcCleanBaseline(root:string, computerId:string, expectedRevision:number, tracked:unknown):PcWorkingStore {
  const next = validateTrackedBackup(tracked);
  const file = location(root,computerId);
  const clean = clone(validateSnapshot(next));
  const tracking = clone(next.pcTracking);
  assertWorkingDirectory(file);
  return withLock(file,()=>{
    const old = readExisting(file,computerId);
    if (old.revision !== expectedRevision) throw new Error("Рабочая БД изменилась во время обновления; повторите попытку.");
    if (old.baseHash !== old.currentHash) throw new Error("В локальной БД есть независимые изменения; автоматическая замена запрещена.");
    if (old.origin.instanceId && old.origin.instanceId !== tracking.instance) throw new Error("Идентификатор источника изменился; автоматическая замена запрещена.");
    if (old.revision === Number.MAX_SAFE_INTEGER) throw new Error("Исчерпан диапазон версий рабочей БД.");
    const nextStore:PcWorkingStore={...old,revision:old.revision+1,origin:{...old.origin,instanceId:tracking.instance},base:clean,current:clone(clean),baseHash:digest(clean),currentHash:digest(clean),tracking,trackingHash:digest(tracking)};
    writeAtomic(file,nextStore); return clone(nextStore);
  });
}

/** Explicit restore after owner confirmation. Stops trusting any old tracking cursor. */
export function restorePcWorkingSnapshot(root:string, computerId:string, expectedRevision:number, input:unknown):PcWorkingStore {
  const snapshot = clone(validateSnapshot(input));
  const file=location(root,computerId); assertWorkingDirectory(file);
  return withLock(file,()=>{
    const old=readExisting(file,computerId);
    if(old.revision!==expectedRevision) throw new Error("Локальная копия изменилась во время восстановления; повторите попытку.");
    if(old.revision===Number.MAX_SAFE_INTEGER) throw new Error("Исчерпан диапазон версий рабочей БД.");
    const {tracking: _tracking, trackingHash: _trackingHash, ...base}=old;
    const next:PcWorkingStore={...base,origin:{...old.origin,instanceId:null},revision:old.revision+1,base:snapshot,current:clone(snapshot),baseHash:digest(snapshot),currentHash:digest(snapshot)};
    writeAtomic(file,next); return clone(next);
  });
}

/** Copy the exact working store to a new manually selected root; never remove the old copy. */
export function copyPcWorkingStore<T>(sourceRoot:string,destinationRoot:string,computerId:string,afterCopy:(store:PcWorkingStore)=>T):T {
  const src=location(sourceRoot,computerId),dst=location(destinationRoot,computerId);
  if(fs.realpathSync(sourceRoot)===fs.realpathSync(destinationRoot)) throw new Error("Выбранная папка совпадает с текущей.");
  assertWorkingDirectory(src);
  try {fs.mkdirSync(path.dirname(dst),{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;}
  assertWorkingDirectory(dst);
  return withLock(src,()=>withLock(dst,()=>{
    const source=readExisting(src,computerId);
    // Safe recovery if the copy succeeded but switching the PC config failed.
    let previous:PcWorkingStore|undefined;
    try { previous=readExisting(dst,computerId); }
    catch(e) {if((e as NodeJS.ErrnoException).code!=="ENOENT") throw new Error("Файл в новой папке повреждён или недоступен; исходная БД сохранена, автоматическая перезапись запрещена.");}
    if(previous) {
      if(JSON.stringify(previous)!==JSON.stringify(source)) throw new Error("В новой папке уже есть другая рабочая БД. Она не будет перезаписана.");
      return afterCopy(clone(previous));
    }
    const temp=`${dst}.${crypto.randomUUID()}.tmp`;let fd:number|undefined;
    try {
      fd=fs.openSync(temp,"wx",0o600);fs.writeFileSync(fd,JSON.stringify(source),"utf8");fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      // Unlike rename, link is atomic and never replaces an existing destination.
      try {fs.linkSync(temp,dst);} catch(e) {
        const code=(e as NodeJS.ErrnoException).code;
        if(code!=="EPERM" && code!=="EACCES" && code!=="EOPNOTSUPP" && code!=="ENOTSUP" && code!=="EXDEV") throw e;
        // Some SMB shares disallow hard links. Exclusive creation still avoids
        // replacement; the old config stays active until the file validates.
        // A crash can leave a partial *new* file, which must never be overwritten.
        let destFd:number|undefined;
        try {destFd=fs.openSync(dst,"wx",0o600);fs.writeFileSync(destFd,JSON.stringify(source),"utf8");fs.fsyncSync(destFd);}
        finally {if(destFd!==undefined)fs.closeSync(destFd);}
      }
      return afterCopy(clone(readExisting(dst,computerId)));
    } finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp)}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
  }));
}
