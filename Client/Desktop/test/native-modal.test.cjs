// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; Contents; Window; fixture; report; preload
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/native-modal.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),vm=require('node:vm');
const {createNativeModal}=require('../host/native-modal.cjs');
class Contents extends EventEmitter{
 constructor(){super();this.mainFrame={url:'http://127.0.0.1:17910/'};this.sent=[];}
 isDestroyed(){return !!this.destroyed;}
 send(channel,value){this.sent.push({channel,value});}
}
class Window extends EventEmitter{isDestroyed(){return !!this.destroyed;}}
function fixture(t){const ipcMain=new EventEmitter();let changes=0;const modal=createNativeModal({ipcMain,onChange:()=>changes++});t.after(()=>modal.close());return {modal,ipcMain,get changes(){return changes;}};}
function report(f,wc,open,token=wc.sent.at(-1)?.value.token,frame=wc.mainFrame){f.ipcMain.emit('workspace:nativeModal',{sender:wc,senderFrame:frame},{token,open});}
test('overlapping sources are idempotent and only the last close releases their shared native owner',t=>{
 const f=fixture(t),win=new Window(),a=new Contents(),b=new Contents(),first=f.modal.register(a,{window:()=>win}),second=f.modal.register(b,{window:()=>win});
 assert.equal(win.listenerCount('show'),1);first.set(true);first.set(true);second.set(true);assert.equal(f.changes,1);assert.equal(f.modal.blocked(win),true);
 first.set(false);assert.equal(f.modal.blocked(win),true);assert.equal(f.changes,1);second.set(false);assert.equal(f.modal.blocked(win),false);assert.equal(f.changes,2);
 first.release();assert.equal(win.listenerCount('show'),1);second.release();assert.equal(win.listenerCount('show'),0);assert.equal(a.listenerCount('did-start-navigation'),0);
});
test('hiding suspends a modal, showing retains it, and docking transfers its hold to the actual window',t=>{
 const f=fixture(t),main=new Window(),portal=new Window(),wc=new Contents();let target=main,visible=true;
 const source=f.modal.register(wc,{window:()=>target,visible:()=>visible});source.set(true);assert.equal(f.modal.blocked(main),true);
 visible=false;source.refresh();assert.equal(f.modal.blocked(main),false);visible=true;source.refresh();assert.equal(f.modal.blocked(main),true);
 target=portal;source.refresh();assert.equal(f.modal.blocked(main),false);assert.equal(f.modal.blocked(portal),true);assert.equal(main.listenerCount('show'),0);
 source.release();assert.equal(f.modal.blocked(portal),false);assert.equal(portal.listenerCount('show'),0);
});
test('only registered current main frame, allowed origin and current document token may report a modal',t=>{
 const f=fixture(t),win=new Window(),wc=new Contents(),other=new Contents(),allowed=url=>url.startsWith('http://127.0.0.1:17910/');
 f.modal.register(wc,{window:()=>win,receive:true,allowed});wc.emit('dom-ready');const token=wc.sent.at(-1).value.token;
 report(f,wc,true,token,{url:wc.mainFrame.url});report(f,other,true,token);report(f,wc,true,'wrong');report(f,wc,'true',token);assert.equal(f.modal.blocked(win),false);
 report(f,wc,true,token);assert.equal(f.modal.blocked(win),true);wc.mainFrame.url='https://example.org/';report(f,wc,false,token);assert.equal(f.modal.blocked(win),true);
 wc.mainFrame.url='http://127.0.0.1:17910/';const oldFrame=wc.mainFrame;wc.emit('did-start-navigation',{},wc.mainFrame.url,false,true);assert.equal(f.modal.blocked(win),false);
 // Chromium may reuse WebFrameMain across a same-origin navigation. A new
 // document token still rejects the old renderer's queued open/close reports.
 wc.emit('dom-ready');const nextToken=wc.sent.at(-1).value.token;assert.notEqual(nextToken,token);report(f,wc,true,nextToken);assert.equal(f.modal.blocked(win),true);
 report(f,wc,false,token,oldFrame);assert.equal(f.modal.blocked(win),true);report(f,wc,false,nextToken);assert.equal(f.modal.blocked(win),false);
 wc.emit('did-finish-load');assert.equal(wc.sent.at(-1).value.token,nextToken);
});
test('navigation, crashes, destruction and shutdown release holds and reject late messages',t=>{
 const f=fixture(t),win=new Window(),wc=new Contents(),source=f.modal.register(wc,{window:()=>win,receive:true,allowed:()=>true});
 wc.emit('dom-ready');let token=wc.sent.at(-1).value.token;report(f,wc,true);wc.emit('did-start-navigation',{},'',true,true);assert.equal(f.modal.blocked(win),true,'same document changes keep the modal');
 wc.emit('render-process-gone');assert.equal(f.modal.blocked(win),false);report(f,wc,true,token);assert.equal(f.modal.blocked(win),false);wc.emit('did-finish-load');token=wc.sent.at(-1).value.token;report(f,wc,true,token);
 wc.destroyed=true;wc.emit('destroyed');assert.equal(f.modal.blocked(win),false);assert.equal(win.listenerCount('show'),0);assert.equal(wc.listenerCount('dom-ready'),0);source.release();source.set(true);
 const next=new Contents();f.modal.register(next,{window:()=>win}).set(true);const before=f.changes;f.modal.close();assert.equal(f.modal.blocked(win),false);assert.equal(f.changes,before,'shutdown must not repaint closed projections');assert.equal(f.ipcMain.listenerCount('workspace:nativeModal'),0);
});
test('program overlay follows authenticated modal transitions and document resets',t=>{
 const f=fixture(t),wc=new Contents(),win=new Window(),states=[];
 f.modal.register(wc,{window:()=>win,allowed:()=>true,receive:true,onState:open=>states.push(open)});
 wc.emit('dom-ready');const oldToken=wc.sent.at(-1).value.token;
 report(f,wc,true);report(f,wc,true);assert.deepEqual(states,[true]);
 wc.emit('did-start-navigation',{},wc.mainFrame.url,false,true);assert.deepEqual(states,[true,false]);
 wc.emit('dom-ready');report(f,wc,true);report(f,wc,false,oldToken);assert.deepEqual(states,[true,false,true]);
 wc.emit('render-process-gone');assert.deepEqual(states,[true,false,true,false]);
});
test('program preload queues modal state until host probe and uses the existing document token protocol',async()=>{
 const ipcRenderer=new EventEmitter(),window=new EventEmitter(),sent=[];let bridge;
 window.addEventListener=(name,fn)=>window.on(name,fn);ipcRenderer.send=(channel,value)=>sent.push({channel,value});
 vm.runInNewContext(fs.readFileSync(require.resolve('../host/plugin-preload.cjs'),'utf8'),{window,process:{isMainFrame:true},require:()=>({ipcRenderer,webUtils:{},contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}}})});
 await bridge.modalSurface(true);assert.equal(sent.length,0);
 ipcRenderer.emit('workspace:modalProbe',{}, {token:'a'.repeat(32)});assert.equal(sent.at(-1).channel,'workspace:nativeModal');assert.equal(sent.at(-1).value.open,true);
 await bridge.modalSurface(false);assert.equal(sent.at(-1).value.open,false);await bridge.modalSurface(true);
 window.emit('pagehide');assert.equal(sent.at(-1).value.open,false);const count=sent.length;await bridge.modalSurface(true);assert.equal(sent.length,count);
});
function preload(main=true,script='file-drop-preload.cjs',args=[]){
 const window=new EventEmitter(),ipcRenderer=new EventEmitter(),sent=[],observers=[];let modals=0;
 window.addEventListener=(name,fn,options)=>options?.once?window.once(name,fn):window.on(name,fn);
 ipcRenderer.send=(channel,value)=>sent.push({channel,value});
 class MutationObserver{constructor(fn){this.fn=fn;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}}
 const document={documentElement:{},querySelector:selector=>{assert.equal(selector,'dialog:modal');return modals?{}:null;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../host/'+script),'utf8'),{window,document,MutationObserver,process:{isMainFrame:main,argv:args},require:()=>({ipcRenderer,webUtils:{},contextBridge:{exposeInMainWorld(){}}})});
 return {window,ipcRenderer,sent,observers,setModals(n){modals=n;observers.at(-1)?.fn();}};
}
test('preload aggregates real modal dialogs, deduplicates mutations and reprobes each document',()=>{
 const f=preload(),first='a'.repeat(32),second='b'.repeat(32);f.window.emit('DOMContentLoaded');assert.equal(f.sent.length,0);
 f.ipcRenderer.emit('workspace:modalProbe',{}, {token:first});assert.equal(f.sent.at(-1).value.open,false);f.setModals(1);assert.equal(f.sent.at(-1).value.open,true);const before=f.sent.length;
 f.setModals(2);f.setModals(1);assert.equal(f.sent.length,before,'one closing dialog cannot release another');f.setModals(0);assert.equal(f.sent.at(-1).value.open,false);
 f.setModals(1);f.ipcRenderer.emit('workspace:modalProbe',{}, {token:second});assert.equal(f.sent.at(-1).value.token,second);assert.equal(f.sent.at(-1).value.open,true);
 f.window.emit('pagehide');assert.equal(f.sent.at(-1).value.open,false);assert.equal(f.observers[0].connected,false);f.window.emit('pageshow');assert.equal(f.observers.length,2);assert.equal(f.sent.at(-1).value.open,true);
 const child=preload(false);child.window.emit('DOMContentLoaded');child.ipcRenderer.emit('workspace:modalProbe',{}, {token:first});assert.equal(child.sent.length,0);assert.equal(child.observers.length,0);
});
test('settings resource dialogs hold the native owner, reprobe and release without changing the Agent view',()=>{
 const f=preload(true,'extension-preload.cjs',['--aieyra-extension-kind=settings']),token='c'.repeat(32);
 f.window.emit('DOMContentLoaded');assert.equal(f.sent.length,0);f.setModals(1);
 f.ipcRenderer.emit('workspace:modalProbe',{}, {token});assert.equal(f.sent.at(-1).value.open,true);
 const before=f.sent.length;f.setModals(2);f.setModals(1);assert.equal(f.sent.length,before);f.setModals(0);assert.equal(f.sent.at(-1).value.open,false);
 f.setModals(1);f.window.emit('pagehide');assert.equal(f.sent.at(-1).value.open,false);assert.equal(f.observers[0].connected,false);
 f.window.emit('pageshow');assert.equal(f.sent.at(-1).value.open,true);
 const other=preload(true,'extension-preload.cjs',['--aieyra-extension-kind=conversation']);other.window.emit('DOMContentLoaded');other.ipcRenderer.emit('workspace:modalProbe',{}, {token});assert.equal(other.sent.length,0);assert.equal(other.observers.length,0);
});

test('the browser publisher blocks both native projections for the current panel, dialog or permission only',()=>{
 const source=fs.readFileSync(require.resolve('../../../Program/official/browser/service/browser-runtime.cjs'),'utf8'),states=[];
 const wc={isDestroyed:()=>false,getURL:()=> 'about:blank',getTitle:()=>'',isLoadingMainFrame:()=>false,navigationHistory:{canGoBack:()=>false,canGoForward:()=>false}},win={isDestroyed:()=>false};
 const group={active:'active',win,profile:'default',shell:{send(){},isDestroyed:()=>false},modalSource:{set:value=>states.push(value)}};
 const active={id:'active',group,wc,win,view:{setVisible(){}},visible:false},inactive={id:'inactive',group,wc,win,view:{setVisible(){}},visible:false,dialog:{type:'alert'}};
 const context={closed:false,tabs:new Map([[active.id,active],[inactive.id,inactive]]),identities:{list:()=>[]},preferences:{read:()=>({}),cookiePolicy:()=> 'retain'},passwords:{status:()=>({available:false})},bookmarks:null,bookmarkError:'',downloads:new Map(),language:'zh-CN',tabInfo:()=>({}),downloadInfo:()=>({}),visible:()=>true,mode:()=> 'interactive',refreshBackdrop(){},changed(){}};
 vm.runInNewContext(source.slice(source.indexOf('function publish('),source.indexOf('function activate(')),context);
 context.publish(active);group.panelOverlay=true;context.publish(active);group.panelOverlay=false;active.dialog={type:'alert'};context.publish(active);active.dialog=null;active.permission={id:'permission'};context.publish(active);active.permission=null;context.publish(active);
 assert.deepEqual(states,[false,true,true,true,false],'an inactive tab dialog must not block the current native owner');
});
