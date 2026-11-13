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
  // or/not/contains считаются локальным движком так же, как PostgREST, поэтому разрешены;
  // refused остаётся для всего, что движок точно не воспроизводит.
  assert.equal((await getAdminDb().from('products').select('*').or('name.eq.Box')).data.length,1);
  assert.equal((await getAdminDb().from('products').select('*').or('name.eq.Box,unknown.eq.x')).error.code,'PC_QUERY_UNSUPPORTED');
  assert.equal((await getAdminDb().from('products').select('*').not('unknown','is',null)).error.code,'PC_QUERY_UNSUPPORTED');
  assert.equal((await getAdminDb().from('products').select('*').gte('id','p')).data.length,1);
  assert.equal((await getAdminDb().from('products').select('*').contains('unknown',[])).error.code,'PC_QUERY_UNSUPPORTED');
  assert.equal(count,0); assert.equal(readActivePcSnapshot().tables.products[0].name,'Box');
 } finally {globalThis.fetch=originalFetch}
});
test('the wastepaper section serves its own tables from a real local copy while the network is offline',{timeout:240_000},async()=>{
  // Снимок строится на настоящей схеме: pg_export_app_data даёт те же columns и
  // sequences, что видит админка, поэтому проверка повторяет путь разделов макулатуры.
  const wpRoot=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-wp-local-')),wpCfg=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-wp-cfg-'));
  const env=['SGT_PC_LOCAL_SERVER','SGT_PC_CONFIG_DIR','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];const before=Object.fromEntries(env.map(k=>[k,process.env[k]]));
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db=new PGlite({extensions:{pgcrypto}});
  try{
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;`);
    await db.exec(fs.readFileSync('supabase/FULL_DATABASE_MIGRATION.sql','utf8'));
    await db.exec(`
      INSERT INTO admins (username, password_hash, role, is_active) VALUES ('owner','h','owner',true);
      INSERT INTO wp_counterparties (name) VALUES ('ИП «Тест»');
      INSERT INTO wp_products (name, price_per_kg) VALUES ('Макулатура «А»', 9.7);
      INSERT INTO wp_intakes (date, counterparty_name, weight_kg, price_per_kg, total) VALUES ('2026-05-01','ИП «Тест»',120.5,9.7,1168.85);
      INSERT INTO wp_intakes (date, counterparty_name, weight_kg, price_per_kg, total, items) VALUES ('2026-05-03','Друг',10,9,90,'[{"id":"i2","wastepaperType":"mag","weightKg":10,"pricePerKg":9,"total":90}]'::jsonb);
      INSERT INTO wp_shipments (date, weight_kg, price_per_kg, total) VALUES ('2026-05-02',100,12,1200);
      INSERT INTO wp_payments (date, direction, account, amount) VALUES ('2026-05-01','incoming','cash',500);
      INSERT INTO wp_transports (date, status) VALUES ('2026-05-01','planned');
    `);
    const snapshot=(await db.query('SELECT public.sgt_export_app_data() AS v')).rows[0].v;
    process.env.SGT_PC_LOCAL_SERVER='1';process.env.SGT_PC_CONFIG_DIR=wpCfg;
    process.env.SUPABASE_URL='https://offline.example';process.env.SUPABASE_SERVICE_ROLE_KEY='dummy';
    initializePcLocal(wpRoot,'primary',snapshot);setPcLocalMode('readonly');
    const originalFetch=globalThis.fetch;let attempts=0;
    globalThis.fetch=async()=>{attempts++;throw new Error('offline')};
    try{
      const wp=await import('../src/lib/wastepaper-account.ts');
      assert.ok((await wp.getWpProducts()).length>=5,'справочник видов');
      assert.equal((await wp.getWpIntakes(50)).length,2);
      assert.equal((await wp.getWpShipments(50)).length,1);
      assert.equal((await wp.getWpCounterparties()).length,1);
      assert.equal((await wp.getWpTransports(50)).length,1);
      assert.equal((await wp.getWpManualPayments(50)).length,1);
      assert.deepEqual(await wp.getWpAccountTransfersSafe(),[]);
      const dashboard=await wp.getWpDashboardData();
      assert.ok(dashboard && typeof dashboard==='object','дашборд собран из локальной копии');
      assert.equal(attempts,0,'ни одного обращения к сети');
      // Запись по-прежнему отказывается, а не делает вид, что сохранила.
      // Запись должна отказываться, а не делать вид, что сохранила.
      await assert.rejects(()=>wp.createWpIntake({date:'2026-05-04',counterpartyName:'X',weightKg:1,pricePerKg:1,total:1,items:[],account:'cash'},'owner'));
      assert.equal((await getAdminDb().from('wp_intakes').delete().eq('id','x')).error.code,'PC_READ_ONLY');
    } finally { globalThis.fetch=originalFetch; }
  } finally {
    for(const [k,v] of Object.entries(before)) v===undefined?delete process.env[k]:process.env[k]=v;
    await db.close();fs.rmSync(wpRoot,{recursive:true,force:true});fs.rmSync(wpCfg,{recursive:true,force:true});
  }
});

test('the PC server writes the SQL dump of the local copy into the same folder without any network',{timeout:60_000},async()=>{
 const dumpRoot=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-pc-sql-')),dumpCfg=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-pc-sql-cfg-'));
 const env=['SGT_PC_LOCAL_SERVER','SGT_PC_CONFIG_DIR'];const before=Object.fromEntries(env.map(k=>[k,process.env[k]]));
 try{
  process.env.SGT_PC_LOCAL_SERVER='1';process.env.SGT_PC_CONFIG_DIR=dumpCfg;
  const state=initializePcLocal(dumpRoot,'primary',snapshot);
  const { writePcSqlDumpFiles } = await import('../src/lib/pc-local-runtime.ts');
  const first=writePcSqlDumpFiles();
  const dir=path.join(dumpRoot,`pc-${state.computerId}`);
  assert.equal(first.totalRows,2);
  assert.deepEqual(first.files.map(f=>path.basename(f)).sort(),['sgt-full-data-2026-01-01-0000.sql','sgt-full-data-current.sql']);
  const current=fs.readFileSync(path.join(dir,'sgt-full-data-current.sql'),'utf8');
  assert.ok(current.includes('INSERT INTO public."products"'),current.slice(0,200));
  assert.ok(current.includes('INSERT INTO public."admins"'),current);
  assert.equal(current.match(/CREATE TEMP|ON COMMIT DROP|\bBEGIN;|\bCOMMIT;/g),null);
  // Второй вызов обновляет «текущий» файл и не трогает датированный архив.
  const dated=path.join(dir,'sgt-full-data-2026-01-01-0000.sql');
  const before2=fs.readFileSync(dated,'utf8');
  fs.writeFileSync(path.join(dir,'sgt-full-data-current.sql'),'устарело');
  const second=writePcSqlDumpFiles();
  assert.equal(second.files.length,1,'датированный снимок за этот день уже есть');
  assert.ok(fs.readFileSync(path.join(dir,'sgt-full-data-current.sql'),'utf8').includes('INSERT INTO public."products"'));
  assert.equal(fs.readFileSync(dated,'utf8'),before2);
 } finally {
  for(const [k,v] of Object.entries(before)) v===undefined?delete process.env[k]:process.env[k]=v;
  fs.rmSync(dumpRoot,{recursive:true,force:true});fs.rmSync(dumpCfg,{recursive:true,force:true});
 }
});

test('missing or corrupted file never silently falls back to remote or an empty database',async()=>{
 const state=pcLocalStatus(),file=path.join(root,`pc-${state.computerId}`,'sgt-working-db.json');const saved=fs.readFileSync(file,'utf8');fs.writeFileSync(file,'{broken');
 const result=await getAdminDb().from('products').select('*');assert.equal(result.error.code,'DB_UNAVAILABLE');
 assert.match(result.error.message,/Локальная копия недоступна/);assert.equal(pcLocalRoute().kind,'readonly');
 fs.writeFileSync(file,saved);assert.equal((await getAdminDb().from('products').select('*')).data.length,1);
 setPcLocalMode('remote');assert.equal(pcLocalRoute().kind,'remote');
});
