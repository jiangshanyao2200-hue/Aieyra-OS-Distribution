// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: user; reply; snapshot
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/conversation-view.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
const user=(n,text='请求'+n)=>({id:'u'+n,from:'user',to:'matrix',generation:n,state:'completed',text});
const reply=n=>({id:'a'+n,from:'matrix',to:'user',generation:n,state:'completed',text:'回复'+n});
const snapshot=(n,messages)=>({core_epoch:'core',session_id:'session',roles:[{id:'matrix',role:'matrix',generation:n}],messages});

test('member result presentation preserves the exact receipt and ordinary text while folding only the matching host tail',async()=>{
 const {linkMessagePresentation}=await import('../ui/chat-column.mjs');
 const from='a'.repeat(32),tail='\n完整结果引用：instance='+from+' generation=3',text='已核对文件。'+tail+'\n这段引用属于正文。'+tail;
 // Core's linkPost hashes the result request before persisting groupMessage.
 const message=Object.freeze({from,sender_generation:3,kind:'result',request:'core-link-b4bbf8cccb9df839d96f1c28692fa99e0c0f5b4e1901ddf256af4988f43f8998',text});
 assert.deepEqual(linkMessagePresentation(message,{history:true}),{text:text.slice(0,-tail.length),receipt:text});assert.equal(message.text,text);
 for(const patch of [{kind:'message'},{request:'user-text'},{request:'result:work-3'},{sender_generation:4},{from:'b'.repeat(32)},{text:text+'\n正文仍在继续。'}]){
  const row={...message,...patch};assert.deepEqual(linkMessagePresentation(row,{history:true}),{text:row.text},'unmatched content is not rewritten');
 }
});

test('live collaboration presents authored Briefs and uses only the actual actor generation',async()=>{
 const {linkMessagePresentation,linkMessageGeneration}=await import('../ui/chat-column.mjs');
 const message={from:'member',to:'mother',sender_generation:7,target_generation:2,text:'FULL_INTERNAL_ORIGINAL',brief:'实际简报',kind:'result'};
 assert.deepEqual(linkMessagePresentation(message),{text:'实际简报',brief:true});
 assert.deepEqual(linkMessagePresentation({...message,brief:''}),{text:'交回协作结果',brief:true});
 assert.equal(linkMessageGeneration(message,'mother'),2);assert.equal(linkMessageGeneration(message,'member'),7);assert.equal(linkMessageGeneration(message,'other'),0);
 assert(!JSON.stringify(linkMessagePresentation(message)).includes(message.text));
});
test('empty startup snapshot has no work boundary before a role exists',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs');
 assert.deepEqual(new ConversationView().project({core_epoch:'core',session_id:'session',roles:[],messages:[],plan:null,plan_scope:null}).rows,[]);
});
test('chat retains multiple rounds, slow thinking and memory are still chat',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs'),v=new ConversationView();
 const s=snapshot(2,[user(1),reply(1),user(2)]);
 for(const turn of ['first','after-long-thought','display:2']){
  const result=v.project(s,{turn,active:true,items:[{tool:'memory',generation:2}]});
  assert.equal(result.mode,'chat');assert.deepEqual(result.rows.map(m=>m.id),['u1','a1','u2']);
 }
 const result=v.project(snapshot(2,[...s.messages,reply(2)]),{current:'a2'});
 assert.deepEqual(result.rows.map(m=>m.id),['u1','a1','u2']);
});
test('actual tool switches work while planning stays chat and completion restores history',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs'),v=new ConversationView();
 const s=snapshot(2,[user(1),reply(1),user(2)]),items=[{tool:'exec_command',generation:2,state:'running'}];
 assert.equal(v.project(s,{turn:'2',active:true,items}).mode,'work');
 assert.equal(v.project(s,{turn:'2:steering',active:true}).mode,'work');
 assert.deepEqual(v.project({...s,messages:[...s.messages,reply(2)]},{items}).rows.map(m=>m.id),['u1','a1','u2','a2']);
 const next=snapshot(3,[...s.messages,reply(2),user(3)]);
 assert.equal(v.project(next,{active:true,items}).mode,'chat');
 assert.deepEqual(v.project(next,{active:true,items}).rows.map(m=>m.id),['u1','a1','u2','a2','u3']);
 assert.equal(v.project(next,{active:true,plan:{generation:3}}).mode,'chat');
});

test('authoritative dispatch separates preparation, nested execution, reload and task scope',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs'),v=new ConversationView();
 const s=snapshot(2,[user(1),reply(1),user(2)]),role=s.roles[0];
 s.plan={status:'active'};s.plan_scope={agent:role.id,generation:2};
 const items=['update_plan','memory','compact','toolbox','exec','wait','team'].map(tool=>({tool,generation:2,state:'running'}));
 items.push({tool:'exec_command',generation:2,state:'queued',started_at:Date.now()*1000});
 assert.equal(v.project(s,{active:true,items,plan:{generation:2}}).mode,'chat');
 role.execution_started=false;
 assert.equal(v.project(s,{active:true,items:[{tool:'exec_command',generation:2,state:'running'}]}).mode,'chat');
 role.execution_started=true;
 assert.equal(v.project(s,{active:true,items:[]}).mode,'work');
 assert.equal(new ConversationView().project(s,{active:true}).mode,'work');
 assert.equal(v.project(s,{active:false}).mode,'chat');
 const other={...s,roles:[{...role,id:'other-task',execution_started:false}]};
 assert.equal(v.project(other,{active:true}).mode,'chat');
 const next={...s,roles:[{...role,generation:3,execution_started:false}]};
 assert.equal(v.project(next,{active:true,items}).mode,'chat');
 assert.equal(new ConversationView().project(s,{active:true,items:[{tool:'exec_command',generation:2,state:'completed'}]}).mode,'work');
 const legacy=snapshot(2,s.messages);
 assert.equal(new ConversationView().project(legacy,{active:true,items:[{tool:'exec_command',agent:'foreign',generation:2,state:'running'}]}).mode,'chat');
 assert.equal(new ConversationView().project(legacy,{active:true,items:[{tool:'exec_command',generation:2,state:'failed',started_at:Date.now()*1000}]}).mode,'chat');
 assert.equal(new ConversationView().project(legacy,{active:true,items:[{tool:'exec_command',generation:2,state:'completed'}]}).mode,'work');
});
test('instant work and reload preserve all retained chat rounds',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs');
 const items=[{tool:'apply_patch',generation:2}],messages=[user(1),reply(1),user(2),reply(2)];
 for(const generation of [2,3]){
  const v=new ConversationView(),s=snapshot(generation,generation===2?messages:[...messages,user(3),reply(3)]);
  assert.deepEqual(v.project(s,{items,current:'a'+generation}).rows.map(m=>m.id),generation===2?['u1','a1','u2']:['u1','a1','u2','a2','u3']);
 }
});
test('pending request appears immediately and epoch changes reset display trim',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs'),v=new ConversationView();
 v.project(snapshot(2,[user(1),reply(1),user(2),reply(2)]),{items:[{tool:'update_plan',generation:2}]});
 const s={...snapshot(1,[user(1)]),core_epoch:'other'};
 assert.deepEqual(v.project(s,{pending:user(2)}).rows.map(m=>m.id),['u1','u2']);
 assert.equal(s.messages.length,1);
});

test('rapid queued additions retain send order across partial acknowledgements',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs'),v=new ConversationView();
 const queued=[user(2,'追加中文 👩🏽‍💻'),user(3,'继续'),user(4,'继续')];
 const before=snapshot(1,[user(1)]);
 assert.deepEqual(v.project(before,{pending:queued}).rows.map(m=>m.id),['u1','u2','u3','u4']);
 const partial=snapshot(1,[user(1),queued[0]]);
 assert.deepEqual(v.project(partial,{pending:queued}).rows.map(m=>m.id),['u1','u2','u3','u4']);
 assert.deepEqual(new ConversationView().project(partial,{pending:queued.slice(1)}).rows.map(m=>m.id),['u1','u2','u3','u4']);
 assert.deepEqual(v.project(snapshot(1,[user(1),...queued]),{pending:queued}).rows.map(m=>m.id),['u1','u2','u3','u4']);
 assert.equal(before.messages.length,1);assert.equal(partial.messages.length,2);
});

test('reload recovers prior work from core receipts when live terminal is empty',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs');
 const {WorkspacePresentation}=await import('../ui/model.mjs');
 const s=snapshot(4,[user(1),reply(1),user(2),reply(2),user(3),reply(3),user(4),reply(4)]);
 s.roles[0].state='completed';s.roles[0].activity={items:[
  {id:'work',tool:'exec_command',generation:2,state:'completed'},
  {id:'memory',tool:'memory',generation:3,state:'completed'},
  {id:'hidden',tool:'write_stdin',generation:3,state:'completed',hidden:true}
 ]};
 const presentation=new WorkspacePresentation();presentation.ingest(s);
 assert.deepEqual(presentation.terminal(),[]);
 const v=new ConversationView();
 assert.deepEqual(v.project(s,{items:presentation.terminal(),current:'a4'}).rows.map(m=>m.id),['u1','a1','u2','a2','u3','a3','u4']);
 const running={...s,roles:[{...s.roles[0],state:'running'}]};
 assert.equal(v.project(running,{active:true}).mode,'chat');
 assert.equal(s.messages.length,8);
});

test('reload can recover a scoped completed plan without older receipts',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs');
 const s={...snapshot(3,[user(1),reply(1),user(2),reply(2),user(3),reply(3)]),plan:{status:'completed'},plan_scope:{agent:'matrix',generation:2}};
 assert.deepEqual(new ConversationView().project(s,{current:'a3'}).rows.map(m=>m.id),['u1','a1','u2','a2','u3']);
 s.plan_scope.agent='other';
 assert.equal(new ConversationView().project(s,{current:'a3'}).rows.length,5);
});

test('sending after cancelled work cannot move the boundary to an unacknowledged request',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs'),v=new ConversationView();
 const s=snapshot(2,[user(1),reply(1),{...user(2),state:'cancelled'}]);
 s.roles[0].activity={items:[{id:'cancelled',tool:'exec_command',generation:2,state:'cancelled'}]};
 v.project(s);
 const pending={id:'u3',from:'user',to:'matrix',state:'queued',text:'下一个请求'};
 assert.deepEqual(v.project(s,{pending}).rows.map(m=>m.id),['u1','a1','u2','u3']);
 const next={...s,messages:[...s.messages,user(3),reply(3)],roles:[{...s.roles[0],generation:3}]};
 const before=v.project(next,{current:'a3'}).rows.map(m=>m.id);
 assert.deepEqual(before,['u1','a1','u2','u3']);
 assert.deepEqual(new ConversationView().project(next,{current:'a3'}).rows.map(m=>m.id),before);
});

test('incremental receipts and an older plan cannot remove chat after cancelled work',async()=>{
 const {ConversationView}=await import('../ui/experience.mjs'),v=new ConversationView();
 const messages=[user(1),reply(1),user(2),reply(2),{...user(3),state:'cancelled'}];
 const plan={status:'complete'},plan_scope={agent:'matrix',generation:2};
 const cancelled={...snapshot(3,messages),plan,plan_scope};
 cancelled.roles[0].activity={items:[{tool:'exec_command',generation:3,state:'cancelled'}]};
 assert.deepEqual(v.project(cancelled).rows.map(m=>m.id),['u1','a1','u2','a2','u3']);
 const next={...snapshot(4,[...messages,user(4),reply(4)]),plan,plan_scope};
 for(const active of [true,false,false]){
  assert.deepEqual(v.project(next,{active,current:'a4'}).rows.map(m=>m.id),['u1','a1','u2','a2','u3','u4']);
 }
 const full={...next,roles:[{...next.roles[0],activity:cancelled.roles[0].activity}]};
 assert.deepEqual(new ConversationView().project(full,{current:'a4'}).rows.map(m=>m.id),['u1','a1','u2','a2','u3','u4']);
});

test('49, 50 and 51 submissions retain complete rounds including cancellation and failure',async()=>{
 const {recentChatMessages}=await import('../ui/experience.mjs');
 for(const n of [49,50,51]){
  const messages=Array.from({length:n},(_,i)=>[ {...user(i+1),state:i===20?'cancelled':i===21?'failed':'completed'},reply(i+1)]).flat();
  const rows=recentChatMessages(messages);
  assert.equal(rows.filter(m=>m.from==='user').length,Math.min(50,n));
  assert.equal(rows[0].id,n===51?'u2':'u1');assert.equal(rows.at(-1).id,'a'+n);
  assert.equal(messages.length,n*2);
 }
});

test('submissions sharing a generation count separately and replies follow explicit turn ids',async()=>{
 const {recentChatMessages}=await import('../ui/experience.mjs');
 const messages=Array.from({length:51},(_,i)=>[{...user(i+1),generation:7},{...reply(i+1),generation:7,turn_id:'u'+(i+1)}]).flat();
 const rows=recentChatMessages(messages);assert.equal(rows.length,100);assert.equal(rows[0].id,'u2');assert.ok(!rows.some(m=>m.id==='a1'));
});

test('long commentary never consumes chat capacity and pending acknowledgements deduplicate after reload',async()=>{
 const {recentChatMessages,ConversationView}=await import('../ui/experience.mjs');
 const messages=Array.from({length:50},(_,i)=>[{...user(i+1),state:'completed'},reply(i+1)]).flat();
 messages.push(...Array.from({length:300},(_,i)=>({...reply(50),id:'c'+i,state:'commentary'})));
 const pending={...user(51),state:'queued'},s=snapshot(50,messages),v=new ConversationView();
 assert.equal(recentChatMessages(messages).length,100);
 const before=v.project(s,{pending:[pending,pending]}).rows;
 assert.equal(before[0].id,'u2');assert.equal(before.filter(m=>m.from==='user').length,50);
 const after=new ConversationView().project({...s,messages:[...messages,pending]},{pending}).rows;
 assert.deepEqual(after,before);assert.equal(messages.length,400);
});

test('outstanding submissions survive the chat window until their actual terminal receipt',async()=>{
 const {recentChatMessages}=await import('../ui/experience.mjs');
 for(const state of ['queued','context','delivered','waiting_human','waiting_user','running','cancelling']){
  const messages=Array.from({length:55},(_,i)=>[user(i+1),{...reply(i+1),turn_id:'u'+(i+1)}]).flat();
  messages[0].state=state;
  const rows=recentChatMessages(messages);
  assert.equal(rows.filter(m=>m.from==='user').length,51,state);assert.deepEqual(rows.slice(0,2).map(m=>m.id),['u1','a1']);
  messages[0].state='cancelled';
  const settled=recentChatMessages(messages);assert.equal(settled[0].id,'u6');assert.equal(settled.length,100);
 }
});
