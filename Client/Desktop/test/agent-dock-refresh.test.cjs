// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; flush; deferred; modulePromise; loadDock; user; work; page; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/agent-dock-refresh.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {registerHooks}=require('node:module'),{pathToFileURL}=require('node:url');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
let modulePromise;
function loadDock(){
 if(!modulePromise)modulePromise=(async()=>{
  const url=pathToFileURL(require.resolve('../ui/agent-dock.mjs')).href+'?atomic-refresh';
  // Exercise the real pagination/merge controller. Visuals record each paint;
  // browser geometry and animations remain the responsibility of the GUI run.
  const visuals={
   './chat-column.mjs':`export const setupChatColumn=root=>({paint(entries){root.frames.push(entries.slice());root.children=entries.map(e=>({dataset:{id:e.id},querySelector:()=>null}));},visibility(){},clear(){root.children=[];},close(){}});`,
   './attachments.mjs':'export const paintBubbleAttachments=()=>{};',
   '../../../Tool/presentation/receipt-reader.mjs':'export const createReceiptReader=()=>{};',
   './markdown.mjs':'export const renderMarkdown=()=>{};',
  };
  const hooks=registerHooks({resolve(specifier,context,next){return context.parentURL===url&&visuals[specifier]?{url:'data:text/javascript,'+encodeURIComponent(visuals[specifier]),shortCircuit:true}:next(specifier,context);}});
  try{return await import(url);}finally{hooks.deregister();}
 })();
 return modulePromise;
}
const user=id=>({id,sender_id:'user',text:id});
const work=id=>({id,from:'eyra',streaming:true,work:{key:id,thought:'正在调查'}});
const page=(entries=[],extra={})=>({entries,...extra});
async function fixture(t){
 const {createAgentDock}=await loadDock(),requests=[],errors=[],root={children:[],frames:[]};
 const scroller=Object.assign(new EventTarget(),{clientHeight:100,scrollHeight:1000,scrollTop:900});
 const dock=createAgentDock({root,scroller,getProfile:()=>({}),read:(action,args)=>{const request={action,args,...deferred()};requests.push(request);return request.promise;},onError:error=>errors.push(error)});
 t.after(()=>dock.close());
 return {dock,requests,errors,root,scroller,open:id=>dock.open({scope_id:id,kind:'group',core_epoch:'epoch'}),ids:()=>root.frames.at(-1)?.map(e=>e.id)||[]};
}

test('initial busy page cannot expose a work row before its latest user history',async t=>{
 const f=await fixture(t);f.open('a');const refreshed=f.dock.refresh([work('live:a')]);await flush();
 assert.equal(f.requests.length,1);assert.equal(await f.dock.refresh(),false,'plain refresh keeps its existing busy behavior');
 f.requests[0].resolve(page());await flush();
 assert.equal(f.requests.length,2);assert.equal(f.requests[1].args.before,'');assert.deepEqual(f.ids(),[]);
 f.requests[1].resolve(page([user('user:a')]));assert.equal(await refreshed,true);
 assert.deepEqual(f.ids(),['user:a','live:a']);
 assert(f.root.frames.every(frame=>!frame.some(e=>e.id==='live:a')||frame[0]?.id==='user:a'));
});

test('failed latest read retains the previous work and a successful retry commits both rows',async t=>{
 const f=await fixture(t);f.open('a');await flush();f.requests[0].resolve(page([user('user:old')]));await flush();f.dock.live([work('live:old')]);
 const failed=f.dock.refresh([work('live:new')]);await flush();f.requests[1].reject(Error('history unavailable'));
 assert.equal(await failed,false);assert.deepEqual(f.ids(),['user:old','live:old']);assert.match(f.dock.state().error,/history unavailable/);
 const retry=f.dock.refresh([work('live:new')]);await flush();f.requests[2].resolve(page([user('user:new')]));assert.equal(await retry,true);
 assert.deepEqual(f.ids(),['user:old','user:new','live:new']);
 const plain=f.dock.refresh();await flush();f.requests[3].resolve(page());assert.equal(await plain,true);assert.equal(f.ids().at(-1),'live:new','plain refresh preserves live');
});

test('latest refresh waits for an older page and releases automatic fill afterwards',async t=>{
 const f=await fixture(t);f.open('a');await flush();f.requests[0].resolve(page([user('user:current')],{has_more:true,before:'cursor:1'}));await flush();
 const older=f.dock.older();await flush();f.scroller.scrollHeight=100;
 const refreshed=f.dock.refresh([work('live:a')]);f.requests[1].resolve(page([user('user:older')],{has_more:true,before:'cursor:2'}));await older;await flush();
 assert.equal(f.requests[2].args.before,'','automatic older fill must not take the latest request slot');
 f.requests[2].resolve(page([user('user:new')]));assert.equal(await refreshed,true);await flush();
 assert.deepEqual(f.ids(),['user:older','user:current','user:new','live:a']);
 assert.equal(f.requests[3].args.before,'cursor:2','fill resumes after the atomic refresh');
 f.requests[3].resolve(page());await flush();
});

test('switching scope invalidates waiting refresh immediately and late old finally cannot release the new page',async t=>{
 const f=await fixture(t);f.open('a');await flush();const stale=f.dock.refresh([work('live:a')]);f.open('b');
 assert.equal(await stale,false,'old read is still unresolved');await flush();assert.equal(f.requests.length,2);
 f.requests[0].resolve(page([user('user:a')]));await flush();assert.equal(f.dock.state().busy,true);assert.deepEqual(f.ids(),[]);
 f.requests[1].resolve(page([user('user:b')]));await flush();assert.deepEqual(f.ids(),['user:b']);assert.deepEqual(f.errors,[]);
});

test('reset and close release waiting refreshes without adopting their late failures',async t=>{
 const f=await fixture(t);f.open('a');await flush();const reset=f.dock.refresh([work('live:a')]);f.dock.reset();assert.equal(await reset,false);
 f.open('b');await flush();const closed=f.dock.refresh([work('live:b')]);f.dock.close();assert.equal(await closed,false);
 f.requests[0].reject(Error('old reset read'));f.requests[1].reject(Error('old closed read'));await flush();assert.deepEqual(f.errors,[]);assert.deepEqual(f.ids(),[]);
});

test('cursor reset retries latest atomically and an explicit empty live clears only after success',async t=>{
 const f=await fixture(t);f.open('a');await flush();f.requests[0].resolve(page());await flush();
 const refreshed=f.dock.refresh([work('live:a')]);await flush();f.requests[1].resolve({reset:true});await flush();
 assert.equal(f.requests.length,3);assert.equal(f.requests[2].args.before,'');f.requests[2].resolve(page([user('user:a')]));assert.equal(await refreshed,true);assert.deepEqual(f.ids(),['user:a','live:a']);
 const clear=f.dock.refresh([]);await flush();assert.equal(f.ids().at(-1),'live:a');f.requests[3].resolve(page());assert.equal(await clear,true);assert.deepEqual(f.ids(),['user:a']);
});
