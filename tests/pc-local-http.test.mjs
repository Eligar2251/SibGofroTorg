import assert from 'node:assert/strict';import {scryptSync} from 'node:crypto';import {spawn} from 'node:child_process';import fs from 'node:fs';import http from 'node:http';import net from 'node:net';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {initializePcLocal,setPcLocalMode} from '../src/lib/pc-local-runtime.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pc-offline-')),newRoot=fs.mkdtempSync(path.join(os.tmpdir(),'pc-offline-new-')),config=fs.mkdtempSync(path.join(os.tmpdir(),'pc-offline-config-'));
process.env.SGT_PC_LOCAL_SERVER='1';process.env.SGT_PC_CONFIG_DIR=config;
const cols=fields=>fields.map(name=>({name,type:'text',generated:'',identity:''}));
const snapshot={app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01T00:00:00Z',totalRows:3,tables:{admins:[{id:'test-id',username:'pc_owner',password_hash:`0123456789abcdef0123456789abcdef:${scryptSync('pc-test-password','0123456789abcdef0123456789abcdef',64).toString('hex')}`,role:'owner',is_active:true,display_name:'Owner'},{id:'other',username:'manager',password_hash:'manager-test-password',role:'manager',is_active:true,display_name:'Manager'}],products:[{id:'p',name:'Test'}]},columns:{admins:cols(['id','username','password_hash','role','is_active','display_name']),products:cols(['id','name'])},sequences:{admins:{},products:{}}};
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n}
test('local server permits password login and snapshot reads without Supabase, but not writes or cross-site control',{timeout:120000},async()=>{
 const state=initializePcLocal(root,'primary',snapshot);setPcLocalMode('readonly');
 const file=path.join(root,`pc-${state.computerId}`,'sgt-working-db.json'),before=fs.readFileSync(file,'utf8');
 const p=await port(),base=`http://127.0.0.1:${p}`;let log='';
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p',String(p),'-H','127.0.0.1'],{cwd:process.cwd(),detached:process.platform!=='win32',env:{...process.env,SGT_DATA_DIR:path.join(config,'runtime'),ADMIN_SECRET_PATH:'admin',NEXT_PUBLIC_ADMIN_PATH:'admin',ADMIN_SESSION_SECRET:'test-only-admin-session-secret-123456789',SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',SUPABASE_SECONDARY_URL:''},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`not ready: ${log}`)),45000);const data=c=>{log+=c.toString();if(log.includes('Ready in')){clearTimeout(timer);resolve()}};child.stdout.on('data',data);child.stderr.on('data',data);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`exit ${code} ${log}`))})});
  const loginPage=await fetch(`${base}/admin/login`);assert.equal(loginPage.status,200);
  const wrong=await fetch(`${base}/admin/api/login`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username:'pc_owner',password:'incorrect'})});assert.equal(wrong.status,401,`${log} response=${await wrong.clone().text()}`);
  assert.equal((await fetch(`${base}/api/admin/database/pc-local`)).status,401);
  const manager=await fetch(`${base}/admin/api/login`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username:'manager',password:'manager-test-password'})});assert.equal(manager.status,200);const managerCookie=manager.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(`${base}/api/admin/database/pc-local`,{headers:{cookie:managerCookie}})).status,403);
  const login=await fetch(`${base}/admin/api/login`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username:'pc_owner',password:'pc-test-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const stat=await fetch(`${base}/api/admin/database/pc-local`,{headers:{cookie}});assert.equal(stat.status,200);const body=await stat.json();assert.equal(body.mode,'readonly');assert.equal(body.ready,true);
  const sameMode=await fetch(`${base}/api/admin/database/pc-local`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action:'mode',mode:'readonly'})});assert.equal(sameMode.status,200);
  const noOverwrite=await fetch(`${base}/api/admin/database/pc-local`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action:'prepare_file',root,source:'primary',snapshot})});assert.equal(noOverwrite.status,409);
  const blocked=await fetch(`${base}/api/admin/database/full-backup`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action:'run'})});assert.equal(blocked.status,403);assert.equal((await blocked.json()).code,'PC_READ_ONLY');
  assert.equal((await fetch(`${base}/api/admin/database/pc-incremental?source=primary`,{headers:{cookie}})).status,403);
  const cross=await fetch(`${base}/api/admin/database/pc-local`,{method:'POST',headers:{cookie,origin:'http://evil.example','content-type':'application/json'},body:JSON.stringify({action:'mode',mode:'remote'})});assert.equal(cross.status,403);
  const denied=await new Promise((resolve,reject)=>{const req=http.request(`${base}/admin/login`,{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end()});assert.equal(denied,403);
  const page=await fetch(`${base}/admin`,{headers:{cookie}});assert.equal(page.status,200);assert.match(await page.text(),/только чтение/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  const moveBody=JSON.stringify({action:'change_root',root:newRoot});
  const byManager=await fetch(`${base}/api/admin/database/pc-local`,{method:'POST',headers:{cookie:managerCookie,origin:base,'content-type':'application/json'},body:moveBody});assert.equal(byManager.status,403);
  const byCross=await fetch(`${base}/api/admin/database/pc-local`,{method:'POST',headers:{cookie,origin:'http://evil.example','content-type':'application/json'},body:moveBody});assert.equal(byCross.status,403);
  assert.deepEqual(fs.readdirSync(newRoot),[]);
  const moved=await fetch(`${base}/api/admin/database/pc-local`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:moveBody});assert.equal(moved.status,200,await moved.clone().text());assert.equal((await moved.json()).root,newRoot);
  assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(fs.readFileSync(path.join(newRoot,`pc-${state.computerId}`,'sgt-working-db.json'),'utf8'),before);
  assert.equal((await fetch(`${base}/admin`,{headers:{cookie}})).status,200);
  const toRemote=await fetch(`${base}/api/admin/database/pc-local`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action:'mode',mode:'remote'})});assert.equal(toRemote.status,200);
  assert.equal((await fetch(`${base}/api/admin/database/pc-local`,{headers:{cookie}})).status,401, 'offline session must not authorize cloud mode');
 }finally{
  if(child.exitCode===null){try{process.platform==='win32'?child.kill():process.kill(-child.pid,'SIGTERM')}catch{} await new Promise(r=>{child.once('exit',r);setTimeout(r,5000).unref()})}
  fs.rmSync(root,{recursive:true,force:true});fs.rmSync(newRoot,{recursive:true,force:true});fs.rmSync(config,{recursive:true,force:true});
 }
});
