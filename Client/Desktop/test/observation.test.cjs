// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: binding; snapshot; settle; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/observation.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createObservationHub,scopedArguments,bindingKey}=require('../host/observation.cjs');
const {railLayout,attachedBounds,fit}=require('../host/extension-layout.cjs');
const binding={task_id:'task-a',agent_id:'agent-a',role:'matrix',generation:1,core_epoch:'epoch-a'};
const snapshot=(patch={})=>({version:1,session_id:'task-a',core_epoch:'epoch-a',revision:1,roles:[{id:'agent-a',role:'matrix',generation:1,state:'running',activity:{items:[],cursor:0}}],live:{matrix:{generation:1,revision:1,phase:'thinking',thought:'正在检查'}},messages:[],...patch});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(read){const {WorkspacePresentation}=await import('../ui/model.mjs');const timers=new Map();let timerId=0;const hub=createObservationHub({read,createPresentation:()=>new WorkspacePresentation(),setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id)});return {hub,timers,async tick(){const [id,fn]=timers.entries().next().value||[];if(fn){timers.delete(id);fn();await settle();}}};}

test('unopened views allocate no poller; two visible consumers share one task read',async()=>{
 let calls=0,resolve;const f=await fixture(()=>{calls++;return new Promise(r=>resolve=r);}),framesA=[],framesB=[];
 f.hub.subscribe('a',binding,v=>framesA.push(v));f.hub.subscribe('b',binding,v=>framesB.push(v));assert.equal(calls,0);assert.equal(f.timers.size,0);
 f.hub.visible('a',true);f.hub.visible('b',true);assert.equal(calls,1);resolve(snapshot());await settle();
 assert.equal(framesA.at(-1).status,'ready');assert.equal(framesB.at(-1).status,'ready');assert.equal(f.timers.size,1);
 f.hub.visible('a',false);f.hub.visible('b',false);assert.equal(f.timers.size,0);f.hub.close();
});
test('hide during a pending read cannot revive polling; reopening keeps task cursor',async()=>{
 const requests=[];let resolve;const f=await fixture(p=>{requests.push(p);return new Promise(r=>resolve=r);});f.hub.subscribe('a',binding,()=>{});f.hub.visible('a',true);f.hub.visible('a',false);
 resolve(snapshot({revision:7,roles:[{id:'agent-a',role:'matrix',generation:1,state:'running',activity:{items:[],cursor:14}}]}));await settle();assert.equal(f.timers.size,0);
 f.hub.visible('a',true);assert.equal(requests.length,2);assert.equal(requests[1].task_id,'task-a');assert.equal(requests[1].activity_cursors.matrix,14);assert.equal(requests[1].revision,7);f.hub.close();resolve(snapshot());await settle();assert.equal(f.timers.size,0);
});
test('epoch or generation changes invalidate old bindings and terminal scope',async()=>{
 let next=snapshot();const frames=[],f=await fixture(async()=>next);f.hub.subscribe('a',binding,v=>frames.push(v));f.hub.visible('a',true);await settle();assert.deepEqual(f.hub.assertScope('a',{}),{task_id:'task-a',agent_id:'agent-a',generation:1});
 next=snapshot({core_epoch:'restarted'});await f.tick();assert.equal(frames.at(-1).status,'stale');assert.throws(()=>f.hub.assertScope('a',{}),/不可读取/);assert.equal(f.timers.size,0);f.hub.close();
 const g=await fixture(async()=>snapshot({roles:[{id:'agent-a',role:'matrix',generation:2,state:'running'}]}));const rows=[];g.hub.subscribe('a',binding,v=>rows.push(v));g.hub.visible('a',true);await settle();assert.equal(rows.at(-1).status,'stale');g.hub.close();
});
test('a completed observation stops snapshot polling without releasing its final frame',async()=>{
 const f=await fixture(async()=>snapshot({roles:[{id:'agent-a',role:'matrix',generation:1,state:'completed'}]}));f.hub.subscribe('a',binding,()=>{});f.hub.visible('a',true);await settle();assert.equal(f.timers.size,0);assert.equal(f.hub.frame('a').snapshot.roles[0].state,'completed');assert.equal(f.hub.counts.subscribers,1);f.hub.close();
});

test('observation process projection includes real plan and executor receipts without borrowing another role plan',async()=>{
 const items=[{id:'plan-call',tool:'update_plan',state:'completed',generation:1,preview:{ok:true,steps:[{id:'a',text:'步骤',status:'completed'}]}},{id:'exec-call',tool:'exec',state:'completed',generation:1,preview:{output:[{type:'text',text:'实际输出'}]}},{id:'wait-call',tool:'wait',state:'failed',generation:1,preview:{ok:false,error:'未完成'}}];
 const value=snapshot({roles:[{id:'agent-a',role:'matrix',generation:1,state:'running',activity:{items,cursor:3}},{id:'worker',role:'execution',generation:1,state:'running',activity:{items:[],cursor:0}}]});
 const f=await fixture(async()=>value);f.hub.subscribe('a',binding,()=>{});f.hub.subscribe('worker',{...binding,role:'execution',agent_id:'worker'},()=>{});f.hub.visible('a',true);f.hub.visible('worker',true);await settle();
 assert.deepEqual(f.hub.frame('a').projection.activities.map(i=>i.id),['plan-call','exec-call','wait-call']);assert.equal(f.hub.frame('worker').projection.plan,null);f.hub.close();
});
test('a delta carrying a previous generation live text never becomes current speech',async()=>{
 const f=await fixture(async()=>snapshot({live:{matrix:{generation:0,revision:4,text:'previous generation'}}}));f.hub.subscribe('a',binding,()=>{});f.hub.visible('a',true);await settle();assert.equal(f.hub.frame('a').snapshot.live.matrix,undefined);f.hub.close();
});
test('terminal arguments are bound to actual task, agent and generation',()=>{
 for(const args of [{task_id:'other'},{agent_id:'other'},{generation:2},{core_epoch:'other'}])assert.throws(()=>scopedArguments(binding,args),/范围已改变/);
 assert.deepEqual(scopedArguments(binding,{offset:120}),{task_id:'task-a',agent_id:'agent-a',generation:1});
 assert.notEqual(bindingKey(binding),bindingKey({...binding,agent_id:'second'}));
});
test('twelve active instances fit at most two columns in a small display and remain in its work area',()=>{
 const area={x:-1366,y:40,width:1366,height:728},owner={x:-1366,y:80,width:1000,height:360};
 const layout=railLayout(owner,area,12);assert.ok(layout.columns<=2);assert.ok(layout.rows*layout.columns>=12);assert.ok(layout.size>=30);assert.ok(layout.bounds.x>=area.x);assert.ok(layout.bounds.y>=area.y);assert.ok(layout.bounds.y+layout.bounds.height<=area.y+area.height);
 const rect=attachedBounds(owner,area);assert.ok(rect.x>=area.x);assert.ok(rect.x+rect.width<=area.x+area.width);assert.deepEqual(fit({x:2000,y:-100,width:840,height:620},area),{x:-840,y:40,width:840,height:620});
});
test('instance catalog preserves distinct helpers and split workspaces without a busy parent',async()=>{
 const {observationEntries}=await import('../ui/observer-model.mjs');const value=snapshot({roles:[{id:'agent-a',role:'matrix',generation:1,state:'completed'}],collaboration:{helpers:Array.from({length:12},(_,i)=>({task_id:'child-'+i,title:'助手'+i,state:'running',generation:1})),splits:[{task_id:'split-a',agent_id:'split-matrix',core_epoch:'split-epoch',state:'running',generation:3}]}});
 const entries=observationEntries(value);assert.equal(entries.length,13);assert.equal(new Set(entries.map(e=>e.key)).size,13);const split=entries.find(e=>e.binding.task_id==='split-a');assert.equal(split.binding.agent_id,'split-matrix');assert.equal(split.binding.core_epoch,'split-epoch');
});
