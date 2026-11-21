// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; flush; deferred; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/coding-live-order.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function fixture(){
 const source=fs.readFileSync(require.resolve('../../../Program/official/coding/ui/coding.mjs'),'utf8');
 // Run the production poll function without mounting the IDE or starting timers.
 const start=source.indexOf('async function tick(){'),end=source.indexOf('const stopVisibility=',start);
 assert(start>=0&&end>start);
 const reads=[],refreshes=[],live=[],delays=[],presentations=[],projected=[],status={binding:{scope_id:'scope',host_session_id:'host',project_key:'project'},group:{seq:7,members:[]}},terminal={scope_id:'scope',project_key:'project',core_epoch:'epoch'};
 const context={closed:false,visible:true,document:{hidden:false,body:{style:{}}},polling:false,again:false,timer:0,ticket:0,lastSeq:-1,avatars:new Map(),terminalScope:JSON.stringify(['scope','project','epoch']),lastError:'',chatRefresh:null,
  clearTimeout(){},setTimeout(_fn,delay){delays.push(delay);return delays.length;},read:async(action,args)=>{if(action==='status'){reads.push(args);return status;}assert.equal(action,'terminal');return terminal;},
  chatLayer:{scope(){},presented:options=>presentations.push(options.empty)},applyChatLayout(){},members:()=>[],initializeDraft:async()=>{},reports:{paint(){}},clearOperations(){},liveEntries:()=>[{id:'live'}],
  dock:{open(){},refresh(messages){const request={messages,...deferred()};refreshes.push(request);return request.promise;},live:entries=>live.push(entries)},
  paintTerminal(){projected.push(terminal.items?.[0]?.id);},paintWelcome(){},controls(){},working:()=>true,transcript:{rows:()=>[]},$:()=>({}),
 };
 const controller=vm.runInNewContext(source.slice(start,end)+'\n({tick,state:()=>({lastSeq,polling}),invalidate:()=>ticket++})',context);
 return {...controller,reads,refreshes,live,delays,presentations,projected,terminal};
}

test('Coding keeps projecting tools while chat history waits and advances its cursor only on a successful page',async()=>{
 const f=fixture();f.terminal.items=[{id:'shell'}];await f.tick();assert.equal(f.state().lastSeq,-1);assert.equal(f.live.length,0);
 f.terminal.items=[{id:'patch'}];await f.tick();assert.deepEqual(f.projected,['shell','patch']);assert.equal(f.refreshes.length,1);
 f.refreshes[0].resolve(false);await flush();assert.equal(f.state().lastSeq,-1);assert.equal(f.delays.at(-1),600);assert.equal(f.presentations.length,0);
 await f.tick();assert.equal(f.refreshes.length,2);f.refreshes[1].resolve(true);await flush();assert.equal(f.state().lastSeq,7);assert.deepEqual(f.presentations,[true]);
 await f.tick();assert.deepEqual(f.reads.map(p=>p.after),[0,0,0,7]);assert.equal(f.refreshes.length,2);assert.equal(f.live.length,1);
});

test('a superseded Coding poll cannot advance the new binding cursor after its refresh finishes',async()=>{
 const f=fixture();await f.tick();f.invalidate();f.refreshes[0].resolve(true);await flush();
 assert.equal(f.state().lastSeq,-1);assert.equal(f.live.length,0);assert.equal(f.presentations.length,0);
});
