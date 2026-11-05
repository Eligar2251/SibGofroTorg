import assert from 'node:assert/strict';import fs from 'node:fs';import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

// PGlite is an isolated PostgreSQL-compatible test; it does not prove real
// multi-connection locking, Supabase privileges, failover or SMB behaviour.
test('PC changes use one transactional CAS, constraints and retry-safe receipts',{timeout:60000},async()=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE products(id text PRIMARY KEY, name text NOT NULL UNIQUE, qty integer NOT NULL CHECK(qty > 0), updated_at text DEFAULT 'old');
    CREATE TABLE children(id text PRIMARY KEY, product_id text NOT NULL REFERENCES products(id));
    CREATE TABLE seq_items(id serial PRIMARY KEY, name text);
    CREATE TABLE nested_keys(id jsonb PRIMARY KEY, label text);
    INSERT INTO nested_keys VALUES ('{"a":1}'::jsonb,'one'),('{"a":1,"b":2}'::jsonb,'two');
    INSERT INTO products(id,name,qty) VALUES ('a','A',1),('b','B',2);
  `);
  for(const f of ['migration_complete_app_backup.sql','migration_pc_incremental_backup.sql','migration_pc_merge_apply.sql'])await db.exec(fs.readFileSync(`supabase/${f}`,'utf8'));
  const instance=(await db.query('select instance_id from sgt_pc_backup.state')).rows[0].instance_id;
  const catalogHash=(await db.query('select md5(sgt_pc_backup.catalog()::text) h')).rows[0].h;
  const get=async id=>(await db.query('select to_jsonb(p) row from products p where id=$1',[id])).rows[0]?.row ?? null;
  const apply=async(id,changes,src=instance)=>(await db.query('select public.sgt_pc_apply_changes($1,$2,$3,$4::jsonb) value',[src,catalogHash,id,JSON.stringify(changes)])).rows[0].value;
  const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222';
  const a=await get('a'), b=await get('b');
  const changes=[{table:'products',key:{id:'a'},before:a,after:{...a,name:'updated'}},{table:'products',key:{id:'b'},before:b,after:null},{table:'products',key:{id:'c'},before:null,after:{id:'c',name:'C',qty:4,updated_at:'old'}}];
  assert.deepEqual(await apply(one,changes),{applied:3,alreadyApplied:false});assert.equal((await get('a')).name,'updated');assert.equal(await get('b'),null);assert.equal((await get('c')).qty,4);
  assert.deepEqual(await apply(one,changes),{applied:3,alreadyApplied:true});
  await assert.rejects(apply(one,[changes[0]]),/different data/);
  assert.equal((await db.query('select count(*)::int n from sgt_pc_backup.merge_receipts')).rows[0].n,1);
  const nestedChange={table:'nested_keys',key:{id:{a:1}},before:{id:{a:1},label:'one'},after:{id:{a:1},label:'ONE'}};
  await apply('12121212-1212-4121-8121-121212121212',[nestedChange]);
  assert.equal((await db.query("SELECT label FROM nested_keys WHERE id='{\"a\":1,\"b\":2}'::jsonb")).rows[0].label,'two');
  // Row changed after preview: neither it nor the otherwise valid insert applies.
  const conflict=[{table:'products',key:{id:'a'},before:a,after:{...a,name:'stale'}},{table:'products',key:{id:'d'},before:null,after:{id:'d',name:'D',qty:5,updated_at:'old'}}];
  await assert.rejects(apply(two,conflict),/conflict/);assert.equal((await get('a')).name,'updated');assert.equal(await get('d'),null);
  // Failure of the second SQL statement rolls back the first and the receipt.
  const updated=await get('a');const invalid=[{table:'products',key:{id:'a'},before:updated,after:{...updated,qty:10}},{table:'products',key:{id:'d'},before:null,after:{id:'d',name:'C',qty:1,updated_at:'old'}}];
  await assert.rejects(apply(two,invalid),/unique/);assert.equal((await get('a')).qty,1);assert.equal(await get('d'),null);
  // A trigger's timestamp is expected, but an unexpected data transformation isn't.
  await db.exec(`CREATE FUNCTION test_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:='remote-time'; IF NEW.qty=99 THEN NEW.name:='mutated'; END IF; IF NEW.qty=98 THEN RETURN NULL; END IF; RETURN NEW; END $$; CREATE TRIGGER trg_test BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION test_trigger();`);
  await apply(two,[{table:'products',key:{id:'a'},before:updated,after:{...updated,qty:7}}]);assert.equal((await get('a')).updated_at,'remote-time');
  let now=await get('a');
  await assert.rejects(apply('33333333-3333-4333-8333-333333333333',[{table:'products',key:{id:'a'},before:now,after:{...now,qty:99}}]),/trigger or generated/);assert.equal((await get('a')).qty,7);
  await assert.rejects(apply('33333333-3333-4333-8333-333333333333',[{table:'products',key:{id:'a'},before:now,after:{...now,qty:98}}]),/suppressed/);assert.equal((await get('a')).qty,7);
  // A later row's trigger may modify an earlier row; final validation must abort both.
  await db.exec(`CREATE FUNCTION test_cross_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='c' AND NEW.qty=12 THEN UPDATE products SET qty=100 WHERE id='a'; END IF; RETURN NEW; END $$; CREATE TRIGGER trg_cross AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION test_cross_trigger();`);
  const currentC=await get('c');
  await assert.rejects(apply('abababab-abab-4aba-8aba-abababababab',[{table:'products',key:{id:'a'},before:now,after:{...now,qty:8}},{table:'products',key:{id:'c'},before:currentC,after:{...currentC,qty:12}}]),/final row differs/);
  assert.equal((await get('a')).qty,7);assert.equal((await get('c')).qty,4);
  // FK, unsafe sequence IDs, duplicate keys, schema and source fail closed.
  await db.exec("INSERT INTO children VALUES ('kid','a')");
  await assert.rejects(apply('44444444-4444-4444-8444-444444444444',[{table:'products',key:{id:'a'},before:now,after:null}]),/foreign key/);assert.ok(await get('a'));
  await assert.rejects(apply('55555555-5555-4555-8555-555555555555',[{table:'seq_items',key:{id:2},before:null,after:{id:2,name:'s'}}]),/sequence-bearing/);
  await assert.rejects(apply('66666666-6666-4666-8666-666666666666',[changes[0],changes[0]]),/duplicate row/);
  await assert.rejects(apply('77777777-7777-4777-8777-777777777777',[{table:'products; drop table products',key:{id:'a'},before:now,after:null}]),/table not allowed/);
  await assert.rejects(apply('88888888-8888-4888-8888-888888888888',[{table:'products',key:{id:'a'},before:now,after:{id:'a'}}]),/incomplete/);
  await assert.rejects(apply('99999999-9999-4999-8999-999999999999',[changes[0]],'f'.repeat(32)),/source identity/);
  await db.exec('ALTER TABLE products ADD COLUMN newly_added text');
  await assert.rejects(apply('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',[changes[0]]),/catalog changed/);
  assert.deepEqual(await apply(one,changes),{applied:3,alreadyApplied:true});
  await db.exec('SET ROLE anon');await assert.rejects(apply('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',[changes[0]]),/permission denied/i);
 } finally {await db.close()}
});
