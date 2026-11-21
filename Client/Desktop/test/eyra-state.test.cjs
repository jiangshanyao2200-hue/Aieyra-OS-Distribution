// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; at; snapshot; text; storage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/eyra-state.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const at=100000;
const snapshot=(live={},role={},messages=[])=>({core_epoch:'epoch',session_id:'session',roles:[{role:'matrix',id:'matrix',generation:1,state:'running',execution_started:false,...role}],live:{matrix:{generation:1,...live}},messages});
const text=(value='第一段。\n\n最新段落。',extra={})=>({body_id:'body',body_at:at*1000,body_updated_at:at,phase:'body',text:value,...extra});
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),data};};

test('local outbox and uncertain receipts do not pretend the model is running',async()=>{
 const {EyraState}=await import('../ui/eyra-state.mjs'),s=snapshot({}, {state:'completed',execution_started:true}),state=new EyraState();
 for(const [delivery,expected] of [['prepared','confirming'],['pending','confirming']]){
  const flow=state.project(s,{pending:[{id:'local',from:'user',text:'待发正文',delivery}]});assert.equal(flow.state,expected);assert.equal(flow.active,false);assert.equal(flow.compact,false);assert.equal(flow.user.text,'待发正文');
 }
 assert.equal(state.project(snapshot({phase:'thinking'}),{pending:[{delivery:'prepared'}]}).state,'thinking');
});

test('direct memory receipts open work detail without changing execution accounting or reviving old generations',async()=>{
 const {EyraState}=await import('../ui/eyra-state.mjs');
 const s=snapshot({phase:'waiting'}),state=new EyraState();
 const direct=state.project(s,{items:[{generation:1,tool:'memory',state:'completed'}]});assert.equal(direct.mode,'work','a real receipt opens the work form');assert.equal(direct.worked,true);
 assert.equal(s.roles[0].execution_started,false);
 assert.equal(new EyraState().project(s,{items:[{generation:0,tool:'memory',state:'completed'}]}).mode,'chat');
 assert.equal(state.project(snapshot({}, {state:'completed'}),{items:[]}).mode,'chat');
});

test('preparation tools show their real work receipts without requiring execution_started',async()=>{
 const {EyraState}=await import('../ui/eyra-state.mjs');
 for(const tool of ['toolbox','core_link','agents','settings']){
  const s=snapshot({phase:'waiting'}),item={agent:'matrix',generation:1,tool,state:'completed'};
  const shown=new EyraState().project(s,{items:[item]});assert.equal(shown.mode,'work',tool);assert.equal(shown.worked,true,tool);
  assert.equal(s.roles[0].execution_started,false);
  for(const stale of [{...item,hidden:true},{...item,generation:0},{...item,agent:'other'}])assert.equal(new EyraState().project(s,{items:[stale]}).mode,'chat');
 }
});

test('preview never dissolves on a timer: unchanged polls, reload and long idle keep the body',async()=>{
  const {EyraState}=await import('../ui/eyra-state.mjs'),saved=storage(),state=new EyraState({storage:saved});
  const a=snapshot(text());assert.equal(state.project(a,{now:at}).preview.text,'最新段落。');
  assert.equal(state.project(a,{now:at+9999}).preview.full,'第一段。\n\n最新段落。');assert.ok(state.project(a,{now:at+600000}).preview,'ten minutes later the body is still there');
  assert.ok(new EyraState({storage:saved}).project(a,{now:at+11000}).preview,'a reloaded renderer shows the same body');
  const b=snapshot(text('最新正文已更新。',{body_updated_at:at+11000}));
  assert.equal(state.project(b,{now:at+11000}).preview.text,'最新正文已更新。');assert.equal(state.project(b,{now:at+21000}).body.text,'最新正文已更新。');
  assert.equal(saved.data.size,1,'storage stays bounded across generations');
});
test('thinking invalidates old text, including a missed thinking phase and renderer reload',async()=>{
  const {EyraState}=await import('../ui/eyra-state.mjs'),saved=storage(),state=new EyraState({storage:saved});
  const a=snapshot(text());state.project(a,{now:at});
  const thought=snapshot(text('旧正文',{phase:'thinking',reasoning_started_at:at+1000}));
  assert.equal(state.project(thought,{now:at+1000}).preview,null);
  const ended=snapshot({...thought.live.matrix,phase:'waiting',reasoning_started_at:0});
  assert.equal(state.project(ended,{now:at+1200}).preview,null);
  assert.equal(new EyraState({storage:saved}).project(ended,{now:at+1500}).preview,null);
  const missed=new EyraState();missed.project(a,{now:at});
  assert.equal(missed.project(snapshot({...text(),reasoning_history:[{started_at:at+1000,finished_at:at+1200}]}),{now:at+1400}).preview,null);
  const fresh=snapshot(text('新正文',{body_id:'new-body',body_at:(at+2000)*1000,body_updated_at:at+2000,reasoning_history:[{started_at:at+1000}]}));
  assert.equal(state.project(fresh,{now:at+2000}).preview.text,'新正文');
});
test('pending send immediately retires final preview and old generations never leak',async()=>{
  const {EyraState}=await import('../ui/eyra-state.mjs'),saved=storage(),state=new EyraState({storage:saved});
  const message={id:'final',generation:1,from:'matrix',to:'user',state:'answered',text:'正式结尾',at:new Date(at).toISOString()};
  const a=snapshot(text('旧的行进中正文'),{state:'completed'},[message]);
  assert.equal(state.project(a,{now:at}).preview.kind,'final');assert.equal(state.project(a,{now:at}).preview.text,'正式结尾');
  assert.equal(state.project(a,{pending:[{id:'pending',from:'user',text:'下一条'}],now:at+20}).preview,null);
  assert.equal(new EyraState({storage:saved}).project(a,{now:at+30}).preview,null);
  assert.equal(state.project(snapshot(text(),{generation:2},[message]),{now:at+50}).preview,null);
});
test('a supplement awaiting acknowledgement preserves the active stream through polls and reload',async()=>{
 const {EyraState}=await import('../ui/eyra-state.mjs'),saved=storage(),state=new EyraState({storage:saved});
 const first=snapshot(text('正在输出第一段。'),{execution_started:true});
 assert.equal(state.project(first,{now:at}).preview.full,'正在输出第一段。');
 const pending=[{id:'supplement',from:'user',text:'补充要求',delivery:'pending'}];
 const during=state.project(first,{pending,now:at+10});
 assert.equal(during.state,'body');assert.equal(during.preview?.full,'正在输出第一段。');
 assert.equal(during.user.text,'补充要求');
 const next=snapshot(text('正在输出第一段。继续输出。',{body_updated_at:at+20}),{execution_started:true});
 assert.equal(state.project(next,{now:at+20}).preview?.full,next.live.matrix.text);
 assert.equal(new EyraState({storage:saved}).project(next,{now:at+30}).preview?.full,next.live.matrix.text);
});
test('actual receipts or an applied plan open work presentation; queue and tool intent alone do not',async()=>{
  const {EyraState}=await import('../ui/eyra-state.mjs'),state=new EyraState();
  assert.equal(state.project(snapshot({}, {state:'queued'}),{now:at}).compact,false);
  assert.equal(state.project(snapshot({phase:'tool'}),{items:[{generation:1,agent:'matrix',tool:'exec_command',state:'running'}],now:at}).worked,true,'current-generation receipts are visible independently of execution accounting');
  assert.equal(state.project(snapshot({phase:'tool'},{execution_started:true}),{now:at}).worked,true);
  assert.equal(state.project(snapshot({}, {state:'completed',execution_started:false}),{now:at}).compact,false,'a settled task without a preview restores the OS chat surface');
  assert.equal(state.project(snapshot({}, {generation:2}),{now:at}).compact,false);
  assert.equal(state.project(snapshot(),{disconnected:true,now:at}).state,'offline');
  assert.equal(state.project(snapshot({}, {state:'waiting_user'}),{now:at}).state,'waiting_user');
});
test('finished work keeps the final body and restores chat without losing execution evidence',async()=>{
  const {EyraState}=await import('../ui/eyra-state.mjs'),saved=storage(),state=new EyraState({storage:saved});
  state.project(snapshot({}, {execution_started:true}),{now:at});
  const final={id:'delivered',generation:1,from:'matrix',to:'user',state:'answered',text:'已交付。',at:new Date(at+1000).toISOString()};
  const settled=snapshot({}, {state:'completed',execution_started:true},[final]);
  const first=state.project(settled,{now:at+1000});assert.equal(first.compact,false,'settled work returns to the chat form at once');assert.equal(first.preview.kind,'final');assert.equal(first.mode,'chat');
  const later=state.project(settled,{now:at+11000});assert.equal(later.preview.kind,'final','the final body does not dissolve');assert.equal(later.worked,true);
  const reload=new EyraState({storage:saved}).project(settled,{now:at+12000});assert.equal(reload.compact,false);assert.equal(reload.preview.text,'已交付。');
  const planned=new EyraState().project(snapshot({phase:'waiting'},{execution_started:false}),{items:[{generation:1,tool:'update_plan',state:'completed'}],now:at});assert.equal(planned.mode,'work');assert.equal(planned.worked,true,'a plan alone counts as work');
  assert.equal(new EyraState().project(snapshot({phase:'tool'},{execution_started:false}),{items:[{generation:1,tool:'update_plan',state:'running'}],now:at}).mode,'chat','plan intent alone does not');
  const next=state.project(snapshot({}, {generation:2,execution_started:false}),{now:at+13000});assert.equal(next.compact,false);assert.equal(next.worked,false);
});
test('latest paragraph is bounded by Unicode characters and retains short fenced code',async()=>{
  const {latestParagraph}=await import('../ui/eyra-state.mjs');
  assert.deepEqual(latestParagraph('旧段落\n\n🙂'.repeat(700)),{text:'🙂',details:true});
  assert.equal(Array.from(latestParagraph('🙂'.repeat(700)).text).length,521);
  assert.deepEqual(latestParagraph('```js\nconst n=1;\n```'),{text:'```js\nconst n=1;\n```',details:false});
});
test('double click cancels delayed single click, keyboard is immediate and disposal clears timers',async()=>{
  const {bindEyraGesture}=await import('../ui/eyra-state.mjs'),events=new Map(),timers=new Map();let tick=0,serial=0,input=0,history=0;
  const node={addEventListener:(key,cb)=>events.set(key,cb),removeEventListener:key=>events.delete(key)};
  const win={setTimeout:(cb,ms)=>{const id=++serial;timers.set(id,{cb,at:tick+ms});return id;},clearTimeout:id=>timers.delete(id)};
  const advance=ms=>{tick+=ms;for(const [id,t]of timers)if(t.at<=tick){timers.delete(id);t.cb();}};
  const dispose=bindEyraGesture(node,{input:()=>input++,history:()=>history++},win);
  events.get('click')({detail:1});advance(450);assert.equal(input,0);
  events.get('click')({detail:2});events.get('dblclick')({preventDefault(){}});advance(500);assert.equal(history,1);assert.equal(input,0);
  events.get('click')({detail:1});advance(500);assert.equal(input,1);
  events.get('click')({detail:0});assert.equal(input,2);
  events.get('click')({detail:1});dispose();advance(600);assert.equal(input,2);assert.equal(events.size,0);
});
test('a long-running tool keeps the ring in tool state even though the model phase is settled (2026-10-16)',async()=>{
  const {EyraState}=await import('../ui/eyra-state.mjs'),state=new EyraState();
  const settled=snapshot({phase:'settled'},{execution_started:true});
  assert.equal(state.project(settled,{now:at}).state,'waiting','without a running tool the circle waits for the model');
  assert.equal(state.project(settled,{now:at,toolRunning:true}).state,'tool','a running shell keeps the circle working');
  assert.equal(state.project(snapshot(text(),{execution_started:true}),{now:at,toolRunning:true}).state,'body','streaming text still wins');
  assert.equal(state.project(snapshot({phase:'thinking'},{execution_started:true}),{now:at,toolRunning:true}).state,'thinking');
});

test('a later body in the same provider request replaces thought without reviving older text',async()=>{
 const {EyraState}=await import('../ui/eyra-state.mjs'),saved=storage(),state=new EyraState({storage:saved});
 state.project(snapshot(text('请求的第一段。')),{now:at});
 const reasoning=snapshot({body_id:'body',phase:'thinking',text:'',new_body:true,reasoning_started_at:at+1000});
 assert.equal(state.project(reasoning,{now:at+1000}).preview,null);
 const later=snapshot(text('思考后的新正文。',{body_at:(at+2000)*1000,body_updated_at:at+2000,reasoning_history:[{started_at:at+1000,finished_at:at+1500}]}));
 assert.equal(state.project(later,{now:at+2000}).preview?.full,'思考后的新正文。');
 const restored=new EyraState({storage:saved});
 assert.equal(restored.project(later,{now:at+2500}).preview?.full,'思考后的新正文。');
 const stale=snapshot(text('请求的第一段。',{reasoning_history:[{started_at:at+1000,finished_at:at+1500}]}));
 const staleReload=new EyraState({storage:saved});
 assert.equal(staleReload.project(stale,{now:at+2600}).preview,null,'old body timestamps stay below the reasoning boundary');
});
