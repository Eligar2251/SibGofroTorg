import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import { assertPcOwner, initializePcLocal, pcLocalRoute, pcLocalStatus, readActivePcSnapshot, setPcLocalMode } from '../src/lib/pc-local-runtime.ts';
import { signAdminSession, verifyAdminSessionToken, adminSessionSecretState } from '../src/lib/admin-session-token.ts';
import { getAdminDb, getPublicDb } from '../src/lib/supabase-server-engine.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-local-ro-')), cfg=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-local-cfg-'));
const env=['SGT_PC_LOCAL_SERVER','SGT_PC_CONFIG_DIR','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];const before=Object.fromEntries(env.map(k=>[k,process.env[k]]));
const snapshot={app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01T00:00:00Z',totalRows:2,
 tables:{admins:[{id:'a',username:'owner',password_hash:'example',role:'owner',is_active:true}],products:[{id:'p',name:'Box'}]},
 columns:{admins:['id','username','password_hash','role','is_active'].map(name=>({name,type:'text'})),products:['id','name'].map(name=>({name,type:'text'}))},sequences:{admins:{},products:{}}};
test.after(()=>{for(const [k,v] of Object.entries(before))v===undefined?delete process.env[k]:process.env[k]=v;fs.rmSync(root,{recursive:true,force:true});fs.rmSync(cfg,{recursive:true,force:true})});
test('PC sessions cannot be replayed against the public server, even with the same secret',async()=>{
  const saved=process.env.ADMIN_SESSION_SECRET;process.env.ADMIN_SESSION_SECRET='test-only-admin-session-secret-123456789';
  try {process.env.SGT_PC_LOCAL_SERVER='1';const pc=await signAdminSession({username:'owner',role:'owner',pcMode:'readonly'});assert.ok(await verifyAdminSessionToken(pc));delete process.env.SGT_PC_LOCAL_SERVER;assert.equal(await verifyAdminSessionToken(pc),null);const web=await signAdminSession({username:'owner',role:'owner'});process.env.SGT_PC_LOCAL_SERVER='1';assert.equal(await verifyAdminSessionToken(web),null);}
  finally {process.env.SGT_PC_LOCAL_SERVER='1';if(saved===undefined)delete process.env.ADMIN_SESSION_SECRET;else process.env.ADMIN_SESSION_SECRET=saved;}
});
test('PC mode never permits the known development session secret',async()=>{
 const old=process.env.ADMIN_SESSION_SECRET;delete process.env.ADMIN_SESSION_SECRET;process.env.SGT_PC_LOCAL_SERVER='1';
 try {assert.equal(adminSessionSecretState(),'missing');await assert.rejects(signAdminSession({username:'owner',role:'owner',pcMode:'remote'}),/ADMIN_SESSION_SECRET/);}
 finally {if(old===undefined)delete process.env.ADMIN_SESSION_SECRET;else process.env.ADMIN_SESSION_SECRET=old;}
});
test('local mode is explicit and never initializes a server file implicitly',()=>{
 delete process.env.SGT_PC_LOCAL_SERVER;process.env.SGT_PC_CONFIG_DIR=cfg;
 assert.equal(pcLocalRoute().kind,'disabled');assert.equal(pcLocalStatus().available,false);
 assert.throws(()=>initializePcLocal(root,'primary',snapshot),/локальном сервере/i);
 assert.deepEqual(fs.readdirSync(root),[]); assert.deepEqual(fs.readdirSync(cfg),[]);
 process.env.SGT_PC_LOCAL_SERVER='1';
 assert.equal(pcLocalRoute().kind,'remote');
 const state=initializePcLocal(root,'primary',snapshot);assert.equal(state.ready,true);assert.equal(state.mode,'remote');
 assert.throws(()=>initializePcLocal(root,'primary',snapshot),/уже существует/);
 setPcLocalMode('readonly');assert.equal(pcLocalRoute().kind,'readonly');
 assert.equal(readActivePcSnapshot().tables.products[0].name,'Box');
});
test('a snapshot without this active owner cannot be selected for offline login',()=>{
  assert.doesNotThrow(()=>assertPcOwner(snapshot,'owner'));
  assert.throws(()=>assertPcOwner(snapshot,'other'),/владельца/);
  const bad=structuredClone(snapshot);bad.tables.admins[0].is_active=false;assert.throws(()=>assertPcOwner(bad,'owner'),/владельца/);
  bad.tables.admins[0].is_active=true;bad.tables.admins[0].password_hash='';assert.throws(()=>assertPcOwner(bad,'owner'),/владельца/);
});
test('offline reads use the isolated snapshot and mutations, RPC and unsupported queries fail closed',async()=>{
 let count=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{count++;throw new Error('offline')};
 try {
  process.env.SUPABASE_URL='https://offline.example';process.env.SUPABASE_SERVICE_ROLE_KEY='dummy';
  const users=await getAdminDb().from('admins').select('*').eq('username','owner').limit(1).maybeSingle();
  assert.equal(users.error,null);assert.equal(users.data.id,'a');
  const pub=await getPublicDb().from('products').select('id,name').eq('id','p');assert.equal(pub.data[0].name,'Box');
  assert.equal((await getAdminDb().from('products').update({name:'changed'}).eq('id','p')).error.code,'PC_READ_ONLY');
  assert.equal((await getAdminDb().rpc('fn_next_counter',{p_key:'deal'})).error.code,'PC_READ_ONLY');
  assert.equal((await getAdminDb().from('products').select('unknown')).error.code,'PC_QUERY_UNSUPPORTED');
  assert.equal((await getAdminDb().from('products').select('*').or('name.eq.Box')).error.code,'PC_QUERY_UNSUPPORTED');
  assert.equal(count,0); assert.equal(readActivePcSnapshot().tables.products[0].name,'Box');
 } finally {globalThis.fetch=originalFetch}
});
test('missing or corrupted file never silently falls back to remote or an empty database',async()=>{
 const state=pcLocalStatus(),file=path.join(root,`pc-${state.computerId}`,'sgt-working-db.json');const saved=fs.readFileSync(file,'utf8');fs.writeFileSync(file,'{broken');
 const result=await getAdminDb().from('products').select('*');assert.equal(result.error.code,'DB_UNAVAILABLE');
 assert.match(result.error.message,/Локальная копия недоступна/);assert.equal(pcLocalRoute().kind,'readonly');
 fs.writeFileSync(file,saved);assert.equal((await getAdminDb().from('products').select('*')).data.length,1);
 setPcLocalMode('remote');assert.equal(pcLocalRoute().kind,'remote');
});
