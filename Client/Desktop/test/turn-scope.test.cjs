// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: role; message; snapshot
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/turn-scope.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const role={id:'new-instance',role:'matrix',generation:1,state:'running'};
const message=(id,extra={})=>({id,from:'matrix',to:'user',state:'commentary',generation:1,text:id,agent_id:'old-instance',...extra});
const snapshot=(messages,live={})=>({session_id:'restored',core_epoch:'epoch',roles:[role],messages,live:{matrix:{agent_id:role.id,generation:1,phase:'waiting',new_body:true,...live}}});

test('a fresh submitted reader never imports a completed turn journal before Core accepts it',async()=>{
 const {EyraState}=await import('../ui/eyra-state.mjs'),{WorkTranscript}=await import('../ui/work-transcript.mjs');
 const owner={id:'first',from:'user',to:'matrix',state:'completed',generation:1,agent_id:role.id,text:'first'};
 const oldLive={turn_id:owner.id,body_id:'body-first',phase:'settled',thought:'OLD_THOUGHT',text:'OLD_BODY',body_at:100000,new_body:false,reasoning_history:[{id:'body-first:50',started_at:50}]};
 const completed={...snapshot([owner],oldLive),roles:[{...role,state:'completed'}]};
 const pending={id:'second',from:'user',to:'matrix',state:'queued',text:'second'},state=new EyraState(),journal=new WorkTranscript();
 state.project(completed);
 const update=flow=>journal.update({key:flow.workKey,phase:flow.state,live:flow.live,thought:flow.thought,text:flow.active?flow.body?.full||'':'',briefs:flow.workItems});
 const stale={id:'old-tool',agent:role.id,generation:1,turn_id:owner.id,tool:'terminal',state:'completed',brief:'OLD_TOOL'};
 const waiting=state.project(completed,{pending:[pending],workItems:[stale]});
 assert.equal(waiting.turnID,pending.id);assert.deepEqual(waiting.live,{});assert.deepEqual(update(waiting),[]);
 const queued=state.project({...completed,messages:[owner,pending]},{workItems:[stale]});
 assert.equal(queued.workKey,waiting.workKey);assert.deepEqual(update(queued),[]);
 const accepted={...snapshot([owner,{...pending,state:'delivered',generation:2,agent_id:role.id}],{generation:2,turn_id:pending.id}),roles:[{...role,generation:2}]};
 const active=state.project(accepted,{workItems:[stale]});assert.equal(active.workKey,waiting.workKey);assert.deepEqual(update(active),[]);
 const thinking=state.project({...accepted,live:{matrix:{...accepted.live.matrix,phase:'thinking',body_id:'body-second',thought:'NEW_THOUGHT',reasoning_started_at:200}}},{workItems:[stale]});
 assert.equal(thinking.workKey,waiting.workKey);assert.deepEqual(update(thinking).map(r=>r.text),['NEW_THOUGHT']);
 const supplement={...pending,id:'third',state:'context'};assert.equal(state.project({...accepted,messages:[...accepted.messages,supplement]}).workKey,waiting.workKey,'queued steering preserves the active reader');
});

test('a restored executor cannot project another instance with the same generation',async()=>{
 const {EyraState,roleLive}=await import('../ui/eyra-state.mjs');
 const old=message('old compression prose'),current=message('current progress',{agent_id:role.id});
 const state=new EyraState();
 assert.equal(state.project(snapshot([old])).body,null);
 assert.equal(state.project(snapshot([old,current])).body.full,current.text);
 assert.deepEqual(roleLive(snapshot([],{agent_id:'old-instance',text:'stale body',new_body:false})),{});
 assert.equal(state.project(snapshot([old],{phase:'thinking',thought:'current thought',reasoning_started_at:1000}),{now:1000}).thought,'current thought');
 assert.equal(state.project(snapshot([old],{phase:'body',text:'fresh stream',new_body:false,body_at:2000*1000}),{now:2000}).body.full,'fresh stream');
});

test('legacy prose is bounded by the latest accepted input without removing chat history',async()=>{
 const {messageInTurn}=await import('../ui/turn-scope.mjs'),{chatRounds}=await import('../ui/chat-column.mjs');
 const user={id:'new-user',from:'user',to:'matrix',state:'delivered',generation:1,text:'Ciallo'};
 const old=message('old',{agent_id:undefined,turn_id:'old-user'}),legacy=message('legacy current',{agent_id:undefined,turn_id:user.id});
 const history=message('old final',{state:'completed'}),rows=[old,history,user,legacy];
 assert.equal(messageInTurn(old,role,rows),false);assert.equal(messageInTurn(legacy,role,rows),true);
 assert.equal(messageInTurn(message('unattributed',{agent_id:undefined}),role,rows),false);
 assert.deepEqual(chatRounds(rows,[],{commentary:role}).map(m=>m.id),[history.id,user.id,legacy.id]);
});

test('a supplemental input follows its active reply until the turn settles, without retiring the stream',async()=>{
 const {trailingInputs}=await import('../ui/turn-scope.mjs'),{EyraState}=await import('../ui/eyra-state.mjs');
 const owner={id:'original',from:'user',state:'delivered',generation:1,agent_id:role.id,text:'first'},later={...owner,id:'supplement',text:'second',state:'context'};
 const s=snapshot([owner,later],{body_id:'stream',phase:'body',new_body:false,text:'original reply',body_at:100000});
 const pending={id:'still-local',from:'user',text:'third'};
 assert.deepEqual([...trailingInputs(s.messages,[pending],role)],['supplement','still-local']);
 assert.equal(new EyraState().project(s,{pending:[pending]}).body.full,'original reply');
 later.state='delivered';assert.deepEqual([...trailingInputs(s.messages,[],role)],['supplement']);
});


test('same-generation compaction keeps the old live answer before the newly delivered supplement',async()=>{
 const {trailingInputs}=await import('../ui/turn-scope.mjs'),{EyraState}=await import('../ui/eyra-state.mjs');
 const first={id:'first',from:'user',to:'matrix',state:'delivered',agent_id:role.id,generation:1,text:'original'},second={...first,id:'second',text:'supplement'};
 const old=message('old-body',{agent_id:role.id,turn_id:first.id}),s=snapshot([first,old,second],{turn_id:first.id,body_id:old.id,text:old.text,new_body:false,phase:'compacting'}),state=new EyraState();
 const flow=state.project(s);assert.equal(flow.turnID,first.id);assert.equal(flow.body.full,old.text);assert.deepEqual([...trailingInputs(s.messages,[],role,flow.turnID)],[second.id]);
 s.live.matrix={...s.live.matrix,turn_id:second.id,body_id:'new-body',text:'',new_body:true,phase:'waiting'};
 const next=state.project(s);assert.equal(next.turnID,second.id);assert.equal(next.body,null);assert.deepEqual([...trailingInputs(s.messages,[],role,next.turnID)],[]);
});


test('a completed reply arriving after a queued user message stays beside its own input',async()=>{
 const {chatRounds}=await import('../ui/chat-column.mjs');
 const first={id:'first',from:'user',to:'matrix',generation:1,state:'completed',text:'first'},later={...first,id:'later',generation:0,state:'queued',text:'later'};
 const reply={id:'answer',from:'matrix',to:'user',generation:1,state:'completed',turn_id:first.id,text:'answer to first'};
 assert.deepEqual(chatRounds([first,later,reply],[],{limit:20}).map(m=>m.id),['first','answer','later']);
 assert.deepEqual(chatRounds([first,later,reply],[],{limit:1}).map(m=>m.id),['later']);
});


test('link chronology and team completion cannot undo reply input ownership',async()=>{
 const {orderTurnReplies}=await import('../ui/turn-scope.mjs');
 const base=[{id:'u1',from:'user',text:'first',at:1},{id:'u2',from:'user',text:'second',at:2},{id:'a1',from:'eyra',turnID:'u1',text:'first answer',at:3},{id:'link',from:'eyra',text:'member note',at:4}];
 assert.deepEqual(orderTurnReplies(base).map(m=>m.id),['u1','a1','u2','link']);
});

test('a local send without a receipt stays at the visible tail when Link rows are merged by time',async()=>{
 const {mergeTimed,carryTimes}=await import('../ui/turn-scope.mjs'),{chatRounds}=await import('../ui/chat-column.mjs'),{createConversationPager}=await import('../ui/conversation-pages.mjs');
 const history=[];for(let i=0;i<25;i++){const at=new Date(Date.UTC(2026,10,10,12,i)).toISOString();history.push({id:'u'+i,from:'user',text:'q'+i,at,state:'completed'},{id:'a'+i,from:'matrix',to:'user',text:'a'+i,at,state:'completed'});}
 const link=[{id:'link:1',from:'eyra',text:'工位消息',at:new Date(Date.UTC(2026,10,10,12,10,30)).toISOString()}];
 // Legacy local row (no time) and a stamped one both remain last.
 for(const local of [{id:'new',from:'user',text:'刚发出',state:'queued'},{id:'new',from:'user',text:'刚发出',state:'queued',at:new Date(Date.UTC(2026,10,10,13)).toISOString()}]){
  const rows=mergeTimed(chatRounds(history,[local],{limit:Infinity}),link);
  assert.equal(rows.at(-1).id,'new');assert.equal(rows.findIndex(r=>r.id==='link:1'),rows.findIndex(r=>r.id==='a10')+1);
  const page=createConversationPager().update(rows,'s');assert.equal(page.entries.at(-1).id,'new','the newest send is inside the rendered page');
 }
 assert.deepEqual(carryTimes([{at:''},{at:'2026-11-10T00:00:00Z'},{at:''}]),[0,Date.parse('2026-11-10T00:00:00Z'),Date.parse('2026-11-10T00:00:00Z')]);
});
