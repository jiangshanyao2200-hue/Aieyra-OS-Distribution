// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; text; snapshot; deferred; flush; fixture; pollingFixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/failure-notice.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,randomUUID,createHash}=require('node:crypto');

const text='服务暂时不可用。\n错误码：provider_unavailable\n原始错误：server_error overloaded';
const snapshot=(extra={})=>({core_epoch:'process-1',session_id:'session-1',documents:[],roles:[{role:'matrix',id:'agent-1',generation:3,state:'failed',failure:{code:'provider_unavailable'}}],...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture({notice,id,date=Date}={}){
 const helpers=await import('../ui/failure-notice.mjs'),nodes=new Map(),paints=[],calls=[],stateCalls=[],timers=new Map();let serial=0,actions;
 const node=()=>({hidden:true,setAttribute(){},addEventListener(){},dataset:{},style:{setProperty(){}}});
 const document={getElementById(name){if(!nodes.has(name))nodes.set(name,node());return nodes.get(name);},addEventListener(){},dispatchEvent(){}};
 const api={notice:request=>{calls.push({...request});return notice?notice(request):Promise.resolve({document:{id:request.id,kind:'system',format:'md',revision:0}});},documentState:async request=>{stateCalls.push({...request});return {document:{id:request.id,kind:'system',format:'md',revision:request.expected_revision+1,read:true,...(request.action==='close'?{dismissed:true,pinned:false}:{})}};}};
 const context={...helpers,document,window:{addEventListener(){}},reportAppearance:()=>({'--report-left-room':'168px'}),crypto:{randomUUID},console,Date:date,Promise,Map,Set,Number,String,Boolean,JSON,Math,Object,Array,
  CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
  setupSystemNotices(options){actions=options;return {paint(scope,docs){paints.push({scope,docs:structuredClone(docs)});}};},
  failureNoticeID:id||(key=>helpers.failureNoticeID(key,webcrypto)),
  setTimeout(fn,delay){timers.set(++serial,{fn,delay});return serial;},clearTimeout(timer){timers.delete(timer);}
 };
 const redaction=fs.readFileSync(path.join(__dirname,'../ui/system-notices.mjs'),'utf8').split('export function noticeFailureText')[0].replace(/^import[^\n]+\r?\n/gm,'').replace(/^export /gm,'');
 vm.runInNewContext(redaction,context,{filename:'system-notices.mjs'});
 const source=fs.readFileSync(path.join(__dirname,'../ui/reports.mjs'),'utf8')
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm,'').replace(/^export \{[\s\S]*?\};\r?\n/gm,'').replace(/^export /gm,'');
 vm.runInNewContext(source,context,{filename:'reports.mjs'});
 const reports=context.setupReports(api,value=>{if(value?.ok===false)throw Error(value.error?.message||value.error||'操作未成功');return value;},()=>{},null);
 const key=helpers.failureNoticeKey;
 return {reports,key,calls,stateCalls,timers,paints,get actions(){return actions;},docs(){return paints.at(-1)?.docs||[];},emit(next=snapshot()){reports.paint(next);return reports.notice(text,true,{quiet:true,eventKey:key(next,text)});}};
}

test('failure identity persists across renderer/Core restart and separates session, instance, generation and error',async()=>{
 const {failureNoticeKey:key,failureNoticeID:id}=await import('../ui/failure-notice.mjs'),base=snapshot(),event=key(base,text);
 assert.equal(key({...base,core_epoch:'restarted'},text),event);
 const result=await id(event,webcrypto);assert.match(result,/^[a-f0-9]{32}$/);
 assert.equal(result,createHash('sha256').update(event).digest('hex').slice(0,32));
 for(const changed of [snapshot({session_id:'session-2'}),snapshot({roles:[{...base.roles[0],id:'agent-2'}]}),snapshot({roles:[{...base.roles[0],generation:4}]}),snapshot({roles:[{...base.roles[0],failure:{code:'timeout'}}]})])assert.notEqual(await id(key(changed,text),webcrypto),result);
 assert.notEqual(await id(key(base,text+' changed'),webcrypto),result);
 assert.equal(key(base,'  '+text+'  '),event);
});

test('incomplete event identities never fall back to a random persistent failure notice',async()=>{
 const {failureNoticeKey:key}=await import('../ui/failure-notice.mjs'),base=snapshot();
 for(const next of [{},snapshot({session_id:''}),snapshot({roles:[]}),snapshot({roles:[{...base.roles[0],id:''}]}),...[-1,1.5,NaN,undefined,'3'].map(generation=>snapshot({roles:[{...base.roles[0],generation}]}))])assert.equal(key(next,text),'');
 assert.equal(key(base,''),'');assert.ok(key(snapshot({roles:[{...base.roles[0],generation:0}]}),text));
});

test('repaint and renderer recreation reuse one durable ID while a following generation gets its own event',async()=>{
 const saved=new Map(),write=async request=>{if(!saved.has(request.id))saved.set(request.id,{id:request.id,kind:'system',format:'md',revision:0});return {document:saved.get(request.id)};};
 const f=await fixture({notice:write}),base=snapshot();await f.emit(base);await flush();
 for(let i=0;i<4;i++)await f.emit(base);
 assert.equal(f.calls.length,1);assert.equal(saved.size,1);
 const reopened=await fixture({notice:write});await reopened.emit({...base,core_epoch:'process-2'});await flush();
 assert.equal(reopened.calls[0].id,f.calls[0].id);assert.equal(saved.size,1);
 await f.emit({...base,roles:[{...base.roles[0],generation:4}]});await flush();
 assert.equal(saved.size,2);assert.notEqual(f.calls[0].id,f.calls[1].id);
});

test('concurrent paints share the same pending event before its ID is ready',async()=>{
 const pending=deferred(),f=await fixture({id:()=>pending.promise}),base=snapshot();
 const first=f.emit(base);for(let i=0;i<5;i++)void f.emit(base);
 assert.equal(f.calls.length,0);pending.resolve('a'.repeat(32));await first;await flush();assert.equal(f.calls.length,1);
});

test('a snapshot containing a dismissed or read failure is kept intact without a new save',async()=>{
 const helpers=await import('../ui/failure-notice.mjs'),base=snapshot(),id=await helpers.failureNoticeID(helpers.failureNoticeKey(base,text),webcrypto);
 for(const state of [{read:true},{read:true,dismissed:true,pinned:false}]){
  const doc={id,kind:'system',format:'md',revision:5,...state},f=await fixture();await f.emit({...base,documents:[doc]});await flush();
  assert.equal(f.calls.length,0);assert.deepEqual(f.docs()[0],doc);
 }
});

test('an existing Core failure returned after an incomplete snapshot is never optimistically resurrected',async()=>{
 const pending=deferred(),f=await fixture({notice:()=>pending.promise});await f.emit();await flush();
 assert.equal(f.calls.length,1);assert.equal(f.docs().length,0,'no unread placeholder before Core confirms visibility');
 const saved={id:f.calls[0].id,kind:'system',format:'md',revision:6,read:true,dismissed:true,pinned:false};
 pending.resolve({document:saved});await flush();assert.deepEqual(f.docs()[0],saved);assert.equal(f.stateCalls.length,0);
 f.reports.paint(snapshot());assert.deepEqual(f.docs()[0],saved,'a lagging snapshot cannot reopen the saved event');
});

test('generic notice responses preserve authoritative read/dismissed state when there was no local action',async()=>{
 const f=await fixture({notice:async request=>({document:{id:request.id,kind:'system',format:'md',revision:4,read:true,dismissed:true,pinned:false}})});
 f.reports.paint(snapshot());f.reports.notice('a retry of a host error',true,{quiet:true});await flush();
 assert.equal(f.docs()[0].read,true);assert.equal(f.docs()[0].dismissed,true);assert.equal(f.docs()[0].pinned,false);assert.equal(f.stateCalls.length,0);
});

test('a real local dismiss during a pending generic save still persists after the response',async()=>{
 const pending=deferred(),f=await fixture({notice:()=>pending.promise});f.reports.paint(snapshot());f.reports.notice('host error',true,{quiet:true});
 const id=f.calls[0].id;assert.equal(await f.actions.dismiss(id),true);assert.equal(f.docs()[0].dismissed,true);
 pending.resolve({document:{id,kind:'system',format:'md',revision:2}});await flush();
 assert.equal(f.stateCalls.length,1);assert.equal(f.stateCalls[0].action,'close');assert.equal(f.stateCalls[0].expected_revision,2);
 assert.equal(f.docs()[0].dismissed,true);assert.equal(f.docs()[0].read,true);
});

test('a late identity computation cannot publish across a scope switch, including A to B to A',async()=>{
 for(const returnToA of [false,true]){
  const pending=deferred(),f=await fixture({id:()=>pending.promise}),base=snapshot(),started=f.emit(base);
  f.reports.paint(snapshot({session_id:'session-2'}));if(returnToA)f.reports.paint(base);
  pending.resolve('b'.repeat(32));await started;await flush();assert.equal(f.calls.length,0);assert.equal(f.docs().length,0);assert.equal(f.timers.size,0);
 }
});

test('late save responses cannot paint or reschedule a notice in a later scope revision',async()=>{
 for(const failed of [false,true]){
  const pending=deferred(),f=await fixture({notice:()=>pending.promise}),base=snapshot();await f.emit(base);await flush();const id=f.calls[0].id;
  f.reports.paint(snapshot({session_id:'session-2'}));f.reports.paint(base);const count=f.paints.length;
  failed?pending.reject(Error('old scope disconnected')):pending.resolve({document:{id,kind:'system',format:'md',revision:0}});
  await flush();assert.equal(f.paints.length,count);assert.equal(f.docs().length,0);assert.equal(f.timers.size,0);assert.equal(f.calls.length,1);
 }
});

test('a transient save retry keeps the original stable ID and task instead of creating a second event',async()=>{
 let attempts=0,clock=Date.now();class TestDate extends Date{static now(){return clock;}}
 const f=await fixture({date:TestDate,notice:async request=>{if(++attempts===1)throw Error('temporary transport failure');return {document:{id:request.id,kind:'system',format:'md',revision:0}};}});
 await f.emit();await flush();assert.equal(f.calls.length,1);assert.equal(f.timers.size,1);
 // Trigger the scheduled retry with its real entry now due, without a wall-clock sleep.
 const [[timer,{fn,delay}]]=f.timers;assert.equal(delay,4000);f.timers.delete(timer);
 clock+=5000;fn();await flush();
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.docs().length,1);assert.equal(f.timers.size,0);
});

async function pollingFixture({initial=snapshot()}={}){
 const helpers=await import('../ui/failure-notice.mjs'),f=await fixture(),nodes=new Map(),notices=[],pending=[],timers=new Map();let next=Error('Core unavailable'),serial=0;
 if(initial)f.reports.paint(initial);
 const context={snapshot:initial,closed:false,readsPaused:false,readEpoch:0,polling:false,pollTimer:0,cursor:0,activityCursors:{},liveCursors:{},disconnected:false,anchorSignature:'',
  snapshotReadFailure:helpers.createReadFailureTracker('workspace-snapshot'),
  taskView:{id:'session-1',epoch:0,ticket(){return {id:this.id,epoch:this.epoch};},accepts(ticket){return ticket.id===this.id&&ticket.epoch===this.epoch;}},
  api:{async snapshot(){if(next instanceof Error)throw next;return next;}},check:value=>value,
  accept(value){context.snapshot=value;f.reports.paint(value);},desktop:{update(){}},
  document:{hidden:false,body:{dataset:{}}},$(name){if(!nodes.has(name))nodes.set(name,{hidden:false,dataset:{},classList:{add(){}}});return nodes.get(name);},
  notice(value,error,options){notices.push({value,error,options});const p=f.reports.notice(value,error,{...options,quiet:true});pending.push(p);return p;},
  setTimeout(fn,delay){timers.set(++serial,{fn,delay});return serial;},clearTimeout(id){timers.delete(id);},Promise
 };
 const source=fs.readFileSync(path.join(__dirname,'../ui/app.mjs'),'utf8');
 vm.runInNewContext(source.slice(source.indexOf('  let refreshInFlight = null;'),source.indexOf('  async function switchTask'))+'\n'+source.slice(source.indexOf('  async function poll()'),source.indexOf('  async function send()')),context,{filename:'app.mjs'});
 return {...f,context,notices,timers,setNext:value=>{next=value;},async poll(){await context.poll();await Promise.all(pending.splice(0));await flush();}};
}

test('actual snapshot polling records one sustained outage beyond 60 seconds, then new recovery and error events',async()=>{
 const f=await pollingFixture(),originalNow=Date.now;let now=originalNow();Date.now=()=>now;
 try{
  await f.poll();assert.equal(f.calls.length,1);const first=f.calls[0].id;
  for(let i=0;i<4;i++){now+=65000;await f.poll();}
  assert.equal(f.calls.length,1);assert.equal(f.notices.length,1);
  f.setNext(snapshot());await f.poll();
  f.setNext(Error('Core unavailable'));await f.poll();
  assert.equal(f.calls.length,2);assert.notEqual(f.calls[1].id,first,'a second real outage is recorded inside the generic 60-second window');
  f.setNext(Error('Core response is invalid'));await f.poll();assert.equal(f.calls.length,3);
  await f.poll();assert.equal(f.calls.length,3);
  f.context.taskView.id='session-2';await f.poll();assert.equal(f.calls.length,4,'a different read scope is independently visible');
 }finally{Date.now=originalNow;}
});

test('startup read failures remain visible before a report scope exists',async()=>{
 const f=await pollingFixture({initial:null});await f.poll();await f.poll();
 assert.equal(f.notices.length,1);assert.equal(f.notices[0].options,undefined);assert.equal(f.docs().length,1);assert.equal(f.docs()[0].content,'Core unavailable');
});

test('a late snapshot during suspension cannot end an outage or create a new false recovery notice',async()=>{
 const f=await pollingFixture();await f.poll();const response=deferred();f.setNext(response.promise);
 const polling=f.context.poll();f.context.readsPaused=true;f.context.readEpoch++;response.resolve(snapshot());await polling;
 f.context.readsPaused=false;f.setNext(Error('Core unavailable'));await f.poll();
 assert.equal(f.calls.length,1);assert.equal(f.notices.length,1);
});

test('notification summaries enforce the Core UTF8 budget without replacing intact Chinese or emoji',async()=>{
 const {summarizeNoticeText:summarize,NOTICE_MAX_BYTES:limit}=await import('../ui/failure-notice.mjs');
 for(const text of ['x'.repeat(limit),'中'.repeat(5461),'🙂'.repeat(4096)])assert.equal(summarize(text),text);
 for(const text of ['中🙂'.repeat(5000),'x'.repeat(limit-1)+'🙂','🙂'.repeat(4097)]){
  const summary=summarize(text,'本轮任务的“查看错误详情”');
  assert.ok(Buffer.byteLength(summary)<=limit);assert.ok(!summary.includes('\ufffd'));assert.ok(summary.startsWith(Array.from(text)[0]));
  assert.match(summary,/系统信息已保留摘要/);assert.match(summary,/查看错误详情/);assert.match(summary,new RegExp('原文 '+Buffer.byteLength(text)+' 字节'));
 }
});

test('long Agent failures persist a bounded redacted summary and keep full-text event identities',async()=>{
 const f=await fixture({notice:async request=>{
  assert.ok(Buffer.byteLength(request.text)<=16384,'the real Core limit is a byte limit');
  return {document:{id:request.id,kind:'system',format:'md',revision:0}};
 }}),base=snapshot(),original='上游服务暂时不可用\n错误码：provider_unavailable\napi_key="fixture-value-not-a-real-credential"\n原始错误：'+'中🙂'.repeat(5000);
 f.reports.paint(base);
 for(const content of [original,original+' distinct error']){await f.reports.notice(content,true,{quiet:true,eventKey:f.key(base,content)});await flush();}
 assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].id,f.calls[1].id,'equal retained prefixes must not merge different errors');assert.equal(f.timers.size,0);
 for(const call of f.calls){assert.match(call.text,/provider_unavailable/);assert.match(call.text,/查看错误详情/);assert.ok(!call.text.includes('fixture-value-not-a-real-credential'));assert.ok(!call.text.includes('\ufffd'));}
 assert.ok(original.endsWith('中🙂'.repeat(5000)),'the full source error has not been mutated');
});

test('long host errors also respect the byte limit and redact credentials before truncating',async()=>{
 const f=await fixture(),secret='sk-private-test-'+ 'a'.repeat(600),original='状态读取错误\n'+'中🙂'.repeat(2200)+'\napi_key="'+secret+'"\n'+'尾'.repeat(3000);
 f.reports.paint(snapshot());f.reports.notice(original,true,{quiet:true});await flush();
 assert.equal(f.calls.length,1);assert.ok(Buffer.byteLength(f.calls[0].text)<=16384);assert.match(f.calls[0].text,/完整错误提示/);assert.ok(!f.calls[0].text.includes('sk-private-test'));assert.equal(f.timers.size,0);
});

test('permanent notice rejections stop retrying while leaving the failure readable and explicitly unsaved',async()=>{
 for(const failure of [Error('invalid notice'),Error('Error invoking remote method: Error: invalid notice'),{ok:false,code:'invalid_params',error:'invalid parameters'},{ok:false,error:{code:-32602,message:'bad arguments'}},Object.assign(Error('rejected'),{retryable:false}),Error('信息编号已用于不同内容')]){
  const f=await fixture({notice:async()=>{if(failure.ok===false)return failure;throw failure;}});await f.emit();await flush();
  assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);assert.equal(f.docs().length,1);assert.match(f.docs()[0].title,/尚未保存/);
  const loaded=await f.actions.load(f.docs()[0]);assert.match(loaded.content,/provider_unavailable/);assert.match(loaded.content,/仅在当前窗口保留/);
  for(let i=0;i<3;i++){f.reports.paint(snapshot());await f.emit();await flush();}
  assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
 }
});

test('only definite payload errors are permanent; storage, permission and transport errors keep retrying',async()=>{
 const {isPermanentNoticeError:permanent}=await import('../ui/failure-notice.mjs');
 for(const error of [Error('invalid notice response from proxy'),Error('temporary transport failure'),Error('另一窗口正在保存信息，请稍后重试'),Error('EACCES: permission denied'),{code:'ETIMEDOUT'},null])assert.equal(permanent(error),false);
 for(const error of [{code:-32600},{code:'payload_too_large'},Error('请求内容过大')])assert.equal(permanent(error),true);
});

test('an invalid notice does not block another notice from recovering with the same original ID',async()=>{
 let hostAttempts=0;const f=await fixture({notice:async request=>{
  if(request.text===text)throw Error('invalid notice');
  if(++hostAttempts===1)throw Error('temporary disconnect');
  return {document:{id:request.id,kind:'system',format:'md',revision:0}};
 }});await f.emit();await flush();f.reports.notice('another host failure',true,{quiet:true});await flush();
 assert.equal(f.timers.size,1);const [[timer,{fn}]]=f.timers;f.timers.delete(timer);
 const originalNow=Date.now;Date.now=()=>originalNow()+5000;
 try{fn();await flush();}finally{Date.now=originalNow;}
 assert.equal(f.calls.filter(c=>c.text===text).length,1);const hostCalls=f.calls.filter(c=>c.text==='another host failure');assert.equal(hostCalls.length,2);assert.equal(hostCalls[0].id,hostCalls[1].id);assert.equal(f.timers.size,0);
});
