import test from 'node:test';
import assert from 'node:assert/strict';
import { novosibirskSlot, moscowDailySlot, choosePcScheduleDirectory, getPcScheduleSettings, getPcScheduleStatus, runPcScheduledBackups, savePcCurrentBackups, savePcScheduleSettings } from '../src/lib/pc-scheduled-backup.ts';

test('schedule uses Novosibirsk civil time, not browser timezone', () => {
  assert.deepEqual(novosibirskSlot(new Date('2026-11-04T11:00:00Z')), { date:'2026-11-04', time:'18-00' });
  assert.deepEqual(novosibirskSlot(new Date('2026-11-04T16:05:00Z')), { date:'2026-11-04', time:'23-00' });
  assert.equal(novosibirskSlot(new Date('2026-11-04T16:11:00Z')), null);
  assert.equal(novosibirskSlot(new Date('2026-11-04T10:59:59Z')), null);
  assert.deepEqual(moscowDailySlot(new Date('2026-11-04T15:00:00Z')), {date:'2026-11-04',time:'18-00-msk'});
  assert.deepEqual(moscowDailySlot(new Date('2026-11-04T15:11:00Z')), {date:'2026-11-04',time:'18-00-msk'});
  assert.equal(moscowDailySlot(new Date('2026-11-04T14:59:00Z')), null);
});

test('independent accounts and sources, retry failures without recording false success', async () => {
  const saved = new Map(), local = new Map(), files = new Map();
  let fetches = []; let secondaryFails = true; let permitted = true; let localReady = false; let readonly = false; let value = 1;
  const old = Object.fromEntries(['window','localStorage','indexedDB','navigator','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const makeDir = prefix => ({ name:'shared', queryPermission: async () => permitted ? 'granted' : 'prompt', requestPermission: async () => permitted ? 'granted' : 'prompt',
    getDirectoryHandle: async name => makeDir(`${prefix}/${name}`),
    getFileHandle: async name => ({ createWritable: async () => { let text=''; return { write:async t=>{text=t}, close:async()=>files.set(`${prefix}/${name}`,text), abort:async()=>{} }; } }) });
  try {
    Object.defineProperty(globalThis,'localStorage',{ configurable:true, value:{ getItem:k=>local.get(k) ?? null, setItem:(k,v)=>local.set(k,v) }});
    Object.defineProperty(globalThis,'window',{ configurable:true, value:{ showDirectoryPicker:async()=>makeDir('Z:'), dispatchEvent(){} }});
    Object.defineProperty(globalThis,'navigator',{ configurable:true, value:{ locks:{ request:async (_key,_opt,cb)=>cb({name:'lock'}) } }});
    Object.defineProperty(globalThis,'indexedDB',{ configurable:true, value:{ open(){
      const req = {}; queueMicrotask(()=> { req.result = { close(){}, transaction(){ const tx = { objectStore(){return {
        get(key){ const r={}; queueMicrotask(()=>{r.result=saved.get(key); r.onsuccess?.(); tx.oncomplete?.()}); return r },
        put(value,key){const r={}; queueMicrotask(()=>{saved.set(key,value); r.onsuccess?.(); tx.oncomplete?.()}); return r }
      }} }; return tx } }; req.onsuccess?.() }); return req;
    } }});
    Object.defineProperty(globalThis,'fetch',{ configurable:true, value: async url => {
      if (String(url).includes("pc-source")) return new Response(JSON.stringify({localReadonly:readonly,source:"primary"}));
      if (String(url).endsWith("pc-local")) return new Response(JSON.stringify({available:localReady,configured:localReady,ready:localReady}));
      fetches.push(String(url));
      if (String(url).includes('secondary') && secondaryFails) return new Response(JSON.stringify({error:'unavailable'}),{status:503});
      return new Response(JSON.stringify({app:'SibGofroTorg',backupFormat:'sgt-public-v1',tables:{},totalRows:0,value}),{status:200});
    }});
    const settings = await choosePcScheduleDirectory('owner');
    savePcScheduleSettings('owner',{...settings, enabled:true, autoActive:false, sources:{primary:true,secondary:true}});
    assert.equal(getPcScheduleSettings('another-owner').enabled,true);
    const when = new Date('2026-11-04T11:00:00Z');
    await runPcScheduledBackups('owner',when);
    assert.equal(fetches.length,2);
    assert.match(getPcScheduleStatus('owner').error, /Supabase №2 .*: unavailable/);
    assert.equal(getPcScheduleStatus('owner').completed.primary,'2026-11-04_18-00_primary');
    assert.equal(getPcScheduleStatus('owner').completed.secondary,undefined);
    assert.equal(files.size,1);
    secondaryFails=false;
    await runPcScheduledBackups('owner',when);
    assert.equal(fetches.length,3);
    assert.equal(files.size,2);
    assert.equal(getPcScheduleStatus('owner').error,'');
    assert.ok([...files.keys()].every(x=>x.includes(`pc-${settings.computerId}`) && x.includes('/scheduled/')));
    await runPcScheduledBackups('owner',when);
    assert.equal(fetches.length,3);
    const manual = await savePcCurrentBackups('owner');
    assert.deepEqual(manual, ['Supabase №1 (SUPABASE_URL): сохранено', 'Supabase №2 (SUPABASE_SECONDARY_URL): сохранено', 'Локальная JSON-БД: доступна только при запуске сайта на этом ПК.']);
    assert.equal(files.size,4);
    const currentKey = [...files.keys()].find(x => x.endsWith('/primary/sgt-full-current.json'));
    const currentFile = files.get(currentKey);
    const secondaryKey = [...files.keys()].find(x => x.endsWith('/secondary/sgt-full-current.json'));
    const secondaryFile = files.get(secondaryKey);
    secondaryFails = true;
    const result = await savePcCurrentBackups('owner');
    assert.match(result[1], /Supabase №2 .*: unavailable/);
    assert.equal(files.get(currentKey), currentFile);
    assert.equal(files.get(secondaryKey), secondaryFile);
    permitted=false;
    await runPcScheduledBackups('owner',new Date('2026-11-04T16:00:00Z'));
    assert.match(getPcScheduleStatus('owner').error, /Нет доступа/);
    assert.equal(files.size,4);
    // Catch up after 18:00 Moscow, preserve both prior Novosibirsk slots and
    // overwrite the same daily file on the next Moscow day.
    permitted=true;secondaryFails=false;localReady=true;
    await runPcScheduledBackups('owner',new Date('2026-11-04T15:30:00Z'));
    const dailyKeys=[...files.keys()].filter(x=>x.endsWith('/scheduled/sgt-full-daily-msk.json'));
    assert.equal(dailyKeys.length,3);assert.ok(dailyKeys.some(x=>x.includes('/local/')));
    const before=files.size,count=fetches.length;
    await runPcScheduledBackups('owner',new Date('2026-11-04T15:59:00Z'));assert.equal(fetches.length,count);
    await runPcScheduledBackups('owner',new Date('2026-11-04T16:00:00Z'));
    const oldSlotCount=fetches.length;
    await runPcScheduledBackups('owner',new Date('2026-11-04T16:12:00Z'));assert.equal(fetches.length,oldSlotCount,'Moscow slot not repeated after 23:00 Novosibirsk');
    value=2;await runPcScheduledBackups('owner',new Date('2026-11-05T15:30:00Z'));
    assert.equal(files.size,before+3);assert.ok(dailyKeys.every(k=>JSON.parse(files.get(k)).value===2));
    readonly=true;fetches=[];
    const localOnly=await savePcCurrentBackups('owner');
    assert.deepEqual(localOnly,['Локальная JSON-БД: сохранено']);
    assert.deepEqual(fetches,['/api/admin/database/pc-local?download=1']);
  } finally { for (const [key, desc] of Object.entries(old)) desc ? Object.defineProperty(globalThis,key,desc) : delete globalThis[key]; }
});

test('local save writes the SQL data dump next to the JSON copy of the same snapshot', async () => {
  const saved = new Map(), local = new Map(), files = new Map();
  const full = {
    app: 'SibGofroTorg', backupFormat: 'sgt-public-v1', version: 1, exportedAt: '2026-11-04T10:00:00Z', totalRows: 1,
    tables: { products: [{ id: 7, name: "Короб 'Д' 600×400" }] },
    columns: { products: [{ name: 'id', type: 'bigint', generated: '', identity: 'a' }, { name: 'name', type: 'text', generated: '', identity: '' }] },
    sequences: { products: { id: { last: '7', called: true } } },
  };
  const old = Object.fromEntries(['window', 'localStorage', 'indexedDB', 'navigator', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const makeDir = prefix => ({
    name: 'backup', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    getDirectoryHandle: async name => makeDir(`${prefix}/${name}`),
    getFileHandle: async name => ({ createWritable: async () => { let text = ''; return { write: async t => { text = t }, close: async () => files.set(`${prefix}/${name}`, text), abort: async () => {} }; } }),
  });
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => local.get(k) ?? null, setItem: (k, v) => local.set(k, v) } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { showDirectoryPicker: async () => makeDir('Z:'), dispatchEvent() {} } });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_k, _o, cb) => cb({ name: 'lock' }) } } });
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
      const req = {};
      queueMicrotask(() => {
        const store = {
          get(key) { const r = {}; queueMicrotask(() => { r.result = saved.get(key); if (r.onsuccess) r.onsuccess(); if (tx.oncomplete) tx.oncomplete(); }); return r },
          put(value, key) { const r = {}; queueMicrotask(() => { saved.set(key, value); if (r.onsuccess) r.onsuccess(); if (tx.oncomplete) tx.oncomplete(); }); return r },
        };
        const tx = { objectStore() { return store } };
        req.result = { close() {}, transaction() { return tx } };
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    } } });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async url => {
      if (String(url).includes('pc-source')) return new Response(JSON.stringify({ localReadonly: false, source: 'primary' }));
      if (String(url).endsWith('pc-local')) return new Response(JSON.stringify({ available: false }));
      return new Response(JSON.stringify(full), { status: 200 });
    } });
    const settings = await choosePcScheduleDirectory('sql-owner');
    savePcScheduleSettings('sql-owner', { ...settings, enabled: true, autoActive: false, sources: { primary: true, secondary: false } });
    const messages = await savePcCurrentBackups('sql-owner');
    assert.match(messages[0], /сохранено \+ sgt-full-current\.sql/);
    const jsonKey = [...files.keys()].find(x => x.endsWith('/primary/sgt-full-current.json'));
    const sqlKey = [...files.keys()].find(x => x.endsWith('/primary/sgt-full-current.sql'));
    assert.ok(jsonKey && sqlKey, `expected JSON and SQL next to each other, got ${[...files.keys()]}`);
    const sql = files.get(sqlKey);
    // Дамп собран из того же снимка, что и рядом лежащий JSON.
    assert.deepEqual(JSON.parse(files.get(jsonKey)).tables.products, full.tables.products);
    assert.ok(sql.includes('INSERT INTO public."products"'), sql.slice(0, 200));
    assert.ok(sql.includes("''Д''"), 'quote inside the literal must be doubled');
    assert.ok(sql.includes('OVERRIDING SYSTEM VALUE'), sql);
    assert.equal(files.get(sqlKey).match(/CREATE TEMP|BEGIN;|COMMIT;/g), null);
  } finally { for (const [key, desc] of Object.entries(old)) desc ? Object.defineProperty(globalThis, key, desc) : delete globalThis[key]; }
});
