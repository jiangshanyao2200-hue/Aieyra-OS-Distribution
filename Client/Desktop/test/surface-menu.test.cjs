// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/surface-menu.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createSurfaceMenu}=require('../host/surface-menu.cjs');
const {closeSurface}=require('../host/surface-lifecycle.cjs');
function fixture(t,theme){
 const handlers=new Map(),windows=[];
 class Window extends EventEmitter{
  constructor(options={}){super();this.options=options;this.bounds={x:20,y:30,width:800,height:600};this.messages=[];this.captureCount=this.boundsCount=this.showCount=this.hideCount=0;this.contentView={children:[]};this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{url:''},isDestroyed:()=>!!this.destroyed,setWindowOpenHandler(){},getZoomFactor:()=>1.25,setZoomFactor(){},setBackgroundThrottling:value=>{this.throttled=value;},focus(){},capturePage:async()=>{this.captureCount++;},send:(channel,frame)=>{this.messages.push(frame);if(!frame.phase)this.frame=frame;},loadURL:async url=>{this.webContents.mainFrame.url=url;queueMicrotask(()=>this.webContents.emit('did-finish-load'));}});windows.push(this);}
  isDestroyed(){return !!this.destroyed;}getContentBounds(){return this.bounds;}setBounds(b){this.boundsCount++;this.bounds=b;}show(){this.showCount++;this.shown=true;}isVisible(){return !!this.shown;}setOpacity(value){this.opacity=value;}showInactive(){this.show();}hide(){this.hideCount++;this.shown=false;}setIgnoreMouseEvents(){}destroy(){this.destroyed=true;}
 }
 const win=new Window(),menu=createSurfaceMenu({electron:{BrowserWindow:Window,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1000,height:800}})},ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)}},win,theme,displayDebug:true});
 const invoke=(p,sender=windows[1].webContents)=>handlers.get('surface-menu:action')({sender,senderFrame:sender.mainFrame},{...(p.action==='size'?{revision:windows[1].frame.revision}:{}),...p});
 t.after(()=>menu.close());return {menu,win,windows,invoke,handlers};
}
test('native themed menu is lazily created, clamps to the monitor and rejects stale or foreign clicks',async t=>{
 const f=fixture(t);assert.equal(f.windows.length,1);
 const first=f.menu.open({x:900,y:700,items:[{id:'detach',label:'在独立窗口中打开'}]});await new Promise(r=>setImmediate(r));
 const popup=f.windows[1],id=popup.frame.id;assert.equal(popup.options.parent,f.win);assert.equal(popup.options.skipTaskbar,true);
 assert.equal(f.invoke({id,action:'size',width:200,height:52}).ok,true);assert.deepEqual(popup.bounds,{x:750,y:735,width:250,height:65});
 assert.equal(f.invoke({id,action:'choose',value:'detach'},f.win.webContents).ok,false);
 assert.equal(f.invoke({id:id-1,action:'choose',value:'detach'}).ok,false);assert.equal(f.invoke({id,action:'choose',value:'arbitrary'}).ok,false);
 f.invoke({id,action:'choose',value:'detach'});assert.equal(await first,'detach');assert.equal(popup.shown,false);
 const second=f.menu.open({x:0,y:0,items:[{id:'detach',label:'拆出'}]});f.win.emit('resize');assert.equal(await second,null);assert.equal(f.windows.length,2);
});
test('native menu dismisses on child-page clicks and recovers after renderer failure',async t=>{
 const f=fixture(t),child=new EventEmitter();child.isDestroyed=()=>false;f.win.contentView.children=[{webContents:child}];
 const first=f.menu.open({x:20,y:30,items:[{id:'detach',label:'拆出'}]});child.emit('before-mouse-event',{}, {type:'mouseDown'});assert.equal(await first,null);assert.equal(child.listenerCount('before-mouse-event'),0);
 const second=f.menu.open({x:20,y:30,items:[{id:'detach',label:'拆出'}]});await new Promise(r=>setImmediate(r));f.windows[1].webContents.emit('render-process-gone');assert.equal(await second,null);
 const third=f.menu.open({x:20,y:30,items:[{id:'detach',label:'拆出'}]});assert.equal(f.windows.length,3);f.menu.close();assert.equal(await third,null);assert.equal(f.handlers.size,0);
});
test('surface close distinguishes docking, attached hiding, standalone and application shutdown',async()=>{
 const calls=[],actions={dock:()=>calls.push('dock'),hide:()=>calls.push('hide'),shutdown:()=>calls.push('shutdown')};
 for(const state of [{detached:true,ownerAvailable:true},{detached:false,ownerAvailable:true},{detached:true,ownerAvailable:false},{detached:true,ownerAvailable:true,quitting:true}])await closeSurface({...actions,...state});
 assert.deepEqual(calls,['dock','hide','shutdown','shutdown']);
});
test('native notice hydration updates only the same open request and cannot revive a dismissed panel',async t=>{
 const f=fixture(t),p=f.menu.open({x:10,y:20,request_id:'first',rows:[{id:'n',content:null}],items:[{id:'read:n',label:'已读'}]});await new Promise(r=>setImmediate(r));
 const popup=f.windows[1],id=popup.frame.id;
 assert.equal(f.menu.update({request_id:'old',rows:[{id:'n',content:'stale'}]}).stale,true);assert.equal(popup.frame.rows[0].content,null);
 assert.equal(f.menu.update({request_id:'first',rows:[{id:'n',content:'ready'},{id:'unrequested',content:'ignore'}]}).ok,true);assert.equal(popup.frame.id,id);assert.deepEqual(popup.frame.rows,[{id:'n',content:'ready'}]);
 f.invoke({id,action:'dismiss'});await p;assert.equal(f.menu.update({request_id:'first',rows:[{id:'n',content:'late'}]}).stale,true);assert.equal(popup.shown,false);
});

test('notice updates send a single changed body instead of resending the whole archive',async t=>{
 const f=fixture(t),rows=Array.from({length:200},(_,i)=>({id:String(i),content:'x'.repeat(16000)}));
 const p=f.menu.open({x:10,y:20,request_id:'large',rows,items:[{id:'clear',label:'清空'}]});await new Promise(r=>setImmediate(r));
 assert.equal(f.windows[1].frame.rows.length,200);
 f.menu.update({request_id:'large',rows:[{id:'100',content:'changed'}]});assert.deepEqual(f.windows[1].frame.rows,[{id:'100',content:'changed'}]);
 f.menu.close();await p;
});

test('open native menu follows theme changes with the same request and releases subscription',async t=>{
 let changed,stopped=0,version='one';const theme={read:()=>({version,settings:{theme_css:''},fields:{}}),watch:fn=>{changed=fn;return ()=>stopped++;}};
 const f=fixture(t,theme),p=f.menu.open({x:10,y:20,items:[{id:'pick',label:'选择'}]});await new Promise(r=>setImmediate(r));
 const popup=f.windows[1],id=popup.frame.id;assert.equal(popup.frame.theme.version,'one');version='two';changed();
 assert.equal(popup.frame.id,id);assert.equal(popup.frame.theme.version,'two');f.invoke({id,action:'choose',value:'pick'});assert.equal(await p,'pick');
 f.menu.close();assert.equal(stopped,1);changed();assert.equal(f.windows.length,2);
});

test('attached native titlebar notices keep the region width and top seam while content grows at 125 percent',async t=>{
 const f=fixture(t),p=f.menu.open({x:400,y:50,attachment:{kind:'topbar',width:240,maxHeight:400},rows:[{id:'n',content:'body'}],items:[{id:'clear',label:'清空'}]});await new Promise(r=>setImmediate(r));
 const popup=f.windows[1],id=popup.frame.id;assert.deepEqual(popup.frame.attachment,{kind:'topbar',width:240,maxHeight:400});
 f.invoke({id,action:'size',width:700,height:700});assert.deepEqual(popup.bounds,{x:520,y:93,width:300,height:500});
 assert.throws(()=>f.menu.open({x:400,y:50,items:[{id:'x'}],attachment:{kind:'topbar',width:NaN,maxHeight:400}}),/附着/);
 assert.equal(popup.frame.id,id,'invalid geometry cannot dismiss the current menu');
 f.menu.close();await p;
});

test('native menu first-frame cancellation rejects stale sizes and cannot resurrect a closed request',async t=>{
 const f=fixture(t),p=f.menu.open({x:20,y:30,items:[{id:'x',label:'选择'}]});await new Promise(r=>setImmediate(r));const popup=f.windows[1],{id,revision}=popup.frame;
 assert.equal(f.invoke({id,revision:revision-1,action:'size',width:200,height:50}).ok,false);
 assert.equal(f.invoke({id,revision,action:'painted'}).ok,false);
 f.invoke({id,revision,action:'size',width:200,height:50});assert.equal(popup.showCount,1);assert.equal(popup.opacity,0);assert.equal(popup.throttled,false);
 f.invoke({id,action:'dismiss'});assert.equal(await p,null);assert.equal(f.invoke({id,revision,action:'painted'}).ok,false);assert.equal(popup.shown,false);assert.equal(popup.throttled,true);
});
test('same native menu updates retain the window and bounds, and fast replacement never clears the visible frame',async t=>{
 const f=fixture(t),p=f.menu.open({x:20,y:30,request_id:'one',rows:[{id:'n',content:'body'}],items:[{id:'clear',label:'清空'}]});await new Promise(r=>setImmediate(r));const popup=f.windows[1];
 const size=()=>f.invoke({id:popup.frame.id,action:'size',width:200,height:50});size();assert.equal(popup.opacity,0);assert.equal(f.invoke({id:popup.frame.id,revision:popup.frame.revision,action:'painted'}).ok,true);assert.equal(popup.opacity,1);assert.equal(popup.throttled,true);assert.equal(popup.captureCount,0);assert.equal(popup.showCount,1);
 const messages=popup.messages.length;for(let i=0;i<20;i++){size();assert.equal(f.menu.update({request_id:'one',rows:[{id:'n',content:'body'}]}).unchanged,true);}
 assert.equal(popup.messages.length,messages);assert.equal(popup.boundsCount,1);assert.equal(popup.captureCount,0);assert.equal(popup.showCount,1);
 f.menu.update({request_id:'one',rows:[{id:'n',content:'changed'}]});size();assert.equal(popup.frame.visible,true);assert.equal(popup.captureCount,0);assert.equal(popup.showCount,1);
 const hideCount=popup.hideCount,p2=f.menu.open({x:20,y:30,items:[{id:'pick',label:'另一菜单'}]});assert.equal(await p,null);assert.equal(popup.hideCount,hideCount);assert.equal(popup.frame.visible,true);size();await new Promise(r=>setImmediate(r));
 assert.equal(popup.showCount,1);assert.equal(popup.captureCount,0);const id=popup.frame.id;f.invoke({id,action:'dismiss'});assert.equal(await p2,null);const exit=popup.messages.at(-1);assert.equal(exit.phase,'hide');assert.equal(popup.shown,true);
 assert.equal(f.invoke({id:exit.id,action:'hidden'}).ok,true);assert.equal(popup.shown,false);
});

test('native menu frame timeout releases the window and ignores a late acknowledgement',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t),p=f.menu.open({x:20,y:30,items:[{id:'x',label:'选择'}]});await new Promise(r=>setImmediate(r));const popup=f.windows[1],{id,revision}=popup.frame;
 f.invoke({id,revision,action:'size',width:200,height:50});assert.equal(popup.opacity,0);t.mock.timers.tick(2001);assert.equal(await p,null);assert.equal(popup.shown,false);assert.equal(popup.throttled,true);
 assert.equal(f.invoke({id,revision,action:'painted'}).ok,false);
});
