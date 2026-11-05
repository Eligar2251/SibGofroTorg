import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isAdminDatabasePath } from '../src/lib/admin-database-path.ts';

test('warnings are scoped to the configured admin database section', () => {
  assert.equal(isAdminDatabasePath('/secret/database', 'secret'), true);
  assert.equal(isAdminDatabasePath('/secret/database/', 'secret'), true);
  assert.equal(isAdminDatabasePath('/secret/database/details', 'secret'), true);
  for (const path of [null, '/secret', '/secret/orders', '/secret/database-other', '/other/database', '/database']) {
    assert.equal(isAdminDatabasePath(path, 'secret'), false, String(path));
  }
});

test('both backup runners stay mounted and continue their timers while alerts are page-scoped', () => {
  const browser = fs.readFileSync('src/components/admin/PcScheduledFullBackup.tsx', 'utf8');
  const local = fs.readFileSync('src/components/admin/PcWorkingLiveRunner.tsx', 'utf8');
  const shell = fs.readFileSync('src/components/admin/AdminShell.tsx', 'utf8');
  const layout = fs.readFileSync('src/app/[adminPath]/layout.tsx', 'utf8');
  assert.match(browser, /setInterval\(tick, 30_000\)/);
  assert.match(browser, /setInterval\(liveTick, 5_000\)/);
  assert.match(browser, /!isAdminDatabasePath\(pathname, adminPath\)/);
  assert.match(local, /setInterval\(\(\)=>void tick\(\),5000\)/);
  assert.match(local, /isAdminDatabasePath\(pathname,adminPath\)/);
  assert.equal((shell.match(/<PcScheduledFullBackupRunner username=\{username\} adminPath=\{adminPath\}/g) || []).length, 2);
  assert.match(layout, /<PcWorkingLiveRunner adminPath=\{ADMIN_PATH\}/);
});

test('database UI retains restore and legacy stop without advertising experimental merge or replication enable', () => {
  const switcher = fs.readFileSync('src/components/admin/DatabaseBackendSwitcher.tsx', 'utf8');
  const full = fs.readFileSync('src/components/admin/FullBackupPanel.tsx', 'utf8');
  const page = fs.readFileSync('src/app/[adminPath]/database/page.tsx', 'utf8');
  assert.doesNotMatch(switcher, /<MergeBackupPanel/);
  assert.match(page, /<PcScheduledFullBackupPanel/);
  assert.match(full, /Остановить автокопирование/);
  assert.match(full, /status\.settings\.enabled/);
  assert.match(full, /Выбрать файл и восстановить все три/);
  assert.doesNotMatch(full, /Включить \/ сохранить копирование/);
});
