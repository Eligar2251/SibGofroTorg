import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {prepareAutomaticPcCopy} from '../src/lib/pc-working-auto.ts';
import {defaultPcDownloadsRoot,pcLocalStatus,readConfiguredPcStore,setPcLiveDisabled,setPcLocalMode,readActivePcSnapshot} from '../src/lib/pc-local-runtime.ts';
import {enablePcWorkingRefresh,tickPcWorkingRefresh} from '../src/lib/pc-working-live.ts';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pc-auto-')), root=path.join(temp,'Downloads');fs.mkdirSync(root);
process.env.SGT_PC_LOCAL_SERVER='1';process.env.SGT_PC_DOWNLOADS_DIR=root;
const columns=names=>names.map(name=>({name,type:'text',generated:'',identity:''}));
const snapshot={app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01T00:00:00Z',totalRows:2,tables:{admins:[{id:'a',username:'owner',role:'owner',password_hash:'hash',is_active:true}],products:[{id:'p',name:'before'}]},columns:{admins:columns(['id','username','role','password_hash','is_active']),products:columns(['id','name'])},sequences:{admins:{},products:{}}};
const initial={snapshot,instance:'a'.repeat(32),cursor:'10',catalogHash:'b'.repeat(32),catalog:{admins:{pk:['id'],columns:snapshot.columns.admins},products:{pk:['id'],columns:snapshot.columns.products}}};
const getTracked=async()=>initial, getFull=async()=>snapshot;
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
test('auto setup uses Downloads, and updates the same file later used for local reads',async()=>{
 process.env.SGT_PC_CONFIG_DIR=path.join(temp,'cfg1');assert.equal(defaultPcDownloadsRoot(),root);
 const res=await prepareAutomaticPcCopy('owner','primary',root,getTracked,getFull);
 assert.equal(res.status.liveEnabled,true);assert.equal(res.status.archivesEnabled,true);assert.equal(res.status.autoManaged,true);
 const file=path.join(root,`pc-${res.status.computerId}`,'sgt-working-db.json'),before=fs.readFileSync(file,'utf8');
 await tickPcWorkingRefresh(async()=>({reset:false,cursor:'11',tables:{products:{keys:[{id:'p'}],rows:[{id:'p',name:'after'}]}},sequences:snapshot.sequences}));
 assert.notEqual(fs.readFileSync(file,'utf8'),before);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).current.tables.products[0].name,'after');
 const after=fs.readFileSync(file,'utf8');await tickPcWorkingRefresh(async()=>({reset:false,cursor:'12',tables:{},sequences:snapshot.sequences}));assert.equal(fs.readFileSync(file,'utf8'),after);
 setPcLocalMode('readonly');assert.equal(readActivePcSnapshot().tables.products[0].name,'after');
 await assert.rejects(prepareAutomaticPcCopy('owner','primary',root,getTracked,getFull),/локальный просмотр|подключённой/i);assert.equal(fs.readFileSync(file,'utf8'),after);
});
test('missing journal creates one initial file and resumes only after tracker works; opt-out wins race',async()=>{
 process.env.SGT_PC_CONFIG_DIR=path.join(temp,'cfg2');let full=0;
 const res=await prepareAutomaticPcCopy('owner','secondary',root,async()=>{throw Error('tracker missing')},async()=>{full++;return snapshot});
 assert.match(res.warning,/tracker missing/);assert.equal(full,1);assert.equal(res.status.liveEnabled,false);assert.equal(res.status.source,'secondary');
 const file=path.join(root,`pc-${res.status.computerId}`,'sgt-working-db.json'),before=fs.readFileSync(file,'utf8');
 await prepareAutomaticPcCopy('owner','secondary',root,getTracked,async()=>{throw Error('unexpected')});assert.equal(fs.readFileSync(file,'utf8'),before);
 let ready,release;const started=new Promise(r=>ready=r);const delayed=enablePcWorkingRefresh(async()=>{ready();return await new Promise(r=>release=r)},'owner',true);await started;
 setPcLiveDisabled();release(initial);await assert.rejects(delayed,/настройки или режим/i);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(pcLocalStatus().autoManaged,false);
 await assert.rejects(enablePcWorkingRefresh(async()=>initial,'owner',true),/отключено/);
});
test('refuses untrusted owner, unrelated host and missing default folder without creating a file',async()=>{
 process.env.SGT_PC_CONFIG_DIR=path.join(temp,'cfg3');const invalid=structuredClone(snapshot);invalid.tables.admins[0].role='manager';
 await assert.rejects(prepareAutomaticPcCopy('owner','primary',root,async()=>{throw Error('no tracker')},async()=>invalid),/владельца/);assert.equal(pcLocalStatus().configured,false);
 process.env.SGT_PC_DOWNLOADS_DIR=path.join(temp,'missing');assert.throws(defaultPcDownloadsRoot,/не найдена/);
 delete process.env.SGT_PC_LOCAL_SERVER;assert.throws(defaultPcDownloadsRoot,/только при запуске/i);process.env.SGT_PC_LOCAL_SERVER='1';
});
