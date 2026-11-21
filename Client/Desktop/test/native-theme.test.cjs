// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: environment; appearance; flush
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/native-theme.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>


'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
function environment(){
 const windows=[],views=[],handlers=new Map();
 class Contents extends EventEmitter{constructor(){super();this.messages=[];this.mainFrame={};this.captureCount=0;this.backgroundThrottling=true;}isDestroyed(){return !!this.closed;}send(channel,value){this.messages.push({channel,value});}getZoomFactor(){return 1;}setZoomFactor(){}setBackgroundThrottling(value){this.backgroundThrottling=value;}setWindowOpenHandler(){}async capturePage(){this.captureCount++;}loadURL(url){this.mainFrame.url=url;queueMicrotask(()=>this.emit('did-finish-load'));return Promise.resolve();}close(){this.closed=true;}}
 class View{constructor(){this.webContents=new Contents();views.push(this);}setBackgroundColor(){}setBounds(value){this.bounds=value;}}
 class Window extends EventEmitter{constructor(){super();this.webContents=new Contents();this.contentView={addChildView(){}};this.showCount=this.hideCount=this.boundsCount=0;windows.push(this);}getContentSize(){return [800,600];}getContentBounds(){return {x:0,y:0,width:800,height:600};}isDestroyed(){return !!this.destroyed;}loadFile(){return Promise.resolve();}hide(){this.hideCount++;this.visible=false;}showInactive(){this.showCount++;this.visible=true;}setOpacity(value){this.opacity=value;}setBounds(b){this.boundsCount++;this.bounds=b;}isVisible(){return !!this.visible;}setIgnoreMouseEvents(){}destroy(){this.destroyed=true;this.emit('closed');}close(){this.destroy();}}
 return {windows,views,electron:{BrowserWindow:Window,WebContentsView:View,ipcMain:{handle:(n,fn)=>handlers.set(n,fn),removeHandler:n=>handlers.delete(n)},screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:800,height:600}})}},handlers,Window};
}
function appearance(){let version='one',change=null,stopped=0;return {get stopped(){return stopped;},update(){version='two';change();},theme:{read:()=>({version,settings:{layout_theme:{id:'example.theme',digest:'a'.repeat(64)},regions:{}},fields:{},background:'PRIVATE_BACKGROUND',config:'PRIVATE_CONFIG'}),watch(fn){change=fn;return ()=>stopped++;}}};}
test('program window theme reaches only trusted chrome and unsubscribes on close',()=>{
 const f=environment(),a=appearance(),{ShellWindow}=require('../host/shell-window.cjs');
 const window=new ShellWindow({electron:f.electron,theme:a.theme,title:'Owned program'});window.host.webContents.emit('did-finish-load');
 const received=window.host.webContents.messages.at(-1);assert.equal(received.channel,'shell-window:theme');assert.equal(received.value.version,'one');assert(!JSON.stringify(received).includes('PRIVATE'));assert.equal(window.webContents.messages.length,0);
 a.update();assert.equal(window.host.webContents.messages.at(-1).value.version,'two');
 const invoke=f.handlers.get('shell-window:action');assert.equal(invoke({sender:window.webContents},{action:'theme'}).ok,false);
 window.close();assert.equal(a.stopped,1);assert(window.webContents.isDestroyed());
});
test('visible native tooltip updates theme with its original request and never revives when hidden',async()=>{
 const f=environment(),a=appearance(),owner=new f.Window(),{createTipWindow}=require('../host/tip-window.cjs');
 const tip=createTipWindow({electron:f.electron,win:owner,theme:a.theme});tip.call({action:'show',text:'示例',x:20,y:30,width:30,height:20});await new Promise(r=>setImmediate(r));
 const popup=f.windows[1],last=()=>popup.webContents.messages.at(-1).value,id=last().id;assert.equal(last().appearanceTheme.version,'one');assert(!JSON.stringify(last()).includes('PRIVATE'));a.update();assert.equal(last().id,id);assert.equal(last().appearanceTheme.version,'two');
 const size=f.handlers.get('tip:size'),revision=last().revision;assert.equal(size({sender:popup.webContents},{id,revision,width:-1,height:20}).ok,false);size({sender:popup.webContents},{id,revision,width:9000,height:9000});assert.equal(popup.bounds.width,800);assert.equal(popup.bounds.height,600);
 tip.call({action:'hide'});const n=popup.webContents.messages.length;a.update();assert.equal(popup.webContents.messages.length,n);assert.equal(tip.state().visible,false);
 tip.close();assert.equal(a.stopped,1);assert.equal(f.handlers.size,0);
});
test('model native tip carries only public details and rejects invalid prices',async()=>{
 const f=environment(),owner=new f.Window(),{createTipWindow}=require('../host/tip-window.cjs'),tip=createTipWindow({electron:f.electron,win:owner});
 tip.call({action:'show',text:'模型',model:{id:'model',name:'示例模型',api_key:'PRIVATE_KEY',endpoint:'PRIVATE_URL',context_window:128000,info:{vision:false,tool_calls:true,price:{input:1.25,output:10,cache_read:NaN},secret:'PRIVATE_INFO'}},x:20,y:30,width:40,height:20});
 await new Promise(r=>setImmediate(r));const frame=f.windows[1].webContents.messages.at(-1).value;
 assert(!JSON.stringify(frame).includes('PRIVATE'));assert.equal(frame.model.info.context_window,128000);assert.equal(frame.model.info.vision,false);assert.equal(frame.model.info.price.input,1.25);assert.equal(frame.model.info.price.cache_read,null);tip.close();
});

const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('native tooltip waits behind transparency for its current rendered frame, then refreshes without re-showing',async t=>{
 const f=environment(),owner=new f.Window(),{createTipWindow}=require('../host/tip-window.cjs'),tip=createTipWindow({electron:f.electron,win:owner});t.after(()=>tip.close());
 const payload={action:'show',text:'等待中',x:20,y:30,width:40,height:20};tip.call(payload);await flush();const popup=f.windows[1],size=f.handlers.get('tip:size');
 const frame=()=>popup.webContents.messages.filter(m=>m.value.revision&&!m.value.phase).at(-1).value;
 const ack=()=>size({sender:popup.webContents},{id:frame().id,revision:frame().revision,painted:true});
 const measure=()=>size({sender:popup.webContents},{id:frame().id,revision:frame().revision,width:180,height:34});
 const messages=popup.webContents.messages.length;for(let i=0;i<20;i++)tip.call(payload);assert.equal(popup.webContents.messages.length,messages);
 assert.equal(ack().ok,false,'paint before current layout is rejected');measure();assert.equal(popup.showCount,1);assert.equal(popup.opacity,0);assert.equal(tip.state().visible,false);assert.equal(popup.webContents.backgroundThrottling,false);
 assert.equal(ack().ok,true);assert.equal(popup.opacity,1);assert.equal(tip.state().visible,true);assert.equal(popup.webContents.backgroundThrottling,true);assert.equal(popup.webContents.captureCount,0,'no hidden screenshot dependency');
 for(let i=0;i<20;i++)measure();assert.equal(popup.showCount,1);assert.equal(popup.boundsCount,1);
 tip.call({...payload,text:'等待更新'});measure();assert.equal(popup.showCount,1);assert.equal(popup.boundsCount,1);assert.equal(popup.opacity,1);
});
test('cancelled and outdated native frames cannot reveal a replacement or hide an already visible tooltip',async t=>{
 const f=environment(),owner=new f.Window(),{createTipWindow}=require('../host/tip-window.cjs'),tip=createTipWindow({electron:f.electron,win:owner});t.after(()=>tip.close());
 const payload={action:'show',text:'第一项',x:20,y:30,width:40,height:20};tip.call(payload);await flush();const popup=f.windows[1],size=f.handlers.get('tip:size');
 const prepare=()=>{const frame=popup.webContents.messages.at(-1).value;size({sender:popup.webContents},{id:frame.id,revision:frame.revision,width:180,height:34});return {id:frame.id,revision:frame.revision,painted:true};};
 const old=prepare();tip.call({action:'hide',immediate:true});assert.equal(popup.visible,false);assert.equal(popup.webContents.backgroundThrottling,true);
 tip.call({...payload,text:'第二项'});const current=prepare();assert.equal(size({sender:popup.webContents},old).ok,false);assert.equal(popup.opacity,0);assert.equal(tip.state().visible,false);
 assert.equal(size({sender:popup.webContents},current).ok,true);assert.equal(popup.opacity,1);
 tip.call({action:'hide'});const exit=popup.webContents.messages.at(-1).value;assert.equal(exit.phase,'hide');assert.equal(popup.visible,true);
 tip.call({...payload,text:'新一项'});assert.equal(size({sender:popup.webContents},{id:exit.id,hidden:true}).ok,false);assert.equal(popup.visible,true);
 owner.emit('resize');assert.equal(popup.visible,false);assert.equal(size({sender:popup.webContents},current).ok,false);
});
test('native tooltip theme revision invalidates prior paint and a missing frame releases the transparent popup',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=environment(),a=appearance(),owner=new f.Window(),{createTipWindow}=require('../host/tip-window.cjs'),tip=createTipWindow({electron:f.electron,win:owner,theme:a.theme});t.after(()=>tip.close());
 tip.call({action:'show',text:'主题更新',x:20,y:30,width:40,height:20});await flush();const popup=f.windows[1],size=f.handlers.get('tip:size');
 const first=popup.webContents.messages.at(-1).value;size({sender:popup.webContents},{id:first.id,revision:first.revision,width:180,height:34});
 a.update();const next=popup.webContents.messages.at(-1).value;assert.equal(size({sender:popup.webContents},{id:first.id,revision:first.revision,painted:true}).ok,false);
 size({sender:popup.webContents},{id:next.id,revision:next.revision,width:190,height:36});assert.equal(popup.opacity,0);
 t.mock.timers.tick(2001);assert.equal(popup.visible,false);assert.equal(popup.webContents.backgroundThrottling,true);assert.equal(tip.state().visible,false);
 assert.equal(size({sender:popup.webContents},{id:next.id,revision:next.revision,painted:true}).ok,false);
});
