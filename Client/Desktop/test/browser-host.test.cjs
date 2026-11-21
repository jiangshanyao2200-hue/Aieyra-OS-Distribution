// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-host.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
function fixture(t,{mainAvailable=()=>true,deskPark=()=>null,nativeModal=null,presence=null}={}){
 const privateRoot=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'browser-host-paths-'));t.after(()=>fs.rmSync(privateRoot,{recursive:true,force:true}));
 const groups=[];
 class Contents extends EventEmitter{loadFile(){return Promise.resolve();}isDestroyed(){return false;}close(){}send(){}getZoomFactor(){return 1;}}
 class View{constructor(){this.webContents=new Contents();}setBounds(r){this.bounds=r;}getBounds(){return this.bounds;}setVisible(v){this.visible=v;}setBackgroundColor(){}addChildView(){}removeChildView(){}}
 class Window extends EventEmitter{constructor(){super();this.webContents=new Contents();this.contentView=new View();}getContentSize(){return [640,500];}isVisible(){return true;}isDestroyed(){return false;}setMenu(){}loadFile(){return Promise.resolve();}showInactive(){}destroy(){this.emit('closed');}}
 const runtime={previewTarget:()=>null,status:()=>({groups:groups.map(g=>({id:g.id,owner:g.owner,profile:g.profile,count:1,active_tab_id:g.id+'-tab',detached:g.detached,visible:g.visible()})),count:groups.length}),closeGroup(id){const i=groups.findIndex(g=>g.id===id);if(i>=0){groups[i].dispose();groups.splice(i,1);}},close(){for(const g of [...groups])this.closeGroup(g.id);},async user(){return {};}};
 const module={exports:{}};const win=new Window();
 const mocks={'./module-window.cjs':require('../host/module-window.cjs'),'./profile.cjs':{createProfileStore:()=>({read:()=>({eyraName:'Eyra'})})},electron:{View,WebContentsView:View,BrowserWindow:Window},'./window-theme.cjs':{createWindowTheme:()=>({read:()=>({}),watch:()=>()=>{}})},'../src/window-presentation.cjs':{apply(){}},'../src/paths.cjs':require('../src/paths.cjs'),'../src/interface-zoom.cjs':{forConfig:()=>({attach(){}})},'../src/browser-runtime.cjs':{createBrowserRuntime(options){for(const profile of ['default','work']){const g=options.mount({owner:'program/browser',profile,fp:{width:1000,height:700}});g.id=profile;g.bindWindow=w=>{g.win=w;};groups.push(g);}return runtime;}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../host/browser.cjs'),'utf8'),{module,__dirname:__dirname,require:name=>mocks[name]||require(name)});
 const host=module.exports.createEmbeddedBrowser({win,config:require('node:path').join(privateRoot,'config.json'),offscreen:true,mainAvailable,deskPark,nativeModal,presence});
 return {host,groups,runtime,win};
}
test('late layout after profile switch or docking preserves the native selected page',async t=>{
 const {host,groups}=fixture(t);await host.user('owner',{action:'open'});
 const bounds={x:0,y:44,width:640,height:456};
 host.surface({visible:true,bounds,select_group:'work'});
 groups[1].selectGroup(groups[0]);
 host.surface({visible:true,bounds,selected:'work'});
 assert.equal(host.status().selected,'default');assert.equal(groups[0].container.visible,true);assert.equal(groups[1].container.visible,false);
 groups[0].place(true);groups[0].place(false);
 host.surface({visible:true,bounds,selected:'work'});
 assert.equal(host.status().selected,'default');assert.equal(groups[0].shellView.bounds.width,640);
 host.surface({visible:true,bounds,select_group:'work'});assert.equal(host.status().selected,'work');
 assert.throws(()=>host.surface({visible:true,bounds,select_group:'unknown'}),/Unknown browser group/);host.close();
});

test('work projection retains native page through resize, full browser, dock and source destruction',async t=>{
 const {host,groups,win}=fixture(t);t.after(()=>host.close());await host.user('owner',{action:'open'});
 const source=new EventEmitter(),parent=new win.contentView.constructor(),portal=new win.constructor();parent.setBounds({x:0,y:48,width:1200,height:750});
 Object.assign(source,{view:parent,owner:win,host:null,webContents:{getZoomFactor:()=>1.25},isVisible:()=>true,isDestroyed:()=>false});
 host.surface({visible:false,select_group:'default'});
 const bounds={x:400,y:16,width:440,height:540};host.workSurface({visible:true,bounds,tab_id:'default-tab'},source);
 const group=groups[0],shell=group.shell;
 assert.equal(group.parentView,source.host?.contentView||win.contentView);assert.equal(group.win,win);assert.equal(group.inWork,true);
 assert.deepEqual({...group.container.bounds},{x:500,y:68,width:550,height:675});
 host.surface({visible:true,bounds:{x:0,y:44,width:640,height:456}});assert.equal(group.parentView,win.contentView);assert.equal(group.inWork,false);
 host.surface({visible:false});assert.equal(group.parentView,source.host?.contentView||win.contentView);assert.equal(group.shell,shell);
 source.emit('host-changing');source.host=portal;source.emit('resize');assert.equal(group.win,portal);assert.equal(group.parentView,source.host?.contentView||win.contentView);
 source.emit('host-changing');assert.equal(group.win,win,'unbind old window before docking destroys it');source.host=null;source.emit('resize');
 group.place(true);const detachedParent=group.parentView;host.workSurface({visible:true,bounds,tab_id:'default-tab'},source);assert.equal(group.parentView,detachedParent,'do not steal an explicitly detached browser');group.place(false,{returnToMain:false});assert.equal(group.parentView,source.host?.contentView||win.contentView);
 source.emit('destroying');assert.equal(group.parentView,win.contentView);assert.equal(group.win,win);assert.equal(group.container.visible,false);assert.equal(group.shell,shell);
 assert.equal(source.listenerCount('resize'),0);assert.equal(source.listenerCount('host-changing'),0);
});

test('work projection follows the actual tool tab without replacing the full browser selection',async t=>{
 const {host,groups,runtime,win}=fixture(t);t.after(()=>host.close());await host.user('owner',{action:'open'});
 groups[1].owner='owner';
 runtime.execute=async()=>({ok:true,tab_id:'work-tab',profile:'work'});
 host.surface({visible:false,select_group:'default'});host.workSurface({visible:true,bounds:{x:300,y:40,width:300,height:400}},win);assert.equal(groups[0].container.visible,false,'missing or rejected browser receipt never exposes another page');await host.execute('owner',{action:'open'});
 host.workSurface({visible:true,tab_id:'work-tab',bounds:{x:300,y:40,width:300,height:400}},win);
 assert.equal(groups[0].container.visible,false);assert.equal(groups[1].container.visible,true);assert.equal(groups[1].visible(),true);
 assert.equal(host.status().selected,'default');
 groups[1].selectGroup(groups[0]);host.workSurface({visible:true,tab_id:'work-tab',bounds:{x:310,y:40,width:290,height:400}},win);assert.equal(groups[0].container.visible,true,'resize preserves an explicit native group selection');
 host.surface({visible:true,bounds:{x:0,y:44,width:640,height:456}});assert.equal(groups[0].container.visible,true);assert.equal(groups[1].container.visible,false);
});

test('conversation projection permits only the active tab of its own browser group',async t=>{
 const {host,groups,runtime,win}=fixture(t);t.after(()=>host.close());await host.user('owner',{action:'open'});
 groups[0].owner='private-a';groups[1].owner='private-b';
 runtime.previewTarget=id=>({contents:id,identity:id});
 const bounds={x:200,y:50,width:390,height:350};
 assert.equal((await host.projection('work-tab',{metadataOnly:true,owner:'private-a'})).available,false);
 assert.equal((await host.projection('default-tab',{metadataOnly:true,owner:'private-a'})).native,true);
 assert.equal(host.workSurface({visible:true,tab_id:'work-tab',bounds},win,false,'private-a').hidden,true);
 host.workSurface({visible:true,tab_id:'default-tab',bounds},win,false,'private-a');
 assert.equal(groups[0].inWork,true);
 assert.equal(groups[1].inWork,false);
 assert.throws(()=>groups[0].selectGroup(groups[1]),/another conversation/);
 host.workSurface({visible:false},win,false,'private-a');
 assert.equal(groups[0].inWork,false);
});

test('browser preview follows the selected attached or detached group and invalidates a late tab capture',async t=>{
 const captures=[];const {host,groups,runtime}=fixture(t,{deskPark:()=>({preview:async(key,contents,options)=>(captures.push({key,contents,options}),{ok:true})})});
 let tab='one';runtime.previewTarget=id=>({contents:id,identity:id+':'+tab});
 await host.user('owner',{action:'open'});groups[0].place(true);groups[1].place(true);
 host.surface({select_group:'work'});await host.preview();assert.equal(captures[0].contents,'work');assert.equal(captures[0].options.isCurrent(),true);
 groups[1].win.isMinimized=()=>true;assert.equal(captures[0].options.cached,false,'the visible pre-hide window is captured even during native minimize transition');
 tab='two';assert.equal(captures[0].options.isCurrent(),false);await host.preview();assert.equal(captures[1].options.identity,'work:two');
 host.closeModule();await host.preview();assert.equal(captures[2].contents,'work');assert.equal(captures[2].options.cached,true);host.close();
});

test('browser pre-hide restoration compensates native border rounding before it records parked bounds',async t=>{
 let saved;const {host,groups}=fixture(t,{deskPark:()=>({active:()=>true,take:(_key,w)=>{saved=w.getBounds();}})});
 await host.user('owner',{action:'open'});groups[0].place(true);const w=groups[0].win,target={x:30,y:40,width:900,height:600};let actual={...target};
 Object.assign(w,{getNormalBounds:()=>({...target}),getBounds:()=>({...actual}),restore(){},setBounds:b=>{actual={...b,width:b.width+1,height:b.height+1};}});
 w.emit('minimize');assert.deepEqual(saved,target);host.close();
});

test('browser X docks while the main window exists, and destroys only its own group after OS closes',async t=>{
 let main=true;const {host,groups}=fixture(t,{mainAvailable:()=>main});await host.user('owner',{action:'open'});groups[0].place(true);groups[0].win.emit('close',{preventDefault(){}});assert.equal(groups.length,2);assert.equal(groups[0].detached,false);
 groups[0].place(true);groups[1].place(true);main=false;groups[0].win.emit('close',{preventDefault(){}});assert.equal(groups.length,1);assert.equal(groups[0].id,'work');assert.equal(groups[0].detached,true);host.closeModule();assert.equal(groups.length,0);host.close();
});

test('only accepted user messages hand back browser control, and fast tool dispatch waits for their receipt',async t=>{
 const {host,runtime}=fixture(t);await host.user('owner',{action:'open'});const calls=[];runtime.resume=async owner=>calls.push('resume:'+owner);runtime.execute=async owner=>{calls.push('execute:'+owner);return {ok:true};};
 let accept;const pending=host.userMessage('owner',()=>new Promise(resolve=>{accept=resolve;}));await Promise.resolve();const operation=host.execute('owner',{action:'snapshot'});await Promise.resolve();assert.deepEqual(calls,[]);accept({ok:true,accepted:true});await pending;await operation;assert.deepEqual(calls,['resume:owner','execute:owner']);
 calls.length=0;await host.userMessage('owner',async()=>({ok:false}));assert.deepEqual(calls,[]);await assert.rejects(host.userMessage('owner',async()=>{throw Error('send rejected');}),/send rejected/);assert.deepEqual(calls,[]);await host.execute('owner',{});assert.deepEqual(calls,['execute:owner']);calls.length=0;await host.userMessage('owner',async()=>({ok:true}),'same-message');await host.userMessage('owner',async()=>({ok:true}),'same-message');assert.deepEqual(calls,['resume:owner']);host.close();
});


test('drawer commits one browser rectangle with a fixed right edge on reversals',async t=>{
 const {host,groups}=fixture(t);await host.user('owner',{action:'open'});let layouts=0;groups[0].relayout=()=>layouts++;
 const bounds={x:0,y:44,width:640,height:456};host.surface({visible:true,bounds,select_group:'default'});
 for(const x of [75,220,300,150,0]){
  const before=layouts;host.setInset(x);host.setInset(x);
  assert.equal(layouts,before+1);
  assert.deepEqual({...groups[0].container.bounds},{...bounds,x,width:640-x});
  assert.equal(groups[0].shellView.bounds.width,640-x);
 }
 host.close();
});

test('browser modal ownership follows active group visibility and native docking, then releases with its group',async t=>{
 const nativeModal=require('../host/native-modal.cjs').createNativeModal({ipcMain:new EventEmitter()}),projections=[];t.after(()=>nativeModal.close());
 const {host,groups,win}=fixture(t,{nativeModal,presence:{mount(options){projections.push(options);return {refresh(){},destroy(){},unparent(){}};}}});t.after(()=>host.close());await host.user('owner',{action:'open'});
 const first=groups[0],bounds={x:0,y:44,width:640,height:456};host.surface({visible:true,bounds,select_group:'default'});first.panelOverlay=true;first.modalSource.set(true);
 assert.equal(nativeModal.blocked(win),true);assert.equal(projections[0].visible(),false);
 host.surface({visible:true,bounds,select_group:'work'});assert.equal(nativeModal.blocked(win),false,'a hidden group must not suppress another page');
 host.surface({visible:true,bounds,select_group:'default'});assert.equal(nativeModal.blocked(win),true);
 first.place(true);const portal=first.win;assert.equal(nativeModal.blocked(win),false);assert.equal(nativeModal.blocked(portal),true);first.place(false);assert.equal(nativeModal.blocked(portal),false);assert.equal(nativeModal.blocked(win),true);
 first.modalSource.set(false);first.panelOverlay=false;assert.equal(nativeModal.blocked(win),false);assert.equal(projections[0].visible(),true);
 first.modalSource.set(true);host.close();assert.equal(nativeModal.blocked(win),false);assert.equal(win.listenerCount('show'),0);
});

test('receipt browser projection reads only the actual tab and retires late navigation',async t=>{
 let finish,captures=0,version=1;
 const {host,runtime}=fixture(t,{deskPark:()=>({preview:async(_key,_contents,options)=>{captures++;await new Promise(r=>finish=r);return {ok:true,available:options.isCurrent(),url:'data:image/png;base64,eA=='};}})});
 t.after(()=>host.close());await host.user('owner',{action:'open'});
 runtime.previewTarget=id=>({contents:id,identity:id+':'+version});
 assert.equal((await host.projection('foreign-tab')).available,false);assert.equal(captures,0);
 const pending=host.projection('default-tab');version++;finish();
 const late=await pending;assert.equal(late.available,false);assert.equal(late.changed,true);
 const current=host.projection('default-tab');finish();const frame=await current;
 assert.equal(frame.available,true);assert.equal(frame.tab_id,'default-tab');assert.equal(frame.identity,'default:2');assert.equal(captures,2);
});
