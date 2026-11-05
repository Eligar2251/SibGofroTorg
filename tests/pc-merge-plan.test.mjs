import assert from 'node:assert/strict';
import test from 'node:test';
import {planPcMerge} from '../src/lib/pc-merge-plan.ts';
const init=()=>({app:'SibGofroTorg',backupFormat:'sgt-public-v1',version:1,exportedAt:'2026-01-01T00:00:00Z',totalRows:2,
 tables:{p:[{id:'a',name:'A'},{id:'b',name:'B'}]},columns:{p:[{name:'id',type:'text'},{name:'name',type:'text'}]},sequences:{p:{}}});
const cat=()=>({p:{pk:['id'],columns:init().columns.p}});
const copy=x=>structuredClone(x);
test('plans independent row edits and remote changes without touching snapshots',()=>{
 const base=init(), local=copy(base), remote=copy(base);local.tables.p[0].name='local';remote.tables.p[1].name='remote';
 const plan=planPcMerge(base,local,remote,cat());
 assert.equal(plan.needsDatabaseValidation,true);assert.equal(plan.conflicts.length,0);assert.equal(plan.changes.length,1);
 assert.equal(plan.changes[0].before.name,'A');assert.equal(plan.changes[0].after.name,'local');
 assert.equal(remote.tables.p[0].name,'A'); assert.equal(base.tables.p[0].name,'A');
});
test('detects edit/delete conflicts and accepts identical edits or deletes',()=>{
 const base=init(), local=copy(base), remote=copy(base);local.tables.p[0].name='local';remote.tables.p.splice(0,1);remote.totalRows=1;
 assert.equal(planPcMerge(base,local,remote,cat()).conflicts[0].reason,'both_changed');
 local.tables.p.splice(0,1);local.totalRows=1;
 assert.deepEqual(planPcMerge(base,local,remote,cat()).changes,[]);assert.deepEqual(planPcMerge(base,local,remote,cat()).conflicts,[]);
});
test('deletions and inserts carry before values for later compare-and-swap',()=>{
 const base=init(), local=copy(base), remote=copy(base);local.tables.p.shift();local.tables.p.push({id:'c',name:'C'});
 const changes=planPcMerge(base,local,remote,cat()).changes;
 assert.deepEqual(changes.map(c=>[c.key.id,c.before?.name??null,c.after?.name??null]),[['a','A',null],['c',null,'C']]);
});
test('no primary key or sequence changes require review',()=>{
 const base=init(),local=copy(base),remote=copy(base);local.tables.p[0].name='L';local.sequences.p={id:{last:'3',called:true}};
 const plan=planPcMerge(base,local,remote,{p:{...cat().p,pk:[]}});
 assert.deepEqual(plan.conflicts.map(c=>c.reason),['sequence_changed','no_primary_key']);assert.deepEqual(plan.changes,[]);
});
test('rejects wrong schema, malformed catalog and duplicate primary keys',()=>{
 const base=init(), local=copy(base), remote=copy(base);local.columns.p[0].type='int';
 assert.throws(()=>planPcMerge(base,local,remote,cat()),/схем/i);
 assert.throws(()=>planPcMerge(base,base,base,{p:{...cat().p,pk:['missing']}}),/каталог/i);
 remote.tables.p.push({id:'a',name:'duplicate'});remote.totalRows++;
 assert.throws(()=>planPcMerge(base,base,remote,cat()),/повторяется/);
});
