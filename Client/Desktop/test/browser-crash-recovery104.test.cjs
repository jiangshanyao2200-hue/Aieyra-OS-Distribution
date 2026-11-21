// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fs; original; deferred; nativeFailure; fixture; settle; attach; detach
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-crash-recovery104.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {pathToFileURL}=require('node:url');
const {createBrowserRuntime}=require('../../../Program/official/browser/service/browser-runtime.cjs');
const original='http://local.test/original',other='http://local.test/other';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const nativeFailure=()=>Object.assign(Error('ERR_FAILED (-2) loading recovery target'),{code:'ERR_FAILED',errno:-2});

// The actual public runtime owns dispatch, crash handling, navigation and
// snapshots. Only Electron's native process/CDP boundary is deterministic here.
function fixture(t){
 const storage=fs.mkdtempSync(path.join(os.tmpdir(),'browser-crash104-'));
 const ipcMain=new EventEmitter(),groups=[],views=[],calls=[],afterClose=[];
 class Contents extends EventEmitter{
  constructor(){super();this.location='about:blank';this.dead=false;this.loading=false;this.plans=[];this.commandPlans=[];this.mainFrame={url:''};this.sent=[];
   this.navigationHistory={canGoBack:()=>false,canGoForward:()=>false};this.debugger=new EventEmitter();
   Object.assign(this.debugger,{isAttached:()=>true,attach(){},sendCommand:async(method,args,sessionId)=>{
    if(this.dead){afterClose.push(method);throw Error('CDP after close');}
    if(this.rendererCrashed)throw Error('renderer unavailable until bootstrap');
    const held=this.commandPlans[0]?.method===method&&(this.commandPlans[0].sessionId===undefined||this.commandPlans[0].sessionId===sessionId)?this.commandPlans.shift():null;
    if(held){held.entered.resolve();await held.gate.promise;}
    if(method==='Page.handleJavaScriptDialog'&&this.dialogRelease){const release=this.dialogRelease;this.dialogRelease=null;release();}
    if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame',url:this.location}}};
    if(method==='Page.createIsolatedWorld')return {executionContextId:1};
    if(method==='Runtime.evaluate'){
     if(args.expression.startsWith('navigator.userAgentData'))return {result:{value:null}};
     const data={url:this.location,title:this.location,text:'saved document',elements:[{id:'0',name:'保存内容',role:'button'}],total:1};
     if(this.snapshotGate){const gate=this.snapshotGate;this.snapshotGate=null;gate.entered.resolve();await gate.promise;}
     return {result:{value:data}};
    }
    return {};
   }});
  }
  isDestroyed(){return this.dead;}getURL(){return this.location;}getTitle(){return this.location;}isLoadingMainFrame(){return this.loading;}
  getZoomFactor(){return 1;}setZoomFactor(){}focus(){}setWindowOpenHandler(){}send(name,value){if(!this.dead)this.sent.push({name,value});}
  async loadFile(){}
  async loadURL(url){
   if(this.dead){afterClose.push('loadURL');throw Error('load after close');}
   calls.push({method:'loadURL',url});this.loading=true;this.emit('did-start-navigation',{},url,false,true);
   const plan=this.plans[0]?.url===url?this.plans.shift():null;
   const active=deferred();this.active=active;if(plan)plan.entered.resolve();
   if(plan?.gate)plan.gate.promise.then(active.resolve,active.reject);else if(plan?.error)active.reject(plan.error);else active.resolve();
   try{await active.promise;if(this.dead)throw Error('closed while loading');this.rendererCrashed=false;this.location=url;this.emit('did-navigate',{},url,200,'OK');this.emit('did-finish-load');}
   finally{if(this.active===active)this.active=null;this.loading=false;this.emit('did-stop-loading');}
  }
  reload(){calls.push({method:'reload',url:this.location});void this.loadURL(this.location).catch(()=>{});}
  stop(){calls.push({method:'stop',url:this.location});this.active?.reject(nativeFailure());}
  close(){if(this.dead)return;this.dead=true;this.active?.reject(Error('native contents closed'));this.emit('destroyed');}
  crash({rejectLoad=true}={}){this.rendererCrashed=true;if(rejectLoad)this.active?.reject(nativeFailure());this.emit('render-process-gone',{}, {reason:'crashed',exitCode:2});}
 }
 class View{
  constructor(){this.webContents=new Contents();this.bounds={x:0,y:0,width:640,height:500};this.children=[];views.push(this);}
  setBackgroundColor(){}setVisible(){}setBounds(v){this.bounds={...v};}getBounds(){return {...this.bounds};}
  addChildView(v){this.children.push(v);}removeChildView(v){this.children=this.children.filter(x=>x!==v);}
 }
 class Window extends EventEmitter{constructor(){super();this.webContents=new Contents();}isDestroyed(){return false;}isVisible(){return true;}isFocused(){return false;}}
 const ses=Object.assign(new EventEmitter(),{getUserAgent:()=> 'Chrome/130.0',setUserAgent(){},setPermissionCheckHandler(){},setPermissionRequestHandler(){}});
 const runtime=createBrowserRuntime({storage,preloadDir:storage,interfaceConfig:{},atomicWriteJson:(p,v)=>fs.writeFileSync(p,JSON.stringify(v)),
  electron:{app:new EventEmitter(),WebContentsView:View,BrowserWindow:Window,ipcMain,session:{defaultSession:ses,fromPath:()=>ses},shell:{},Menu:{}},
  presentation:{mode:()=> 'interactive',apply(){}},zoomService:{forConfig:()=>({attach(){},input(){}})},
  mount(){const shell=new Contents(),container=new View(),group={win:new Window(),shell,container,embedded:true,ready:Promise.resolve(),visible:()=>true,dispose(){shell.close();}};
   shell.mainFrame.url=pathToFileURL(require.resolve('../../../Program/official/browser/ui/browser-shell.html')).href+'?embedded=1';groups.push(group);return group;
  }
 });
 t.after(()=>{runtime.close();fs.rmSync(storage,{recursive:true,force:true});});
 const execute=a=>runtime.execute('owner',a);
 return {runtime,execute,groups,calls,afterClose,
  async open(){const receipt=await execute({action:'open',url:original});assert.equal(receipt.ok,true,receipt.error);const page=views.find(v=>v.webContents.getURL()===original).webContents;calls.length=0;return {page,id:receipt.tab_id,group:groups[0]};},
  fail(page,url){const plan={url,error:nativeFailure(),entered:deferred()};page.plans.push(plan);return plan;},
  hold(page,url){const plan={url,gate:deferred(),entered:deferred()};page.plans.push(plan);return plan;},
  holdCommand(page,method,sessionId){const plan={method,sessionId,gate:deferred(),entered:deferred()};page.commandPlans.push(plan);return plan;},
  command(group,a){ipcMain.emit('agent-browser:command',{sender:group.shell,senderFrame:group.shell.mainFrame},a);},
  async observed(id){const snapshot=await execute({action:'snapshot',tab_id:id});assert.equal(snapshot.ok,true,snapshot.error);return snapshot;}
 };
}

for(const action of ['reload','navigate'])test('failed crash '+action+' preserves the original page for an explicit retry',{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();page.crash();const target=action==='reload'?original:other;f.fail(page,target);
 const failed=await f.execute({action,tab_id:id,...action==='navigate'?{url:target}:{}});
 assert.equal(failed.ok,false);assert.match(failed.error,/ERR_FAILED/);
 assert.deepEqual(f.calls.filter(x=>x.method==='loadURL').map(x=>x.url),['about:blank',target],'a failed target is not automatically retried');
 const retry=await f.execute({action:'reload',tab_id:id});assert.equal(retry.ok,true,retry.error);
 assert.equal((await f.observed(id)).url,original,'the explicit reload must recover the original page, not the bootstrap blank');
 assert.equal(retry.tab_id,id);assert.equal(f.runtime.status().count,1);
 await f.execute({action:'navigate',tab_id:id,url:other});await f.execute({action:'reload',tab_id:id});
 assert.equal((await f.observed(id)).url,other,'successful recovery must retire the old recovery target');
 assert.deepEqual(f.calls.filter(x=>x.method==='reload').map(x=>x.url),[other]);
});

test('successful explicit navigation after a crash becomes the page used by later reloads',{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();page.crash();
 const recovered=await f.execute({action:'navigate',tab_id:id,url:other});assert.equal(recovered.ok,true,recovered.error);assert.equal(recovered.url,other);
 await f.execute({action:'reload',tab_id:id});assert.equal((await f.observed(id)).url,other);
 assert.deepEqual(f.calls.filter(x=>x.method==='loadURL').map(x=>x.url),['about:blank',other,other]);
});

for(const action of ['reload','navigate'])test('explicit stop during crash '+action+' allows observation then recovery',{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();page.crash();const target=action==='reload'?original:other,held=f.hold(page,target);
 const pending=f.execute({action,tab_id:id,...action==='navigate'?{url:target}:{}});await held.entered.promise;
 assert.equal((await f.execute({action:'stop',tab_id:id})).ok,true);
 const stopped=await pending;assert.equal(stopped.ok,false);assert.match(stopped.error,/operation_cancelled/);
 const blocked=await f.execute({action:'reload',tab_id:id});assert.equal(blocked.ok,false);assert.match(blocked.error,/snapshot_required/);
 assert.equal((await f.observed(id)).url,'about:blank','observe the actual interrupted bootstrap before resuming');
 const retry=await f.execute({action:'reload',tab_id:id});assert.equal(retry.ok,true,retry.error);assert.equal((await f.observed(id)).url,original);
});

test('human takeover preserves the recovery target and requires handback plus a fresh snapshot',{timeout:5000},async t=>{
 const f=fixture(t),{page,id,group}=await f.open();page.crash();const held=f.hold(page,original);
 const pending=f.execute({action:'reload',tab_id:id});await held.entered.promise;f.command(group,{action:'takeover'});await group.controlReady;
 held.gate.reject(nativeFailure());assert.equal((await pending).ok,false);
 const denied=await f.execute({action:'reload',tab_id:id});assert.equal(denied.ok,false);assert.match(denied.error,/human_control/);
 await f.runtime.resume('owner');const stale=await f.execute({action:'reload',tab_id:id});assert.equal(stale.ok,false);assert.match(stale.error,/snapshot_required/);
 await f.observed(id);const recovered=await f.execute({action:'reload',tab_id:id});assert.equal(recovered.ok,true,recovered.error);assert.equal((await f.observed(id)).url,original);
});

for(const stage of ['bootstrap','target'])test('closing during recovery '+stage+' never publishes or navigates a retired tab',{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();page.crash();const held=f.hold(page,stage==='bootstrap'?'about:blank':original);
 const pending=f.execute({action:'reload',tab_id:id});await held.entered.promise;f.runtime.closeGroup(f.groups[0].id);held.gate.resolve();
 assert.equal((await pending).ok,false);assert.equal(f.runtime.status().count,0);assert.deepEqual(f.afterClose,[]);
 assert.deepEqual(f.calls.filter(x=>x.method==='loadURL').map(x=>x.url),stage==='bootstrap'?['about:blank']:['about:blank',original]);
});

test('another crash during bootstrap-target navigation cannot replace the original recovery URL with blank',{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();page.crash();const held=f.hold(page,original);
 const pending=f.execute({action:'reload',tab_id:id});await held.entered.promise;assert.equal(page.getURL(),'about:blank');page.crash();assert.equal((await pending).ok,false);
 const retry=await f.execute({action:'reload',tab_id:id});assert.equal(retry.ok,true,retry.error);assert.equal((await f.observed(id)).url,original);
});

test('a late snapshot from an earlier recovery cannot acknowledge a newer renderer crash',{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();page.crash();const gate={...deferred(),entered:deferred()};page.snapshotGate=gate;
 const pending=f.execute({action:'reload',tab_id:id});await gate.entered.promise;page.crash();gate.resolve();
 const stale=await pending;assert.equal(stale.ok,false,'the first recovery must not claim success after a newer crash');
 const retry=await f.execute({action:'reload',tab_id:id});assert.equal(retry.ok,true,retry.error);assert.equal((await f.observed(id)).url,original);
});

for(const stage of ['bootstrap','setup'])for(const interruption of ['stop','takeover'])test(interruption+' during '+stage+' permits a fresh snapshot before explicit recovery',{timeout:5000},async t=>{
 const f=fixture(t),{page,id,group}=await f.open();page.crash();
 const held=stage==='bootstrap'?f.hold(page,'about:blank'):f.holdCommand(page,'Page.enable');
 const pending=f.execute({action:'reload',tab_id:id});await held.entered.promise;
 if(interruption==='stop')assert.equal((await f.execute({action:'stop',tab_id:id})).ok,true);
 else {f.command(group,{action:'takeover'});await group.controlReady;}
 held.gate.resolve();assert.equal((await pending).ok,false,'an interrupted operation cannot report successful recovery');
 if(interruption==='takeover'){
  const denied=await f.execute({action:'snapshot',tab_id:id});assert.equal(denied.ok,false);assert.match(denied.error,/human_control/);
  await f.runtime.resume('owner');
 }
 const blocked=await f.execute({action:'reload',tab_id:id});assert.equal(blocked.ok,false);assert.match(blocked.error,/snapshot_required/);
 const observed=await f.observed(id);assert.equal(observed.url,page.getURL());
 const beforeReload=f.calls.filter(x=>x.method==='loadURL').map(x=>x.url);
 assert.equal(beforeReload.filter(x=>x===original).length,0,'taking a fresh snapshot cannot implicitly retry the original page');
 const retry=await f.execute({action:'reload',tab_id:id});assert.equal(retry.ok,true,retry.error);assert.equal((await f.observed(id)).url,original);
});

for(const stage of ['bootstrap','setup','target'])test('a late successful '+stage+' completion cannot consume a newer crash',{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();page.crash();
 const held=stage==='setup'?f.holdCommand(page,'Page.enable'):f.hold(page,stage==='bootstrap'?'about:blank':original);
 const pending=f.execute({action:'reload',tab_id:id});await held.entered.promise;page.crash({rejectLoad:false});held.gate.resolve();
 assert.equal((await pending).ok,false,'a native promise may resolve after its renderer has already gone');
 if(stage!=='target')assert.equal(f.calls.filter(x=>x.method==='loadURL'&&x.url===original).length,0,'old initialization cannot dispatch a target load after a newer crash');
 const retry=await f.execute({action:'reload',tab_id:id});assert.equal(retry.ok,true,retry.error);assert.equal((await f.observed(id)).url,original);
});

test('a committed new page survives another crash before its recovery snapshot completes',{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();page.crash();const gate={...deferred(),entered:deferred()};page.snapshotGate=gate;
 const pending=f.execute({action:'navigate',tab_id:id,url:other});await gate.entered.promise;assert.equal(page.getURL(),other);page.crash();gate.resolve();
 assert.equal((await pending).ok,false,'an old observation cannot acknowledge the new crash');
 const retry=await f.execute({action:'reload',tab_id:id});assert.equal(retry.ok,true,retry.error);assert.equal((await f.observed(id)).url,other,'recover the last committed document');
});

for(const action of ['snapshot','find'])test('a crashed renderer can be observed after direct takeover and handback using '+action,{timeout:5000},async t=>{
 const f=fixture(t),{page,id,group}=await f.open();page.crash();
 const crashed=await f.execute({action,tab_id:id});assert.equal(crashed.ok,false);assert.match(crashed.error,/reload or navigate/);assert.deepEqual(f.calls,[]);
 f.command(group,{action:'takeover'});await group.controlReady;
 const denied=await f.execute({action,tab_id:id});assert.equal(denied.ok,false);assert.match(denied.error,/human_control/);
 await f.runtime.resume('owner');const blocked=await f.execute({action:'reload',tab_id:id});assert.equal(blocked.ok,false);assert.match(blocked.error,/snapshot_required/);
 const observed=await f.execute({action,tab_id:id});assert.equal(observed.ok,true,observed.error);assert.equal(observed.url,'about:blank');
 assert.deepEqual(f.calls.filter(x=>x.method==='loadURL').map(x=>x.url),['about:blank'],'observation can rebuild the dead renderer without retrying its network target');
 const retry=await f.execute({action:'reload',tab_id:id});assert.equal(retry.ok,true,retry.error);assert.equal((await f.observed(id)).url,original);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const attach=(page,sessionId,targetId)=>page.debugger.emit('message',{},'Target.attachedToTarget',{sessionId,targetInfo:{type:'iframe',targetId}});
const detach=(page,sessionId)=>page.debugger.emit('message',{},'Target.detachedFromTarget',{sessionId});

test('an old iframe initialization error cannot poison a newer successful renderer recovery',{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open(),held=f.holdCommand(page,'Runtime.evaluate','old-child');
 attach(page,'old-child','old-target');await held.entered.promise;page.crash();
 const recovered=await f.execute({action:'reload',tab_id:id});assert.equal(recovered.ok,true,recovered.error);assert.equal(recovered.url,original);
 held.gate.resolve();await settle();const observed=await f.execute({action:'snapshot',tab_id:id});
 assert.equal(observed.ok,true,observed.error);assert.equal(observed.url,original);
});

for(const replacement of [false,true])test('a detached iframe initialization error cannot poison '+(replacement?'its same-session replacement':'the surviving page'),{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open(),held=f.holdCommand(page,'Runtime.evaluate','child');
 attach(page,'child','retired-target');await held.entered.promise;detach(page,'child');if(replacement)attach(page,'child','replacement-target');
 assert.equal((await f.execute({action:'snapshot',tab_id:id})).ok,true,'the current page/frame must already be usable');
 held.gate.reject(Error('retired iframe setup failure'));await settle();const observed=await f.execute({action:'snapshot',tab_id:id});
 assert.equal(observed.ok,true,observed.error);assert.equal(observed.url,original);
});

for(const recovered of [false,true])test('a current iframe initialization failure still fails the snapshot '+(recovered?'after renderer recovery':'before any crash'),{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();if(recovered){page.crash();assert.equal((await f.execute({action:'reload',tab_id:id})).ok,true);}
 const held=f.holdCommand(page,'Runtime.evaluate','current-child');
 attach(page,'current-child','current-target');await held.entered.promise;held.gate.reject(Error('current iframe setup failure'));await settle();
 const observed=await f.execute({action:'snapshot',tab_id:id});assert.equal(observed.ok,false);assert.match(observed.error,/current iframe setup failure/);
});

for(const crashDuringSnapshot of [false,true])test('handling a recovery destination dialog '+(crashDuringSnapshot?'cannot consume a newer crash':'retires the previous saved URL'),{timeout:5000},async t=>{
 const f=fixture(t),{page,id}=await f.open();page.crash();const held=f.hold(page,other);
 const pending=f.execute({action:'navigate',tab_id:id,url:other});await held.entered.promise;
 page.location=other;page.emit('did-navigate',{},other,200,'OK');page.debugger.emit('message',{},'Page.javascriptDialogOpening',{type:'alert',message:'destination dialog'});
 const navigated=await pending;assert.equal(navigated.ok,true,navigated.error);assert.equal(navigated.dialog.type,'alert');
 page.dialogRelease=()=>{held.gate.resolve();page.debugger.emit('message',{},'Page.javascriptDialogClosed',{});};
 const snapshot=crashDuringSnapshot?{...deferred(),entered:deferred()}:null;if(snapshot)page.snapshotGate=snapshot;
 const handling=f.execute({action:'handle_dialog',tab_id:id,accept:true});
 if(snapshot){await snapshot.entered.promise;assert.equal(page.getURL(),other);page.crash();snapshot.resolve();}
 const handled=await handling;assert.equal(handled.ok,!crashDuringSnapshot,handled.error);
 if(!crashDuringSnapshot)assert.equal(handled.url,other);
 const reloaded=await f.execute({action:'reload',tab_id:id});assert.equal(reloaded.ok,true,reloaded.error);const observed=await f.execute({action:'snapshot',tab_id:id});
 assert.equal(observed.ok,true,observed.error);assert.equal(observed.url,other,'reload must use the committed destination, not the retired page');
 if(crashDuringSnapshot)assert.equal(f.calls.filter(x=>x.method==='loadURL'&&x.url===other).length,2,'the newer crash still needs an explicit destination load');
 else assert.deepEqual(f.calls.filter(x=>x.method==='reload').map(x=>x.url),[other],'successful dialog recovery returns subsequent reloads to ordinary browser behavior');
});
