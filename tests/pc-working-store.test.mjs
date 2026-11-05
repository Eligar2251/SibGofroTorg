import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { createPcWorkingStore, readPcWorkingStore, updatePcWorkingStore } from '../src/lib/pc-working-store.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-pc-working-'));
const id='a94dca43-3d12-46da-92cb-12132e3df786';
const file=path.join(root,`pc-${id}`,'sgt-working-db.json');
const initial=()=>({app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01T00:00:00.000Z',totalRows:1,
  tables:{products:[{id:'a',name:'base'}]},columns:{products:[{name:'id',type:'text',generated:'',identity:''},{name:'name',type:'text',generated:'',identity:''}]},sequences:{products:{}}});
const origin={source:'secondary',instanceId:'a'.repeat(32)};
const changed=name=>{const s=initial();s.tables.products[0].name=name;return s};
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('mode is explicit, source snapshot is retained, and existing files are never overwritten',()=>{
  delete process.env.SGT_PC_LOCAL_SERVER;
  assert.throws(()=>createPcWorkingStore(root,id,initial(),origin),/только.*локального сервера/i);
  assert.deepEqual(fs.readdirSync(root),[]);
  process.env.SGT_PC_LOCAL_SERVER='1';
  assert.throws(()=>createPcWorkingStore('relative',id,initial(),origin),/абсолютный/);
  assert.throws(()=>createPcWorkingStore(root,'../bad',initial(),origin),/идентификатор/);
  const bad=initial(); delete bad.tables.products[0].name;
  assert.throws(()=>createPcWorkingStore(root,id,bad,origin),/неполная/i);
  assert.deepEqual(fs.readdirSync(root),[]);
  const input=initial(); input.pcTracking={ignored:true};
  const first=createPcWorkingStore(root,id,input,origin);
  assert.equal(first.revision,0); assert.equal(first.base.tables.products[0].name,'base');
  assert.equal(Object.hasOwn(first.current,'pcTracking'),false);
  first.current.tables.products[0].name='outside';
  assert.equal(readPcWorkingStore(root,id).current.tables.products[0].name,'base');
  const bytes=fs.readFileSync(file,'utf8');
  assert.throws(()=>createPcWorkingStore(root,id,initial(),origin),/уже существует/);
  assert.equal(fs.readFileSync(file,'utf8'),bytes);
});
test('updates are revision checked, validated, and keep the common ancestor',()=>{
  const one=updatePcWorkingStore(root,id,0,changed('offline'));
  assert.equal(one.revision,1); assert.equal(one.base.tables.products[0].name,'base');
  assert.equal(one.current.tables.products[0].name,'offline');
  assert.equal(updatePcWorkingStore(root,id,1,changed('offline')).revision,1);
  const bytes=fs.readFileSync(file,'utf8');
  assert.throws(()=>updatePcWorkingStore(root,id,0,changed('stale')),/другом процессе/);
  const bad=changed('bad'); bad.columns.products[1].type='integer';
  assert.throws(()=>updatePcWorkingStore(root,id,1,bad),/схемы/);
  const unsafe=changed(9007199254740992);
  assert.throws(()=>updatePcWorkingStore(root,id,1,unsafe),/число/i);
  assert.equal(fs.readFileSync(file,'utf8'),bytes);
});
test('lock and corruption fail closed without replacing existing data',()=>{
  const bytes=fs.readFileSync(file,'utf8'); fs.writeFileSync(`${file}.lock`,'other');
  assert.throws(()=>updatePcWorkingStore(root,id,1,changed('new')),/блокировка/);
  assert.equal(fs.readFileSync(file,'utf8'),bytes); fs.unlinkSync(`${file}.lock`);
  const tampered=JSON.parse(bytes); tampered.current.tables.products[0].name='external'; fs.writeFileSync(file,JSON.stringify(tampered));
  assert.throws(()=>readPcWorkingStore(root,id),/Контрольная сумма/);
  assert.throws(()=>updatePcWorkingStore(root,id,1,changed('new')),/Контрольная сумма/);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).current.tables.products[0].name,'external');
  fs.writeFileSync(file,bytes);
});
test('two independent processes cannot both commit the same revision', async()=>{
  const script=`import {updatePcWorkingStore} from './src/lib/pc-working-store.ts';\ntry {const s=JSON.parse(process.env.TEST_SNAPSHOT);updatePcWorkingStore(process.env.TEST_ROOT,process.env.TEST_PC,1,s);console.log('committed')} catch(e) {console.error(e.message);process.exitCode=2}`;
  const run=(n)=>new Promise((resolve,reject)=>{const proc=spawn(process.execPath,['--experimental-strip-types','--import','./tests/ts-register.mjs','--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,TEST_ROOT:root,TEST_PC:id,TEST_SNAPSHOT:JSON.stringify(changed(n))}});let err='';proc.stderr.on('data',d=>err+=d);proc.on('error',reject);proc.on('close',code=>resolve({code,err}));});
  const result=await Promise.all([run('left'),run('right')]);
  assert.deepEqual(result.map(x=>x.code).sort(),[0,2]);
  assert.match(result.find(x=>x.code===2).err,/другом процессе|блокировка/);
  const stored=readPcWorkingStore(root,id);
  assert.equal(stored.revision,2); assert.ok(['left','right'].includes(stored.current.tables.products[0].name));
  assert.equal(stored.base.tables.products[0].name,'base');
});

test('rejects symlinked per-PC directory and symlinked working file', {skip:process.platform==='win32'}, ()=>{
  const other='0c118c18-2833-4dca-82e1-99f6c35d80a6';
  const symlinkDir=path.join(root,`pc-${other}`);
  fs.symlinkSync(path.dirname(file),symlinkDir,'dir');
  assert.throws(()=>createPcWorkingStore(root,other,initial(),origin),/не ссылкой/);
  assert.throws(()=>readPcWorkingStore(root,other),/не ссылкой/);
  fs.unlinkSync(symlinkDir);
  const backup=`${file}.saved`;fs.renameSync(file,backup);fs.symlinkSync(backup,file);
  try { assert.throws(()=>readPcWorkingStore(root,id),/не ссылкой/);assert.throws(()=>updatePcWorkingStore(root,id,2,changed('unsafe')),/не ссылкой/); }
  finally {fs.unlinkSync(file);fs.renameSync(backup,file)}
});
