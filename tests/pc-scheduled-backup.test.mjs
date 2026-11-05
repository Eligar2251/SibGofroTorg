import test from 'node:test';
import assert from 'node:assert/strict';
import { novosibirskSlot, choosePcScheduleDirectory, getPcScheduleSettings, getPcScheduleStatus, runPcScheduledBackups, savePcCurrentBackups, savePcScheduleSettings } from '../src/lib/pc-scheduled-backup.ts';

test('schedule uses Novosibirsk civil time, not browser timezone', () => {
  assert.deepEqual(novosibirskSlot(new Date('2026-11-04T11:00:00Z')), { date:'2026-11-04', time:'18-00' });
  assert.deepEqual(novosibirskSlot(new Date('2026-11-04T16:05:00Z')), { date:'2026-11-04', time:'23-00' });
  assert.equal(novosibirskSlot(new Date('2026-11-04T16:11:00Z')), null);
  assert.equal(novosibirskSlot(new Date('2026-11-04T10:59:59Z')), null);
});

test('independent accounts and sources, retry failures without recording false success', async () => {
  const saved = new Map(), local = new Map(), files = new Map();
  let fetches = []; let secondaryFails = true; let permitted = true;
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
      fetches.push(String(url));
      if (String(url).includes('secondary') && secondaryFails) return new Response(JSON.stringify({error:'unavailable'}),{status:503});
      return new Response(JSON.stringify({app:'SibGofroTorg',backupFormat:'sgt-public-v1',tables:{},totalRows:0}),{status:200});
    }});
    const settings = await choosePcScheduleDirectory('owner');
    savePcScheduleSettings('owner',{...settings, enabled:true, autoActive:false, sources:{primary:true,secondary:true}});
    assert.equal(getPcScheduleSettings('another-owner').enabled,true);
    const when = new Date('2026-11-04T11:00:00Z');
    await runPcScheduledBackups('owner',when);
    assert.equal(fetches.length,2);
    assert.match(getPcScheduleStatus('owner').error, /secondary: unavailable/);
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
    assert.deepEqual(manual, ['primary: сохранено', 'secondary: сохранено']);
    assert.equal(files.size,4);
    const currentKey = [...files.keys()].find(x => x.endsWith('/primary/sgt-full-current.json'));
    const currentFile = files.get(currentKey);
    const secondaryKey = [...files.keys()].find(x => x.endsWith('/secondary/sgt-full-current.json'));
    const secondaryFile = files.get(secondaryKey);
    secondaryFails = true;
    const result = await savePcCurrentBackups('owner');
    assert.match(result[1], /secondary: unavailable/);
    assert.equal(files.get(currentKey), currentFile);
    assert.equal(files.get(secondaryKey), secondaryFile);
    permitted=false;
    await runPcScheduledBackups('owner',new Date('2026-11-04T16:00:00Z'));
    assert.match(getPcScheduleStatus('owner').error, /Нет доступа/);
    assert.equal(files.size,4);
  } finally { for (const [key, desc] of Object.entries(old)) desc ? Object.defineProperty(globalThis,key,desc) : delete globalThis[key]; }
});
