import test from 'node:test';
import assert from 'node:assert/strict';
import { runPcLiveBackup } from '../src/lib/pc-live-backup.ts';
import { downloadCachedPcCopy, downloadCopyKey, readDownloadCopy, writeDownloadCopy } from '../src/lib/pc-download-backup.ts';
import { getPcScheduleSettings, getPcScheduleStatus, savePcScheduleSettings, runPcScheduledBackups } from '../src/lib/pc-scheduled-backup.ts';

const initial = {instance:'a'.repeat(32),cursor:'100',catalogHash:'b'.repeat(32),catalog:{products:{pk:['id'],columns:[{name:'id'},{name:'name'}]}},snapshot:{app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01',totalRows:1,tables:{products:[{id:'a',name:'A'}]},columns:{products:[{name:'id'},{name:'name'}]},sequences:{products:{}}}};
function fakeIdb() {
 const dbs=new Map();
 return {open(name){const req={};queueMicrotask(()=>{
   let stores=dbs.get(name);const fresh=!stores;if(!stores){stores=new Map();dbs.set(name,stores)}
   req.result={createObjectStore(name){stores.set(name,new Map())},close(){},transaction(name){const store=stores.get(name);let pending=0, aborted=false;const tx={error:null,abort(){aborted=true;queueMicrotask(()=>tx.onabort?.())},objectStore(){return {
    get(key){const r={};pending++;queueMicrotask(()=>{if(aborted)return;r.result=store.get(key);r.onsuccess?.();if(!--pending&&!aborted)queueMicrotask(()=>{if(!pending&&!aborted)tx.oncomplete?.()})});return r},
    put(value,key){const r={};pending++;queueMicrotask(()=>{if(aborted)return;store.set(key,structuredClone(value));r.onsuccess?.();if(!--pending&&!aborted)queueMicrotask(()=>{if(!pending&&!aborted)tx.oncomplete?.()})});return r}
   }}};return tx}};
   if(fresh)req.onupgradeneeded?.();req.onsuccess?.();
 });return req},dbs};
}
test('downloads without a folder, remains separate per account/source, and never claims file saved',async()=>{
 const old=Object.fromEntries(['window','document','localStorage','indexedDB','navigator','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const create=URL.createObjectURL, revoke=URL.revokeObjectURL, timeout=globalThis.setTimeout;
 const local=new Map(),idb=fakeIdb(),downloads=[];let source='primary',changed=false,tracker=true,requests=0,blocked=false;
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent(){}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)}});
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:idb});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_k,_o,cb)=>cb({})}}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{appendChild(){}},createElement(){return {style:{},click(){if(blocked)throw new Error('download blocked');downloads.push(this.download)},remove(){}}}}});
  URL.createObjectURL=()=> 'blob:pc';URL.revokeObjectURL=()=>{};globalThis.setTimeout=(fn,ms,...a)=>timeout(fn,ms===60000?0:ms,...a);
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(url,init)=>{
   url=String(url);requests++;
   if(url.endsWith('/pc-source'))return Response.json({source,localReadonly:false});
   if(url.includes('/full-backup'))return Response.json(initial.snapshot);
   if(!tracker)return Response.json({error:'journal disabled'},{status:503});
   if(!init?.method)return Response.json(initial);
   return Response.json({reset:false,cursor:changed?'102':'101',tables:{products:{keys:[{id:'a'}],rows:[{id:'a',name:changed?'Changed':'A'}]}},sequences:{products:{}}});
  }});
  const poll=()=>{for(const key of local.keys())if(key.startsWith('sgt-pc-live-poll:'))local.delete(key)};
  await runPcLiveBackup('owner');const cfg=getPcScheduleSettings('owner');assert.equal(cfg.folderName,'');assert.ok(cfg.computerId);assert.equal(downloads.length,1);
  assert.match(downloads[0],/sgt-live-primary/);assert.ok(getPcScheduleStatus('owner').live.primary.downloadRequested);
  poll();await runPcLiveBackup('owner');assert.equal(downloads.length,1,'unchanged data did not download again');
  changed=true;blocked=true;poll();await runPcLiveBackup('owner');assert.equal(downloads.length,1);
  assert.match(getPcScheduleStatus('owner').live.primary.downloadError,/download blocked/);
  poll();await runPcLiveBackup('owner');assert.match(getPcScheduleStatus('owner').live.primary.downloadError,/download blocked/,'failure remains visible when no data changes');
  blocked=false;await downloadCachedPcCopy('owner',cfg.computerId,'primary');assert.equal(downloads.length,2);
  assert.equal(JSON.parse((await readDownloadCopy(downloadCopyKey('owner',cfg.computerId,'primary'))).text).tables.products[0].name,'Changed');
  source='secondary';poll();await runPcLiveBackup('owner');assert.equal(downloads.length,3);assert.match(downloads[2],/secondary/);
  const primary=(await readDownloadCopy(downloadCopyKey('owner',cfg.computerId,'primary'))).text;
  assert.equal(JSON.parse(primary).tables.products[0].name,'Changed');
  await runPcLiveBackup('other-owner');const other=getPcScheduleSettings('other-owner');assert.notEqual(cfg.computerId,other.computerId);
  const count=requests;await downloadCachedPcCopy('owner',cfg.computerId,'primary');assert.equal(requests,count,'cached copy downloads without Supabase');
  source='primary';tracker=false;await runPcLiveBackup('unprepared');assert.match(getPcScheduleStatus('unprepared').live.primary.trackingWarning,/только начальный снимок/);
  const n=downloads.length;poll();await runPcLiveBackup('unprepared');assert.equal(downloads.length,n,'no repeated full snapshots while tracker unavailable');
  savePcScheduleSettings('owner',{...cfg,enabled:true,autoActive:true});
  await runPcScheduledBackups('owner',new Date('2026-11-04T11:00:00Z'));
  assert.match(getPcScheduleStatus('owner').last,/запрошена загрузка.*не подтверждено/);
  assert.match(downloads.at(-1),/sgt-scheduled-primary/);
  const key=downloadCopyKey('owner',cfg.computerId,'primary'), cached=await readDownloadCopy(key);
  const records=idb.dbs.get('sgt-pc-download-copy-v1').get('snapshots');
  records.set(key,{...cached,text:'externally altered'});
  await assert.rejects(writeDownloadCopy(key,cached,cached),/другой вкладке/,'CAS must not overwrite an externally changed copy');
  await assert.rejects(readDownloadCopy(key),/повреждена/,'corrupted cached record is not silently replaced');
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.setTimeout=timeout;for(const [k,d] of Object.entries(old))d?Object.defineProperty(globalThis,k,d):delete globalThis[k]}
});
