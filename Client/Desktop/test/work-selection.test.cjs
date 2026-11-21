// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; members
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/work-selection.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const members=n=>Array.from({length:n},(_,i)=>({id:'member-'+i,state:'running',updated:i}));
test('failed and waiting members retain visible priority and show the reason instead of stale progress',async()=>{
 const {WorkSelection,workVisible,workText}=await import('../ui/work-selection.mjs');
 for(const state of ['failed','timed_out','interrupted','persistence_failed','waiting_user']){
  const attention={id:'attention',state,error:'需要检查原回执',task:'原任务',text:'旧的进行中输出',phase:'thinking',thought:'旧的思考'};
  const selected=new WorkSelection().select([...members(30),attention,{id:'finished',state:'completed'}].filter(workVisible));
  assert.equal(selected.total,31);assert.ok(selected.items.some(m=>m.id==='attention'));
  assert.ok(!workText(attention,false).includes('旧的'));assert.match(workText(attention,false),/需要检查原回执/);
 }
 assert.equal(workVisible({state:'cancelled'}),false);assert.equal(workVisible({state:'idle'}),false);
});
test('work presentation is bounded for 1, 3, 6, 10 and 30 independent members',async()=>{
 const {WorkSelection}=await import('../ui/work-selection.mjs');
 for(const n of [1,3,6,10,30]){
  const input=members(n),selector=new WorkSelection(),shown=selector.select(input,{now:0});
  assert.equal(shown.items.length,Math.min(n,6));assert.equal(shown.hidden,Math.max(0,n-6));
  assert.equal(selector.select(input,{expanded:true,now:1}).items.length,n);
  assert.deepEqual(input,members(n),'presentation did not modify execution');
 }
});
test('new activity respects dwell time while attention and keyboard focus take precedence',async()=>{
 const {WorkSelection}=await import('../ui/work-selection.mjs'),selector=new WorkSelection(),input=members(10);
 const first=selector.select(input,{now:0}).items.map(x=>x.id);
 input[0].updated=100;
 assert.deepEqual(selector.select(input,{now:100}).items.map(x=>x.id),first);
 input[1].state='failed';
 assert.ok(selector.select(input,{now:200}).items.some(x=>x.id==='member-1'));
 const focused=first[0];input.find(x=>x.id===focused).focused=true;
 assert.equal(selector.select(input,{now:300,limit:1}).items[0].id,focused);
 input.find(x=>x.id===focused).focused=false;input.find(x=>x.id===focused).pinned=true;
 assert.equal(selector.select(input,{now:4300,limit:1}).items[0].id,'member-1');
});
test('retired members disappear immediately and a new conversation clears retained slots',async()=>{
 const {WorkSelection}=await import('../ui/work-selection.mjs'),selector=new WorkSelection();
 selector.select(members(30),{now:0});
 assert.deepEqual(selector.select([{id:'new',state:'queued'}],{now:1}).items.map(x=>x.id),['new']);
 assert.equal(selector.select([],{now:2}).total,0);selector.clear();
 assert.deepEqual(selector.keys,[]);
});
test('a settled model response cannot hide a still-running tool or an attention state',async()=>{
 const {workPhase}=await import('../ui/work-selection.mjs');
 const item={state:'running',phase:'settled',activity:{items:[{state:'completed'},{state:'running'}]}};
 assert.equal(workPhase(item),'tool');
 assert.equal(workPhase({...item,activity:{items:[{state:'completed'}]}}),'waiting');
 assert.equal(workPhase({...item,state:'waiting_user'}),'waiting_user');
 assert.equal(workPhase({...item,state:'failed'}),'failed');
 assert.equal(workPhase({...item,state:'cancelling'}),'cancelling');
 assert.equal(workPhase({state:'running',phase:'thinking'}),'thinking');
});

test('a group task awaiting its first delta is waiting, not an assistant body',async()=>{
 const {workPhase}=await import('../ui/work-selection.mjs');
 const task={state:'replying',task:'用户交给群主持的任务'};
 assert.equal(workPhase(task),'waiting');
 assert.equal(workPhase({...task,phase:'thinking',thought:'真实思考'}),'thinking');
 assert.equal(workPhase({...task,phase:'body',text:'真实正文'}),'body');
 assert.equal(workPhase({...task,text:'已有正文'}),'body');
});
