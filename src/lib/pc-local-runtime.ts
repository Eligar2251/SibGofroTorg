/** Per-machine configuration for a deliberately started local server only. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createPcWorkingStore, readPcWorkingStore, type PcWorkingStore } from "./pc-working-store";
import type { PublicBackup } from "./merge-public-snapshots";

export type PcLocalSettings = { version:1; root:string; computerId:string; source:"primary"|"secondary"; mode:"remote"|"readonly" };
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
  if (!c || c.version!==1 || typeof c.root!=="string" || !path.isAbsolute(c.root) || typeof c.computerId!=="string" || !idFormat.test(c.computerId) || !["primary","secondary"].includes(c.source) || !["remote","readonly"].includes(c.mode)) throw new Error("Настройки локального сервера повреждены; автоматическое переключение остановлено.");
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
  return {available:true as const,configured:true as const,root:c.root,computerId:c.computerId,source:c.source,mode:c.mode,ready:!!store,error,createdAt:store?.createdAt??null,revision:store?.revision??null,totalRows:store?.current.totalRows??null};
}
/** Configuration is stored first; if interrupted after file creation it remains recoverable. */
export function initializePcLocal(root:string,source:"primary"|"secondary",snapshot:PublicBackup) {
  if(!isPcLocalServer()) throw new Error("Рабочая папка доступна только на локальном сервере ПК.");
  if(typeof root!=="string" || !path.isAbsolute(root)) throw new Error("Введите абсолютный путь к существующей папке ПК.");
  if(source!=="primary" && source!=="secondary") throw new Error("Неизвестный источник.");
  if(!fs.statSync(root).isDirectory()) throw new Error("Выберите существующую папку на ПК.");
  return configLock(()=>{
    let c=loadSettings();
    if(c && (c.root!==root || c.source!==source)) throw new Error("У этого ПК уже выбраны папка или источник. Старые файлы не перезаписаны.");
    if(!c) { c={version:1,root,computerId:crypto.randomUUID(),source,mode:"remote"}; writeSettings(c); }
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
