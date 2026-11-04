import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {initializePcLocal,changePcRoot,pcLocalStatus,setPcLocalMode,readActivePcSnapshot} from '../src/lib/pc-local-runtime.ts';
import {copyPcWorkingStore} from '../src/lib/pc-working-store.ts';
const old=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-old-root-')),next=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-new-root-')),cfg=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-root-cfg-'));
process.env.SGT_PC_LOCAL_SERVER='1';process.env.SGT_PC_CONFIG_DIR=cfg;
const snapshot={app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01T00:00:00Z',totalRows:1,tables:{admins:[{id:'a',username:'owner',password_hash:'hash',role:'owner',is_active:true}]},columns:{admins:['id','username','password_hash','role','is_active'].map(name=>({name,type:'text'}))},sequences:{admins:{}}};
let id,source,dest;
test.after(()=>{for(const dir of [old,next,cfg])fs.rmSync(dir,{recursive:true,force:true})});
test('copy can be safely retried after failed config change; existing file is never overwritten',()=>{
 id=initializePcLocal(old,'secondary',snapshot).computerId;source=path.join(old,`pc-${id}`,'sgt-working-db.json');dest=path.join(next,`pc-${id}`,'sgt-working-db.json');const before=fs.readFileSync(source,'utf8');
 assert.throws(()=>copyPcWorkingStore(old,next,id,()=>{throw new Error('config failed')}),/config failed/);assert.equal(fs.readFileSync(dest,'utf8'),before);assert.equal(pcLocalStatus().root,old);
 const state=changePcRoot(next);assert.equal(state.root,next);assert.equal(state.computerId,id);assert.equal(fs.readFileSync(source,'utf8'),before);assert.equal(fs.readFileSync(dest,'utf8'),before);
 setPcLocalMode('readonly');assert.deepEqual(readActivePcSnapshot(),snapshot);
});
test('refuses mismatched existing target, aliases, missing root and target locks without touching source',()=>{
 const third=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-other-root-'));try {
  assert.throws(()=>changePcRoot(next),/совпадает/);assert.throws(()=>changePcRoot(path.join(third,'missing')));
  const targetDir=path.join(third,`pc-${id}`);fs.mkdirSync(targetDir);const target=path.join(targetDir,'sgt-working-db.json');fs.writeFileSync(target,'different');
  const before=fs.readFileSync(dest,'utf8');assert.throws(()=>changePcRoot(third));assert.equal(fs.readFileSync(target,'utf8'),'different');assert.equal(fs.readFileSync(dest,'utf8'),before);assert.equal(pcLocalStatus().root,next);
  fs.unlinkSync(target);fs.writeFileSync(target+'.lock','busy');assert.throws(()=>changePcRoot(third),/блокировка/);assert.equal(fs.existsSync(target),false);assert.equal(pcLocalStatus().root,next);
 }finally{fs.rmSync(third,{recursive:true,force:true})}
});
test('interrupted exclusive copy keeps the old root and refuses to overwrite the partial file',()=>{
 const partial=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-partial-')),originalLink=fs.linkSync,originalOpen=fs.openSync,originalWrite=fs.writeFileSync;const target=path.join(partial,`pc-${id}`,'sgt-working-db.json');let targetFd;
 try {
  fs.linkSync=()=>{const e=new Error('no hard link');e.code='EPERM';throw e};
  fs.openSync=(p,...args)=>{const fd=originalOpen(p,...args);if(p===target)targetFd=fd;return fd};
  fs.writeFileSync=(fd,data,...args)=>{if(fd===targetFd){fs.writeSync(fd,'partial');throw new Error('disk interrupted')}return originalWrite(fd,data,...args)};
  assert.throws(()=>changePcRoot(partial),/interrupted/);assert.equal(pcLocalStatus().root,next);assert.ok(fs.existsSync(dest));assert.equal(fs.readFileSync(target,'utf8'),'partial');
  fs.linkSync=originalLink;fs.openSync=originalOpen;fs.writeFileSync=originalWrite;
  assert.throws(()=>changePcRoot(partial),/повреждён/);assert.equal(fs.readFileSync(target,'utf8'),'partial');assert.equal(pcLocalStatus().root,next);
 } finally {fs.linkSync=originalLink;fs.openSync=originalOpen;fs.writeFileSync=originalWrite;fs.rmSync(partial,{recursive:true,force:true})}
});
test('exclusive-copy fallback works on a share without hard-link support',()=>{
 const fallback=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-no-link-')),originalLink=fs.linkSync;const before=fs.readFileSync(dest,'utf8');
 try {fs.linkSync=()=>{const e=new Error('hard links disabled');e.code='EPERM';throw e};const s=changePcRoot(fallback);assert.equal(s.root,fallback);assert.equal(fs.readFileSync(path.join(fallback,`pc-${id}`,'sgt-working-db.json'),'utf8'),before);assert.equal(fs.readFileSync(dest,'utf8'),before);}
 finally {fs.linkSync=originalLink;fs.rmSync(fallback,{recursive:true,force:true})}
});
test('public server cannot choose or copy the PC directory',()=>{delete process.env.SGT_PC_LOCAL_SERVER;assert.throws(()=>changePcRoot(old),/локальном сервере/i);process.env.SGT_PC_LOCAL_SERVER='1'});
