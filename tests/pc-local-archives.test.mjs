import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {initializePcLocal,setPcLocalMode,setPcArchivesEnabled,archivePcSnapshotAt,pcLocalStatus,recordPcArchiveStatus,readPcArchiveStatus} from '../src/lib/pc-local-runtime.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-pc-archive-')),cfg=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-pc-archive-cfg-'));
process.env.SGT_PC_CONFIG_DIR=cfg;process.env.SGT_PC_LOCAL_SERVER='1';
const snap={app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01T00:00:00Z',totalRows:1,tables:{admins:[{id:'a',username:'owner',password_hash:'hash',role:'owner',is_active:true}]},columns:{admins:['id','username','password_hash','role','is_active'].map(name=>({name,type:'text',generated:'',identity:''}))},sequences:{admins:{}}};
const at=s=>new Date(s);let id,dir;
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(cfg,{recursive:true,force:true})});
test('archives are opt-in and only use Novosibirsk 18:00/23:00 slots',()=>{
 id=initializePcLocal(root,'primary',snap).computerId;dir=path.join(root,`pc-${id}`,'scheduled');
 assert.equal(archivePcSnapshotAt(at('2026-04-01T11:00:00Z')).reason,'disabled');assert.equal(fs.existsSync(dir),false);
 setPcArchivesEnabled(true);assert.equal(pcLocalStatus().archivesEnabled,true);
 assert.equal(archivePcSnapshotAt(at('2026-04-01T10:59:00Z')).reason,'outside_window');assert.equal(archivePcSnapshotAt(at('2026-04-01T11:10:00Z')).reason,'outside_window');assert.equal(fs.existsSync(dir),false);
 const r=archivePcSnapshotAt(at('2026-04-01T11:01:00Z'));assert.equal(r.created,true);assert.equal(path.basename(r.file),'sgt-pc-2026-04-01-1800.json');assert.deepEqual(JSON.parse(fs.readFileSync(r.file,'utf8')),snap);
 const bytes=fs.readFileSync(r.file,'utf8');assert.equal(archivePcSnapshotAt(at('2026-04-01T11:04:00Z')).reason,'already_exists');assert.equal(fs.readFileSync(r.file,'utf8'),bytes);assert.equal(fs.readdirSync(dir).length,1);
});
test('offline readonly archives remain separate, disabling and public server do not create files',()=>{
 setPcLocalMode('readonly');const r=archivePcSnapshotAt(at('2026-04-01T16:00:00Z'));assert.equal(r.created,true);assert.equal(path.basename(r.file),'sgt-pc-2026-04-01-2300.json');setPcArchivesEnabled(false);assert.equal(archivePcSnapshotAt(at('2026-04-02T11:00:00Z')).reason,'disabled');
 delete process.env.SGT_PC_LOCAL_SERVER;assert.equal(archivePcSnapshotAt(at('2026-04-02T11:00:00Z')).reason,'disabled');assert.equal(fs.readdirSync(dir).length,2);process.env.SGT_PC_LOCAL_SERVER='1';
});
test('archive status reports failures and avoids rewriting the same error',()=>{
 const now=at('2026-04-01T11:00:00Z');recordPcArchiveStatus(now,null,new Error('disk unavailable'));const file=path.join(cfg,'pc-archive-status.json'),before=fs.readFileSync(file,'utf8');assert.equal(readPcArchiveStatus().error,'disk unavailable');recordPcArchiveStatus(at('2026-04-01T11:01:00Z'),null,new Error('disk unavailable'));assert.equal(fs.readFileSync(file,'utf8'),before);
 recordPcArchiveStatus(now,{created:true,file:'saved.json'});assert.equal(readPcArchiveStatus().error,undefined);assert.equal(readPcArchiveStatus().lastFile,'saved.json');
});
test('Moscow daily snapshot catches up and replaces the same file while keeping dated history',()=>{
 setPcArchivesEnabled(true);
 const first=archivePcSnapshotAt(at('2026-04-03T15:30:00Z'));assert.equal(first.created,true);assert.match(first.file,/1800-msk\.json$/);
 const daily=path.join(dir,'sgt-pc-daily-msk.json');assert.deepEqual(JSON.parse(fs.readFileSync(daily,'utf8')),snap);
 assert.equal(archivePcSnapshotAt(at('2026-04-03T18:30:00Z')).reason,'already_exists');
 const next=archivePcSnapshotAt(at('2026-04-04T15:30:00Z'));assert.equal(next.created,true);assert.notEqual(next.file,first.file);assert.deepEqual(JSON.parse(fs.readFileSync(daily,'utf8')),snap);
});
test('symlinked archive directory cannot redirect data elsewhere',{skip:process.platform==='win32'},()=>{
 setPcArchivesEnabled(true);const saved=dir+'-saved';fs.renameSync(dir,saved);const other=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-link-'));fs.symlinkSync(other,dir,'dir');
 try{assert.throws(()=>archivePcSnapshotAt(at('2026-04-02T11:00:00Z')),/не ссылкой/);assert.deepEqual(fs.readdirSync(other),[])}finally{fs.unlinkSync(dir);fs.renameSync(saved,dir);fs.rmSync(other,{recursive:true,force:true})}
});
