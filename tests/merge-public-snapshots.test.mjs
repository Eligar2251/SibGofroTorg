import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePublicSnapshots } from '../src/lib/merge-public-snapshots.ts';

function snap() {
  return { app:'SibGofroTorg', backupFormat:'sgt-public-v1', version:1, exportedAt:'2026-01-01T00:00:00Z', totalRows:3,
    tables:{paper:[{id:'p1',name:'Paper'},{id:'p2',name:'Old'}], rent:[{id:'r1',name:'Rent'}]},
    columns:{paper:[{name:'id',type:'text'},{name:'name',type:'text'}], rent:[{name:'id',type:'text'},{name:'name',type:'text'}]},
    sequences:{paper:{},rent:{}} };
}
test('merges disjoint table changes and deletions without modifying inputs', () => {
  const base=snap(), left=structuredClone(base), right=structuredClone(base);
  left.tables.paper = [{id:'p1',name:'Edited'}]; left.totalRows=2;
  right.tables.rent[0].name='Updated';
  const before=JSON.stringify([base,left,right]);
  const result=mergePublicSnapshots(base,left,right);
  assert.deepEqual(result.tables.paper,[{id:'p1',name:'Edited'}]);
  assert.deepEqual(result.tables.rent,[{id:'r1',name:'Updated'}]);
  assert.equal(result.totalRows,2);
  assert.equal(JSON.stringify([base,left,right]),before);
});
test('reordered SQL rows and object keys do not constitute changes', () => {
  const base=snap(), left=structuredClone(base), right=structuredClone(base);
  left.tables.paper=[{name:'Old',id:'p2'},{name:'Paper',id:'p1'}];
  right.tables.paper[0].name='Updated';
  assert.equal(mergePublicSnapshots(base,left,right).tables.paper[0].name,'Updated');
});
test('conflicting changes, including delete vs update, fail without output', () => {
  const base=snap(), left=structuredClone(base), right=structuredClone(base);
  left.tables.paper.splice(0,1); left.totalRows--;
  right.tables.paper[0].name='Updated';
  assert.throws(()=>mergePublicSnapshots(base,left,right), /обе копии изменили таблица paper/);
});
test('conflicting sequence updates and different schema fail closed', () => {
  const base=snap(); base.sequences.paper.id={last:'1',called:true};
  const left=structuredClone(base), right=structuredClone(base);
  left.sequences.paper.id.last='2'; right.sequences.paper.id.last='3';
  assert.throws(()=>mergePublicSnapshots(base,left,right), /последовательность paper.id/);
  right.columns.rent.push({name:'extra',type:'text'});
  assert.throws(()=>mergePublicSnapshots(base,left,right), /неполная строка|схемы файлов/i);
});
test('rejects incomplete snapshots and unsafe numbers', () => {
  const base=snap(), left=structuredClone(base), right=structuredClone(base);
  delete right.tables.rent[0].name;
  assert.throws(()=>mergePublicSnapshots(base,left,right), /Неполная строка/);
  right.tables.rent[0].name=9007199254740992;
  assert.throws(()=>mergePublicSnapshots(base,left,right), /большое число/);
});
