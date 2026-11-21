// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; fixture; until; deferred; settle
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/main-shutdown.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');

// Execute the production host entry with local doubles. This exercises its
// startup catch, quit interception and service wiring without launching a GUI.
function fixture(t,{failAfterTheme=false,failLoad=false,releaseGate=Promise.resolve(),failedService,readyGate=Promise.resolve(),browserStartGate=Promise.resolve(),browserRegisterGate=Promise.resolve(),communityStartGate=Promise.resolve(),communityRegisterGate=Promise.resolve(),loadGate=Promise.resolve(),accountRefreshGate=Promise.resolve(),visible=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-host-exit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const app=new EventEmitter(),events=[],stderr=[],windows=[],requests=[],handlers=new Map();let communityCall;
 const ipcMain=Object.assign(new EventEmitter(),{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)});
 const frameURL=require('node:url').pathToFileURL(path.join(__dirname,'../ui/index.html')).href;
 const invoke=(win,method,args={})=>handlers.get('workspace:'+method)({sender:win.webContents,senderFrame:win.webContents.mainFrame},args);
 app.commandLine={appendSwitch(){}};app.setPath=()=>{};app.getPath=()=>require('node:os').tmpdir();app.requestSingleInstanceLock=()=>true;app.whenReady=()=>readyGate;
 app.quit=()=>{events.push('quit');};app.exit=code=>{events.push(['exit',code]);};
 class BrowserWindow extends EventEmitter{
  constructor(){super();events.push('create:window');windows.push(this);this.on('closed',()=>{this.destroyed=true;});this.webContents=new EventEmitter();this.webContents.mainFrame={url:frameURL};this.webContents.session={setPermissionRequestHandler(){}};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=(channel,args)=>{if(channel==='workspace:flush')queueMicrotask(()=>{void invoke(this,'workspaceFlush',{...args,ok:true});});};}
  isDestroyed(){return !!this.destroyed;}
  setAspectRatio(ratio){this.aspectRatio=ratio;}
  isVisible(){return !!this.visible;}
  isMinimized(){return false;}
  showInactive(){this.visible=true;events.push('show-inactive');}
  show(){this.visible=true;events.push('show');}
  focus(){events.push('focus');}
  async loadURL(url){this.webContents.mainFrame.url=url;events.push('load');await loadGate;if(failLoad)throw Error('ERR_FAILED local fixture');await invoke(this,'pagesReady');events.push('loaded');}
 }
 const service=name=>{events.push('create:'+name);return {close(){events.push('close:'+name);if(name===failedService)throw Error('private '+name+' detail');if(name==='control')return releaseGate;}};};
 const themeTimers=new Set(),themeSubscriptions=new Set();
 t.after(()=>{assert.equal(themeTimers.size,0,'theme timers released');assert.equal(themeSubscriptions.size,0,'theme subscriptions released');});
 const community={status:()=>({signedIn:false}),subscribe(fn){themeSubscriptions.add(fn);return ()=>themeSubscriptions.delete(fn);},close(){events.push('community-client');}};
 const themeModule=require('../../../Theme/runtime/official-library.cjs');
 const modules={
  electron:{app,BrowserWindow,ipcMain,protocol:{registerSchemesAsPrivileged(){},handle(){}},screen:{getPrimaryDisplay:()=>({workAreaSize:{width:1000,height:800}})}},
  // beta：Link 环境改写（host/runtime-env.cjs）在宿主里只做目录与端口设定，这里用替身，避免在假路径下建目录。
  './runtime-env.cjs':{prepareLinkEnvironment:async env=>env,togetherLegacyOffice:()=>undefined},
  './first-run.cjs':require('../host/first-run.cjs'),
  './bridge.cjs':{validateDescriptor:x=>x,requestCore:async(_d,action,args)=>{requests.push({action,args});events.push(action);if(action==='workspace.browser_bridge')await browserRegisterGate;if(action==='workspace.community_bridge')await communityRegisterGate;return action==='workspace.shutdown'?{phase:'stopped',failures:{}}:{};}},
  './image-library.cjs':{createImageCodec:()=>()=>{},createImageLibrary:()=>({})},
  './theme-image-decoder.cjs':require('../host/theme-image-decoder.cjs'),
  './file-drop-router.cjs':{createFileDropRouter:()=>({register(){},close(){}})},
  './native-modal.cjs':require('../host/native-modal.cjs'),
  './attachments.cjs':{createAttachmentStore:()=>({})},
  '../src/resources.cjs':{read:()=>({official_updates_enabled:false}),releaseStage:()=>({link_situation:true})},
  '../src/paths.cjs':require('../src/paths.cjs'),
  '../../../Contracts/storage/profile.cjs':{use(config){const release=require('../../../Contracts/storage/profile.cjs').use(config);t.after(release);return release;}},
  './desktop-tools.cjs':require('../host/desktop-tools.cjs'),
  './software-api.cjs':require('../host/software-api.cjs'),
  './program-service-authority.cjs':require('../host/program-service-authority.cjs'),
  // 外嵌模块停靠（Claude M7）：本测试只验证宿主生命周期，停靠逻辑见 module-dock.test.cjs。
  './module-runtime.cjs':require('../host/module-runtime.cjs'),
  './module-order.cjs':require('../host/module-order.cjs'),
  './program-drafts.cjs':require('../host/program-drafts.cjs'),
  './chat-layer-preferences.cjs':require('../host/chat-layer-preferences.cjs'),
  './extension-settings.cjs':require('../host/extension-settings.cjs'),
  './module-catalog.cjs':require('../host/module-catalog.cjs'),
  './module-drag-preview.cjs':require('../host/module-drag-preview.cjs'),
  './module-dock.cjs':{createModuleDock:()=>({detached:()=>false,start:async()=>{events.push('module-dock:start');},close:async()=>{events.push('module-dock:close');},state:()=>({ok:true,modules:{link:{detached:false}}}),detach:async()=>({ok:true,modules:{}}),wrapSurface:surface=>surface})},
  './observation.cjs':{createDefaultObservationHub:async()=>({close(){events.push('observation:close');}})},
  './extensions.cjs':{createExtensions:()=>({open(){return {};},contents(){return null;},ready(){return Promise.resolve();},detach(){},dock(){},state(){return {windows:[]};},publish(){return {};},close(){events.push('extensions:close');}})},
  './folded-overlay.cjs':{createFoldedOverlay:()=>({surface(){return {ok:true};},raise(){},close(){events.push('folded-overlay:close');if(failedService==='foldedOverlay')throw Error('private overlay release detail');}})},
  './program-agent-overlay.cjs':require('../host/program-agent-overlay.cjs'),
  './surface-menu.cjs':{createSurfaceMenu:()=>({open:async()=>null,close(){events.push('surface-menu:close');}})},
  './tip-window.cjs':{createTipWindow:()=>({call:()=>({ok:true}),close(){}}),listenTips:()=>()=>{}},
  './window-theme.cjs':{createWindowTheme:()=>({read:()=>({}),watch:()=>()=>{}})},
  '../../../Program/official/servers/desktop.cjs':{createServersProgram:()=>{if(failAfterTheme)throw Error('post-theme startup fixture');return {close(){},call:async()=>({ok:true}),agentCall:async()=>({ok:true})};}},
  './desk-park.cjs':{createDeskPark:()=>({take(){return false;},restore(){return false;},restoreAll(){},preview:async()=>({ok:true,available:false}),parked:()=>false,active:()=>false,forget(){}})},
  './together-theme.cjs':{createTogetherTheme:()=>({})},
  '../../../Program/official/together/service.cjs':{createTogetherProgram:()=>({close(){}})},
  './center-telemetry.cjs':{createCenterTelemetry:()=>async()=>({})},
  './json-storage.cjs':require('../host/json-storage.cjs'),
  './link-agent.cjs':{createLinkAgent:()=>({call:async()=>({ok:true}),start(){},close:async()=>{}})},
  './plugins.cjs':{createPlugins:()=>({call:async()=>({ok:true,apps:[]}),subscribe(){},changed(){},close(){}})},
  
  './profile.cjs':{createProfileStore:()=>({read:()=>({})})},
  './eyra-presence.cjs':{profileFrame:x=>x,createEyraPresence:()=>({read:()=>({}),setFrame(){},close(){}})},
  './settings-watch.cjs':{watchSettings:()=>()=>{events.push('settings-watch:close');}},
  '../../../Theme/runtime/recovery.cjs':require('../../../Theme/runtime/recovery.cjs'),
  '../../../Theme/runtime/official-library.cjs':{...themeModule,createOfficialLibrary(options){
   const library=themeModule.createOfficialLibrary({...options,setTimer(fn,ms){const timer={fn,ms,unref(){}};themeTimers.add(timer);return timer;},clearTimer:timer=>themeTimers.delete(timer)});
   events.push('create:theme');return {...library,start(){events.push('theme:start');library.start();},close(){events.push('close:theme');library.close();}};
  }},
  '../../../Halo/runtime/settings.cjs':require('../../../Halo/runtime/settings.cjs'),
  '../src/os-appearance.cjs':{createAppearanceStore:()=>({read:()=>({settings:{window:{width:800,height:600}}})})},
  '../src/interface-zoom.cjs':{forConfig:()=>({attach(){}})},
  './browser.cjs':{createEmbeddedBrowser:()=>({captureTarget:()=>null,status:()=>({groups:[]})})},
  './browser-bridge.cjs':{startBrowserBridge:async()=>{events.push('start:browser');await browserStartGate;return {...service('browser'),url:'http://127.0.0.1:1'};}},
  './community.cjs':{createCommunityClient:()=>community,startCommunityBridge:async({call})=>{communityCall=call;events.push('start:community');await communityStartGate;return service('community');}},
  './apps.cjs':{createApps:()=>({})},
  // 资源中心（第 81 轮 R51）：本测试只验证宿主生命周期，安装事务见 resources.test.cjs。
  './mod-packages.cjs':{createModPackages:()=>({...service('packages'),reconcile:async()=>{}})},
  './native-program-verification.cjs':{createNativeProgramVerification:()=>({verify:async()=>{},close:async()=>{events.push('native-verification:close');if(failedService==='nativeVerification')throw Error('private verification release detail');}})},
  '../../../Program/runtime/native.cjs':{createNativePrograms:()=>({assert(){},shutdown:async()=>{events.push('native-programs:close');if(failedService==='nativePrograms')throw Error('private native release detail');},run:(_key,fn)=>fn()})},
  './resources.cjs':{createResources:()=>({call:async()=>({ok:true}),close(){}})},
  './control.cjs':{createControl:()=>service('control')},
  '../../../Program/official/link/desktop.cjs':{createLinkProgram:()=>({...service('link'),activateIfAdmitted(){},run:fn=>fn(),agentCall:async()=>({ok:true})})},
  './forum-sync.cjs':{createForumSync:()=>({setWorking(){},digest:()=>({ok:true,signedIn:false}),preferences:()=>{throw Error('请先登录账号');},refresh:async()=>{events.push('forum:refresh');return {ok:false,signedIn:false};}})},
  '../src/managed-updates.cjs':{createManagedUpdates:()=>service('updates')},
  './official-account.cjs':{createOfficialAccount:()=>({...service('account'),status:()=>({signedIn:false}),refresh:async()=>{events.push('account:refresh');await accountRefreshGate;}})},
  './remote-link.cjs':{createRemoteLink:()=>({call:async()=>({ok:true,account:null}),accountChanged(){},close(){}})},
  './cloud-updates.cjs':{createCloudUpdates:()=>({...service('cloud'),start(){}})},
  './settings-updates.cjs':require('../host/settings-updates.cjs'),
  '../../../Program/official/center/health-model.cjs':require('../../../Program/official/center/health-model.cjs'),
  '../../../Program/official/center/issue-reports.cjs':require('../../../Program/official/center/issue-reports.cjs'),
  '../../../Program/official/center/learning.cjs':require('../../../Program/official/center/learning.cjs'),
  '../../../Program/official/center/service.cjs':{createCenterProgram:()=>({shutdown:async()=>{}})},
  '../../../Program/official/center/status-log.cjs':require('../../../Program/official/center/status-log.cjs'),
  '../src/update-integrity.cjs':{createIntegrity:()=>({status:()=>({phase:'unchecked'}),check:async()=>({phase:'unavailable'}),close(){}})},
 };
 const host=path.join(__dirname,'../host');
 vm.runInNewContext(fs.readFileSync(path.join(host,'main.cjs'),'utf8'),{
  require:name=>Object.hasOwn(modules,name)?modules[name]:name==='./shutdown.cjs'?require('../host/shutdown.cjs'):name.startsWith('node:')?require(name):(()=>{throw Error('unexpected host import '+name);})(),
  __dirname:host,process:{env:{AIEYRA_WORKSPACE_OFFSCREEN:visible?'0':'1',AIEYRA_AIDEBUG_INTERACTIVE:visible?'1':'0',AIEYRA_WORKSPACE_BRIDGE:JSON.stringify({root,config:path.join(root,'config.json'),mode:'os',session_id:'fixture'})},platform:process.platform,stderr:{write:line=>stderr.push(line)}},
 },{filename:'Client/Desktop/host/main.cjs'});
 return {app,events,stderr,windows,requests,invoke,communityCall:p=>communityCall(p)};
}
async function until(predicate){
 const deadline=Date.now()+1500;
 while(!predicate()){
  if(Date.now()>=deadline)throw Error('host did not reach expected lifecycle boundary');
  await new Promise(resolve=>setTimeout(resolve,5));
 }
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function settle(){for(let n=0;n<3;n++)await new Promise(r=>setImmediate(r));}

test('local context digest stays available during slow account verification; explicit refresh still verifies',async t=>{
 const gate=deferred(),f=fixture(t,{accountRefreshGate:gate.promise});
 try{
  await until(()=>f.events.includes('loaded'));const before=f.events.filter(e=>e==='account:refresh').length;
  let digest;void f.communityCall({action:'home_digest'}).then(value=>{digest=value;});await settle();
  assert.deepEqual(digest,{ok:true,signedIn:false});
  for(let i=0;i<5;i++)await f.communityCall({action:'home_digest'});
  await assert.rejects(f.communityCall({action:'home_preferences'}),/请先登录/);
  assert.equal(f.events.filter(e=>e==='account:refresh').length,before);
  let synced=false;const explicit=f.communityCall({action:'home_refresh'}).then(()=>{synced=true;});await settle();
  assert.equal(synced,false);assert.equal(f.events.filter(e=>e==='account:refresh').length,before+1);
  gate.resolve();await explicit;assert.equal(f.events.includes('forum:refresh'),true);
 }finally{gate.resolve();f.app.emit('before-quit',{preventDefault(){}});await until(()=>f.events.includes('quit'));}
});

test('quit before Electron ready exits without creating a late workspace',async t=>{
 const gate=deferred(),f=fixture(t,{readyGate:gate.promise});
 try{
  f.app.emit('before-quit',{preventDefault(){}});await until(()=>f.events.includes('quit'));
  gate.resolve();await settle();
  assert.equal(f.windows.length,0);assert.equal(f.events.includes('start:browser'),false);
  assert.equal(f.events.filter(e=>e==='workspace.shutdown').length,1);assert.deepEqual(f.events.filter(e=>e==='quit'||Array.isArray(e)),['quit']);
 }finally{gate.resolve();await settle();}
});

for(const scenario of [
 {name:'browser creation',option:'browserStartGate',boundary:'start:browser',forbidden:'workspace.browser_bridge',releases:['browser']},
 {name:'browser registration',option:'browserRegisterGate',boundary:'workspace.browser_bridge',forbidden:'create:control',releases:['browser']},
 {name:'community creation',option:'communityStartGate',boundary:'start:community',forbidden:'workspace.community_bridge',releases:['control','link','browser','community','account','packages','theme']},
 {name:'community registration',option:'communityRegisterGate',boundary:'workspace.community_bridge',forbidden:'create:cloud',releases:['control','link','browser','community','account','packages','theme']},
 {name:'page loading',option:'loadGate',boundary:'load',releases:['control','link','browser','cloud','community','account','packages','theme']},
])test('quit during '+scenario.name+' waits for owned startup work and stops initialization',async t=>{
 const gate=deferred(),f=fixture(t,{[scenario.option]:gate.promise});
 try{
  await until(()=>f.events.includes(scenario.boundary));
  f.app.emit('before-quit',{preventDefault(){}});f.app.emit('before-quit',{preventDefault(){}});
  await until(()=>f.events.includes('workspace.shutdown'));await settle();
  assert.equal(f.events.includes('quit'),false);assert.deepEqual(f.events.filter(e=>typeof e==='string'&&e.startsWith('close:')),[]);
  gate.resolve();await until(()=>f.events.includes('quit'));await settle();
  if(scenario.forbidden)assert.equal(f.events.includes(scenario.forbidden),false);
  assert.deepEqual(f.events.filter(e=>typeof e==='string'&&e.startsWith('close:')),scenario.releases.map(name=>'close:'+name));
  assert.equal(f.events.filter(e=>e==='workspace.shutdown').length,1);assert.deepEqual(f.events.filter(e=>e==='quit'||Array.isArray(e)),['quit']);assert.deepEqual(f.stderr,[]);
 }finally{gate.resolve();await settle();}
});

test('an early closed window drains pending initialization without creating further services',async t=>{
 const gate=deferred(),f=fixture(t,{browserStartGate:gate.promise});
 try{
  await until(()=>f.events.includes('start:browser'));f.windows[0].emit('closed');
  await until(()=>f.events.includes('workspace.shutdown'));await settle();assert.equal(f.events.includes('quit'),false);
  gate.resolve();await until(()=>f.events.includes('quit'));await settle();
  assert.equal(f.events.includes('workspace.browser_bridge'),false);assert.equal(f.events.includes('create:control'),false);
  assert.equal(f.events.filter(e=>e==='close:browser').length,1);assert.deepEqual(f.stderr,[]);
 }finally{gate.resolve();await settle();}
});

test('a genuine startup failure during an existing quit still drains and exits once with code 1',async t=>{
 const gate=deferred(),f=fixture(t,{loadGate:gate.promise,failLoad:true});
 try{
  await until(()=>f.events.includes('load'));f.app.emit('before-quit',{preventDefault(){}});
  await until(()=>f.events.includes('workspace.shutdown'));await settle();assert.equal(f.events.includes('quit'),false);
  gate.resolve();await until(()=>f.events.some(Array.isArray));await settle();
  assert.equal(f.stderr.some(s=>s.includes('ERR_FAILED local fixture')),true);
 assert.equal(f.events.includes('close:packages'),true);
  assert.deepEqual(f.events.filter(e=>e==='quit'||Array.isArray(e)),[['exit',1]]);
  assert.equal(f.events.filter(e=>e==='close:control').length,1);
 }finally{gate.resolve();await settle();}
});

test('late display and second-instance events cannot show or focus a workspace during quit',async t=>{
 const gate=deferred(),f=fixture(t,{loadGate:gate.promise,visible:true});
 try{
  await until(()=>f.events.includes('load'));f.app.emit('before-quit',{preventDefault(){}});
  await until(()=>f.events.includes('workspace.shutdown'));
  f.windows[0].emit('ready-to-show');f.windows[0].webContents.emit('did-finish-load');f.app.emit('second-instance');
  assert.deepEqual(f.events.filter(e=>['show','show-inactive','focus'].includes(e)),[]);
  gate.resolve();await until(()=>f.events.includes('quit'));await settle();
  assert.deepEqual(f.events.filter(e=>['show','show-inactive','focus'].includes(e)),[]);
 }finally{gate.resolve();await settle();}
});

test('ready display and user-requested second instance still work before shutdown',async t=>{
 const gate=deferred(),f=fixture(t,{loadGate:gate.promise,visible:true});
 try{
  await until(()=>f.events.includes('load'));f.windows[0].emit('ready-to-show');f.app.emit('second-instance');
  assert.deepEqual(f.events.filter(e=>['show','show-inactive','focus'].includes(e)),['show','focus','show','focus']);
  gate.resolve();await until(()=>f.events.includes('loaded'));await settle();
  f.app.emit('before-quit',{preventDefault(){}});await until(()=>f.events.includes('quit'));
 }finally{gate.resolve();await settle();}
});

test('production startup failure drains services before exiting once with code 1',async t=>{
 let release;const releaseGate=new Promise(r=>release=r),f=fixture(t,{failLoad:true,releaseGate});
 await until(()=>f.events.includes('close:control'));
 assert.equal(f.stderr.some(s=>s.includes('ERR_FAILED local fixture')),true);
 assert.equal(f.events.includes('quit'),false);assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='exit'),false);
 release();await until(()=>f.events.some(e=>Array.isArray(e)&&e[0]==='exit'));
 assert.deepEqual(f.events.filter(e=>e==='quit'||Array.isArray(e)),[['exit',1]]);
});

// beta 不创建托管更新服务（host/main.cjs 的 BETA 开关），退出时也就没有 updates 要关闭。
test('production quit closes every service after CORE and reports a failed release',async t=>{
 const f=fixture(t,{failedService:'control'});await until(()=>f.events.includes('load'));
 let blocked=false;f.app.emit('before-quit',{preventDefault(){blocked=true;}});assert.equal(blocked,true);
 await until(()=>f.events.some(e=>e==='quit'||Array.isArray(e)));
 assert.deepEqual(f.events.filter(e=>typeof e==='string'&&e.startsWith('close:')),['close:control','close:link','close:browser','close:cloud','close:community','close:account','close:packages','close:theme']);
 assert(f.events.indexOf('workspace.shutdown')<f.events.indexOf('close:control'));
 const incomplete=f.stderr.map(s=>{try{return JSON.parse(s);}catch{return null;}}).find(r=>r?.host_phase==='shutdown-incomplete');
 assert.equal(incomplete.failures['host.control'],'service_release_unconfirmed');assert.equal(JSON.stringify(incomplete).includes('private control detail'),false);
 assert.deepEqual(f.events.filter(Array.isArray),[['exit',1]]);
});

test('production normal close waits for release and joins repeated quit without changing success',async t=>{
 let release;const releaseGate=new Promise(r=>release=r),f=fixture(t,{releaseGate});
 await until(()=>f.events.includes('load'));
 let blocked=0;const event={preventDefault(){blocked++;}};
 f.windows[0].emit('close',event);f.app.emit('before-quit',event);
 await until(()=>f.events.includes('close:control'));assert.equal(blocked,2);
 assert.equal(f.events.includes('quit'),false);assert.deepEqual(f.events.filter(Array.isArray),[]);
 release();await until(()=>f.events.includes('quit'));
 f.windows[0].emit('closed');f.app.emit('window-all-closed');
 await new Promise(r=>setImmediate(r));
 assert.equal(f.events.filter(e=>e==='workspace.shutdown').length,1);
 assert.equal(f.events.filter(e=>e==='quit').length,1);assert.deepEqual(f.events.filter(Array.isArray),[]);
});

for(const failedService of ['nativePrograms','nativeVerification','foldedOverlay'])test('production quit continues service cleanup after '+failedService+' fails',async t=>{
 const f=fixture(t,{failedService});await until(()=>f.events.includes('loaded'));
 f.app.emit('before-quit',{preventDefault(){}});await until(()=>f.events.some(Array.isArray));
 assert.equal(f.events.includes('folded-overlay:close'),true);assert.equal(f.events.includes('extensions:close'),true);assert.equal(f.events.includes('module-dock:close'),true);
 assert.equal(f.events.filter(e=>e==='native-verification:close').length,1);
 assert.deepEqual(f.events.filter(e=>typeof e==='string'&&e.startsWith('close:')),['close:control','close:link','close:browser','close:cloud','close:community','close:account','close:packages','close:theme']);
 const receipt=f.stderr.map(s=>{try{return JSON.parse(s);}catch{return null;}}).find(r=>r?.host_phase==='shutdown-incomplete');
 assert.equal(receipt.failures['host.'+failedService],'service_release_unconfirmed');assert.equal(JSON.stringify(receipt).includes('private'),false);
 assert.deepEqual(f.events.filter(Array.isArray),[['exit',1]]);
});

test('历史跨重启读取与原文标志从真实宿主IPC传到Core，保持任务身份和有界分页',async t=>{
 const f=fixture(t);await until(()=>f.events.includes('loaded'));const win=f.windows[0];
 await f.invoke(win,'history',{all_history:true,task_id:'earlier',segment:'segment-a',limit:100000});
 await f.invoke(win,'receipt',{all_history:true,entry_id:'memory:old/agent:000000000001',segment:'segment-a'});
 const history=f.requests.find(r=>r.action==='workspace.history').args,receipt=f.requests.find(r=>r.action==='workspace.receipt').args;
 assert.equal(history.all_history,true);assert.equal(history.task_id,'earlier');assert.equal(history.limit,30);assert.equal(receipt.all_history,true);assert.equal(receipt.entry_id,'memory:old/agent:000000000001');
 f.app.emit('before-quit',{preventDefault(){}});await until(()=>f.events.includes('quit'));
});

test('theme rotation is released when startup fails before the community bridge exists',async t=>{
 const f=fixture(t,{failAfterTheme:true});await until(()=>f.events.some(Array.isArray));
 assert.equal(f.events.includes('theme:start'),true);assert.equal(f.events.includes('start:community'),false);
 assert.equal(f.events.filter(e=>e==='close:theme').length,1);
 assert.equal(f.stderr.some(line=>line.includes('post-theme startup fixture')),true);
 assert.deepEqual(f.events.filter(e=>e==='quit'||Array.isArray(e)),[['exit',1]]);
});
