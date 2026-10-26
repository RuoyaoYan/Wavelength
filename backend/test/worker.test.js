import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{clean} from '../worker.js';
import {openDb} from '../sqlite-d1.js';

const call=(env,method,body)=>worker.fetch(new Request('http://x/achievements',{method,body:body&&JSON.stringify(body)}),env).then(async r=>({status:r.status,body:await r.json()}));
const post=(env,b)=>call(env,'POST',b);
const list=env=>call(env,'GET').then(r=>r.body);
const sync={id:'wl:abc123:sync:2',game:'wavelength',type:'sync',lead:['Ann','Bob','Cy']};

test('a posted achievement is listed, newest first',async()=>{
  const env={DB:openDb()};
  assert.deepEqual((await post(env,sync)).body,{ok:true,stored:true});
  await post(env,{id:'im:xyz789:actor',game:'imposter',type:'actor',lead:['Bob'],others:['Ann','Cy']});
  const {items}=await list(env);
  assert.deepEqual(items.map(i=>i.type),['actor','sync']);
  assert.deepEqual(items[1].lead,['Ann','Bob','Cy']);
  assert.equal(typeof items[0].at,'number');
});
test('retrying the same id stores it once',async()=>{
  const env={DB:openDb()};
  await post(env,sync);
  assert.equal((await post(env,sync)).body.stored,false);
  assert.equal((await list(env)).items.length,1);
});
test('a co-op score is logged only when it beats the record',async()=>{
  const env={DB:openDb()};
  const rec=(id,score)=>post(env,{id:'wl:'+id+':record',game:'wavelength',type:'record',score,lead:['Ann','Bob']});
  assert.equal((await rec('game01',18)).body.stored,true);
  assert.equal((await rec('game02',18)).body.stored,false);
  assert.equal((await rec('game03',12)).body.stored,false);
  assert.equal((await rec('game04',22)).body.stored,true);
  const l=await list(env);
  assert.equal(l.best.wavelength,22);
  assert.deepEqual(l.items.map(i=>i.score),[22,18]);
});
test('bad posts are rejected',async()=>{
  const env={DB:openDb()};
  assert.equal((await post(env,{...sync,type:'nope'})).status,400);
  assert.equal((await post(env,{...sync,lead:[]})).status,400);
  assert.equal((await post(env,{...sync,id:'x'})).status,400);
  assert.equal((await post(env,{...sync,type:'record',score:-3})).status,400);
  assert.equal((await list(env)).items.length,0);
});
test('names are trimmed, deduplicated and capped',()=>{
  const r=clean({...sync,lead:['  Ann ','Ann','','x'.repeat(40),...Array(20).fill(0).map((_,i)=>'P'+i)]});
  assert.equal(r.lead[0],'Ann');assert.equal(r.lead[1].length,20);assert.equal(r.lead.length,12);
});
test('the database survives a restart',async()=>{
  const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');
  const file=mkdtempSync(tmpdir()+'/ach-')+'/a.db';
  await post({DB:openDb(file)},sync);
  assert.equal((await list({DB:openDb(file)})).items.length,1);
});
