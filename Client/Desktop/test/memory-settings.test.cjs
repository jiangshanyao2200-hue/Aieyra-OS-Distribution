// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: deferred; fixture; view
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/memory-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const nodes=new Map();
 const node=()=>({value:'',dataset:{},disabled:false,checked:false,hidden:false,addEventListener(){},replaceChildren(){}});
 const doc={hidden:false,getElementById(id){if(id==='memory-settings')return null;if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
 return {doc,$:id=>doc.getElementById(id)};
}
const view=(revision,text)=>({ok:true,revision,source:'v'+revision,text,session_id:'one',sessions:[{id:'one',title:'Current',versions:1}],message_count:1,auto_memory:false});
test('reopening memory reads current revision before enabling editing and save',async t=>{
 const {setupMemorySettings}=await import('../ui/memory-settings.mjs'),f=fixture(),pending=deferred(),calls=[];
 let reads=0;
 const api={context:async a=>{calls.push(a);if(a.action==='view')return ++reads===1?view(1,'old'):pending.promise;return view(3,a.text);}};
 const c=setupMemorySettings(api,{doc:f.doc});t.after(()=>c.close());await c.open();c.hide();
 const reopening=c.open();assert.equal(f.$('memory-context').readOnly,true);assert.equal(f.$('memory-new').disabled,true);
 pending.resolve(view(2,'new conversation'));await reopening;
 assert.equal(f.$('memory-context').readOnly,false);assert.equal(f.$('memory-context').value,'new conversation');
 f.$('memory-context').value='correction';await f.$('memory-save').onclick();
 assert.equal(calls.at(-1).source,'v2');assert.equal(calls.at(-1).text,'correction');
});
test('reopening preserves an unsaved draft and its original compare-and-swap version',async t=>{
 const {setupMemorySettings}=await import('../ui/memory-settings.mjs'),f=fixture(),calls=[];let reads=0;
 const c=setupMemorySettings({context:async a=>{calls.push(a);if(a.action==='view')return ++reads===1?view(1,'old'):view(2,'new conversation');return {ok:false,error:'version conflict'};}},{doc:f.doc,check:r=>{if(r.ok===false)throw Error(r.error);return r;}});
 t.after(()=>c.close());await c.open();f.$('memory-context').value='my unsaved correction';c.hide();await c.open();
 assert.equal(f.$('memory-context').value,'my unsaved correction');await f.$('memory-save').onclick();
 assert.equal(calls.at(-1).source,'v1');assert.equal(f.$('memory-context').value,'my unsaved correction');assert.match(f.$('memory-status').textContent,/version conflict/);
});
