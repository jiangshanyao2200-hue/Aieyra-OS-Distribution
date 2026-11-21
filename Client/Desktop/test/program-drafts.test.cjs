// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/program-drafts.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProgramDrafts}=require('../host/program-drafts.cjs');
test('program retirement waits for current page drafts and rejects foreign, old and failed confirmations',async()=>{
 const events=[],page={send:(channel,p)=>events.push({channel,...p}),isDestroyed:()=>false};let current=page;
 const drafts=createProgramDrafts({contents:()=>current,timeoutMs:1000});
 const first=drafts.prepare();assert.equal(drafts.prepare(),first);
 assert.equal(drafts.preparing(page),true);assert.throws(()=>drafts.acknowledge({},events[0]),/过期/);
 const failed=assert.rejects(first,/尚未保存/);drafts.acknowledge(page,{id:events[0].id,ok:false});await failed;
 const next=drafts.prepare();assert.throws(()=>drafts.acknowledge(page,{id:events[0].id,ok:true}),/过期/);
 current={...page};assert.throws(()=>drafts.acknowledge(page,{id:events[1].id,ok:true}),/过期/);current=page;
 drafts.acknowledge(page,{id:events[1].id,ok:true});await next;
 current=null;await drafts.prepare();assert.equal(events.length,2);
});
test('unresponsive project preserves the page and late acknowledgements cannot confirm a retry',async()=>{
 const events=[],page={send:(_,p)=>events.push(p),isDestroyed:()=>false};
 const drafts=createProgramDrafts({contents:()=>page,timeoutMs:20});await assert.rejects(drafts.prepare(),/未确认/);
 const retry=drafts.prepare();assert.throws(()=>drafts.acknowledge(page,{id:events[0].id,ok:true}),/过期/);
 drafts.acknowledge(page,{id:events[1].id,ok:true});await retry;page.isCrashed=()=>true;await assert.rejects(drafts.prepare(),/停止响应/);
});
