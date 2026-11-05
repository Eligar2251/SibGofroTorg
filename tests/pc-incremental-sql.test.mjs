import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('incremental RPC sees inserts, updates, PK changes, deletes and forces reset for restore/truncate', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table products(id text primary key, name text);
      create table other(id int primary key, value text);
      insert into products values ('a','first'),('b','second');`);
    await db.exec(fs.readFileSync('supabase/migration_complete_app_backup.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/migration_pc_incremental_backup.sql','utf8'));
    await assert.rejects(db.query('select public.sgt_pc_backup_snapshot() v'),/triggers missing/i);
    await db.exec('SELECT public.sgt_pc_backup_enable()');
    const original=(await db.query('select public.sgt_pc_backup_snapshot() v')).rows[0].v;
    assert.equal(original.snapshot.totalRows,2);
    await db.exec("update products set name='changed' where id='a'; update products set id='c' where id='b'; insert into other values (1,'new')");
    const changes=(await db.query('select public.sgt_pc_backup_changes($1,$2,$3) v',[original.instance,original.cursor,original.catalogHash])).rows[0].v;
    assert.equal(changes.reset,false);
    assert.deepEqual(changes.tables.products.keys.sort((x,y)=>x.id.localeCompare(y.id)),[{id:'a'},{id:'b'},{id:'c'}]);
    assert.deepEqual(changes.tables.products.rows.sort((x,y)=>x.id.localeCompare(y.id)),[{id:'a',name:'changed'},{id:'c',name:'second'}]);
    assert.deepEqual(changes.tables.other.rows,[{id:1,value:'new'}]);
    const cursor=changes.cursor;
    await db.exec('delete from other where id=1');
    const deletion=(await db.query('select public.sgt_pc_backup_changes($1,$2,$3) v',[original.instance,cursor,original.catalogHash])).rows[0].v;
    assert.deepEqual(deletion.tables.other.keys,[{id:1}]);
    assert.deepEqual(deletion.tables.other.rows,[]);
    await db.exec('truncate other');
    assert.equal((await db.query('select public.sgt_pc_backup_changes($1,$2,$3) v',[original.instance,cursor,original.catalogHash])).rows[0].v.reset,true);
    const next=(await db.query('select public.sgt_pc_backup_snapshot() v')).rows[0].v;
    await db.query('select public.sgt_restore_app_data($1::jsonb)',[JSON.stringify(original.snapshot)]);
    assert.equal((await db.query('select public.sgt_pc_backup_changes($1,$2,$3) v',[next.instance,next.cursor,next.catalogHash])).rows[0].v.reset,true);
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.sgt_pc_backup_snapshot()'), /permission denied/i);
    await assert.rejects(db.query('select public.sgt_pc_backup_enable()'), /permission denied/i);
    await assert.rejects(db.query('select public.sgt_pc_backup_disable()'), /permission denied/i);
    await assert.rejects(db.query('select public.sgt_pc_backup_prune()'), /permission denied/i);
  } finally { await db.close(); }
});

test('partition truncate, new partitions, tables without PK and bounded journal retention', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.batches(id integer, bucket integer, PRIMARY KEY(id,bucket)) PARTITION BY RANGE(bucket);
      CREATE TABLE public.batches_0 PARTITION OF public.batches FOR VALUES FROM (0) TO (10);
      CREATE TABLE public.no_key(value text);`);
    await db.exec(fs.readFileSync('supabase/migration_complete_app_backup.sql','utf8'));
    const migration=fs.readFileSync('supabase/migration_pc_incremental_backup.sql','utf8');
    await db.exec(migration);
    await db.exec('SELECT public.sgt_pc_backup_enable()');
    const snapshot=async()=> (await db.query('SELECT public.sgt_pc_backup_snapshot() AS value')).rows[0].value;
    const changes=async start => (await db.query('SELECT public.sgt_pc_backup_changes($1,$2,$3) AS value',[start.instance,start.cursor,start.catalogHash])).rows[0].value;
    let start=await snapshot();
    await db.exec(`INSERT INTO batches VALUES (1,1)`);
    assert.deepEqual((await changes(start)).tables.batches.rows,[{id:1,bucket:1}]);
    start=await snapshot();
    await db.exec(`TRUNCATE batches_0`);
    assert.equal((await changes(start)).reset,true);
    start=await snapshot();
    await db.exec(`INSERT INTO no_key VALUES ('new')`);
    assert.equal((await changes(start)).reset,true);
    start=await snapshot();
    await db.exec(`INSERT INTO batches VALUES (2,2); UPDATE sgt_pc_backup.changes SET changed_at=now()-interval '8 days';`);
    await db.exec(`SELECT public.sgt_pc_backup_prune()`);
    assert.equal((await changes(start)).reset,true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sgt_pc_backup.changes')).rows[0].n,0);
    await db.exec(`CREATE TABLE public.batches_1 PARTITION OF public.batches FOR VALUES FROM (10) TO (20)`);
    await assert.rejects(snapshot(),/partition trigger missing/i);
    await db.exec(migration);
    await db.exec('SELECT public.sgt_pc_backup_enable()');
    start=await snapshot();
    await db.exec(`INSERT INTO batches VALUES (3,11); TRUNCATE batches_1`);
    assert.equal((await changes(start)).reset,true);
    start=await snapshot();
    await db.exec('SELECT public.sgt_pc_backup_disable()');
    await db.exec(`INSERT INTO batches VALUES (4,1)`);
    await assert.rejects(changes(start),/triggers missing/i);
    await db.exec('SELECT public.sgt_pc_backup_enable()');
    assert.equal((await changes(start)).reset,true);
    assert.equal((await snapshot()).snapshot.tables.batches.some(row=>row.id===4),true);
  } finally { await db.close(); }
});
