// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: row; visible
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/activity-view.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Timeline}=require('../renderer/activity-view.js');
const row=(id,sequence,state='completed',revision=sequence)=>({id,sequence,state,revision,tool:'exec_command',title:'Check '+id});
function visible(t,ids,from=100){for(let at=from;at<=from+2000;at+=200)t.advance(at,ids,true);}
test('background time, offscreen work and failures do not disappear',()=>{const t=new Timeline();t.ingest({items:[row('a',1),row('b',2,'failed'),row('c',3,'running')]});for(let at=1;at<10000;at+=200)t.advance(at,['a'],false);assert.equal(t.history().length,0);visible(t,['b','c'],10000);assert.equal(t.history().length,0);visible(t,['a'],13000);assert.deepEqual(t.history().map(r=>r.id),['a']);assert.equal(t.current().length,2);});
test('new completion must be visible; a returned background interval is capped',()=>{const t=new Timeline();t.ingest({items:[row('a',1,'running')]});visible(t,['a']);t.ingest({items:[row('a',1,'completed',2)]});t.advance(60000,['a']);assert.equal(t.history().length,0);visible(t,['a'],60200);assert.equal(t.history().length,1);t.ingest({items:[{...row('a',1,'completed',3),detail:'New outcome'}]});assert.equal(t.history().length,0);});
test('history pagination survives deltas and nested work keeps its parent order',()=>{const t=new Timeline();t.ingest({items:[row('p',2,'running'),{...row('c',4),parent:'p'},{...row('g',5),parent:'c'},row('next',3)],has_older:true,cursor:9,page:'latest'});t.ingest({items:[],has_older:false,cursor:10,page:'delta'});assert.equal(t.hasOlder,true);assert.deepEqual(t.ordered().map(r=>r.id),['p','c','g','next']);t.ingest({items:[row('old',1)],cursor:6,has_older:false,page:'older'});assert.equal(t.cursor,10);assert.equal(t.hasOlder,false);});
test('old async pages cannot revert a completion; folded poll rows are removed',()=>{const t=new Timeline();t.ingest({items:[row('a',1,'completed',5),row('poll',2)]});t.ingest({items:[row('a',1,'running',4),{...row('poll',2,'completed',6),hidden:true}],page:'delta'});assert.equal(t.items.get('a').state,'completed');assert.equal(t.items.has('poll'),false);});

// 用户 2026-10-13 第 12 项：有些工具窗口只写一个工具名，没有说明。每一类都要说清在做什么。
test('every tool family explains itself in its own window instead of showing only a tool name',async()=>{
 const {activityLabel,activityFacts}=await import('../ui/activity.mjs');
 const row=(tool,action,preview)=>({tool,action,state:'completed',key:tool+action,preview});
 const memory=row('memory','read',{rows:new Array(3).fill(0),layer:'deep'});
 assert.match(activityLabel(memory),/读取记忆/);
 assert.deepEqual(activityFacts(memory).map(f=>f.label+'='+f.value),['动作=读取记忆','范围=3 条','层级=deep']);
 const browser=row('browser','open',{url:'https://example.com/a'});
 assert.match(activityLabel(browser),/打开网页/);
 assert.ok(activityFacts(browser).some(f=>f.label==='页面'&&f.value.includes('example.com')));
 const manual={...row('browser','load_tool',{ok:true}),title:'查看页面'};
 assert.equal(activityLabel(manual),'浏览器说明已就绪');assert.deepEqual(activityFacts(manual),[{label:'工具',value:'浏览器'},{label:'动作',value:'准备工具说明'}]);
 const project=row('project','search',{matches:[1,2]});
 project.targets=['src/app.mjs'];
 assert.deepEqual(activityFacts(project).map(f=>f.label),[ '动作','位置','结果' ]);
 assert.equal(activityFacts(project)[1].value,'src/app.mjs');
 const settings=row('settings','update',{patch:{theme:'dark',scale:1}});
 assert.equal(activityFacts(settings).find(f=>f.label==='改动').value,'2 项');
 const toolbox=row('toolbox','load_tool',{open:{browser:true,memory:true}});
 assert.ok(activityFacts(toolbox).some(f=>f.value.includes('浏览器')&&f.value.includes('记忆')));
 // 每一个进通用窗口的工具都要有名字和至少一条说明，不能只剩一个“工具”。
 for(const tool of ['memory','project','browser','settings','workspace','team','computer','tool_factory','exec']){
  const item=row(tool,'read',{});
  assert.ok(!/^工具/.test(activityLabel(item)),tool+' 要有名字');
  assert.equal(activityLabel(item),activityLabel(item));
  assert.ok(Array.isArray(activityFacts(item)),tool+' 要有说明');
 }
});
