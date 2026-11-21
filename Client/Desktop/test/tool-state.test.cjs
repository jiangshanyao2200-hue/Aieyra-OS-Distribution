// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/tool-state.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
test('grouped tools preserve missing and unsaved outcomes, including after recovery',async()=>{
 const {groupActivityState:state}=await import('../../../Tool/presentation/state.mjs');
 for(const status of ['interrupted_unknown','persistence_failed','cancelled','timed_out','interrupted']){const group=state([{id:'done',state:'completed'},{id:'unsettled',state:status}]);assert.equal(group.state,status);assert.equal(group.failed,true);}
 assert.equal(state([{id:'unknown',state:'future_status'}]).state,'unknown');assert.equal(state([]).state,'unknown');assert.equal(state([{id:'a',state:'completed'}]).failed,false);
 assert.equal(state([{id:'a',state:'running',session_id:7},{id:'wait',state:'running',session_id:7},{state:'interrupted_unknown'}]).live,1);
 assert.equal(state([{state:'completed',preview:{ok:false}}]).state,'failed');
});
test('browser details retain typed script results, tabs and safe execution input',async()=>{
 const {activityDetails}=await import('../ui/activity.mjs');
 for(const value of [false,0,null,{success:true,items:[1,2]}]){const parts=activityDetails({tool:'browser',action:'evaluate',state:'completed',input_preview:{script:'return value'},preview:{value}});assert(parts.some(s=>s.label==='执行脚本'&&s.text==='return value'));assert(parts.some(s=>s.label==='脚本结果'&&s.text===JSON.stringify(value,null,2)));}
 const tabs=activityDetails({tool:'browser',action:'tabs',preview:{tabs:[{title:'工作页',url:'https://example.test',active:true}]}});assert(tabs.some(s=>s.text.includes('工作页')&&s.text.includes('https://example.test')));
 const fill=preview=>activityDetails({tool:'browser',action:'fill',input_preview:{value:'secret'},preview});assert(!JSON.stringify(fill({})).includes('secret'));assert(!JSON.stringify(fill({input_sensitive:true})).includes('secret'));assert(JSON.stringify(fill({input_sensitive:false})).includes('secret'));
});
