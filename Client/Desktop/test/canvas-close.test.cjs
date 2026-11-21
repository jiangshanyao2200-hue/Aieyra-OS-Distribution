// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/canvas-close.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
const {createCanvasClose}=require('../../../Program/official/workspace/close.cjs');
test('canvas release waits for its actual page and exact save attempt, and preserves a failed page for retry',async()=>{
 const requests=[],wc={id:42,isDestroyed:()=>false};
 const close=createCanvasClose({contents:()=>wc,broadcast:(channel,p)=>requests.push({channel,...p}),timeoutMs:1000});
 await close.prepare();assert.equal(requests.length,0,'unopened canvas does not create a renderer');
 close.register(wc,true);const first=close.prepare();assert.equal(close.prepare(),first);
 assert.equal(close.preparing(42),true);assert.equal(close.preparing(43),false);
 assert.throws(()=>close.acknowledge({id:43},{id:requests[0].id,ok:true}),/过期/);
 assert.throws(()=>close.acknowledge(wc,{id:'old-attempt',ok:true}),/过期/);
 const failed=assert.rejects(first,/尚未保存/);close.acknowledge(wc,{id:requests[0].id,ok:false});await failed;
 assert.equal(close.preparing(42),false);
 const second=close.prepare();assert.throws(()=>close.acknowledge(wc,{id:requests[0].id,ok:true}),/过期/);
 close.acknowledge(wc,{id:requests[1].id,ok:true});await second;
});
test('an unresponsive canvas cannot authorize release, and a timed out reply cannot complete a later attempt',async()=>{
 const requests=[],wc={id:7,isDestroyed:()=>false};const close=createCanvasClose({contents:()=>wc,broadcast:(_,p)=>requests.push(p),timeoutMs:20});
 close.register(wc,true);await assert.rejects(close.prepare(),/未确认/);
 const next=close.prepare();assert.throws(()=>close.acknowledge(wc,{id:requests[0].id,ok:true}),/过期/);
 close.acknowledge(wc,{id:requests[1].id,ok:true});await next;
 wc.isCrashed=()=>true;await assert.rejects(close.prepare(),/停止响应/);
});

test('navigation invalidates the previous document save and requires a fresh guard even with the same renderer id',async()=>{
 const requests=[],wc={id:7,isDestroyed:()=>false},close=createCanvasClose({contents:()=>wc,broadcast:(_,p)=>requests.push(p),timeoutMs:1000});
 close.register(wc,true);const before=assert.rejects(close.prepare(),/页面已中断/);close.invalidate(wc.id);await before;
 await assert.rejects(close.prepare(),/正在恢复/);assert.throws(()=>close.acknowledge(wc,{id:requests[0].id,ok:true}),/过期/);
 close.register(wc,true);const next=close.prepare();assert.throws(()=>close.acknowledge(wc,{id:requests[0].id,ok:true}),/过期/);
 close.acknowledge(wc,{id:requests[1].id,ok:true});assert.deepEqual(await next,{ok:true});
});
