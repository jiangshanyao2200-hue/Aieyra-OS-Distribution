// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fs; role; user; reply; frame
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/send-turn-boundary.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const role={role:'matrix',id:'executor',generation:1,state:'completed',execution_started:false};
const user=(id,state='completed',extra={})=>({id,from:'user',to:'matrix',text:id,state,generation:1,agent_id:'executor',...extra});
const reply=(id,extra={})=>({id,from:'matrix',to:'user',text:'HISTORICAL_BODY',state:'completed',generation:1,agent_id:'executor',turn_id:'previous-user',...extra});
const frame=(messages,extra={})=>({session_id:'chat',core_epoch:'core',roles:[role],live:{},messages,...extra});

test('missing historical receipts preserve pending bytes and never poison durable drafts',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../ui/app.mjs'),'utf8');
 const handler=source.slice(source.indexOf('  async function confirmRecovered('),source.indexOf('  async function checkRecovered('));
 const entry={session_id:'old-runtime',request_id:'original',text:'原文\r\n🙂',attachments:[],delivery:'pending'};
 const outbox=new Map([[entry.session_id,[entry]]]);let writes=0,paints=0,accepted=false;
 const context=vm.createContext({api:{sendReceipt:async()=>({ok:true,request_id:entry.request_id,accepted})},check:r=>r,outbox,entry,snapshot:{session_id:'new-runtime',tasks:[]},persistComposer:()=>writes++,durableDraft:{flush:async()=>writes++},recoveredSends:{paint:()=>paints++}});
 vm.runInContext(handler,context);
 assert.equal(await vm.runInContext('confirmRecovered(entry)',context),false);
 assert.strictEqual(outbox.get(entry.session_id)[0],entry);
 assert.equal(entry.delivery,'pending');assert.equal(entry.rejection,undefined);assert.equal(writes,0);assert.equal(paints,0);
 accepted=true;
 assert.equal(await vm.runInContext('confirmRecovered(entry)',context),true);
 assert.equal(outbox.get(entry.session_id).length,0);assert.equal(writes,2);assert.equal(paints,1);
});

test('initial input cannot mistake an unread configuration for missing models',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../ui/app.mjs'),'utf8');
 const handlers=source.slice(source.indexOf('  async function send()'),source.indexOf('  async function confirmQueuedSend('));
 let settings=0;
 const context=vm.createContext({composing:false,switchingTask:false,snapshot:null,asks:null,attachments:{pending:false},crypto:{randomUUID:()=> 'startup-command'},showOnboarding:()=>settings++});
 vm.runInContext(handlers,context);
 await vm.runInContext('send()',context);
 assert.equal(await vm.runInContext('sendCommand("early command")',context),false);
 assert.equal(settings,0,'unread configuration must not navigate away from the composer');
 context.snapshot={ready:false};
 await vm.runInContext('send()',context);
 assert.equal(await vm.runInContext('sendCommand("unconfigured command")',context),false);
 assert.equal(settings,2,'an authoritative missing-model result still opens configuration');
});

test('a durable queued submission retires the old body after the local outbox is acknowledged',async()=>{
 const {EyraState}=await import('../ui/eyra-state.mjs'),state=new EyraState();
 const old=[user('previous-user'),reply('previous-body')];
 assert.equal(state.project(frame(old)).body?.full,'HISTORICAL_BODY');
 const queued=state.project(frame([...old,user('next-user','queued',{generation:0,agent_id:undefined})]));
 assert.equal(queued.body,null,'queued input cannot inherit the completed body');
 assert.equal(queued.state,'confirming');assert.equal(queued.active,false);assert.equal(queued.user.id,'next-user');
});

test('startup without an executor cannot display historical prose after an accepted submission',async()=>{
 const {EyraState}=await import('../ui/eyra-state.mjs');
 const state=new EyraState(),s=frame([user('previous-user'),reply('previous-body'),user('next-user','queued',{generation:0,agent_id:undefined})],{roles:[{role:'matrix',state:'idle'}]});
 assert.equal(state.project(s).body,null);assert.equal(state.project(s).state,'confirming');
});

test('an explicit submitted turn must match even when executor and generation match',async()=>{
 const {messageInTurn}=await import('../ui/turn-scope.mjs'),{EyraState}=await import('../ui/eyra-state.mjs');
 const active={...role,state:'running'},messages=[user('previous-user'),reply('previous-body'),user('next-user','delivered')];
 assert.equal(messageInTurn(messages[1],active,messages),false);
 assert.equal(new EyraState().project(frame(messages,{roles:[active]})).body,null);
 const current=reply('current-body',{text:'CURRENT_BODY',turn_id:'next-user',state:'commentary'});
 assert.equal(new EyraState().project(frame([...messages,current],{roles:[active]})).body?.full,'CURRENT_BODY');
});

test('acknowledging a supplement preserves the actual active body',async()=>{
 const {EyraState}=await import('../ui/eyra-state.mjs');
 const active={...role,state:'running'},messages=[user('previous-user','delivered'),user('supplement','queued',{generation:0,agent_id:undefined})];
 const live={matrix:{agent_id:role.id,generation:1,phase:'body',body_id:'current-stream',new_body:false,text:'CURRENT_BODY'}};
 const result=new EyraState().project(frame(messages,{roles:[active],live}));
 assert.equal(result.state,'body');assert.equal(result.body?.full,'CURRENT_BODY');
});

test('a greeting stays before new submissions when generations restart or are not assigned yet',async()=>{
 const {chatRounds}=await import('../ui/chat-column.mjs');
 const old=[user('previous-user'),reply('previous-body')];
 for(const next of [user('next-user','queued',{generation:0}),user('next-user','delivered'),user('next-user')]){
  const messages=[...old,next],greeting={id:'greeting',text:'PREVIOUS_GREETING',after:1,afterID:'previous-body'};
  assert.deepEqual(chatRounds(messages,[],{greeting}).map(m=>m.id),['previous-user','previous-body','greeting','next-user']);
 }
 const current=user('local-user','queued',{generation:0});
 assert.deepEqual(chatRounds([], [current], {greeting:{id:'greeting',text:'hello',after:0,afterID:''}}).map(m=>m.id),['greeting','local-user']);
});
