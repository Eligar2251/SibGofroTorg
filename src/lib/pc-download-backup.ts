// Browser download fallback: storage and files remain on this browser/PC.
// A browser download can be blocked; JavaScript cannot confirm it reached disk.
import { validatePublicBackup } from "./merge-public-snapshots";
import { validateTrackedBackup, type PcTrackedBackup } from "./pc-incremental";
import type { PcSource } from "./pc-scheduled-backup";

const DB="sgt-pc-download-copy-v1", STORE="snapshots";
const memory=new Map<string,DownloadCopy>();
const parsedTracking=new WeakMap<DownloadCopy,PcTrackedBackup>();
const revisionKey=(key:string)=>`sgt-pc-download-revision:${key}`;
export type DownloadCopy = {version:1;kind:"tracked"|"full";text:string;hash:string};
export function downloadCopyKey(username:string,computerId:string,source:PcSource) {return JSON.stringify([username,computerId,source]);}
export async function hashDownloadText(text:string):Promise<string> {
  if(!globalThis.crypto?.subtle) throw new Error("Для проверки локальной копии нужны HTTPS или localhost.");
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}
function openDb():Promise<IDBDatabase> {
  if(typeof indexedDB==="undefined") return Promise.reject(new Error("Браузер не поддерживает локальное хранилище IndexedDB."));
  return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error("Локальное хранилище заблокировано другой вкладкой."));});
}
export async function readDownloadCopy(key:string):Promise<DownloadCopy|null> {
  const cached=memory.get(key);
  if(cached && localStorage.getItem(revisionKey(key))===cached.hash)return cached;
  const db=await openDb();let value:unknown;
  try {value=await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readonly"),r=tx.objectStore(STORE).get(key);let got:unknown;r.onsuccess=()=>{got=r.result};tx.oncomplete=()=>resolve(got);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});} finally {db.close()}
  if(value===undefined || value===null)return null;
  const record=value as DownloadCopy;
  if(record.version!==1 || !["tracked","full"].includes(record.kind) || typeof record.text!=="string" || !/^[a-f0-9]{64}$/.test(record.hash) || await hashDownloadText(record.text)!==record.hash) throw new Error("Локальная копия в браузере повреждена; автоматическая замена остановлена.");
  const parsed=JSON.parse(record.text);if(record.kind==="tracked")parsedTracking.set(record,validateTrackedBackup(parsed));else validatePublicBackup(parsed);
  memory.set(key,record);localStorage.setItem(revisionKey(key),record.hash);
  return record;
}
/** CAS inside a single IDB transaction protects separate tabs from lost updates. */
export async function writeDownloadCopy(key:string,record:DownloadCopy,expected:DownloadCopy|null):Promise<void> {
  const db=await openDb();
  try {await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite"),store=tx.objectStore(STORE),get=store.get(key);let conflict=false;
    get.onsuccess=()=>{const current=get.result as DownloadCopy|undefined;if((current?.hash??null)!==(expected?.hash??null) || (current?.text??null)!==(expected?.text??null)){conflict=true;tx.abort();return;}store.put(record,key)};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(conflict?new Error("Копия изменилась в другой вкладке; обновление отменено."):tx.error||new Error("Не удалось записать локальную копию."));
  });memory.set(key,record);localStorage.setItem(revisionKey(key),record.hash);
  } catch(e) {memory.delete(key);throw e} finally {db.close()}
}
export function requestPcDownload(text:string,source:PcSource,computerId:string,kind:"live"|"full"|"scheduled",now=new Date()):string {
  if(typeof document==="undefined" || typeof URL.createObjectURL!=="function")throw new Error("Браузер не поддерживает загрузку JSON-файла.");
  const date=now.toISOString().replace(/[:.]/g,"-");
  const filename=`sgt-${kind}-${source}-${computerId.slice(0,8)}-${date}.json`;
  const url=URL.createObjectURL(new Blob([text],{type:"application/json;charset=utf-8"}));
  try {const link=document.createElement("a");link.href=url;link.download=filename;link.style.display="none";document.body.appendChild(link);try{link.click()}finally{link.remove()}}
  finally {setTimeout(()=>URL.revokeObjectURL(url),60_000)}
  return filename;
}
export async function downloadCachedPcCopy(username:string,computerId:string,source:PcSource):Promise<string> {
  const r=await readDownloadCopy(downloadCopyKey(username,computerId,source));
  if(!r)throw new Error("Локальной копии в браузере ещё нет. Дождитесь первого снимка.");
  return requestPcDownload(r.text,source,computerId,"live");
}
export function trackedDownload(record:DownloadCopy):PcTrackedBackup {
  let backup=parsedTracking.get(record);if(!backup){backup=validateTrackedBackup(JSON.parse(record.text));parsedTracking.set(record,backup)}return backup;
}
/** Cursor-only changes are memory-only; restart safely replays from the stored cursor. */
export function rememberTrackedDownload(record:DownloadCopy,backup:PcTrackedBackup) {parsedTracking.set(record,backup)}
