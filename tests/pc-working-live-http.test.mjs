// Isolated local Next.js server + synthetic PostgREST; no real Supabase is used.
import assert from 'node:assert/strict';import {scryptSync} from 'node:crypto';import {spawn} from 'node:child_process';import fs from 'node:fs';import http from 'node:http';import net from 'node:net';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {initializePcLocal} from '../src/lib/pc-local-runtime.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-live-http-')),config=fs.mkdtempSync(path.join(os.tmpdir(),'sgt-live-http-cfg-'));process.env.SGT_PC_LOCAL_SERVER='1';process.env.SGT_PC_CONFIG_DIR=config;
const cols=names=>names.map(name=>({name,type:'text',generated:'',identity:''}));
const owner={id:'o',username:'owner',password_hash:`0123456789abcdef0123456789abcdef:${scryptSync('pc-test-password','0123456789abcdef0123456789abcdef',64).toString('hex')}`,role:'owner',is_active:true,display_name:'Owner'};
const snapshot={app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01T00:00:00Z',totalRows:2,tables:{admins:[owner],products:[{id:'p',name:'before'}]},columns:{admins:cols(Object.keys(owner)),products:cols(['id','name'])},sequences:{admins:{},products:{}}};
const initial={snapshot,instance:'a'.repeat(32),cursor:'10',catalogHash:'b'.repeat(32),catalog:{admins:{pk:['id'],columns:snapshot.columns.admins},products:{pk:['id'],columns:snapshot.columns.products}}};
const delta={reset:false,cursor:'11',tables:{products:{keys:[{id:'p'}],rows:[{id:'p',name:'after'}]}},sequences:snapshot.sequences};
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n}
test('owner can enable and apply tracked changes over HTTP; local mode never calls remote',{timeout:120000},async()=>{
 const state=initializePcLocal(root,'primary',snapshot);const file=path.join(root,`pc-${state.computerId}`,'sgt-working-db.json');let rpcCalls=[];
 const fake=http.createServer((req,res)=>{let data='';req.on('data',x=>data+=x);req.on('end',()=>{res.setHeader('content-type','application/json');if(req.url.startsWith('/rest/v1/rpc/sgt_pc_backup_snapshot')){rpcCalls.push('snapshot');res.end(JSON.stringify(initial));}else if(req.url.startsWith('/rest/v1/rpc/sgt_pc_backup_changes')){rpcCalls.push('changes');res.end(JSON.stringify(delta));}else if(req.url.startsWith('/rest/v1/admins'))res.end(JSON.stringify([owner]));else res.end('[]');});});await new Promise(r=>fake.listen(0,'127.0.0.1',r));const remote=`http://127.0.0.1:${fake.address().port}`,p=await port(),base=`http://127.0.0.1:${p}`;let logs='';
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p',String(p),'-H','127.0.0.1'],{cwd:process.cwd(),detached:process.platform!=='win32',env:{...process.env,SGT_DATA_DIR:path.join(config,'runtime'),ADMIN_SECRET_PATH:'admin',NEXT_PUBLIC_ADMIN_PATH:'admin',ADMIN_SESSION_SECRET:'test-only-admin-session-secret-123456789',SUPABASE_URL:remote,NEXT_PUBLIC_SUPABASE_URL:remote,SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'fake-test-key',SUPABASE_SECONDARY_URL:''},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(logs)),45000);const data=c=>{logs+=c.toString();if(logs.includes('Ready in')){clearTimeout(timer);resolve()}};child.stdout.on('data',data);child.stderr.on('data',data);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`exit ${code} ${logs}`))})});
  assert.equal((await fetch(`${base}/admin/login`)).status,200);
  async function login(){const r=await fetch(`${base}/admin/api/login`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username:'owner',password:'pc-test-password'})});assert.equal(r.status,200,`${logs} ${await r.clone().text()}`);return r.headers.get('set-cookie').split(';')[0]}
  let cookie=await login();const post=(body,extra={})=>fetch(`${base}/api/admin/database/pc-local`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json',...extra},body:JSON.stringify(body)});
  assert.equal((await post({action:'live_tick'})).status,200);assert.deepEqual(rpcCalls,[]);
  assert.equal((await post({action:'live_enable'})).status,400);assert.deepEqual(rpcCalls,[]);
  assert.equal((await post({action:'live_enable',confirmReplace:true},{origin:'http://evil.example'})).status,403);
  const enabled=await post({action:'live_enable',confirmReplace:true});assert.equal(enabled.status,200,`${logs} ${await enabled.clone().text()}`);assert.equal((await enabled.json()).liveEnabled,true);assert.deepEqual(rpcCalls,['snapshot']);
  const tick=await post({action:'live_tick'});assert.equal(tick.status,200,`${logs} ${await tick.clone().text()}`);assert.deepEqual(await tick.json(),{changed:true});assert.deepEqual(rpcCalls,['snapshot','changes']);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).current.tables.products[0].name,'after');
  assert.equal((await post({action:'archives',enabled:true})).status,200);
  assert.equal((await post({action:'mode',mode:'readonly'})).status,200);cookie=await login();
  const old=[...rpcCalls];assert.equal((await fetch(`${base}/api/admin/database/full-backup?download=1&source=primary`,{headers:{cookie}})).status,403);assert.equal((await fetch(`${base}/api/admin/database/backend?probe=1`,{headers:{cookie}})).status,403);assert.equal((await fetch(`${base}/api/admin/database/backup`,{headers:{cookie}})).status,403);assert.equal((await post({action:'prepare',root,source:'primary'})).status,409);assert.equal((await post({action:'live_enable',confirmReplace:true})).status,409);assert.equal((await post({action:'live_tick'})).status,200);assert.deepEqual(rpcCalls,old);
  assert.equal((await post({action:'archives',enabled:false})).status,200);
 }finally{
  if(child.exitCode===null){try{process.platform==='win32'?child.kill():process.kill(-child.pid,'SIGTERM')}catch{}await new Promise(r=>{child.once('exit',r);setTimeout(r,5000).unref()})}
  await new Promise(r=>fake.close(r));fs.rmSync(root,{recursive:true,force:true});fs.rmSync(config,{recursive:true,force:true});
 }
});
