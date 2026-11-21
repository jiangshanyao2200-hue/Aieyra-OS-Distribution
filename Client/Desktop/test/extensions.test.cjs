// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/extensions.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createExtensions}=require('../host/extensions.cjs'),{bindingKey}=require('../host/observation.cjs');
for(const kind of ['workspace','settings'])test(kind+' dialogs hold their actual owner, follow page visibility and release on destruction',async t=>{
 const registrations=[],nativeModal={register(wc,options){const source={wc,...options,open:false,refresh(){},set(open){this.open=open;},release(){this.released=true;}};registrations.push(source);return source;}};
 const f=fixture(t,{nativeModal});f.ext.open({key:kind});await new Promise(r=>setImmediate(r));
 const page=f.views.find(v=>kind==='workspace'?v.url?.includes('/workspace/dist/index.html'):v.url?.endsWith('/index.html?extension=settings')),source=registrations.find(s=>s.wc===page.webContents);
 assert.ok(source);assert.equal(source.receive,true);assert.equal(source.allowed(page.url),true);assert.equal(source.allowed(page.url+'?foreign'),false);
 assert.equal((await f.invoke(page,'modalSurface',{open:true})).ok,false,'programs cannot bypass the document token through generic IPC');source.set(true);source.onState(true);assert.equal(source.visible(),true);assert.equal(source.window(),f.main);
 await f.invoke(page,'hide');assert.equal(source.visible(),false);assert.equal(source.open,true,'hidden dialog remains open in its own page');
 f.ext.detach({key:kind});assert.notEqual(source.window(),f.main);assert.equal(source.visible(),true);
 source.set(false);source.onState(false);assert.equal(source.open,false);
 assert.match((await f.invoke(page,'modalSurface',{open:true},{url:page.url})).error,/来源/);
 f.ext.close();assert.equal(source.released,true);
});
function fixture(t,{offscreen=true,onChange=()=>{},options={},invokeResult={ok:true},presence=null,coreReply=null,invokeReply=null,prepareRelease=()=>{},onPageEvent=()=>{},nativeModal=null}={}){
 const windows=[],views=[],handlers=new Map(),calls=[],subscriptions=new Map();let id=0;
 function contents(target){
  const wc=new EventEmitter();wc.id=target.id;wc.mainFrame={url:''};wc.isDestroyed=()=>!!target.destroyed;wc.setWindowOpenHandler=()=>{};wc.send=(name,value)=>calls.push({window:target.id,name,value});
  wc.close=()=>{target.destroyed=true;};wc.focus=()=>{};wc.isFocused=()=>false;wc.getZoomFactor=()=>1;
  wc.loadURL=url=>{target.url=url;wc.mainFrame.url=url;queueMicrotask(()=>wc.emit('did-finish-load'));return Promise.resolve();};return wc;
 }
 class Window extends EventEmitter{
  constructor(options={}){super();this.id=++id;this.options=options;this.bounds={x:200,y:150,width:options.width||900,height:options.height||600};this.visible=false;this.destroyed=false;this.webContents=contents(this);this.children=new Set();this.contentView={addChildView:v=>this.children.add(v),removeChildView:v=>this.children.delete(v)};windows.push(this);}
  loadURL(url){return this.webContents.loadURL(url);}
  getContentSize(){return [this.bounds.width,this.bounds.height];}getContentBounds(){return this.bounds;}
  getNormalBounds(){return this.bounds;}getBounds(){return this.bounds;}setBounds(bounds){this.bounds=bounds;this.emit('move');}isDestroyed(){return this.destroyed;}isVisible(){return this.visible;}isMinimized(){return false;}isMaximized(){return false;}
  show(){this.visible=true;this.emit('show');}showInactive(){this.show();}hide(){this.visible=false;this.emit('hide');}focus(){calls.push({focus:this.id});}minimize(){this.emit('minimize');}destroy(){this.destroyed=true;this.emit('closed');}
 }
 class View {constructor(){this.id=++id;this.webContents=contents(this);views.push(this);}setVisible(v){this.visible=v;}setBounds(b){this.bounds=b;}setBackgroundColor(){}}
 const main=new Window(),screen=new EventEmitter();screen.getDisplayMatching=()=>({workArea:{x:0,y:0,width:1920,height:1080}});
 const hub={counts:{},subscribe:(key,binding,notify)=>subscriptions.set(key,{binding,notify}),visible:(key,v)=>calls.push({visible:key,value:v}),frame:key=>({status:'ready',binding:subscriptions.get(key)?.binding}),unsubscribe:key=>subscriptions.delete(key),assertScope:(key,args)=>{const b=subscriptions.get(key).binding;for(const prop of ['task_id','agent_id','generation'])if(args[prop]!=null&&args[prop]!==b[prop])throw Error('scope mismatch');return {task_id:b.task_id,agent_id:b.agent_id,generation:b.generation};},close:()=>subscriptions.clear()};
 const ext=createExtensions({nativeModal,prepareRelease,onPageEvent,electron:{BrowserWindow:Window,WebContentsView:View,screen,ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name),on:(name,handler)=>handlers.set(name,handler),removeListener:name=>handlers.delete(name)}},owner:()=>main,hub,presence,offscreen,onChange,options,core:async(action,args)=>{calls.push({action,args});return coreReply?coreReply(action,args):{ok:true};},invoke:async(method,args,owner)=>{calls.push({method,args,owner:owner.id});return invokeReply?invokeReply(method,args,owner):invokeResult;},openLink:async args=>{calls.push({link:args});}});
 const binding={task_id:'task',agent_id:'agent',role:'execution',generation:2,core_epoch:'core'};
 const row={kind:'agent',key:bindingKey(binding),title:'Cota',state:'running',binding};
 const invoke=(window,method,args={},frame=window.webContents.mainFrame)=>handlers.get('extension:invoke')({sender:window.webContents,senderFrame:frame},{method,args});
 t.after(()=>ext.close());return {ext,windows,views,main,screen,subscriptions,calls,row,invoke,handlers};
}
test('renderer recovery has fresh readiness, contains load failures and retains the same canvas surface',async t=>{
 const events=[],f=fixture(t,{onPageEvent:event=>events.push(event)});f.ext.open({key:'workspace'});await f.ext.ready('workspace');
 const view=f.views.find(v=>v.url?.includes('/workspace/dist/')),wc=view.webContents,first=f.ext.ready('workspace');
 let crashed=true;wc.isCrashed=()=>crashed;const sentBeforeCrash=f.calls.filter(c=>c.window===wc.id).length;
 wc.emit('render-process-gone',{}, {reason:'crashed',exitCode:2});await assert.rejects(f.ext.ready('workspace'),/已退出/);
 f.ext.broadcast('appearance',{theme:'dark'});f.ext.surface({key:'workspace',visible:false});assert.equal(f.calls.filter(c=>c.window===wc.id).length,sentBeforeCrash,'a disposed renderer frame must not receive notifications');
 let complete;wc.loadURL=()=>new Promise(resolve=>{complete=()=>{crashed=false;wc.emit('did-finish-load');resolve();};});
 f.ext.open({key:'workspace'});const recovering=f.ext.ready('workspace');assert.notEqual(recovering,first);let ready=false;recovering.then(()=>{ready=true;});
 await new Promise(r=>setImmediate(r));assert.equal(ready,false,'old readiness cannot authorize work in a new document');f.ext.open({key:'workspace'});assert.equal(f.ext.ready('workspace'),recovering);assert.equal(f.calls.filter(c=>c.window===wc.id).length,sentBeforeCrash);complete();await recovering;
 assert.ok(f.calls.filter(c=>c.window===wc.id).length>sentBeforeCrash,'the recovered document receives current state again');
 wc.emit('did-start-navigation',{},view.url,false,true);const reload=f.ext.ready('workspace');assert.notEqual(reload,recovering);wc.emit('did-finish-load');await reload;
 wc.emit('render-process-gone',{}, {reason:'oom',exitCode:3});wc.loadURL=async()=>{throw Error('synthetic load failure');};f.ext.open({key:'workspace'});await assert.rejects(f.ext.ready('workspace'),/synthetic load failure/);
 wc.loadURL=async()=>{wc.emit('did-finish-load');};f.ext.open({key:'workspace'});await f.ext.ready('workspace');assert.equal(f.ext.contents('workspace'),wc);
 assert.equal(f.views.filter(v=>v.url?.includes('/workspace/dist/')).length,1);assert.ok(events.some(e=>e.type==='gone'&&e.reason==='oom'));assert.ok(events.some(e=>e.type==='load-failed'));assert.ok(events.some(e=>e.type==='navigating'));
});
test('unopened entries create only the active rail; opening and moving reuses one observer',async t=>{
 const f=fixture(t);f.ext.publish([f.row]);assert.equal(f.windows.length,2);assert.equal(f.subscriptions.size,0);
 f.ext.open({key:f.row.key});const observer=f.windows.at(-1);await new Promise(r=>setImmediate(r));assert.equal(f.subscriptions.size,1);
 f.ext.detach({key:f.row.key,x:1200,y:300});assert.equal(f.windows.at(-1),observer);assert.equal(f.ext.state().windows[0].placement,'detached');
 f.ext.dock({key:f.row.key});assert.equal(f.windows.length,3);assert.equal(f.ext.state().windows[0].placement,'attached');
 const closing={preventDefault(){this.prevented=true;}};observer.emit('close',closing);assert.equal(closing.prevented,true);assert.equal(observer.destroyed,false);assert.equal(f.ext.state().windows[0].visible,false);
 f.ext.open({key:f.row.key});assert.equal(f.windows.at(-1),observer);assert.equal(f.calls.filter(c=>c.action).length,0,'moving or closing never sends any execution operation');
});
test('extension IPC rejects other frames, task mutation and configuration writes from observers',async t=>{
 const f=fixture(t);f.ext.publish([f.row]);f.ext.open({key:f.row.key});const observer=f.windows.at(-1);
 assert.equal((await f.invoke(observer,'send',{text:'injected'})).ok,false);assert.equal((await f.invoke(observer,'updates',{action:'assist'})).ok,false);assert.equal((await f.invoke(observer,'cancel')).ok,false);assert.equal((await f.invoke(observer,'settingsBootstrap')).ok,false);
 assert.equal((await f.invoke(observer,'appearance',{action:'os_appearance_update',patch:{}})).ok,false);
 assert.equal((await f.invoke(observer,'terminalRead',{task_id:'other',session_id:1})).ok,false);
 assert.equal((await f.invoke(observer,'frame',{}, {url:observer.url})).ok,false);
 assert.equal((await f.invoke(observer,'terminals')).ok,true);assert.deepEqual(f.calls.find(c=>c.action==='workspace.terminals').args,{task_id:'task',agent_id:'agent',generation:2});
});
test('only the settings editor reads preset history; observers and its own native title get current appearance',async t=>{
 const full={ok:true,version:'v1',fields:{size:{min:8}},settings:{regions:{assistant:{size:23}},layout_theme:{id:'example.current'},theme_profiles:{private:'PRIVATE_HISTORY'},theme_presets:{private:'PRIVATE_PRESET'}},theme_status:{private:'PRIVATE_STATUS'},defaults:{},note:'PRIVATE_EDITOR_NOTE'};
 const f=fixture(t,{invokeResult:full}),read=w=>f.invoke(w,'appearance',{action:'os_appearance_read'});
 f.ext.detach({key:'settings'});const editor=f.views[0],title=f.windows.at(-1);
 assert.deepEqual(await read(editor),full);
 const expected={settings:{regions:full.settings.regions,layout_theme:full.settings.layout_theme},fields:full.fields,version:'v1'};
 assert.deepEqual(await read(title),expected);assert.equal((await f.invoke(title,'appearance',{action:'os_appearance_update'})).ok,false);
 f.ext.publish([f.row]);f.ext.open({key:f.row.key});const observer=f.windows.at(-1);assert.deepEqual(await read(observer),expected);
 const key=f.ext.registerConversation({id:'c'.repeat(32),title:'Conversation'});f.ext.open({key});assert.deepEqual(await read(f.views.at(-1)),expected);
 assert.equal(full.settings.theme_presets.private,'PRIVATE_PRESET','projection does not mutate the editor state');
});
test('observer appearance read failures remain errors without carrying full configuration',async t=>{
 const f=fixture(t,{invokeResult:{ok:false,code:'appearance_invalid',error:'Unavailable',settings:{private:'PRIVATE'},fields:{}}});f.ext.publish([f.row]);f.ext.open({key:f.row.key});
 assert.deepEqual(await f.invoke(f.windows.at(-1),'appearance',{action:'os_appearance_read'}),{ok:false,code:'appearance_invalid',error:'Unavailable'});
});
test('settings drafts survive hide and relocation while settings saves notify the main renderer',async t=>{
 const f=fixture(t);f.ext.open({key:'settings'});const settings=f.views.find(w=>w.url?.endsWith('index.html?extension=settings'));assert.ok(settings);assert.equal(f.windows.length,1,'ordinary settings open creates no popup');assert.ok(f.main.children.has(settings));
 f.ext.surface({visible:true,bounds:{x:0,y:56,width:700,height:500},overlayClearance:{bottom:170,wide:true}});
 assert.equal(settings.bounds.height,500,'clearance changes the scroll area, never the native viewport');
 assert.deepEqual((await f.invoke(settings,'describe')).overlayClearance,{bottom:170,wide:true});
 assert.equal((await f.invoke(settings,'settingsBootstrap')).ok,true);assert.equal((await f.invoke(settings,'updates',{action:'status'})).ok,false);assert.equal((await f.invoke(settings,'greet')).ok,false);
 await f.invoke(settings,'saveProfile',{name:'new'});assert.ok(f.calls.some(c=>c.name==='workspace:settingsChanged'&&c.value.method==='saveProfile'));
 await f.invoke(settings,'hide');f.ext.open({key:'settings'});await f.invoke(settings,'detach');
 const detached=f.windows.at(-1);assert.equal(detached.options.parent,undefined);assert.ok(detached.children.has(settings));assert.equal(f.main.children.has(settings),false);
 await f.invoke(settings,'dock');assert.ok(f.main.children.has(settings));assert.equal(detached.destroyed,true);assert.equal(f.views.length,1);assert.equal(f.calls.filter(c=>c.method==='settingsBootstrap').length,1);
});
test('OS teardown destroys only its extension surfaces and releases observation subscriptions',t=>{
 const f=fixture(t);f.ext.publish([f.row]);f.ext.open({key:f.row.key});const children=f.windows.slice(1);f.ext.close();assert.ok(children.every(w=>w.destroyed));assert.equal(f.main.destroyed,false);assert.equal(f.subscriptions.size,0);assert.equal(f.handlers.size,0);
});
test('preparing an attached page stays hidden through load and owner layout until navigation selects it',async t=>{
 const f=fixture(t,{offscreen:false});f.main.show();
 f.ext.open({key:'servers',deferSurface:true});const page=f.views.at(-1);
 assert.equal(page.visible,false);assert.equal(f.ext.state().windows[0].visible,false);
 f.main.emit('resize');await new Promise(r=>setTimeout(r,35));assert.equal(page.visible,false);
 f.ext.surface({key:'servers',visible:true,bounds:{x:0,y:56,width:850,height:500}});assert.equal(page.visible,true);
 f.ext.surface({key:'servers',visible:false});f.ext.open({key:'servers',deferSurface:true});
 assert.equal(f.views.at(-1),page);assert.equal(page.visible,false,'late repeated preparation cannot flash a retained page');
});
test('preparing a page already detached still restores its independent window',t=>{
 const f=fixture(t,{offscreen:false});f.main.show();f.ext.detach({key:'servers'});
 const window=f.ext.window('servers');window.hide();assert.equal(window.isVisible(),false);
 const result=f.ext.open({key:'servers',deferSurface:true});
 assert.equal(result.placement,'detached');assert.equal(result.visible,true);assert.equal(window.isVisible(),true);
});
test('native Link moves the same content and its remote page never obtains extension privileges',async t=>{
 const f=fixture(t),portal=f.ext.nativePage({key:'link',title:'Link',url:'http://127.0.0.1:9200/',webPreferences:{preload:undefined,nodeIntegration:false,contextIsolation:true,sandbox:true}});
 const page=f.views[0];await page.webContents.loadURL('http://127.0.0.1:9200/');portal.layout({visible:true,bounds:{x:0,y:40,width:900,height:500}});
 assert.equal((await f.invoke(page,'settingsBootstrap')).ok,false);assert.equal((await f.invoke(page,'account',{action:'logout'})).ok,false);
 f.ext.detach({key:'link'});const detached=f.windows.at(-1);assert(detached.children.has(page));portal.layout({visible:false});assert.equal(portal.shown(),true);
 const close={preventDefault(){this.prevented=true;}};detached.emit('close',close);assert(close.prevented);assert(f.main.children.has(page));assert.equal(page.destroyed,undefined);assert.equal(f.views.length,1,'same live page; the title shell belongs to its temporary window');assert.equal(detached.destroyed,true);
 portal.destroy();assert.equal(page.destroyed,true);
});

test('conversation surfaces reuse their renderer and force all calls to the owning agent',async t=>{
 const f=fixture(t),id='a'.repeat(32),key=f.ext.registerConversation({id,title:'对话一'});f.ext.open({key});
 const view=f.views[0];assert.ok(view.url.endsWith('conversation.html?id='+id));assert.equal(f.subscriptions.size,0);
 assert.equal((await f.invoke(view,'conversation',{action:'send',id:'b'.repeat(32),message:'hello'})).ok,true);
 assert.equal(f.calls.find(c=>c.method==='conversation').args.id,id);
 await f.invoke(view,'conversation',{action:'draft_save',id:'b'.repeat(32),token:'owned',sequence:1,draft:{value:'private'}});
 assert.equal(f.calls.findLast(c=>c.method==='conversation').args.id,id,'draft writes are bound to the owning conversation');
 assert.equal((await f.invoke(view,'conversation',{action:'create'})).ok,false);
 assert.equal((await f.invoke(view,'settingsBootstrap')).ok,false);
 await f.invoke(view,'stageAttachmentPaths',{paths:['image.png']});assert.equal(f.calls.find(c=>c.method==='conversationAttachment').args.id,id);
 f.ext.detach({key});const shell=f.windows.at(-1);assert.ok(shell.children.has(view));await f.invoke(shell,'closeWindow');
 assert.ok(f.main.children.has(view));assert.equal(f.views.length,1);assert.equal(f.ext.state().windows[0].placement,'attached');
 assert.equal(f.calls.filter(c=>c.action).length,0);
});

test('detached settings X and native close both return the same live editor to its owner',async t=>{
 const f=fixture(t);f.ext.detach({key:'settings'});const editor=f.views[0],first=f.windows.at(-1);
 assert.equal((await f.invoke(first,'closeWindow')).ok,true);
 assert.equal(first.destroyed,true);assert.equal(editor.destroyed,undefined);assert.ok(f.main.children.has(editor));
 assert.equal(f.ext.state().windows[0].placement,'attached');assert.equal(f.ext.state().windows[0].visible,false,'放回后不抢用户当前的界面');
 f.ext.detach({key:'settings'});const second=f.windows.at(-1),event={preventDefault(){this.prevented=true;}};
 second.emit('close',event);assert.equal(event.prevented,true);assert.equal(second.destroyed,true);assert.ok(f.main.children.has(editor));
 assert.equal(f.views.length,1);f.ext.close();assert.equal(editor.destroyed,true,'application exit releases rather than docking again');
});

test('detached observation close docks without cancelling its task',async t=>{
 const f=fixture(t);f.ext.publish([f.row]);f.ext.detach({key:f.row.key});const observer=f.windows.at(-1);
 await f.invoke(observer,'closeWindow');assert.equal(f.ext.state().windows[0].placement,'attached');assert.equal(observer.destroyed,false);assert.equal(f.calls.filter(c=>c.action).length,0);
});
test('screen-edge rails are collected into a reachable main menu and never overlay the chat',t=>{
 const f=fixture(t);f.main.setBounds({x:0,y:0,width:1920,height:1080});f.ext.publish([f.row,{...f.row,kind:'plan',key:'plan',title:'计划'}]);
 const state=f.ext.state();assert.equal(state.rails.length,2);assert.ok(state.rails.every(r=>r.visible===false&&r.layout.overflow));
 assert.equal(state.overflow.left[0].key,f.row.key);assert.equal(state.overflow.right[0].key,'plan');assert.ok(!state.overflow.right.some(r=>['settings','link'].includes(r.key)));
 f.ext.open({key:state.overflow.left[0].key});assert.equal(f.ext.state().windows.length,1);
});

test('Link and settings pages suppress both external rails and the overflow light',t=>{
 const f=fixture(t);f.main.setBounds({x:0,y:0,width:1920,height:1080});f.ext.publish([f.row,{...f.row,kind:'plan',key:'plan'}]);
 for(const page of ['link','settings','detail']){f.ext.context({page});const state=f.ext.state();assert.deepEqual(state.overflow,{left:[],right:[]});assert.ok(state.rails.every(r=>!r.visible));}
 f.ext.context({page:'home'});assert.equal(f.ext.state().overflow.left.length,1);
});
test('display removal recovers detached bounds without changing the window or its binding',async t=>{
 const f=fixture(t);f.ext.publish([f.row]);f.ext.open({key:f.row.key});const observer=f.windows.at(-1);
 f.ext.detach({key:f.row.key});observer.setBounds({x:-1800,y:10,width:840,height:620});
 f.main.emit('move');await new Promise(r=>setTimeout(r,35));assert.equal(observer.getBounds().x,-1800,'ordinary owner movement preserves detached position');
 f.screen.emit('display-removed');await new Promise(r=>setTimeout(r,35));assert.equal(observer.getBounds().x,0);
 assert.equal(f.ext.state().windows[0].placement,'detached');assert.deepEqual(f.ext.state().windows[0].binding,f.row.binding);assert.equal(f.windows.at(-1),observer);
});

test('restoring an embedded page restores its home navigation surface without revealing inactive pages',async t=>{
 const f=fixture(t,{offscreen:false});let minimized=false;f.main.isMinimized=()=>minimized;f.main.show();
 f.ext.open({key:'home'});f.ext.open({key:'settings'});f.ext.open({key:'contacts'});await new Promise(r=>setImmediate(r));
 const bounds={x:0,y:56,width:850,height:500};f.ext.surface({key:'contacts',visible:false});f.ext.surface({key:'settings',visible:true,bounds});f.ext.context({page:'settings'});
 const home=f.ext.contents('home'),settings=f.ext.contents('settings');
 minimized=true;f.main.emit('minimize');await new Promise(r=>setTimeout(r,40));
 assert.ok(f.ext.state().windows.every(w=>!w.visible));
 minimized=false;f.main.emit('restore');await new Promise(r=>setTimeout(r,40));
 const state=f.ext.state().windows;
 assert.equal(state.find(w=>w.key==='home').visible,true);assert.equal(state.find(w=>w.key==='settings').visible,true);assert.equal(state.find(w=>w.key==='contacts').visible,false);
 assert.equal(f.ext.contents('home'),home);assert.equal(f.ext.contents('settings'),settings);assert.equal(f.calls.filter(c=>c.action).length,0);
});
test('retained-view capacity can be released explicitly while normal hiding keeps its renderer',async t=>{
 const f=fixture(t),rows=Array.from({length:17},(_,i)=>{const binding={...f.row.binding,agent_id:'worker-'+i};return {...f.row,binding,key:bindingKey(binding)};});f.ext.publish(rows);
 for(const row of rows.slice(0,16))f.ext.open({key:row.key});const observer=f.windows.at(-1);
 await f.invoke(observer,'hide');assert.equal(observer.isDestroyed(),false);assert.throws(()=>f.ext.open({key:rows[16].key}),/结束观察/);
 await f.invoke(observer,'release');assert.equal(observer.isDestroyed(),true);f.ext.open({key:rows[16].key});assert.equal(f.ext.state().windows.length,16);assert.equal(f.calls.filter(c=>c.action).length,0);
});
test('an asynchronously delivered programmatic move does not detach an attached observer',async t=>{
 const f=fixture(t,{offscreen:false});f.main.show();f.ext.publish([f.row]);f.ext.open({key:f.row.key});const observer=f.windows.at(-1);await new Promise(r=>setImmediate(r));
 observer.emit('move');assert.equal(f.ext.state().windows[0].placement,'attached');
 observer.setBounds({...observer.getBounds(),x:observer.getBounds().x+20});assert.equal(f.ext.state().windows[0].placement,'detached');
});

test('ending the last detached observation notifies the shared runtime after removing it',async t=>{
 let f,remaining;
 f=fixture(t,{onChange:()=>{if(f)remaining=f.ext.state().windows.filter(w=>w.placement==='detached').length;}});
 f.ext.publish([f.row]);f.ext.detach({key:f.row.key});assert.equal(remaining,1);
 const observer=f.windows.at(-1);await f.invoke(observer,'release');
 assert.equal(observer.isDestroyed(),true);assert.equal(remaining,0);
 assert.equal(f.calls.filter(c=>c.action).length,0,'ending observation must not cancel the underlying task');
});
test('后台规则：停在 OS 里隐藏够久的程序整页释放，回来重新加载；拆出或保持唤醒的不睡',async t=>{
 const f=fixture(t,{options:{sleepMs:20}}),wait=ms=>new Promise(r=>setTimeout(r,ms)),bounds={x:0,y:40,width:900,height:500};
 f.ext.open({key:'servers'});f.ext.surface({key:'servers',visible:true,bounds});const first=f.views.at(-1);
 f.ext.surface({key:'servers',visible:false});await wait(5);f.ext.surface({key:'servers',visible:true,bounds});f.ext.surface({key:'servers',visible:false});
 await wait(10);assert.equal(first.destroyed,undefined,'重新显示会把计时清零');
 await wait(30);assert.equal(first.destroyed,true,'隐藏够久整页释放');assert.equal(f.ext.state().windows.some(w=>w.kind==='servers'),false);
 f.ext.surface({key:'servers',visible:true,bounds});const second=f.views.at(-1);assert.notEqual(second,first,'回来时重新加载');assert.equal(f.ext.state().windows.find(w=>w.kind==='servers').visible,true);
 f.handlers.get('plugin:awake')({sender:second.webContents},true);f.ext.surface({key:'servers',visible:false});await wait(40);assert.equal(second.destroyed,undefined,'声明保持唤醒的不睡');
 f.handlers.get('plugin:awake')({sender:second.webContents},false);await wait(40);assert.equal(second.destroyed,true);
 f.ext.open({key:'settings'});f.ext.surface({key:'settings',visible:true,bounds});const settings=f.views.at(-1);f.ext.surface({key:'settings',visible:false});await wait(40);assert.equal(settings.destroyed,undefined,'没标 sleep 的不睡');
});

test('group focus hides the native mother presence and contact navigation restores it',async t=>{
 let drawn=false;const presence={mount:({visible})=>({refresh(){drawn=visible();},unparent(){drawn=false;},destroy(){drawn=false;}})};
 const f=fixture(t,{presence});f.main.show();f.ext.open({key:'contacts'});
 const page=f.views.find(v=>v.url?.endsWith('index.html?extension=contacts'));assert.ok(page);assert.equal(drawn,true);
 assert.equal((await f.invoke(page,'sessionFocus',{kind:'group',id:'a'.repeat(32)})).ok,true);assert.equal(drawn,false);
 assert.deepEqual((await f.invoke(page,'describe')).session_scope,{kind:'group',id:'a'.repeat(32)});
 await f.invoke(page,'hide');f.ext.open({key:'contacts'});assert.equal(drawn,false,'reopening the same group does not restore the mother overlay');
 await f.invoke(page,'sessionFocus',{kind:'contacts'});assert.equal(drawn,true,'contact directory keeps its existing quick mother entry');
 await f.invoke(page,'modalSurface',{open:true});assert.equal(drawn,false);await f.invoke(page,'modalSurface',{open:false});assert.equal(drawn,true);
 await f.invoke(page,'detach');const shell=f.windows.at(-1);
 await f.invoke(page,'sessionFocus',{kind:'group',id:'b'.repeat(32)});
 assert.deepEqual(f.calls.filter(c=>c.window===shell.id&&c.name==='extension:state').at(-1).value.session_scope,{kind:'group',id:'b'.repeat(32)},'detached shell receives the same focus');
 await f.invoke(page,'sessionFocus',{kind:'contacts'});assert.equal(f.calls.filter(c=>c.window===shell.id&&c.name==='extension:state').at(-1).value.session_scope,null);
 await f.invoke(page,'dock');f.ext.open({key:'contacts'});assert.equal(f.calls.filter(c=>c.name==='workspace:sessionFocus').at(-1).value,null,'reattaching a directory clears a retained group focus');
});


test('workspace translation preserves the same native viewport and never reloads or republishes page state',async t=>{
 const f=fixture(t);f.ext.open({key:'settings'});await new Promise(r=>setImmediate(r));
 const bounds={x:0,y:56,width:850,height:500};f.ext.surface({key:'settings',visible:true,bounds});
 const view=f.views[0],before=f.calls.length;
 for(const x of [90,220,300,240,110,0]){
  f.ext.setInset(x);assert.deepEqual(view.bounds,{...bounds,x,width:bounds.width-x});
  assert.equal(f.views[0],view);assert.equal(view.visible,true);
 }
 assert.equal(f.calls.length,before,'geometry changes keep page state and visibility');
 f.ext.detach({key:'settings'});const detached={...view.bounds};
 f.ext.setInset(240);assert.deepEqual(view.bounds,detached,'detached windows do not follow the OS drawer');
 f.ext.dock({key:'settings'});f.ext.surface({key:'settings',visible:true,bounds});assert.deepEqual(view.bounds,{...bounds,x:240,width:610});
 f.ext.setInset(0);assert.deepEqual(view.bounds,bounds);
});

test('receipt bridge fixes observation source and forwards only read fields',async t=>{
 const changed={ok:false,code:'receipt_changed',changed:true,reload_required:true};
 const f=fixture(t,{coreReply:()=>changed});f.ext.publish([f.row]);f.ext.open({key:f.row.key});const observer=f.windows.at(-1);
 const result=await f.invoke(observer,'receipt',{id:'invocation:opaque:call',receipt_generation:1,receipt_version:'saved-version',input_offset:65535,output_offset:65536,all_history:true,path:'PRIVATE',owner:'foreign',command:'execute',member_id:'member'});
 assert.deepEqual(result,changed);
 assert.deepEqual(f.calls.find(c=>c.action==='workspace.receipt').args,{task_id:'task',agent_id:'agent',generation:2,core_epoch:'core',id:'invocation:opaque:call',member_id:'member',receipt_generation:1,receipt_version:'saved-version',input_offset:65535,output_offset:65536,all_history:true});
 for(const args of [{task_id:'foreign'},{agent_id:'foreign'},{generation:1},{core_epoch:'old-core'}])assert.equal((await f.invoke(observer,'receipt',{id:'call',...args})).ok,false);
 assert.equal(f.calls.filter(c=>c.action==='workspace.receipt').length,1,'rejected sources never reach Core');
});

test('receipt bridge rejects delayed observation reply after hide and reopen',async t=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const f=fixture(t,{coreReply:()=>pending});f.ext.publish([f.row]);f.ext.open({key:f.row.key});const observer=f.windows.at(-1);
 const read=f.invoke(observer,'receipt',{id:'turn:call'});
 await f.invoke(observer,'hide');f.ext.open({key:f.row.key});finish({ok:true,input:'late-private-body'});
 assert.equal((await read).ok,false);
 assert.equal(f.calls.filter(c=>c.action==='workspace.receipt').length,1,'showing the surface never rereads a receipt');
});

test('receipt bridge rejects delayed observation reply after release',async t=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const f=fixture(t,{coreReply:()=>pending});f.ext.publish([f.row]);f.ext.open({key:f.row.key});const observer=f.windows.at(-1);
 const read=f.invoke(observer,'receipt',{id:'turn:call'});await f.invoke(observer,'release');finish({ok:true,input:'late-body'});
 assert.equal((await read).ok,false);assert.equal(observer.destroyed,true);
});

test('receipt bridge binds private originals and rejects hidden requests',async t=>{
 const f=fixture(t),id='a'.repeat(32),key=f.ext.registerConversation({id,title:'private'});f.ext.open({key});const view=f.views[0];
 assert.equal((await f.invoke(view,'conversation',{action:'receipt',id:'b'.repeat(32),call_id:'full:opaque:call',member_id:'c'.repeat(32),receipt_generation:3,receipt_version:'original-version',input_offset:42,output_offset:63,group_id:'foreign',path:'private',owner:'foreign',execute:true})).ok,true);
 assert.deepEqual(f.calls.find(c=>c.method==='conversation').args,{action:'receipt',id,member_id:'c'.repeat(32),call_id:'full:opaque:call',receipt_generation:3,receipt_version:'original-version',input_offset:42,output_offset:63});
 await f.invoke(view,'hide');assert.equal((await f.invoke(view,'conversation',{action:'receipt',call_id:'full:opaque:call'})).ok,false);
 assert.equal(f.calls.filter(c=>c.method==='conversation').length,1,'hidden requests never reach the service');
 assert.equal((await f.invoke(view,'conversation',{action:'group_receipt',group_id:'foreign',call_id:'full:opaque:call'})).ok,false);
});

test('receipt bridge invalidates private read across hide and show',async t=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const f=fixture(t,{invokeReply:()=>pending}),id='d'.repeat(32),key=f.ext.registerConversation({id,title:'private'});f.ext.open({key});const view=f.views[0];
 const read=f.invoke(view,'conversation',{action:'receipt',call_id:'full:call'});await f.invoke(view,'hide');f.ext.open({key});finish({ok:true,input:'late-body'});
 assert.equal((await read).ok,false);assert.equal(f.calls.filter(c=>c.method==='conversation').length,1);
});

test('receipt bridge fixes group_id to contacts focus and rejects late group reply',async t=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const f=fixture(t,{invokeReply:()=>pending});f.ext.open({key:'contacts'});const view=f.views[0],group='e'.repeat(32),other='f'.repeat(32),member='1'.repeat(32);
 await f.invoke(view,'sessionFocus',{kind:'group',id:group});
 assert.equal((await f.invoke(view,'conversation',{action:'group_receipt',group_id:other,member_id:member,call_id:'full:call'})).ok,false);
 assert.equal((await f.invoke(view,'conversation',{action:'receipt',id:member,call_id:'full:call'})).ok,false);
 const read=f.invoke(view,'conversation',{action:'group_receipt',member_id:member,call_id:'full:call',receipt_generation:2,input_offset:12,output_offset:30,id:other,path:'PRIVATE',owner:'foreign'});
 assert.deepEqual(f.calls.find(c=>c.method==='conversation').args,{action:'group_receipt',group_id:group,member_id:member,call_id:'full:call',receipt_generation:2,receipt_version:'',input_offset:12,output_offset:30});
 await f.invoke(view,'sessionFocus',{kind:'group',id:other});await f.invoke(view,'sessionFocus',{kind:'group',id:group});finish({ok:true,input:'late-group-body'});
 assert.equal((await read).ok,false);assert.equal(f.calls.filter(c=>c.method==='conversation').length,1);
});


test('actual contacts preload routes avatar library calls through the registered extension',async t=>{
 const f=fixture(t);f.ext.open({key:'contacts'});const page=f.views[0],world={};
 const source=require('node:fs').readFileSync(require.resolve('../host/extension-preload.cjs'),'utf8');
 const electron={contextBridge:{exposeInMainWorld:(name,value)=>world[name]=value},ipcRenderer:{invoke:async(channel,payload)=>{assert.equal(channel,'extension:invoke');return f.invoke(page,payload.method,payload.args);}}};
 require('node:vm').runInNewContext(source,{process:{argv:['--aieyra-extension-kind=contacts']},window:{addEventListener(){}},require:()=>electron});
 for(const args of [{action:'list',category:'background'},{action:'image',id:'avatar1'},{action:'like',id:'avatar1',liked:true},{action:'prepare',target:'background',mode:'random'}])assert.equal((await world.aieyraExtension.themeLibrary(args)).ok,true);
 const calls=f.calls.filter(c=>c.method==='themeLibrary');assert.equal(calls.length,4);assert.equal(calls[0].args.category,'avatar');assert.equal(calls[3].args.target,'avatar');assert.ok(calls.every(c=>c.owner===f.main.id));
 await f.invoke(page,'detach');await world.aieyraExtension.themeLibrary({action:'prepare',id:'avatar1'});assert.equal(f.calls.filter(c=>c.method==='themeLibrary').at(-1).owner,f.windows.at(-1).id);
});
test('contact avatar access cannot apply global media or expose library actions to observers',async t=>{
 const f=fixture(t);f.ext.open({key:'contacts'});const page=f.views[0];
 for(const action of ['apply','rotation','manager_open','unknown'])assert.equal((await f.invoke(page,'themeLibrary',{action,target:'background'})).ok,false);
 f.ext.publish([f.row]);f.ext.open({key:f.row.key});assert.equal((await f.invoke(f.windows.at(-1),'themeLibrary',{action:'prepare',target:'avatar'})).ok,false);
 assert.equal(f.calls.filter(c=>c.method==='themeLibrary').length,0);
});

test('program page release preserves the live canvas until save succeeds and retains it on failure',async t=>{
 let settle,attempts=0;const f=fixture(t,{prepareRelease:key=>{assert.equal(key,'workspace');attempts++;return new Promise((resolve,reject)=>{settle={resolve,reject};});}});
 f.ext.open({key:'workspace'});const view=f.views[0];
 const first=f.ext.releasePage('workspace');assert.equal(f.ext.releasePage('workspace'),first);assert.equal(attempts,1);assert.equal(view.destroyed,undefined);
 const failed=assert.rejects(first,/save failed/);settle.reject(Error('save failed'));await failed;
 assert.equal(view.destroyed,undefined);assert.equal(f.ext.state().windows.some(w=>w.key==='workspace'),true);
 const retry=f.ext.releasePage('workspace');settle.resolve();await retry;assert.equal(view.destroyed,true);assert.equal(attempts,2);
});
