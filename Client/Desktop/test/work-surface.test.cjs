// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/work-surface.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('retained terminal status distinguishes finished, stopped and empty work',async()=>{
 const {operationStateLabel}=await import('../ui/work-surface.mjs');
 assert.equal(operationStateLabel({state:'completed'}),'已完成');
 assert.equal(operationStateLabel({state:'cancelled'}),'已停止');
 assert.equal(operationStateLabel({state:'running'}),'正在操作');
 assert.equal(operationStateLabel(),'暂无操作');
});

test('projection paths detect crossings between disjoint endpoints without fading coupled neighbors',async()=>{
 const {projectionPathsOverlap:overlap}=await import('../ui/work-surface.mjs'),rect=(x,y,w,h)=>({left:x,right:x+w,top:y,bottom:y+h}),path=(before,after)=>({before,after});
 const a=path(rect(0,0,100,100),rect(200,0,100,100)),b=path(rect(200,0,100,100),rect(0,0,100,100));
 assert.equal(overlap(a,b),true);assert.equal(overlap(b,a),true);
 const left=path(rect(0,0,600,620),rect(0,0,400,170)),neighbor=path(rect(614,0,600,620),rect(414,0,400,170));
 assert.equal(overlap(left,neighbor),false);
 const below=path(rect(614,0,600,620),rect(0,184,400,170));assert.equal(overlap(left,below),true);
 const touching=path(rect(100,0,100,100),rect(300,0,100,100));assert.equal(overlap(a,touching),false);
 const verticalGap=path(rect(200,114,100,100),rect(0,114,100,100));assert.equal(overlap(a,verticalGap),false);
});
test('parallel work combines ordinary tools into one terminal and keeps at most one native visual',async()=>{
 const {workPanels}=await import('../ui/work-surface.mjs');
 const items=[{tool:'terminal',state:'running'},{tool:'apply_patch',state:'completed'},{tool:'view_image',state:'completed'},{tool:'web_search',state:'completed'},{tool:'browser',state:'running'}];
 const panels=workPanels(items);assert.deepEqual(panels.terminal.map(x=>x.tool),['terminal','apply_patch','view_image']);assert.equal(panels.visual,'browser');assert.equal(panels.search.length,1);
 assert.equal(workPanels([...items,{tool:'web_search',state:'running'}]).visual,'web_search');
 assert.equal(workPanels([{tool:'browser',action:'load_tool',state:'completed'}]).visual,'');
});
test('working projection keeps independent terminal, browser and image views and retires stale media',async()=>{
 const {workProjectionGroups}=await import('../ui/work-surface.mjs');
 const item=(id,tool,state='completed',member='eyra')=>({id,tool,state,member,generation:7});
 const calls=[item('t1','terminal'),item('b1','browser'),item('i1','view_image'),item('t2','exec_command','running')];
 const groups=workProjectionGroups('home',calls);
 assert.deepEqual([...groups.values()].map(group=>[group.kind,group.operations.map(i=>i.id)]),[
  ['terminal',['t1','t2']],['browser',['b1']],['image',['i1']],
 ]);
 const more=[...calls,item('t3','terminal'),item('t4','terminal')];
 assert.deepEqual([...workProjectionGroups('home',more).values()].map(group=>group.kind),['terminal']);
 const unrelated=[...calls,...['v1','v2','v3'].map(id=>item(id,'terminal','completed','vaya')),item('plan','update_plan')];
 assert.deepEqual([...workProjectionGroups('home',unrelated).values()].map(group=>group.kind),['terminal','browser','image','terminal','workflow']);
 more[1]={...more[1],state:'running'};
 assert.deepEqual([...workProjectionGroups('home',more).values()].map(group=>group.kind),['terminal','browser']);
 assert.equal([...workProjectionGroups('home',[...more,item('other','terminal','running','cota')]).values()].filter(group=>group.kind==='terminal').length,2);
});
test('Coding flow preserves distinct evidence, continuing a terminal only within its execution sequence',async()=>{
 const {workProjectionGroups}=await import('../ui/work-surface.mjs');
 const item=(id,tool,member='cota',extra={})=>({id,tool,member,state:'completed',generation:2,...extra});
 const calls=[
  item('run','exec_command'),item('index','project','vaya',{action:'read'}),
  item('input','write_stdin'),item('output','read_shell_output'),
  item('search','web_search'),item('search-again','web_search'),
  item('patch','apply_patch'),item('check','terminal'),
 ];
 const groups=[...workProjectionGroups('coding',calls,{flow:true}).values()].sort((a,b)=>a.latest-b.latest);
 assert.deepEqual(groups.map(group=>[group.kind,group.operations.map(op=>op.id)]),[
  ['project',['index']],['terminal',['run','input','output']],['search',['search']],
  ['search',['search-again']],['patch',['patch']],['terminal',['check']],
 ]);
});
test('the Coding transition folds the previous summary and animates the newly selected tool',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../ui/work-surface.mjs'),'utf8');
 const start=source.indexOf(' function transition(change){'),end=source.indexOf(' function dropPane(',start);
 assert.ok(start>=0&&end>start);
 const terminal={key:'shell',visible:true,node:{getBoundingClientRect:()=>({top:160})}};
 const summary={getBoundingClientRect:()=>({top:140})},patch={key:'patch',visible:true,node:{}};
 const animated=[],panes=new Map([['shell',terminal]]),rows=new Map();
 const transition=require('node:vm').runInNewContext(source.slice(start,end)+'\ntransition',{
  flow:true,rows,panes,paintKey:'shell',projection:()=>({key:'patch',nextShown:true,picked:['patch']}),
  paint(){rows.set('shell',summary);panes.delete('shell');panes.set('patch',patch);},
  animateUI(node,frames){animated.push([node,frames.at(0).transform]);},
 });
 transition(()=>{});
 assert.deepEqual(animated,[[summary,'translateY(20px)'],[patch.node,'translateY(8px)']]);
});
test('home work projects only visible receipts owned by the current generation',async()=>{
 const {homeOperations,currentOperation}=await import('../ui/work-surface.mjs');
 const snapshot={roles:[{role:'matrix',id:'owner',generation:3,activity:{items:[
  {id:'old',tool:'terminal',generation:2},{id:'other',agent:'elsewhere',tool:'terminal',generation:3},
  {id:'hidden',tool:'memory',hidden:true,generation:3},{id:'search',tool:'web_search',generation:3,state:'running'},
  {id:'patch',tool:'apply_patch',generation:3,state:'completed'},
 ]}}]};
 const items=homeOperations(snapshot,'Eyra');assert.deepEqual(items.map(i=>i.call_id),['search','patch']);assert.equal(currentOperation(items).tool,'web_search');
 items[0].state='completed';assert.equal(currentOperation(items).tool,'apply_patch');
});
test('home terminal reads bind actual process receipts and reject stale tasks',async()=>{
 const {homeWorkReaders}=await import('../ui/work-surface.mjs');
 let snapshot={session_id:'s1',core_epoch:'e1',roles:[{id:'a1',role:'matrix',generation:2}]},sent=[];
 const api={receipt:async p=>{sent.push(p);return {ok:true,output:JSON.stringify({session_id:17,generation:2})};},terminalRead:async p=>{sent.push(p);return {ok:true,result:{session_id:17,generation:2,output:'actual log',next_offset:10,logged_bytes:10}};}};
 const readers=homeWorkReaders(api,()=>snapshot),args={call_id:'call',generation:2,offset:0};
 const result=await readers.readTerminal(args);assert.equal(result.result.output,'actual log');assert.equal(result.receipt_generation,2);
 assert.deepEqual(sent[1],{task_id:'s1',agent_id:'a1',generation:2,receipt_generation:2,core_epoch:'e1',id:'call',session_id:17,session_generation:2,offset:0});
 snapshot={...snapshot,roles:[{id:'a1',role:'matrix',generation:3}]};await assert.rejects(()=>readers.readTerminal(args),/任务已变化/);assert.equal(sent.length,2);
});
test('pending and rejected terminal calls never invent a process or poll a missing log',async()=>{
 const {homeWorkReaders}=await import('../ui/work-surface.mjs');let pending=true;
 const readers=homeWorkReaders({receipt:async()=>({ok:true,pending,output:'{}'}),terminalRead:async()=>assert.fail('no process exists')},()=>({session_id:'s',core_epoch:'e',roles:[{role:'matrix',id:'a',generation:1}]}));
 assert.deepEqual(await readers.readTerminal({call_id:'c',generation:1}),{pending:true});pending=false;
 assert.deepEqual(await readers.readTerminal({call_id:'c',generation:1}),{ok:true,no_process:true});
});

test('home work retains committed receipts across empty incremental pages and clears the next generation',async()=>{
 const {homeOperations}=await import('../ui/work-surface.mjs'),{WorkspacePresentation}=await import('../ui/model.mjs');
 const view=new WorkspacePresentation(),role={role:'matrix',id:'owner',generation:1,state:'running'},snapshot={session_id:'s',roles:[{...role,activity:{items:[{id:'tool',tool:'browser',action:'load_tool',state:'completed',generation:1,sequence:1}]}}]};
 view.ingest(snapshot);
 const delta={...snapshot,roles:[{...role,activity:{items:[]}}]};view.ingest(delta);
 assert.equal(homeOperations(delta,'Eyra',view.liveActivities('matrix',{process:true,plan:true}))[0].call_id,'tool');
 const next={...delta,roles:[{...role,generation:2,activity:{items:[]}}]};view.ingest(next);
 assert.deepEqual(homeOperations(next,'Eyra',view.liveActivities('matrix',{process:true,plan:true})),[]);
});

test('plans and reports retain their own presentation without opening or duplicating a terminal',async()=>{
 const {workPanels}=await import('../ui/work-surface.mjs');
 const documents=[{tool:'update_plan',state:'completed'},{tool:'report',state:'completed'},{tool:'workspace',action:'report',state:'completed'}];
 assert.deepEqual(workPanels(documents),{terminal:[],visual:'',search:[]});
 const command={tool:'terminal',state:'running'};
 assert.deepEqual(workPanels([...documents,command]).terminal,[command]);
});
