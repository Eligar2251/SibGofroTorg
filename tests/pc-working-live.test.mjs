import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {initializePcLocal,pcLocalStatus,readConfiguredPcStore,setPcLiveDisabled,setPcLocalMode} from '../src/lib/pc-local-runtime.ts';
import {enablePcWorkingRefresh,tickPcWorkingRefresh} from '../src/lib/pc-working-live.ts';
import {updatePcWorkingStore} from '../src/lib/pc-working-store.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-live-work-')),cfg=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-live-work-cfg-'));
process.env.SGT_PC_LOCAL_SERVER='1';process.env.SGT_PC_CONFIG_DIR=cfg;
const cols=names=>names.map(name=>({name,type:'text',generated:'',identity:''}));
const initial=()=>({app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01T00:00:00Z',totalRows:3,tables:{admins:[{id:'o',username:'owner',password_hash:'hash',role:'owner',is_active:true}],products:[{id:'a',name:'A'},{id:'b',name:'B'}]},columns:{admins:cols(['id','username','password_hash','role','is_active']),products:cols(['id','name'])},sequences:{admins:{},products:{}}});
const full=(instance='a'.repeat(32))=>({instance,cursor:'10',catalogHash:'b'.repeat(32),catalog:{admins:{pk:['id'],columns:initial().columns.admins},products:{pk:['id'],columns:initial().columns.products}},snapshot:initial()});
const fakeSnapshot=async fn=>{assert.equal(fn,'sgt_pc_backup_snapshot');return full()};
let state,file;
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(cfg,{recursive:true,force:true});});
test('explicit initialization records source identity and does not turn on without confirmation',async()=>{
 state=initializePcLocal(root,'secondary',initial());file=path.join(root,`pc-${state.computerId}`,'sgt-working-db.json');
 assert.equal(pcLocalStatus().liveEnabled,false);let calls=0;assert.deepEqual(await tickPcWorkingRefresh(async()=>{calls++}),{changed:false,disabled:true});assert.equal(calls,0);
 await enablePcWorkingRefresh(fakeSnapshot,'owner');const s=readConfiguredPcStore();assert.equal(s.origin.source,'secondary');assert.equal(s.origin.instanceId,'a'.repeat(32));assert.equal(s.tracking.cursor,'10');assert.equal(pcLocalStatus().liveEnabled,true);assert.equal(s.baseHash,s.currentHash);
});
test('applies updates, inserts and deletes while keeping unaffected rows and a clean base',async()=>{
 let args;const delta=async(fn,a)=>{assert.equal(fn,'sgt_pc_backup_changes');args=a;return {reset:false,cursor:'12',tables:{products:{keys:[{id:'a'},{id:'b'},{id:'c'}],rows:[{id:'a',name:'updated'},{id:'c',name:'new'}]}},sequences:initial().sequences}};
 assert.deepEqual(await tickPcWorkingRefresh(delta),{changed:true});const s=readConfiguredPcStore();assert.equal(args.p_cursor,'10');assert.deepEqual(s.current.tables.products,[{id:'a',name:'updated'},{id:'c',name:'new'}]);assert.deepEqual(s.current.tables.admins,initial().tables.admins);assert.deepEqual(s.current,s.base);assert.equal(s.tracking.cursor,'12');
});
test('cursor-only changes never rewrite the JSON file',async()=>{
 const before=fs.readFileSync(file,'utf8');const result=await tickPcWorkingRefresh(async()=>({reset:false,cursor:'14',tables:{},sequences:initial().sequences}));assert.equal(result.changed,false);assert.equal(fs.readFileSync(file,'utf8'),before);
});
test('resets, wrong instance and malformed deltas stop without changing the file',async()=>{
 const before=fs.readFileSync(file,'utf8');await assert.rejects(tickPcWorkingRefresh(async()=>({reset:true})),/новый снимок/);await assert.rejects(enablePcWorkingRefresh(async()=>full('c'.repeat(32)),'owner'),/идентификатор/i);await assert.rejects(tickPcWorkingRefresh(async()=>({reset:false,cursor:'11',tables:{}})),/назад/);assert.equal(fs.readFileSync(file,'utf8'),before);
});
test('disabling or switching modes during the network request prevents replacement',async()=>{
 let release,ready;const started=new Promise(r=>ready=r);const delayed=async()=>{ready();return await new Promise(r=>release=r)};
 const p=tickPcWorkingRefresh(delayed);await started;const before=fs.readFileSync(file,'utf8');setPcLiveDisabled();release({reset:false,cursor:'13',tables:{products:{keys:[{id:'a'}],rows:[{id:'a',name:'bad'}]}}});await assert.rejects(p,/настройки или режим/i);assert.equal(fs.readFileSync(file,'utf8'),before);
 await enablePcWorkingRefresh(fakeSnapshot,'owner');let nextRelease,nextReady;const started2=new Promise(r=>nextReady=r);const p2=tickPcWorkingRefresh(async()=>{nextReady();return await new Promise(r=>nextRelease=r)});await started2;const before2=fs.readFileSync(file,'utf8');setPcLocalMode('readonly');nextRelease({reset:false,cursor:'13',tables:{products:{keys:[{id:'a'}],rows:[{id:'a',name:'bad'}]}}});await assert.rejects(p2,/настройки или режим/i);assert.equal(fs.readFileSync(file,'utf8'),before2);setPcLocalMode('remote');
});
test('independent edits and tampered tracking prevent all remote overwrites',async()=>{
 const old=readConfiguredPcStore(),dirty=structuredClone(old.current);dirty.tables.products[0].name='offline';updatePcWorkingStore(root,old.computerId,old.revision,dirty);let count=0;await assert.rejects(tickPcWorkingRefresh(async()=>{count++}),/независимые изменения/);await assert.rejects(enablePcWorkingRefresh(async()=>{count++;return full()},'owner'),/независимые изменения/);assert.equal(count,0);
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.tracking.cursor='999';fs.writeFileSync(file,JSON.stringify(raw));assert.throws(()=>readConfiguredPcStore(),/метаданные обновления/i);
});
