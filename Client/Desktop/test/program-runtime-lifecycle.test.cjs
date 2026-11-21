// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: deferred; settle; program; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/program-runtime-lifecycle.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createProgramRuntime}=require('../../../Program/runtime/desktop.cjs');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const settle=()=>new Promise(r=>setImmediate(r));
const program=(id='fixture.notebook')=>({id,name:'Notebook',digest:'version-one',entry:'index.html',files:{'index.html':'<p>Notebook</p>'},mode:'collaborative',operations:[{id:'edit'}]});
function fixture(t,{probe=async()=>false,handle=()=>{},load=async()=>{}}={}){
 const opened=[],shared=new EventEmitter();
 shared.protocol={isProtocolHandled:probe,unhandle(){},handle};shared.setPermissionRequestHandler=()=>{};shared.setPermissionCheckHandler=()=>{};
 class Window extends EventEmitter{
  constructor(){super();this.webContents=new EventEmitter();this.webContents.session=shared;this.webContents.setWindowOpenHandler=()=>{};this.webContents.executeJavaScript=async()=>{this.invoked=true;return '{"saved":true}';};opened.push(this);}
  isDestroyed(){return !!this.dead;}show(){this.shows=(this.shows||0)+1;}
  async loadURL(){await load(this);if(this.dead)throw Error('window destroyed during load');}
  destroy(){this.closes=(this.closes||0)+1;if(this.failClose){this.failClose=false;throw Error('fixture destroy unavailable');}this.dead=true;this.emit('closed');}
 }
 const runtime=createProgramRuntime({BrowserWindow:Window});t.after(()=>runtime.shutdown());return {runtime,opened,shared};
}
test('cancellation while a sandbox is initializing cannot dispatch its queued edit',async t=>{
 const gate=deferred(),started=deferred(),f=fixture(t,{load:async()=>{started.resolve();await gate.promise;}}),cancel=new AbortController();
 const opening=f.runtime.open(program());await started.promise;
 const invoking=f.runtime.invoke(program().id,'edit',{text:'cancelled'},{signal:cancel.signal}).then(value=>({value}),error=>({error}));
 cancel.abort();gate.resolve();await opening;
 assert.equal((await invoking).error?.code,'CANCELLED');assert.equal(f.opened[0].invoked,undefined);
 assert.equal((await f.runtime.invoke(program().id,'edit',{text:'next'})).result.saved,true);
});
test('closing an in-flight sandbox invocation settles unknown promptly and never accepts its old late response',async t=>{
 const f=fixture(t),gate=deferred(),started=deferred();await f.runtime.open(program());
 f.opened[0].webContents.executeJavaScript=async()=>{started.resolve();await gate.promise;return '{"saved":"obsolete"}';};
 let settled;const invoking=f.runtime.invoke(program().id,'edit',{text:'in flight'}).then(value=>{settled=value;return value;});
 await started.promise;f.runtime.close(program().id);
 try{await settle();assert.equal(settled?.state,'unknown');assert.equal(settled?.code,'PROGRAM_RESULT_UNCONFIRMED');}
 finally{gate.resolve();await invoking;}
 await f.runtime.open(program());assert.equal((await f.runtime.invoke(program().id,'edit',{text:'new page'})).result.saved,true);assert.equal(f.runtime.isOpen(program().id),true);
});
test('a sandbox rejecting with null or undefined still reports an unknown dispatched result',async t=>{
 const f=fixture(t);await f.runtime.open(program());
 for(const reason of [null,undefined]){
  f.opened[0].webContents.executeJavaScript=async()=>{throw reason;};
  const result=await f.runtime.invoke(program().id,'edit',{});assert.equal(result.ok,false);assert.equal(result.state,'unknown');assert.equal(result.code,'PROGRAM_RESULT_UNCONFIRMED');assert.equal(result.error,String(reason));
 }
});
test('cancelling after sandbox dispatch preserves the confirmed outcome instead of claiming a rollback',async t=>{
 const f=fixture(t),gate=deferred(),started=deferred(),cancel=new AbortController();await f.runtime.open(program());let effects=0;
 f.opened[0].webContents.executeJavaScript=async()=>{effects++;started.resolve();await gate.promise;return '{"saved":true}';};
 const invoking=f.runtime.invoke(program().id,'edit',{text:'accepted'},{signal:cancel.signal});await started.promise;cancel.abort();gate.resolve();
 assert.equal((await invoking).result.saved,true);assert.equal(effects,1);
});
test('closing one sandbox settles every concurrent dispatched call and leaves the replacement usable',async t=>{
 const f=fixture(t),gate=deferred(),started=deferred();await f.runtime.open(program());let entered=0;
 f.opened[0].webContents.executeJavaScript=async()=>{if(++entered===16)started.resolve();await gate.promise;return '{"saved":"old page"}';};
 const results=[];const pending=Array.from({length:16},(_,n)=>f.runtime.invoke(program().id,'edit',{n}).then(value=>{results.push(value);return value;}));
 await started.promise;f.runtime.close(program().id);
 try{await settle();assert.equal(results.length,16);assert(results.every(value=>value.state==='unknown'&&value.code==='PROGRAM_RESULT_UNCONFIRMED'));}
 finally{gate.resolve();await Promise.all(pending);}
 await f.runtime.open(program());assert.equal((await f.runtime.invoke(program().id,'edit',{})).result.saved,true);
});
for(const phase of ['probe','handle'])test('failed protocol '+phase+' releases its window and permits a fresh sandbox open',async t=>{
 let attempts=0;const hooks={[phase]:()=>{if(++attempts===1)throw Error('protocol fixture failure');return false;}},f=fixture(t,hooks);
 await assert.rejects(f.runtime.open(program()),/protocol fixture failure/);
 assert.equal(f.opened[0].dead,true);assert.deepEqual(f.runtime.active(),[]);assert.equal(f.shared.listenerCount('will-download'),0);
 assert.equal((await f.runtime.open(program())).opened,true);assert.equal(f.opened.length,2);
});
test('concurrent opens and an immediate invoke wait for the same first page load',async t=>{
 const gate=deferred(),started=deferred(),f=fixture(t,{load:async()=>{started.resolve();await gate.promise;}});
 const first=f.runtime.open(program());await started.promise;let reused=false;
 const second=f.runtime.open(program()).then(r=>{reused=true;return r;}),invoking=f.runtime.invoke(program().id,'edit',{text:'latest'});
 try{await settle();assert.equal(reused,false);assert.equal(f.opened[0].invoked,undefined);assert.equal(f.opened[0].shows,undefined);}
 finally{gate.resolve();}
 assert.equal((await first).opened,true);assert.equal((await second).reused,true);assert.equal((await invoking).result.saved,true);assert.equal(f.opened.length,1);
});
test('closing during protocol initialization cancels admission promptly and a late result cannot delete its replacement',async t=>{
 const gate=deferred(),started=deferred();let probes=0;const f=fixture(t,{probe:()=>{if(++probes===1){started.resolve();return gate.promise;}return Promise.resolve(false);}});
 const result=f.runtime.open(program()).then(value=>({value}),error=>({error}));let settled;
 void result.then(value=>{settled=value;});await started.promise;f.runtime.close(program().id);
 try{
  await settle();assert.match(settled?.error?.message||'',/关闭|变化/);
  assert.equal((await f.runtime.open(program())).opened,true);
 }finally{gate.resolve(false);await result;}
 await settle();assert.equal(f.opened[0].shows,undefined);assert.equal(f.runtime.isOpen(program().id),true);assert.equal(f.opened[1].dead,undefined);
});
test('shutdown during a held page load prevents a late show or successful open receipt',async t=>{
 const gate=deferred(),started=deferred(),f=fixture(t,{load:async()=>{started.resolve();await gate.promise;}});
 const result=f.runtime.open(program()).then(value=>({value}),error=>({error}));await started.promise;f.runtime.shutdown();gate.resolve();
 assert.match((await result).error?.message||'',/关闭|变化|destroyed/);assert.equal(f.opened[0].shows,undefined);assert.deepEqual(f.runtime.active(),[]);
 await assert.rejects(f.runtime.open(program()),/已关闭/);
});
test('reopening a persistent sandbox session releases download listeners with each window',async t=>{
 const f=fixture(t);
 for(let n=0;n<4;n++){
  await f.runtime.open(program());assert.equal(f.shared.listenerCount('will-download'),1);
  let prevented=false;f.shared.emit('will-download',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
  f.runtime.close(program().id);assert.equal(f.shared.listenerCount('will-download'),0);
 }
});
test('sandbox shutdown attempts every window, retains a failed close for retry and rejects reopening',async t=>{
 const f=fixture(t);await f.runtime.open(program('fixture.one'));await f.runtime.open(program('fixture.two'));f.opened[0].failClose=true;
 let error;try{f.runtime.shutdown();}catch(value){error=value;}
 assert.equal(f.opened[1].dead,true);assert(error instanceof AggregateError);assert.match(error.errors[0].message,/destroy unavailable/);
 assert.deepEqual(f.runtime.active().map(p=>p.id),['fixture.one']);await assert.rejects(f.runtime.open(program('fixture.three')),/已关闭/);
 f.runtime.shutdown();assert.equal(f.opened[0].dead,true);assert.deepEqual(f.runtime.active(),[]);
});
