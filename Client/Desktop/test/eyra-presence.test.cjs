// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/eyra-presence.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createEyraPresence,publicFrame,profileFrame,presenceGeometry}=require('../host/eyra-presence.cjs');
test('native work text is bounded, current, and disappears when the role settles',()=>{
 const input={instrument:{data:{state:'thinking',name:'Eyra'}},summary:{body:'x'.repeat(2000),history:'private',model:'secret'}};
 const frame=publicFrame(input);assert.equal(frame.summary.body.length,1600);assert.equal(frame.summary.name,'Eyra');assert.equal(frame.summary.label,'正在思考');assert.equal(frame.summary.history,undefined);
 const active=presenceGeometry(900,800,1,104,0,true),idle=presenceGeometry(900,800,1,104);
 assert.equal(active.bounds.y,idle.bounds.y);assert.equal(active.bounds.height,idle.bounds.height);assert.ok(active.bounds.width>idle.bounds.width);
 for(const state of ['idle','tool','error','waiting'])assert.equal(publicFrame({...input,instrument:{data:{state}}},frame).summary,undefined);
});
function fixture(t,theme=null,options={}){
 const handlers=new Map(),views=[];let home=0;
 class Contents extends EventEmitter{constructor(){super();this.id=views.length+1;this.messages=[];this.mainFrame={url:''};}send(channel,value){this.messages.push({channel,value});}setZoomFactor(z){this.zoom=z;}getZoomFactor(){return 1;}setWindowOpenHandler(fn){this.open=fn;}loadURL(url){this.mainFrame.url=url;queueMicrotask(()=>this.emit('did-finish-load'));return Promise.resolve();}isDestroyed(){return !!this.closed;}close(){this.closed=true;}}
 class View{constructor(){this.webContents=new Contents();views.push(this);}setVisible(v){this.visible=v;}setBackgroundColor(){}setBounds(b){this.bounds=b;}}
 class Window extends EventEmitter{constructor(){super();this.visible=true;this.minimized=false;this.webContents=new Contents();this.children=[];this.contentView={addChildView:v=>{this.children=this.children.filter(x=>x!==v);this.children.push(v);},removeChildView:v=>{this.children=this.children.filter(x=>x!==v);}};}isDestroyed(){return false;}isVisible(){return this.visible;}isMinimized(){return this.minimized;}getContentSize(){return [900,800];}}
 const manager=createEyraPresence({electron:{ipcMain:{handle:(k,v)=>handlers.set(k,v),removeHandler:k=>handlers.delete(k)},WebContentsView:View},theme,initial:profileFrame({chatLayout:{ring:120}}),onHome:()=>{home++;},...options});t.after(()=>manager.close());
 const invoke=(v,name,args={},frame=v.webContents.mainFrame)=>handlers.get('eyra:'+name)({sender:v.webContents,senderFrame:frame},args);
 return {manager,views,Window,invoke,handlers,get home(){return home;}};
}

test('the overlay receives the resource theme and repaints when it changes',async t=>{
 let css='body{--a:#111111}',changed=null,stopped=0;const f=fixture(t,{read:()=>({settings:{theme_css:css}}),watch(fn){changed=fn;return ()=>{stopped++;};}}),win=new f.Window();
 const surface=f.manager.mount({window:()=>win});surface.refresh();await new Promise(r=>setImmediate(r));f.views[0].webContents.emit('did-finish-load');
 const last=()=>f.views[0].webContents.messages.filter(m=>m.channel==='eyra:frame').at(-1).value;
 assert.equal(last().themeCss,'body{--a:#111111}');
 css='';changed();assert.equal(last().themeCss,'');
 f.manager.close();assert.equal(stopped,1);
});

test('browser overlay follows the normal shelf without changing ring size or reserving page space',async t=>{
 const f=fixture(t),win=new f.Window();let shelf=56;
 const surface=f.manager.mount({window:()=>win,bottomInset:()=>shelf});surface.refresh();await new Promise(r=>setImmediate(r));
 const view=f.views[0],original={...view.bounds};shelf=96;surface.refresh();
 assert.equal(view.bounds.y,original.y-40);assert.equal(view.bounds.height,original.height);
 for(const z of [1,1.25,1.5]){const g=presenceGeometry(1000,800,z,120,96);assert.ok(g.bounds.y+g.bounds.height<=800-96*z);}
});
test('public projection excludes chat, draft and model credentials, preserving the selected visual geometry',()=>{
 const frame=publicFrame({draft:'private',task:'private',model:{key:'secret'},instrument:{data:{state:'tool',name:'Eyra',secret:'private'},code:'>_02',avatar:'https://private.example/avatar'},ringSize:120});
 assert.deepEqual(Object.keys(frame).sort(),['effect','instrument','reduced','ringSize']);assert.equal(frame.instrument.data.secret,undefined);assert.equal(frame.instrument.avatar,'');assert.equal(frame.instrument.code,'>_02');
 assert.equal(profileFrame({}).ringSize,110);assert.equal(presenceGeometry(1000,800,1,120).ring,120);assert.equal(presenceGeometry(1000,550,1,120).ring,64);assert.equal(presenceGeometry(1000,800,2,120).ring,64);
});
test('one projection survives moving containers; inactive pages have no view or live animation',async t=>{
 const f=fixture(t);let win=new f.Window(),active=false;const surface=f.manager.mount({window:()=>win,visible:()=>active});surface.refresh();assert.equal(f.views.length,0);
 active=true;surface.refresh();await new Promise(r=>setImmediate(r));const view=f.views[0];let sent=view.webContents.messages.findLast(x=>x.channel==='eyra:frame').value;
 assert.equal(f.invoke(view,'painted',{revision:sent.revision}).ok,true);assert.equal(surface.state().visible,true);
 active=false;surface.refresh();assert.equal(view.visible,false);assert.deepEqual(view.webContents.messages.at(-1),{channel:'eyra:visibility',value:{visible:false}});
 assert.equal(f.invoke(view,'painted',{revision:sent.revision}).ok,false);assert.equal((await f.invoke(view,'home')).ok,false);
 const previous=win;surface.unparent();win=new f.Window();active=true;surface.refresh();assert.equal(previous.children.length,0);assert.equal(f.views.length,1);assert.equal(win.children[0],view);
 win.minimized=true;win.emit('minimize');assert.equal(view.visible,false);win.minimized=false;win.emit('restore');assert.equal(view.visible,true);
 const count=view.webContents.messages.length;win.visible=false;win.emit('hide');surface.refresh();surface.refresh();assert.equal(view.webContents.messages.length,count+1);
 surface.destroy();assert.equal(view.webContents.closed,true);assert.equal(win.children.length,0);assert.equal(win.listenerCount('resize'),0);
});
test('only the exact visible projection main frame can request home; stale render acknowledgements are ignored',async t=>{
 const f=fixture(t),win=new f.Window();const s=f.manager.mount({window:()=>win});s.refresh();await new Promise(r=>setImmediate(r));const v=f.views[0],old=v.webContents.messages.findLast(x=>x.channel==='eyra:frame').value;
 assert.equal((await f.invoke(v,'home',{}, {url:v.webContents.mainFrame.url})).ok,false);assert.equal(f.home,0);
 f.manager.setFrame({ringSize:130});assert.equal(f.invoke(v,'painted',{revision:old.revision}).ok,false);
 assert.equal((await f.invoke(v,'home')).ok,true);assert.equal(f.home,1);f.manager.close();assert.equal(f.handlers.size,0);
});

test('a crashed projection hides immediately and recovers on the next visible refresh without a second view',async t=>{
 const f=fixture(t),win=new f.Window(),surface=f.manager.mount({window:()=>win});surface.refresh();await new Promise(r=>setImmediate(r));const v=f.views[0];v.webContents.emit('render-process-gone');assert.equal(v.visible,false);surface.refresh();await new Promise(r=>setImmediate(r));assert.equal(f.views.length,1);assert.equal(v.visible,true);assert.equal(surface.state().visible,true);
});

test('projections sharing one native owner share event subscriptions and release the last subscription',async t=>{
 const f=fixture(t),first=new f.Window(),second=new f.Window();let target=first;
 const surfaces=Array.from({length:12},()=>f.manager.mount({window:()=>target,visible:()=>false}));
 for(const s of surfaces)s.refresh();
 for(const event of ['show','hide','minimize','restore','resize'])assert.equal(first.listenerCount(event),1);
 assert.equal(f.views.length,0,'inactive projections still create no renderer');
 target=second;first.emit('resize');assert.equal(first.listenerCount('resize'),0);assert.equal(second.listenerCount('resize'),1);
 for(const s of surfaces.slice(1))s.destroy();assert.equal(second.listenerCount('resize'),1);
 surfaces[0].destroy();assert.equal(second.listenerCount('resize'),0);assert.equal(f.views.length,0);
});

test('native role receives layout selection and typography without profile data',async t=>{
 let changed,version='one';const selected={id:'example.columns',digest:'a'.repeat(64),definition:{schema:'aieyra.theme/1',elements:'1.0.0'}};
 const f=fixture(t,{read:()=>({version,settings:{layout_theme:selected,regions:{interface:{size:18}}},fields:{},background:'PRIVATE_IMAGE',profile:{key:'PRIVATE_KEY'}}),watch:fn=>{changed=fn;return ()=>{};}}),win=new f.Window();
 f.manager.mount({window:()=>win}).refresh();await new Promise(r=>setImmediate(r));
 const last=()=>f.views[0].webContents.messages.filter(m=>m.channel==='eyra:frame').at(-1).value;
 assert.deepEqual(last().appearanceTheme.settings.layout_theme,selected);assert(!JSON.stringify(last()).includes('PRIVATE'));version='two';changed();assert.equal(last().appearanceTheme.version,'two');
});

test('a modal hold survives frame, theme, handover and native restore; release reuses the latest projection',async t=>{
 let blocked=false,changed;const f=fixture(t,{read:()=>({}),watch:fn=>{changed=fn;return ()=>{};}},{blocked:()=>blocked}),win=new f.Window(),surface=f.manager.mount({window:()=>win});
 surface.refresh();await new Promise(r=>setImmediate(r));const view=f.views[0],old=view.webContents.messages.findLast(m=>m.channel==='eyra:frame').value;
 blocked=true;assert.equal(f.invoke(view,'painted',{revision:old.revision}).ok,false);assert.equal((await f.invoke(view,'home')).ok,false);assert.equal((await f.invoke(view,'input')).ok,false);
 f.manager.refresh();assert.equal(view.visible,false);const count=view.webContents.messages.length;
 f.manager.setFrame({instrument:{data:{state:'thinking',name:'Eyra'}},summary:{body:'当前思考'}});f.manager.suppress(win);f.manager.suppress(null);changed();win.emit('restore');surface.raise();
 assert.equal(view.visible,false);assert.equal(view.webContents.messages.length,count);blocked=false;f.manager.refresh();assert.equal(f.views.length,1);assert.equal(view.visible,true);
 const latest=view.webContents.messages.findLast(m=>m.channel==='eyra:frame').value;assert.equal(latest.summary.body,'当前思考');assert.equal(f.invoke(view,'painted',{revision:old.revision}).ok,false);assert.equal(f.invoke(view,'painted',{revision:latest.revision}).ok,true);
});
