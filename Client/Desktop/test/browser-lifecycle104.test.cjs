// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fs; deferred; settle; picture; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-lifecycle104.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {pathToFileURL}=require('node:url');
const {createBrowserRuntime}=require('../../../Program/official/browser/service/browser-runtime.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const picture=name=>({isEmpty:()=>false,getSize:()=>({width:640,height:400}),toDataURL:()=>name});

// The production runtime owns the queue, tab map, profiles and capture dispatch.
// Only native Electron boundaries are replaced, so delayed promises can be
// released at deterministic cancellation and navigation boundaries.
function fixture(t){
 const storage=fs.mkdtempSync(path.join(os.tmpdir(),'browser-lifecycle104-'));
 const groups=[],views=[],ipcMain=new EventEmitter(),navigations=[],commandsAfterClose=[];let nextBlankGate=null;
 class Contents extends EventEmitter{
  constructor(){super();this.dead=false;this.location='about:blank';this.sent=[];this.mainFrame={url:''};this.zoom=1;
   this.navigationHistory={canGoBack:()=>false,canGoForward:()=>false};this.debugger=new EventEmitter();
   Object.assign(this.debugger,{isAttached:()=>true,attach(){},sendCommand:async(method)=>{
    if(this.dead){commandsAfterClose.push(method);throw Error('protocol after close');}
    if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame',url:this.location}}};
    if(method==='Page.createIsolatedWorld')return {executionContextId:1};
    if(method==='Runtime.evaluate')return {result:{value:null}};
    return {};
   }});
  }
  isDestroyed(){return this.dead;}
  close(){if(!this.dead){this.dead=true;this.emit('destroyed');}}
  send(name,value){if(this.dead)throw Error('native contents destroyed');this.sent.push({name,value});}
  setWindowOpenHandler(){} setZoomFactor(z){this.zoom=z;}getZoomFactor(){return this.zoom;}focus(){}
  getTitle(){return this.location;}getURL(){return this.location;}isLoadingMainFrame(){return !!this.loading;}
  async loadFile(){return undefined;}
  async loadURL(url){if(this.dead)throw Error('load after close');navigations.push(url);this.loading=true;this.emit('did-start-navigation',{},url,false,true);if(url==='about:blank'&&nextBlankGate){const gate=nextBlankGate;nextBlankGate=null;await gate.promise;}this.location=url;this.loading=false;this.emit('did-stop-loading');}
  async capturePage(){return picture(this.location);}
 }
 class View{
  constructor(options){this.webContents=new Contents();this.webContents.session=options?.webPreferences?.session;this.bounds={x:0,y:0,width:640,height:500};this.children=[];views.push(this);}
  setBackgroundColor(){}setVisible(v){this.visible=v;}setBounds(b){this.bounds={...b};}getBounds(){return {...this.bounds};}
  addChildView(v){this.children=this.children.filter(x=>x!==v);this.children.push(v);}removeChildView(v){this.children=this.children.filter(x=>x!==v);}
 }
 class Window extends EventEmitter{
  constructor(){super();this.webContents=new Contents();this.aieyraPresentation='interactive';}
  isDestroyed(){return false;}isVisible(){return true;}isFocused(){return false;}showInactive(){}
 }
 const cookieEvents=[],sessions=new Map();
 const browserSession=id=>{
  if(!sessions.has(id))sessions.set(id,Object.assign(new EventEmitter(),{getUserAgent:()=> 'Chrome/130.0',setUserAgent(){},setPermissionCheckHandler(){},setPermissionRequestHandler(){},async clearStorageData(options){cookieEvents.push([id,options]);},cookies:{async flushStore(){cookieEvents.push([id,'flush']);}}}));
  return sessions.get(id);
 };
 const sessionValue=browserSession('default-session');
 const runtime=createBrowserRuntime({storage,preloadDir:storage,interfaceConfig:{},atomicWriteJson:(p,v)=>fs.writeFileSync(p,JSON.stringify(v)),
  electron:{app:new EventEmitter(),WebContentsView:View,BrowserWindow:Window,ipcMain,session:{defaultSession:sessionValue,fromPath:p=>browserSession(path.basename(p))},shell:{},Menu:{}},
  presentation:{mode:()=> 'interactive',apply(){}},zoomService:{forConfig:()=>({attach(){},input(){}})},
  mount(){const win=new Window(),shell=new Contents(),container=new View();shell.mainFrame.url=pathToFileURL(require.resolve('../../../Program/official/browser/ui/browser-shell.html')).href+'?embedded=1';const group={win,shell,container,embedded:true,ready:Promise.resolve(),dispose(){shell.close();},visible:()=>true};groups.push(group);return group;}
 });
 t.after(async()=>{await runtime.close();fs.rmSync(storage,{recursive:true,force:true});});
 const dispatch=(group,name,value)=>ipcMain.emit(name,{sender:group.shell,senderFrame:group.shell.mainFrame},value);
 return {runtime,groups,views,navigations,storage,dispatch,commandsAfterClose,cookieEvents,holdNextBlank:gate=>{nextBlankGate=gate;},
  command:(g,a)=>dispatch(g,'agent-browser:command',a),
  overlay:(g,on=true)=>dispatch(g,'agent-browser:layout',{top:96,bottom:32,right:0,overlay:on}),
  page:()=>views.filter(v=>v.webContents.getURL().startsWith('http')).at(-1)?.webContents,
  images:g=>g.shell.sent.filter(x=>x.name==='agent-browser:backdrop').map(x=>x.value?.data??x.value)
 };
}

test('opening the browser and closing its final tab use the Aieyra site in the same window',async t=>{
 const f=fixture(t),owner='program/browser',home='https://aieyra.cn/';
 const first=await f.runtime.user(owner,{action:'open'});
 const group=f.groups[0],page=f.page();
 assert.equal(page.getURL(),home);
 f.command(group,{action:'close',tab_id:first.tab_id});
 await group.humanQueue;
 assert.equal(f.groups.length,1);
 assert.equal(f.runtime.status().count,1);
 assert.equal(f.runtime.status().groups[0].id,group.id);
 assert.notEqual(group.active,first.tab_id);
 assert.equal(page.isDestroyed(),true);
 assert.equal(f.page().getURL(),home);
 const visible=()=>f.views.find(view=>view.webContents===f.page()).visible;
 f.dispatch(group,'agent-browser:layout',{top:52,bottom:0,right:0,overlay:false,page:true});
 assert.equal(visible(),false);
 f.dispatch(group,'agent-browser:layout',{top:52,bottom:0,right:0,overlay:false,page:false});
 assert.equal(visible(),true);
});

test('download history includes older active transfers and prevents cross-profile shell cancellation',async t=>{
 const f=fixture(t);
 await f.runtime.user('owner',{action:'open',url:'http://local.test/a'});const page=f.page();
 await f.runtime.user('owner',{action:'open',profile:'other',new_instance:true,url:'http://local.test/b'});
 const items=Array.from({length:7},(_,i)=>Object.assign(new EventEmitter(),{
  getFilename:()=>i+'.txt',getURL:()=> 'http://local.test/file',setSavePath(){},
  getReceivedBytes:()=>0,getTotalBytes:()=>1,cancel(){this.cancelled=true;this.emit('done',{},'cancelled');}
 }));
 for(const item of items.slice(0,6))page.session.emit('will-download',{},item,page);
 const otherPage=f.page();otherPage.session.emit('will-download',{},items[6],otherPage);
 const history=group=>group.shell.sent.filter(row=>row.name==='agent-browser:state').at(-1).value.downloads;
 assert.equal(history(f.groups[0]).length,6);assert.equal(history(f.groups[1]).length,1);
 const first=history(f.groups[0])[0].download_id;
 f.command(f.groups[1],{action:'download_cancel',download_id:first});await f.groups[1].humanQueue;
 assert.equal(items[0].cancelled,undefined);
 f.command(f.groups[0],{action:'download_cancel',download_id:first});await f.groups[0].humanQueue;
 assert.equal(items[0].cancelled,true);assert.equal(history(f.groups[0])[0].state,'cancelled');
});

test('cookie settings stay with the active owned identity and exit clears only opted-in cookies',async t=>{
 const f=fixture(t),a=await f.runtime.user('owner',{action:'open',url:'http://local.test/a'}),b=await f.runtime.user('owner',{action:'open',profile:'other',new_instance:true,url:'http://local.test/b'});
 const set=(owner,tab,settings,clear)=>f.runtime.user(owner,{action:'settings',tab_id:tab.tab_id,settings,...clear&&{clear_cookies:true}});
 await assert.rejects(set('wrong-owner',a,{},true),/Unknown tab/);
 await set('owner',a,{},true);
 assert.deepEqual(f.cookieEvents,[['agent-default',{storages:['cookies']}],['agent-default','flush']]);
 await assert.rejects(set('owner',b,{cookie_policy:'clear_on_exit'}),/Cookie 自动保存/);
 await f.runtime.close();
 assert.deepEqual(f.cookieEvents.slice(2),[]);
});

for(const shutdown of ['runtime','group','source-tab'])test('queued human new_tab does not outlive '+shutdown,async t=>{
 const f=fixture(t),first=await f.runtime.user('owner',{action:'open',url:'http://local.test/a'}),g=f.groups[0];
 if(shutdown==='source-tab')await f.runtime.user('owner',{action:'open',url:'http://local.test/b'});
 const gate=deferred();g.controlReady=gate.promise;
 f.command(g,{action:'new_tab'});await settle();
 const active=g.active,count=f.views.length;
 if(shutdown==='runtime')f.runtime.close();else if(shutdown==='group')f.runtime.closeGroup(g.id);else{
  f.command(g,{action:'close',tab_id:active});
  // Native page closure is independent of the command queue.
  f.views.find(v=>v.webContents.getURL()==='http://local.test/b').webContents.close();
 }
 gate.resolve();await g.humanQueue;
 assert.equal(f.views.length,count,'a retired command must not allocate native views');
 assert.equal(f.runtime.status().count,shutdown==='source-tab'?1:0);
 assert.equal(g.humanPending,0);
 assert.equal(f.navigations.filter(x=>x.includes('os.aieyra.cn')).length,0,'no late homepage request');
 if(shutdown==='group'){
  const reopened=await f.runtime.user('owner',{action:'open',url:'http://local.test/reopened'});
  assert.notEqual(reopened.tab_id,first.tab_id);assert.equal(f.runtime.status().count,1);
 }
});

test('queued profile creation does not persist or open a profile after close',async t=>{
 const f=fixture(t);await f.runtime.user('owner',{action:'open',url:'http://local.test/a'});const g=f.groups[0],gate=deferred();g.controlReady=gate.promise;
 f.command(g,{action:'profile_create',profile:'late-profile',label:'Late'});await settle();f.runtime.close();gate.resolve();await g.humanQueue;
 assert.equal(fs.existsSync(path.join(f.storage,'profiles','late-profile.json')),false);assert.equal(f.runtime.status().count,0);
});

test('close during new tab initialization cancels later native setup and homepage navigation',async t=>{
 const f=fixture(t);await f.runtime.user('owner',{action:'open',url:'http://local.test/a'});const g=f.groups[0],gate=deferred();f.holdNextBlank(gate);
 f.command(g,{action:'new_tab'});await settle();assert.equal(f.runtime.status().count,2,'new tab initialization is actually in progress');
 f.runtime.closeGroup(g.id);gate.resolve();await g.humanQueue;
 assert.equal(f.runtime.status().count,0);assert.deepEqual(f.commandsAfterClose,[]);assert.equal(f.navigations.filter(x=>x.includes('os.aieyra.cn')).length,0);assert.equal(g.humanPending,0);
});

test('overlay replaces a completed A capture when switching to B',async t=>{
 const f=fixture(t),a=await f.runtime.user('owner',{action:'open',url:'http://local.test/a'}),b=await f.runtime.user('owner',{action:'open',url:'http://local.test/b'}),g=f.groups[0];
 await f.runtime.user('owner',{action:'activate',tab_id:a.tab_id});f.overlay(g);await settle();assert.equal(f.images(g).at(-1),'http://local.test/a');
 await f.runtime.user('owner',{action:'activate',tab_id:b.tab_id});await settle();assert.equal(g.panelOverlay,true);assert.equal(f.images(g).at(-1),'http://local.test/b');
});

test('a late capture cannot cross tabs, navigation, viewport or overlay lifetime',async t=>{
 const f=fixture(t),a=await f.runtime.user('owner',{action:'open',url:'http://local.test/a'}),pageA=f.page(),b=await f.runtime.user('owner',{action:'open',url:'http://local.test/b'}),g=f.groups[0];
 const gate=deferred();pageA.capturePage=()=>gate.promise;
 await f.runtime.user('owner',{action:'activate',tab_id:a.tab_id});f.overlay(g);await settle();
 await f.runtime.user('owner',{action:'activate',tab_id:b.tab_id});await settle();gate.resolve(picture('stale-A'));await settle();
 assert.equal(f.images(g).includes('stale-A'),false);assert.equal(f.images(g).at(-1),'http://local.test/b');
 const pageB=f.page(),oldNavigation=deferred();pageB.capturePage=()=>oldNavigation.promise;
 f.overlay(g,false);f.overlay(g);await settle();
 pageB.loading=true;pageB.emit('did-start-navigation',{},'http://local.test/c',false,true);pageB.location='http://local.test/c';await settle();
 assert.equal(f.images(g).at(-1),null,'navigation removes the previous page immediately');
 pageB.capturePage=async()=>picture('current-C');pageB.loading=false;pageB.emit('did-stop-loading');oldNavigation.resolve(picture('stale-B'));await settle();
 assert.equal(f.images(g).includes('stale-B'),false);assert.equal(f.images(g).at(-1),'current-C');
 const oldViewport=deferred();pageB.capturePage=()=>oldViewport.promise;g.container.setBounds({width:600,height:500});g.relayout();await settle();
 pageB.capturePage=async()=>picture('resized-C');g.container.setBounds({width:520,height:500});g.relayout();await settle();oldViewport.resolve(picture('stale-size'));await settle();
 assert.equal(f.images(g).includes('stale-size'),false);assert.equal(f.images(g).at(-1),'resized-C');
 const closedOverlay=deferred();pageB.capturePage=()=>closedOverlay.promise;f.overlay(g,false);f.overlay(g);await settle();f.overlay(g,false);closedOverlay.resolve(picture('closed-overlay'));await settle();
 assert.equal(f.images(g).includes('closed-overlay'),false);assert.equal(f.images(g).at(-1),null);
});

test('resize bursts keep only one native capture in flight and render the latest viewport',async t=>{
 const f=fixture(t);await f.runtime.user('owner',{action:'open',url:'http://local.test/a'});const g=f.groups[0],page=f.page(),gate=deferred();let calls=0;
 page.capturePage=()=>{calls++;return calls===1?gate.promise:Promise.resolve(picture('latest-size'));};f.overlay(g);await settle();
 for(let width=600;width>=500;width-=10){g.container.setBounds({width,height:500});g.relayout();await settle();}
 assert.equal(calls,1,'resize cannot fan out screenshot work');gate.resolve(picture('obsolete-size'));await settle();
 assert.equal(calls,2);assert.equal(f.images(g).includes('obsolete-size'),false);assert.equal(f.images(g).at(-1),'latest-size');
});

test('closing a group discards its in-flight native screenshot before a clean reopen',async t=>{
 const f=fixture(t);await f.runtime.user('owner',{action:'open',url:'http://local.test/a'});const g=f.groups[0],gate=deferred();f.page().capturePage=()=>gate.promise;
 f.overlay(g);await settle();f.runtime.closeGroup(g.id);
 await f.runtime.user('owner',{action:'open',url:'http://local.test/reopened'});const next=f.groups.at(-1);f.overlay(next);await settle();gate.resolve(picture('retired-group'));await settle();
 assert.equal(f.images(g).includes('retired-group'),false);assert.equal(f.images(next).at(-1),'http://local.test/reopened');assert.equal(f.runtime.status().count,1);
});

test('navigation invalidates old pixels before Chromium updates its loading flag',async t=>{
 const f=fixture(t);await f.runtime.user('owner',{action:'open',url:'http://local.test/a'});const g=f.groups[0],page=f.page();f.overlay(g);await settle();
 let captures=0;page.capturePage=async()=>{captures++;return picture(page.location);};
 page.emit('did-start-navigation',{},'http://local.test/b',false,true);await settle();
 assert.equal(captures,0,'old document must not be captured under a new navigation identity');assert.equal(f.images(g).at(-1),null);
 page.location='http://local.test/b';page.emit('did-stop-loading');await settle();assert.equal(f.images(g).at(-1),'http://local.test/b');
 page.emit('did-start-navigation',{},'http://local.test/b#section',true,true);page.location='http://local.test/b#section';page.emit('did-navigate-in-page',{},page.location,true);await settle();
 assert.equal(f.images(g).at(-1),'http://local.test/b#section');
});

test('renderer accepts only its current backdrop identity and ignores late old captures',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../../../Program/official/browser/ui/browser-shell.js'),'utf8');
 const img={hidden:true,dataset:{},removeAttribute(name){delete this[name];}},context={state:{backdropIdentity:'current'},panels:{active:true},$:()=>img,bridge:{onBackdrop(fn){this.receive=fn;}}};
 const start=source.indexOf('function clearBackdrop()'),end=source.indexOf('\n',start);
 vm.runInNewContext(source.slice(start,end)+'\n'+source.slice(source.indexOf('bridge.onBackdrop?.('),source.indexOf('\nbridge.onState(paint)')),context);
 context.bridge.receive({identity:'old',data:'old-page'});assert.equal(img.hidden,true);
 context.bridge.receive({identity:'current',data:'current-page'});assert.equal(img.src,'current-page');assert.equal(img.hidden,false);
 context.bridge.receive({identity:'old',data:'old-page'});assert.equal(img.src,'current-page');assert.equal(img.hidden,false);
 context.bridge.receive(null);assert.equal(img.hidden,true);assert.equal(img.src,undefined);
});

test('browser instances separate owners and require an explicit instance when a login profile has several',async t=>{
 const f=fixture(t),a=await f.runtime.execute('os-a',{action:'open',url:'http://local.test/a'}),b=await f.runtime.execute('os-b',{action:'open',url:'http://local.test/b'});
 assert.equal(a.ok,true);assert.equal(b.ok,true);assert.notEqual(a.group_id,b.group_id);
 const second=await f.runtime.execute('os-a',{action:'open',url:'http://local.test/c',new_instance:true});assert.equal(second.ok,true);assert.notEqual(second.group_id,a.group_id);
 const denied=await f.runtime.execute('os-b',{action:'open',url:'http://local.test/denied',group_id:a.group_id});assert.equal(denied.ok,false);assert.match(denied.error,/Unknown browser instance/);
 const ambiguous=await f.runtime.execute('os-a',{action:'open',url:'http://local.test/ambiguous'});assert.equal(ambiguous.ok,false);assert.match(ambiguous.error,/choose group_id/);
 for(let i=0;i<12;i++)assert.equal((await f.runtime.execute('os-a',{action:'open',url:'http://local.test/tab'+i,group_id:a.group_id})).ok,true);
 const tabs=await f.runtime.execute('os-a',{action:'tabs'});assert.equal(tabs.tabs.length,14);assert(tabs.tabs.every(v=>v.group_id!==b.group_id));
 const scoped=await f.runtime.execute('os-a',{action:'tabs',group_id:second.group_id});assert.equal(scoped.tabs.length,1);
});

test('a blocked navigation serializes its instance while another instance can continue',async t=>{
 const f=fixture(t),a=await f.runtime.execute('os-a',{action:'open',url:'http://local.test/a'}),b=await f.runtime.execute('os-a',{action:'open',url:'http://local.test/b',new_instance:true});
 const page=f.views.find(v=>v.webContents.getURL()==='http://local.test/a').webContents,gate=deferred(),entered=deferred(),original=page.loadURL.bind(page);
 page.loadURL=async url=>{if(url==='http://local.test/blocked'){entered.resolve();await gate.promise;}return original(url);};
 const blocked=f.runtime.execute('os-a',{action:'navigate',tab_id:a.tab_id,url:'http://local.test/blocked'});await entered.promise;
 let sameDone=false;const same=f.runtime.execute('os-a',{action:'snapshot',tab_id:a.tab_id}).then(v=>{sameDone=true;return v;});
 try{const other=await f.runtime.execute('os-a',{action:'snapshot',tab_id:b.tab_id});assert.equal(other.ok,true);assert.equal(sameDone,false);}finally{gate.resolve();}
 assert.equal((await blocked).ok,true);assert.equal((await same).ok,true);
});
