// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; row; page; create
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/history-pages.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const row=n=>({id:'row-'+n,at:new Date(100000+n).toISOString(),sort_key:String(n).padStart(6,'0'),text:'记录 '+n});
const page=(numbers,extra={})=>({entries:numbers.map(row),before:row(numbers[0]||0).sort_key,has_more:numbers[0]>1,...extra});
async function create(fetch,options={}){const {HistoryPages}=await import('../ui/history-pages.mjs'),p=new HistoryPages(fetch,options);p.reset({session_id:'one',history_segment:'segment'});p.opened=true;return p;}

test('history initial load stays one recent page and upward pages deduplicate without latest jumping',async()=>{
  const calls=[],results=[page([5,6,7]),page([3,4,5]),page([6,7,8])],p=await create(async args=>{calls.push(args);return results.shift();},{limit:3});
  await p.load('reset');assert.deepEqual(p.rows.map(r=>r.id),[5,6,7].map(n=>row(n).id));
  await p.load('older');assert.equal(calls[1].before,row(5).sort_key);assert.equal(p.rows.length,5);assert.equal(p.before,row(3).sort_key);
  await p.load('latest');assert.equal(p.before,row(3).sort_key);assert.equal(p.paged,true);assert.equal(p.rows.length,6);
});
test('indexing replaces partial recent windows and updates cursors until scan is complete',async()=>{
  const results=[page([1,2],{indexing:true}),page([5,6],{indexing:true}),page([9,10],{indexing:false})],p=await create(async()=>results.shift(),{limit:2});
  await p.load('reset');assert.equal(await p.load('older'),false);
  await p.load('latest');assert.deepEqual(p.rows.map(r=>r.id),[5,6].map(n=>row(n).id));assert.equal(p.before,row(5).sort_key);
  await p.load('latest');assert.deepEqual(p.rows.map(r=>r.id),[9,10].map(n=>row(n).id));assert.equal(p.before,row(9).sort_key);assert.equal(p.hasMore,true);
});
test('history single-flight and session/close changes reject late replies and errors',async()=>{
  let resolve,calls=0;const p=await create(()=>{calls++;return new Promise(r=>resolve=r);});
  const stale=p.load('reset');assert.equal(await p.load('reset'),false);assert.equal(calls,1);
  p.reset({session_id:'two'});resolve(page([1,2]));assert.equal(await stale,false);assert.deepEqual(p.rows,[]);assert.equal(p.busy,false);
  const closing=p.load();p.close();resolve(page([3]));assert.equal(await closing,false);assert.deepEqual(p.rows,[]);assert.equal(p.error,'');
});
test('history retention stays bounded while cursors continue older navigation',async()=>{
  const results=[page([8,9,10]),page([5,6,7]),page([2,3,4]),page([9,10,11])],p=await create(async()=>results.shift(),{limit:3,max:5});
  await p.load('reset');await p.load('older');assert.equal(p.rows.length,5);assert.equal(p.trimmed,true);assert.equal(p.before,row(5).sort_key);
  await p.load('older');assert.deepEqual(p.rows.map(r=>r.id),[2,3,4,5,6].map(n=>row(n).id));assert.equal(p.before,row(2).sort_key);
  await p.load('reset');assert.equal(p.trimmed,false);assert.equal(p.paged,false);assert.deepEqual(p.rows.map(r=>r.id),[9,10,11].map(n=>row(n).id));
});
test('history failures are recoverable and segment changes are never silently merged',async()=>{
  let result=Error('读取失败');const p=await create(async()=>{if(result instanceof Error)throw result;return result;});
  assert.equal(await p.load('reset'),false);assert.equal(p.error,'读取失败');assert.equal(p.loaded,false);
  result=page([1],{reset:true});assert.equal(await p.load(),false);assert.match(p.error,/历史段已变化/);
  result=page([1]);assert.equal(await p.load(),true);assert.equal(p.error,'');assert.equal(p.loaded,true);
});
