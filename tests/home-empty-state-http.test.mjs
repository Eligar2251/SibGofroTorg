// Verify the public homepage when no products or Supabase are configured.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function freePort() {
  const s = net.createServer();
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}

test('empty homepage contains customer-facing text and no admin instruction', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgt-home-empty-'));
  const port = await freePort();
  let logs = '';
  const env = { ...process.env, SGT_PC_LOCAL_SERVER: '0', SGT_DATA_DIR: dir,
    SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_SECONDARY_URL: '', SUPABASE_SECONDARY_SECRET_KEY: '', SUPABASE_SECONDARY_SERVICE_ROLE_KEY: '' };
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: process.cwd(), detached: process.platform !== 'win32', env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Next did not start: ${logs}`)), 45000);
      const onData = chunk => { logs += chunk.toString(); if (logs.includes('Ready in')) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Next exited ${code}: ${logs}`)); });
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Товары сейчас не отображаются\. Уточните наличие по телефону\./);
    assert.doesNotMatch(html, /Плитки ещё не настроены — добавьте их в админ-панели/);
    assert.match(html, /Мы используем cookies/);
    assert.match(html, /Настройки cookies/);
  } finally {
    if (child.exitCode === null) {
      try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGTERM'); } catch {}
      await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5000).unref(); });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
