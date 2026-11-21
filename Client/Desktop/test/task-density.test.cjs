// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/task-density.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('task view rejects delayed results after switching away and back',async()=>{
 const {TaskView}=await import('../ui/task-view.mjs'),v=new TaskView();
 const first=v.select('primary'),child=v.select('child');
 assert.equal(v.accepts(first,{session_id:'primary'}),false);
 assert.equal(v.accepts(child,{session_id:'primary'}),false);
 assert.equal(v.accepts(child,{session_id:'child'}),true);
 const again=v.select('primary');
 assert.equal(v.accepts(first,{session_id:'primary'}),false);
 assert.equal(v.accepts(child),false);assert.equal(v.accepts(again,{session_id:'primary'}),true);
});
test('working prose persists across tool requests without duplicating archived bodies or leaking generations',async()=>{
 const {workingBody}=await import('../ui/experience.mjs');
 const first={id:'a',generation:2,from:'matrix',state:'commentary',text:'先检查文件。'};
 const old={...first,id:'old',generation:1,text:'旧请求内容'};
 assert.equal(workingBody([old],{body_id:'a',text:first.text},2),first.text);
 assert.equal(workingBody([old,first],{body_id:'a',text:first.text},2),first.text);
 assert.equal(workingBody([old,first],{body_id:'b',text:first.text,new_body:true},2),first.text);
 assert.equal(workingBody([old,first],{body_id:'b',text:'检查完成。'},2),'检查完成。');
 assert.equal(workingBody([old,first],{body_id:'c',text:'',new_body:true},3),'');
});
test('thought ribbon advances vertically, holds its end and obeys append/pause/resize',async()=>{
 const {ThoughtRibbon}=await import('../ui/thought-ribbon.mjs'),r=new ThoughtRibbon();let now=0;
 const tick=(overflow=100,opts={})=>r.next(now+=16,overflow,opts);
 for(let i=0;i<100;i++)tick();assert.ok(r.offset>10&&r.offset<40);
 const offset=r.offset;tick(400);assert.ok(r.offset>=offset&&r.offset-offset<1);
 const beforePause=r.offset;for(let i=0;i<300;i++)tick(400,{paused:true});assert.equal(r.offset,beforePause);
 for(let i=0;i<300;i++)tick(400,{reduced:true});assert.equal(r.offset,beforePause);
 tick(10,{paused:true});assert.equal(r.offset,10);
 r.reset();now=0;let reached=false;
 for(let i=0;i<450;i++){const value=tick(50);if(reached)assert.equal(value,50);if(value===50)reached=true;}
 assert.ok(reached);assert.ok(tick(100)>50);assert.equal(tick(0),0);
 r.next(100000,100);assert.ok(r.offset<=2.24,'hidden window time must not jump a whole line');
});
