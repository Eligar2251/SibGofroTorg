import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPcDelta, trackedFromInitial } from '../src/lib/pc-incremental.ts';

function initial() { return { instance:'a'.repeat(32),cursor:'100',catalogHash:'b'.repeat(32),
  catalog:{ products:{ pk:['id'],columns:[{name:'id'},{name:'name'}]}, settings:{pk:['key'],columns:[{name:'key'},{name:'value'}]} },
  snapshot:{app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01',totalRows:3,
    tables:{products:[{id:'a',name:'A'},{id:'b',name:'B'}],settings:[{key:'k',value:'v'}]},
    columns:{products:[{name:'id'},{name:'name'}],settings:[{name:'key'},{name:'value'}]},sequences:{products:{},settings:{}}} }; }
test('apply changed rows, deletes and PK changes without touching unaffected rows',()=>{
  const start=trackedFromInitial(initial()); const before=JSON.stringify(start);
  const result=applyPcDelta(start,{reset:false,cursor:'101',tables:{products:{keys:[{id:'a'},{id:'b'},{id:'c'}],rows:[{id:'a',name:'updated'},{id:'c',name:'B'}]}},sequences:{products:{},settings:{}}});
  assert.equal(result.changed,true);
  assert.deepEqual(result.backup.tables.products,[{id:'a',name:'updated'},{id:'c',name:'B'}]);
  assert.deepEqual(result.backup.tables.settings,[{key:'k',value:'v'}]);
  assert.equal(result.backup.totalRows,3);
  assert.equal(result.backup.pcTracking.cursor,'101');
  assert.equal(JSON.stringify(start),before);
});
test('repeated changes and only cursor movement do not require a disk write',()=>{
  const start=trackedFromInitial(initial());
  const result=applyPcDelta(start,{reset:false,cursor:'101',tables:{products:{keys:[{id:'a'}],rows:[{id:'a',name:'A'}]}},sequences:{products:{},settings:{}}});
  assert.equal(result.changed,false);
  assert.equal(result.backup.pcTracking.cursor,'101');
});
test('rejects invalid rows, mismatched keys, backwards cursor, bad metadata and unsafe numeric values',()=>{
  const start=trackedFromInitial(initial());
  assert.throws(()=>applyPcDelta(start,{reset:false,cursor:'99',tables:{}}),/назад/);
  assert.throws(()=>applyPcDelta(start,{reset:false,cursor:'101',tables:{products:{keys:[{id:'a'}],rows:[{id:'wrong',name:'X'}]}}}),/непредусмотренная/i);
  assert.throws(()=>applyPcDelta(start,{reset:false,cursor:'101',tables:{products:{keys:[{id:'a'}],rows:[{id:'a'}]}}}),/неполная/i);
  assert.throws(()=>applyPcDelta(start,{reset:false,cursor:'101',tables:{products:{keys:[{id:'a'}],rows:[{id:'a',name:9007199254740992}]}}}),/число/i);
  assert.throws(()=>trackedFromInitial({...initial(),catalogHash:'bad'}),/метаданные/i);
});
