import assert from 'node:assert/strict';
import test from 'node:test';
import { choosePcScheduleDirectory, getPcScheduleSettings, getPcScheduleStatus, savePcScheduleSettings } from '../src/lib/pc-scheduled-backup.ts';
import { runPcLiveBackup } from '../src/lib/pc-live-backup.ts';

const initial = { instance:'a'.repeat(32),cursor:'100',catalogHash:'b'.repeat(32),
 catalog:{ products:{pk:['id'],columns:[{name:'id'},{name:'name'}]} },
 snapshot:{app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01',totalRows:1,
  tables:{products:[{id:'a',name:'A'}]},columns:{products:[{name:'id'},{name:'name'}]},sequences:{products:{}}} };
test('browser backup applies incremental changes, does not rewrite unchanged data, and stops on outside edit', async()=>{
  const old=Object.fromEntries(['window','localStorage','indexedDB','navigator','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const handles=new Map(), storage=new Map(), files=new Map(); let clock=0,writes=0,step=0,missingJournal=false;
  const makeDir=prefix=>({name:'Z',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getDirectoryHandle:async name=>makeDir(`${prefix}/${name}`),
    getFileHandle:async(name,opt)=>{const key=`${prefix}/${name}`; if(!files.has(key) && !opt?.create) throw Object.assign(new Error('missing'),{name:'NotFoundError'});
      return {getFile:async()=>{const f=files.get(key);return {lastModified:f.mtime,size:Buffer.byteLength(f.text),text:async()=>f.text}},createWritable:async()=>{let text='';return {write:async t=>{text=t},close:async()=>{files.set(key,{text,mtime:++clock});writes++},abort:async()=>{}}}};
    }});
  try {
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
    Object.defineProperty(globalThis,'window',{configurable:true,value:{showDirectoryPicker:async()=>makeDir('Z:'),dispatchEvent(){}}});
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_k,_o,cb)=>cb({name:'lock'})}}});
    Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){const req={};queueMicrotask(()=>{req.result={close(){},transaction(){const tx={objectStore(){return {get(key){const r={};queueMicrotask(()=>{r.result=handles.get(key);r.onsuccess?.();tx.oncomplete?.()});return r},put(value,key){const r={};queueMicrotask(()=>{handles.set(key,value);r.onsuccess?.();tx.oncomplete?.()});return r}}}};return tx}};req.onsuccess?.()});return req}}});
    Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(_url,init)=>{
      if(String(_url).endsWith('/pc-source')) return Response.json({localReadonly:false,source:'primary'});
      if(String(_url).includes('/full-backup')) return Response.json(initial.snapshot);
      if(missingJournal) return Response.json({error:'Журнал не подготовлен'}, {status:503});
      if (!init?.method) return new Response(JSON.stringify(initial),{status:200});
      if(step===0) return new Response(JSON.stringify({reset:false,cursor:'101',tables:{products:{keys:[{id:'a'}],rows:[{id:'a',name:'A'}]}},sequences:{products:{}}}),{status:200});
      if(step===1) return new Response(JSON.stringify({reset:false,cursor:'102',tables:{products:{keys:[{id:'a'}],rows:[{id:'a',name:'Updated'}]}},sequences:{products:{}}}),{status:200});
      return new Response(JSON.stringify({reset:true,reason:'instance_changed'}),{status:200});
    }});
    const cfg=await choosePcScheduleDirectory('owner');
    savePcScheduleSettings('owner',{...cfg,liveEnabled:true,autoActive:false,sources:{primary:true,secondary:false}});
    const allowPoll=()=>{for(const key of storage.keys()) if(key.startsWith('sgt-pc-live-poll:')) storage.delete(key)};
    await runPcLiveBackup('owner');
    assert.equal(writes,1);
    const key=[...files.keys()][0]; assert.match(key,/primary\/sgt-live-current\.json$/);
    allowPoll(); await runPcLiveBackup('owner'); assert.equal(writes,1);
    step=1; allowPoll(); await runPcLiveBackup('owner'); assert.equal(writes,2);
    assert.equal(JSON.parse(files.get(key).text).tables.products[0].name,'Updated');
    step=2; allowPoll(); await runPcLiveBackup('owner'); assert.equal(writes,2);
    assert.match(getPcScheduleStatus('owner').live.primary.error,/Источник Supabase изменился/);
    files.set(key,{text:'{"external":true}',mtime:++clock});
    allowPoll(); await runPcLiveBackup('owner');
    assert.equal(files.get(key).text,'{"external":true}');
    assert.match(getPcScheduleStatus('owner').live.primary.error,/вне приложения/);
    assert.equal(getPcScheduleSettings('owner').liveEnabled,true);
    const cfg2=await choosePcScheduleDirectory('owner2');
    savePcScheduleSettings('owner2',{...cfg2,liveEnabled:true,autoActive:false,sources:{primary:true,secondary:false}});
    missingJournal=true;await runPcLiveBackup('owner2');
    const fallback=[...files.keys()].find(k=>k.includes(cfg2.computerId) && k.endsWith('/sgt-full-current.json'));
    assert.ok(fallback);assert.equal(JSON.parse(files.get(fallback).text).tables.products[0].name,'A');
    assert.match(getPcScheduleStatus('owner2').live.primary.trackingWarning,/не отслеживаются/);
    const oldWrites=writes;allowPoll();await runPcLiveBackup('owner2');assert.equal(writes,oldWrites,'existing full snapshot is not overwritten');
    missingJournal=false;allowPoll();await runPcLiveBackup('owner2');
    assert.ok([...files.keys()].some(k=>k.includes(cfg2.computerId) && k.endsWith('/sgt-live-current.json')));
    assert.equal(getPcScheduleStatus('owner2').live.primary.trackingWarning,'');

  } finally { for(const [k,d] of Object.entries(old)) d?Object.defineProperty(globalThis,k,d):delete globalThis[k]; }
});
