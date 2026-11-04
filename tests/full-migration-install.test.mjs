import assert from 'node:assert/strict';
import fs from 'node:fs';import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('consolidated SQL includes every individual migration and PC backup dependencies in order',()=>{
 const sql=fs.readFileSync('supabase/FULL_DATABASE_MIGRATION.sql','utf8');
 const files=fs.readdirSync('supabase').filter(x=>x.startsWith('migration_')&&x.endsWith('.sql'));
 for(const file of files)assert.ok(sql.includes(`-- МИГРАЦИЯ: ${file}`),`${file} is missing`);
 assert.ok(sql.indexOf('-- МИГРАЦИЯ: migration_complete_app_backup.sql')<sql.indexOf('-- МИГРАЦИЯ: migration_pc_incremental_backup.sql'));
});

test('complete migration installs on a clean database and can be rerun without losing existing rows',{timeout:90000},async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  try {
    // Minimal Supabase role/auth shim for the isolated test database only.
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;`);
    const sql=fs.readFileSync('supabase/FULL_DATABASE_MIGRATION.sql','utf8');
    await db.exec(sql);
    const tables=(await db.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")).rows[0].n;
    assert.ok(tables>=58,`expected at least 58 public tables, got ${tables}`);
    await db.exec("INSERT INTO admins (username, password_hash, role, is_active) VALUES ('test-owner', 'test-only', 'owner', true), ('test-worker', 'test-only', 'wastepaper', true); INSERT INTO products (name,slug,stock_qty) VALUES ('test product','pc-test',3); INSERT INTO orders (status) VALUES ('confirmed'),('processing'),('in_delivery'),('issued'),('shipped'),('cancelled'); INSERT INTO wp_payments (date,direction,account) VALUES ('2026-01-01','incoming','third_party');");
    await db.exec(sql);
    assert.equal((await db.query("SELECT role FROM admins WHERE username='test-owner'")).rows[0].role,'owner');
    assert.equal((await db.query("SELECT role FROM admins WHERE username='test-worker'")).rows[0].role,'wastepaper');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM orders")).rows[0].n,6);
    assert.equal((await db.query("SELECT account FROM wp_payments")).rows[0].account,'third_party');
    assert.equal((await db.query("SELECT name,in_stock FROM products WHERE slug='pc-test'")).rows[0].name,'test product');
    assert.equal((await db.query("SELECT in_stock FROM products WHERE slug='pc-test'")).rows[0].in_stock,true);
  } finally {await db.close();}
});
