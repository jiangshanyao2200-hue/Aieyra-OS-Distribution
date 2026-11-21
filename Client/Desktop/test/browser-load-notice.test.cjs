// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; navigateFailure
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-load-notice.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

// Exercise the actual shell command handler with a load that finishes or is
// replaced before its rejected promise reaches the UI error path.
async function navigateFailure(error){
 const source=fs.readFileSync(require.resolve('../../../Program/official/browser/service/browser-runtime.cjs'),'utf8');
 const start=source.indexOf("listen('agent-browser:command',"),end=source.indexOf("listen('agent-browser:takeover'",start);
 let handler;const completed=[],notices=[],group={active:'tab',control:'human',shell:{},embedded:false},tab={id:'tab',owner:'owner',group};
 const operation={action:'navigate'};
 vm.runInNewContext(source.slice(start,end),{listen:(_name,fn)=>{handler=fn;},tabs:new Map([[tab.id,tab]]),isLiveTab:()=>true,shellSource:()=>true,mode:()=> 'interactive',control:{run:(_scope,fn)=>fn()},beginOperation:()=>operation,call:async()=>{await Promise.resolve();throw error;},finishOperation:(_tab,item,e)=>completed.push({item,error:e}),publish:(_tab,message)=>notices.push(message||''),setControl(target,human){assert.equal(target,group);assert.equal(human,true);}});
 handler({sender:group.shell},{action:'navigate',url:'http://127.0.0.1/page'});await group.humanQueue;
 assert.equal(group.humanPending,0);assert.equal(completed.length,1);assert.equal(completed[0].error,error,'cancelled navigation must not be reported as successful');
 return notices;
}
test('late cancelled navigation does not put an error banner over a usable page',async()=>{
 for(const details of [{code:'ERR_ABORTED'},{errno:-3},{code:'browser_navigation_cancelled'}]){
  const error=Object.assign(Error('ERR_ABORTED (-3) loading local page'),details);
  assert.deepEqual(await navigateFailure(error),['']);
 }
});
test('real navigation and other command failures remain visible',async()=>{
 for(const details of [{code:'ERR_CONNECTION_REFUSED',errno:-102},{code:'ERR_TIMED_OUT',errno:-7},{code:'ERR_FAILED',errno:-2},{}]){
  const error=Object.assign(Error('page could not load'),details);
  assert.deepEqual(await navigateFailure(error),['page could not load']);
 }
});

test('a user replacing the initial homepage retains the new tab without a stale startup error',async()=>{
 const source=fs.readFileSync(require.resolve('../../../Program/official/browser/service/browser-runtime.cjs'),'utf8');
 async function opening(actor,error){
  const completions=[];let closed=false;
  const group={ready:Promise.resolve(),control:'human'},tab={id:'first',group,wc:{},ready:null};
  const context={presentation:{mode:()=> 'interactive'},selectInstance:()=>null,serial:(_group,fn)=>fn(),progress(){},url:x=>x,identities:{ensure:()=>({id:'default',fingerprint:{}})},tabs:new Map(),sessionFor:()=>({setUserAgent(){}}),configureSession(){},makeTab:()=>tab,beginOperation:()=>({action:'open'}),requireLiveTab(){},control:{assert(){},actor:()=>actor},publish(){},initialize:async()=>{},navigate:async()=>{throw error;},finishOperation:(_tab,_op,e)=>completions.push(e),isLiveTab:()=>!closed,closeTab:()=>{closed=true;}};
  vm.runInNewContext(source.slice(source.indexOf('async function open('),source.indexOf('async function waitFor(')),context);
  const pending=context.open('owner',{url:'about:blank'});
  if(actor==='human'&&error.code==='ERR_ABORTED'){
   const result=await pending;assert.equal(result.tab_id,'first');assert.equal(result.navigation_cancelled,true);assert.equal(result.ok,undefined);
  }else await assert.rejects(pending,e=>e===error);
  assert.equal(closed,false);assert.deepEqual(completions,[error],'cancelled homepage remains a failed operation');
 }
 await opening('human',Object.assign(Error('replaced homepage'),{code:'ERR_ABORTED'}));
 await opening('human',Object.assign(Error('network unavailable'),{code:'ERR_CONNECTION_REFUSED'}));
 await opening('agent',Object.assign(Error('taken over'),{code:'ERR_ABORTED'}));
});

test('explicit stop owns its pending navigation even when Chromium returns ERR_FAILED',async()=>{
 const source=fs.readFileSync(require.resolve('../../../Program/official/browser/service/browser-runtime.cjs'),'utf8');
 const context={control:{assert(){}},requireLiveTab(){},url(){},pause:async()=>{},downloads:new Map(),publish(){},snapshot:()=>({loaded:true}),clearTimeout,clearPasswordCandidate(){}};
 vm.runInNewContext(source.slice(source.indexOf('function stopLoading('),source.indexOf('async function open(')),context);
 let rejectLoad;const debug=new (require('node:events').EventEmitter)();
 const failure=Object.assign(Error('ERR_FAILED'),{code:'ERR_FAILED',errno:-2});
 const tab={navigationSequence:3,wc:{debugger:debug,loadURL(){tab.navigationSequence++;return new Promise((_resolve,reject)=>{rejectLoad=reject;});},stop(){rejectLoad(failure);}}};
 const pending=context.navigate(tab,'http://127.0.0.1/slow');context.stopLoading(tab);
 await assert.rejects(pending,e=>e.code==='browser_navigation_cancelled');
 assert.equal(tab.stoppedNavigation,4);assert.equal(tab.pendingNavigation,null);assert.equal(debug.listenerCount('message'),0);
 const next=context.navigate(tab,'http://127.0.0.1/broken');rejectLoad(failure);
 await assert.rejects(next,e=>e===failure,'a previous stop must not hide a genuine failure of the next page');
 assert.equal(tab.pendingNavigation,null);assert.equal(debug.listenerCount('message'),0);
});
