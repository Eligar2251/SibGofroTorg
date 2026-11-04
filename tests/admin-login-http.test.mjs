// Integration test: real Next.js server, isolated local database, no real credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgt-login-http-'));
process.env.SGT_DATA_DIR = dir;
const { saveDbRuntimeConfig } = await import('../src/lib/db-runtime-config.ts');
const { getLocalJsonDbClient } = await import('../src/lib/local-json-db.ts');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('login works for legacy read-only data and server-local switching is disabled', { timeout: 120000 }, async () => {
  saveDbRuntimeConfig({ activeBackend: 'local', autoFailover: true, autoBackupEnabled: true, mirrorWritesToLocal: true });
  const inserted = await getLocalJsonDbClient().from('admins').insert({
    id: 'test-admin', username: 'fake_owner', password_hash: 'fake-password-only-for-test',
    role: 'owner', is_active: true,
  });
  assert.equal(inserted.error, null);
  const legacyBefore = fs.readFileSync(path.join(dir, 'local-db.json'), 'utf8');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: process.cwd(), detached: process.platform !== 'win32',
    env: { ...process.env, SGT_DATA_DIR: dir, ADMIN_SECRET_PATH: 'admin', NEXT_PUBLIC_ADMIN_PATH: 'admin',
      ADMIN_SESSION_SECRET: 'test-only-admin-session-secret-123456789', SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_SECONDARY_URL: '', SGT_ALLOWED_DEV_ORIGINS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Next.js did not start: ${output}`)), 45000);
      const onData = (chunk) => {
        output += chunk.toString();
        if (output.includes('Ready in')) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Next.js exited ${code}: ${output}`)); });
    });
    const page = await fetch(`${base}/admin/login`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /<form[^>]*action="\/admin\/api\/login"[^>]*method="post"/);
    assert.doesNotMatch(html, /type="submit" disabled/);

    const form = await fetch(`${base}/admin/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: new URLSearchParams({ username: 'fake_owner', password: 'fake-password-only-for-test' }), redirect: 'manual',
    });
    assert.equal(form.status, 303);
    assert.equal(new URL(form.headers.get('location'), base).pathname, '/admin');
    const cookie = form.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie || '', /^admin-session=/);
    assert.equal((await fetch(`${base}/admin`, { headers: { cookie }, redirect: 'manual' })).status, 200);

    const switched = await fetch(`${base}/api/admin/database/backend`, {
      method: 'PUT', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ activeBackend: 'local' }),
    });
    assert.equal(switched.status, 410);
    assert.match((await switched.json()).error, /отключён/);
    const oldBackup = await fetch(`${base}/api/admin/database/backend`, {
      method:'POST', headers:{cookie, 'content-type':'application/json'}, body:JSON.stringify({action:'run_backup_now'})
    });
    assert.equal(oldBackup.status,410);
    const oldImport = await fetch(`${base}/api/admin/database/backup`, {
      method:'POST', headers:{cookie, 'content-type':'application/json'}, body:JSON.stringify({snapshot:{tables:{}}})
    });
    assert.equal(oldImport.status,410);
    const emergency = await fetch(`${base}/admin/api/login/local-file`, { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
    assert.equal(emergency.status,410);
    assert.equal(fs.readFileSync(path.join(dir, 'local-db.json'), 'utf8'), legacyBefore);

    const json = await fetch(`${base}/admin/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ username: 'fake_owner', password: 'fake-password-only-for-test' }),
    });
    assert.equal(json.status, 200);
    assert.equal((await json.json()).success, true);

    const wrong = await fetch(`${base}/admin/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'fake_owner', password: 'bad-test-password' }), redirect: 'manual',
    });
    assert.equal(wrong.status, 303);
    assert.match(wrong.headers.get('location'), /login_error=credentials/);
    assert.doesNotMatch(wrong.headers.get('location'), /bad-test-password/);
    const errorPage = await fetch(new URL(wrong.headers.get('location'), base));
    assert.match(await errorPage.text(), /Неверный логин или пароль/);

    const crossSite = await fetch(`${base}/admin/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' },
      body: 'username=a&password=b', redirect: 'manual',
    });
    assert.match(crossSite.headers.get('location'), /login_error=origin/);
    const scrub = await fetch(`${base}/admin/login?username=test&password=synthetic`, { redirect: 'manual' });
    assert.equal(scrub.status, 303);
    assert.equal(new URL(scrub.headers.get('location'), base).search, '');

    const script = html.match(/src="([^\"]+\.js[^\"]*)"/)?.[1]?.replaceAll('&amp;', '&');
    assert.ok(script);
    assert.equal((await fetch(base + script, { headers: { origin: 'http://10.121.106.53:3000' } })).status, 200);
    assert.equal((await fetch(base + script, { headers: { origin: 'http://evil.example' } })).status, 403);
    const hmrStatus = await new Promise((resolve, reject) => {
      const req = http.request(`${base}/_next/webpack-hmr`, { headers: {
        origin: 'http://10.121.106.53:3000', connection: 'Upgrade', upgrade: 'websocket',
        'sec-websocket-version': '13', 'sec-websocket-key': 'MDEyMzQ1Njc4OWFiY2RlZg==',
      } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('upgrade', (res, socket) => { resolve(res.statusCode); socket.destroy(); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(hmrStatus, 101);
  } finally {
    if (child.exitCode === null) {
      try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGTERM'); } catch {}
      await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 5000).unref(); });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
