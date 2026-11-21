// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/tool-projection.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('tool scenes classify existing direct and toolbox envelopes without executing them',async()=>{
 const {projectionKind,projectionIdentity,projectionState}=await import('../../../Tool/presentation/projection.mjs');
 for(const [tool,kind]of Object.entries({terminal:'terminal',exec_command:'terminal',web_search:'search',apply_patch:'patch',project:'project',view_image:'image',image_gen:'image',video_gen:'video',update_plan:'workflow',compact:'workflow',agents:'agents',core_link:'agents',human:'decision',memory:'receipt'}))assert.equal(projectionKind({tool}),kind,tool);
 for(const action of ['load_tool','unload_tool'])assert.equal(projectionKind({tool:'project',action}),'toolbox');
 assert.equal(projectionKind({tool:'toolbox',action:'open',input_preview:{name:'project'}}),'toolbox');
 assert.equal(projectionKind({tool:'toolbox',action:'call',input_preview:JSON.stringify({name:'project'})}),'project');
 for(const action of ['contacts','contact','programs','session_create'])assert.equal(projectionKind({tool:'agents',action}),'contacts');
 assert.equal(projectionKind({tool:'browser',action:'open',input_preview:{url:'http://127.0.0.1/'}}),'browser');
 assert.equal(projectionKind({tool:'custom',preview:{schema:'aieyra.workbox-state/1'}}),'workflow');
 const item={id:'call',agent:'owner',generation:1};const base=projectionIdentity('scope',item);
 for(const [scope,change]of [['other',{}],['scope',{agent:'other'}],['scope',{generation:2}],['scope',{id:'other'}]])assert.notEqual(projectionIdentity(scope,{...item,...change}),base);
 assert.equal(projectionState('interrupted_unknown'),'结果待确认');assert.equal(projectionState('persistence_failed'),'记录未保存');
});
test('home tool overview is capped at twelve while ordinary preview selection retains its six default',async()=>{
 const {WorkSelection}=await import('../ui/work-selection.mjs'),items=Array.from({length:20},(_,i)=>({id:'call'+i,state:'running',updated:i}));
 assert.equal(new WorkSelection().select(items,{limit:99}).items.length,6);
 const tool=new WorkSelection();assert.equal(tool.select(items,{limit:2,ceiling:12,hold:0}).items.length,2);assert.equal(tool.select(items,{limit:99,ceiling:12,hold:0}).items.length,12);
 const selected=tool.select(items.map((x,i)=>({...x,focused:i===0})),{limit:2,ceiling:12,hold:0}).items;assert(selected.some(x=>x.id==='call0'));
});
