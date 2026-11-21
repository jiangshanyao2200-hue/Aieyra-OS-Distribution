// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; SETTINGS; successful; appSpec; embedded; attachedPage; createExtensions
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/extensions.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {publicAppearance}=require('../../../Theme/runtime/projection.cjs');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {validBinding,bindingKey}=require('./observation.cjs');
const {fit,railLayout,attachedBounds}=require('./extension-layout.cjs');
const {closeSurface}=require('./surface-lifecycle.cjs');
const SETTINGS=new Set(['extensionPackages','runtimePrompts','context','settingsBootstrap','onboard','account','profile','appearance','saveProfile','chooseAvatar','chooseBackground','themeLibrary','prompts','savePrompt','restorePrompt','restoreAllPrompts','undoPrompt','pickProject','openLink']);
const successful=r=>r?.ok!==false;
// 目录里带 page 的模块是 OS 内程序（docs/程序开发协定.md）：页面透明，遮罩由 OS 或拆出窗口提供。
const appSpec=kind=>require('./module-catalog.cjs').MODULES.find(s=>s.id===kind&&s.page);
const embedded=record=>['home','contacts','settings','conversation','link'].includes(record.kind)||!!appSpec(record.kind);
const attachedPage=record=>record.kind==='conversation'?'conversation:'+record.agent_id:record.kind;

// All surfaces remain part of the existing OS. Link's independent service
// ownership stays in module-dock; these windows never own or restart services.
function createExtensions({authorize=()=>{},electron,owner,hub,core,invoke,openLink,config,navigate=()=>{},onWindow=()=>{},registerDrop=()=>{},offscreen=false,displayDebug=false,options={},trace=()=>{},mainAvailable=()=>true,wakeOwner=()=>{},onChange=()=>{},presence=null,desk=null,prepareRelease=()=>{},onReleaseError=()=>{},onPageEvent=()=>{},nativeModal=null,browserWorkSurface,surfaceAdapter=()=>null}){
 const {BrowserWindow,screen,ipcMain}=electron,records=new Map(),shells=new Map(),rails=new Map(),conversations=new Map();
 let catalog=new Map(),closed=false,repositioning=false,layoutTimer=null,recoverDisplays=false,overflowSignature='',contextPage='home',workspaceInset=0;
 let overflow={left:[],right:[]};
 const page=name=>pathToFileURL(path.join(__dirname,'../ui',name)).href;
 const windowSpec=require('./module-window.cjs').moduleWindowSpec();
 const defaults={...windowSpec,orb_size:54,tool_orb_size:42,orb_gap:12,sleepMs:10*60*1000,...options};
 const savedBounds=new Map();
 const boundsFile=record=>config?path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'modules',record.kind==='conversation'?'conversation-'+record.agent_id:record.kind,'window.json'):null;
 function restoredBounds(record){if(!savedBounds.has(record.key)){let value=null;const file=boundsFile(record);if(file)try{value=require('./json-storage.cjs').inspectJson(file).value;}catch{}savedBounds.set(record.key,{bounds:value?.bounds||null,custom:value?.custom===true});}return savedBounds.get(record.key);}
 function rememberSettings(record){if(!embedded(record)||!record.window.host||desk?.parked(record.key))return;const host=record.window.host,bounds=host.isMaximized()||host.isMinimized()?host.getNormalBounds():host.getBounds(),custom=record.customSize===true||restoredBounds(record).custom;savedBounds.set(record.key,{bounds,custom});const file=boundsFile(record);if(file)try{require('./json-storage.cjs').atomicWriteJson(file,{version:2,bounds,custom});}catch(error){trace('surface-bounds-save-failed',error.message);}}
 function send(record,name,value){
  if(closed||record.window.isDestroyed())return;
  const contents=record.window.webContents,host=record.window.host;
  if(!record.failed&&!contents.isDestroyed()&&!contents.isCrashed?.())contents.send('extension:'+name,value);
  if(host&&!host.isDestroyed()&&!host.webContents.isDestroyed()&&!host.webContents.isCrashed?.())host.webContents.send('extension:'+name,value);
 }
 function usable(){const main=owner();return !closed&&main&&!main.isDestroyed()&&!main.isMinimized()&&(offscreen||main.isVisible());}
 function area(rect){return screen.getDisplayMatching(rect).workArea;}
 function state(record){return {key:record.key,kind:record.kind,title:record.title,placement:record.placement,visible:!!record.visible,barHeight:defaults.barHeight,agent_id:record.agent_id||null,binding:record.binding||null,parked:!!desk?.parked(record.key),desk:desk?.active()===true,container_id:record.window.host?.id||embedded(record)&&owner()?.id||record.window.id,web_contents_id:record.window.webContents.id,...(record.kind==='contacts'?{session_scope:record.sessionScope||null}:{}),...(record.kind==='settings'?{overlayClearance:record.overlayClearance||{bottom:0,wide:false}}:{})};}
 function notify(record){record.presence?.refresh();send(record,'state',state(record));const main=owner();if(main&&!main.isDestroyed())main.webContents.send('workspace:extensionState',state(record));refreshRails();onChange();}
 function markVisible(record,visible){
	 if(record.visible!==!!visible)record.receiptLife=(record.receiptLife||0)+1;
  record.visible=!!visible;send(record,'visibility',{visible:!!visible});record.presence?.refresh();record.modalSource?.refresh();
  if(record.binding)hub.visible(record.key,!!visible);
  if(visible&&record.kind==='contacts'&&record.placement==='attached')owner()?.webContents.send('workspace:sessionFocus',record.sessionScope||null);
  scheduleSleep(record);
 }
 // 后台规则（docs/程序开发协定.md）：隐藏的程序页收到 visibility=false 后自己暂停；目录标了 background:"sleep" 的程序
 // 停在 OS 里连续隐藏满 sleepMs 且没声明保持唤醒，就整页释放，下次打开重新加载。拆出的窗口归用户管，不休眠。
 function scheduleSleep(record){
  clearTimeout(record.sleepTimer);record.sleepTimer=null;
  if(closed||record.visible||record.awake||record.placement!=='attached'||appSpec(record.kind)?.background!=='sleep')return;
  record.sleepTimer=setTimeout(()=>{record.sleepTimer=null;const eligible=()=>!closed&&!record.visible&&!record.awake&&record.placement==='attached'&&!record.window.isDestroyed();if(!eligible())return;Promise.resolve(releaseSaved(record,eligible)).then(()=>{if(record.window.isDestroyed())trace('extension-slept',record.key);}).catch(error=>{trace('extension-save-failed',error.message);onReleaseError(error);});},defaults.sleepMs);
 }
 function releaseSaved(record,eligible=()=>true){
  if(record.releasePromise)return record.releasePromise;
  const finish=()=>{if(records.get(record.key)!==record||record.window.isDestroyed()||!eligible())return {ok:true};rememberSettings(record);record.destroying=true;record.window.destroy();return {ok:true};};
  const saved=prepareRelease(record.key);
  if(!saved?.then)return finish();
  record.releasePromise=Promise.resolve(saved).then(finish).finally(()=>{record.releasePromise=null;});return record.releasePromise;
 }
 function show(record,userRequested=true){
  authorize(record.key);
  record.requested=true;position(record);desk?.restore(record.key);markVisible(record,true);
  if(!offscreen){if(userRequested&&!displayDebug){record.window.show();record.window.focus();}else record.window.showInactive();}
  notify(record);
 }
 function hide(record,{stay=false}={}){rememberSettings(record);record.requested=false;markVisible(record,false);record.window.hide();notify(record);if(!stay&&record.kind==='settings'&&record.placement==='attached')navigate('home');return {ok:true,...state(record)};}
 function closeView(record){return closeSurface({detached:record.placement==='detached',ownerAvailable:mainAvailable()&&!!owner()&&!owner().isDestroyed(),quitting:closed||record.destroying,dock:()=>dock(record,{quiet:true}),hide:()=>hide(record),shutdown:()=>releaseSaved(record)});}
 function position(record){
  const main=owner();if(!main||main.isDestroyed()||record.placement!=='attached')return;
  if(embedded(record))return;
  const mainBounds=main.getBounds(),work=area(mainBounds),bounds=attachedBounds(mainBounds,work,{width:defaults.width,height:Math.min(defaults.height,mainBounds.height)});
  record.positionedBounds=bounds;repositioning=true;record.window.setBounds(bounds);repositioning=false;
 }
 function pageEvent(record,type,details={}){onPageEvent({key:record.key,type,senderID:record.window.webContents.id,...details});}
 function resetReady(record){
  record.rejectReady?.(Error('页面已重新载入，请等待当前页面。'));
  record.loaded=false;record.failed=false;record.loading=true;record.loadGeneration=(record.loadGeneration||0)+1;
  record.ready=new Promise((resolve,reject)=>{record.resolveReady=resolve;record.rejectReady=reject;});
  // Readiness stays rejectable for callers, including when no caller is waiting.
  void record.ready.catch(()=>{});return record.loadGeneration;
 }
 function failLoad(record,error){
  record.loaded=false;record.failed=true;record.loading=false;
  record.rejectReady?.(error);record.resolveReady=record.rejectReady=null;
  trace('extension-load-failed',String(error.message));pageEvent(record,'load-failed',{code:error.code});notify(record);
 }
 function loadDocument(record){
  const ticket=resetReady(record);record.expectNavigation=true;
  const failed=error=>{if(ticket===record.loadGeneration&&!record.window.isDestroyed())failLoad(record,error);};
  try{void Promise.resolve(record.window.loadURL(record.url)).catch(failed);}catch(error){failed(error);}
  return record.ready;
 }
 function makeWindow(record,url,rail=false){
  const main=owner(),work=area(main.getBounds());
  const windowOptions={width:Math.min(defaults.width,work.width),height:Math.min(defaults.height,work.height),minWidth:rail?1:Math.min(defaults.minWidth,work.width),minHeight:rail?1:Math.min(defaults.minHeight,work.height),parent:main,show:false,frame:false,transparent:rail,backgroundColor:rail?'#00000000':'#08090b',hasShadow:!rail,resizable:!rail,skipTaskbar:rail,title:record.title,autoHideMenuBar:true,focusable:!displayDebug,webPreferences:{preload:path.join(__dirname,record.kind==='home'?'preload.cjs':appSpec(record.kind)?'plugin-preload.cjs':'extension-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,offscreen,backgroundThrottling:true,additionalArguments:['--aieyra-extension-kind='+record.kind]}};
  if(record.native)windowOptions.webPreferences={...windowOptions.webPreferences,...record.webPreferences};
  const adapter=surfaceAdapter(record.kind);
  if(adapter)Object.assign(windowOptions.webPreferences,adapter.webPreferences);
  const window=embedded(record)?new (require('./dockable-view.cjs').DockableView)({electron,owner:main,options:windowOptions,shellPreload:path.join(__dirname,'extension-preload.cjs')}):new BrowserWindow(windowOptions);
  record.window=window;record.url=url;
  if(!rail&&!record.native)record.modalSource=nativeModal?.register(window.webContents,{window:()=>window.host||owner(),visible:()=>record.visible&&!record.failed&&!record.destroying,receive:record.kind==='settings'||!!appSpec(record.kind),allowed:current=>current===url,onState:open=>{record.modal=open;record.presence?.refresh();record.programOverlay?.refreshHalo();}});if(embedded(record)&&record.kind!=='home')window.setInset(workspaceInset);
  if(presence&&['settings','contacts'].includes(record.kind))record.presence=presence.mount({window:()=>window.host||owner(),visible:()=>mainAvailable()&&record.visible&&record.placement==='attached'&&record.kind==='contacts'&&!record.modal&&!record.sessionScope});
  if(record.presence)window.on('host-changing',()=>record.presence.unparent());
  if(record.kind!=='conversation'&&!record.native&&!appSpec(record.kind))registerDrop(window.webContents,u=>u===url);
  if(embedded(record)){window.on('host-ready',()=>notify(record));window.on('host-changing',()=>{record.programOverlay?.close();record.programOverlay=null;});}
  if(record.kind==='home'){const resizeHome=()=>{if(record.placement==='attached'){const [width,height]=main.getContentSize();window.setSurface({x:0,y:0,width,height});}};main.on('resize',resizeHome);window.once('closed',()=>main.removeListener('resize',resizeHome));resizeHome();}
  if(!rail)onWindow(window);
  if(displayDebug)window.setIgnoreMouseEvents(true,{forward:true});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));if(!record.native)window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.on('did-start-navigation',(_e,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace){if(record.expectNavigation)record.expectNavigation=false;else resetReady(record);record.modal=false;record.programOverlay?.refreshHalo();pageEvent(record,'navigating');}});
  window.webContents.on('render-process-gone',(_e,details)=>{record.modal=false;record.programOverlay?.refreshHalo();trace('extension-renderer-gone',record.key+':'+details.reason);if(record.binding)hub.visible(record.key,false);record.visible=false;resetReady(record);record.failed=true;record.loading=false;record.rejectReady(Error('程序页面已退出，请重新打开。'));record.resolveReady=record.rejectReady=null;pageEvent(record,'gone',{reason:details.reason,exitCode:details.exitCode});notify(record);});
  window.webContents.on('unresponsive',()=>pageEvent(record,'unresponsive'));
  window.webContents.on('responsive',()=>pageEvent(record,'responsive'));
  window.webContents.on('did-finish-load',()=>{
   record.loaded=true;record.failed=false;record.loading=false;record.expectNavigation=false;record.resolveReady?.();record.resolveReady=record.rejectReady=null;pageEvent(record,'loaded');send(record,'state',state(record));send(record,'visibility',{visible:record.visible});
   if(rail)send(record,'catalog',railData(record.side));else if(record.binding)send(record,'frame',hub.frame(record.key));
  });
  window.on('close',event=>{if(closed||record.destroying)return;if(rail){event.preventDefault();return;}event.preventDefault();Promise.resolve(closeView(record)).catch(error=>{trace('extension-save-failed',error.message);onReleaseError(error);});});
  window.on('closed',()=>{record.rejectReady?.(Error('程序页面已关闭'));record.resolveReady=record.rejectReady=null;pageEvent(record,'closed');record.modalSource?.release();record.programOverlay?.close();record.programOverlay=null;clearTimeout(record.previewTimer);desk?.forget(record.key);clearTimeout(record.sleepTimer);record.presence?.destroy();if(record.binding)hub.unsubscribe(record.key);records.delete(record.key);if(rail)rails.delete(record.side);if(!closed){refreshRails();onChange();}});
  window.on('minimize',()=>{markVisible(record,false);if(parkable(record)&&!desk.parked(record.key)){record.window.host.restore();park(record,true);}});
  if(embedded(record))window.on('user-resized',()=>{record.customSize=true;rememberSettings(record);});
  window.on('restore',()=>{if(record.requested)markVisible(record,true);});
  window.on('hide',()=>{if(record.visible)markVisible(record,false);});
  window.on('show',()=>{if(!record.visible&&record.requested)markVisible(record,true);});
  if(!rail)window.on('move',()=>{const current=window.getBounds(),placed=record.positionedBounds;const positioned=placed&&['x','y','width','height'].every(k=>current[k]===placed[k]);if(!repositioning&&!positioned&&record.loaded&&record.placement==='attached'&&!offscreen){record.placement='detached';notify(record);}});
  adapter?.mount(window);
  if(record.native)record.ready=Promise.resolve();else loadDocument(record);
  return window;
 }
 const windowTheme=config?require('./window-theme.cjs').createWindowTheme(config):null,stopTheme=windowTheme?.watch(()=>refreshRails());
 function railData(side){
  const rows=[...catalog.values()].filter(row=>(row.kind==='agent'?'left':'right')===side);
  const visible=['home','eyra'].includes(contextPage)?rows:[];
  return {side,appearanceTheme:publicAppearance(windowTheme?.read()),themeCss:windowTheme?.read().settings?.theme_css||'',entries:visible.map(row=>({...row,window:records.has(row.key)?state(records.get(row.key)):null})),layout:rails.get(side)?.layout||null};
 }
 function refreshRails(){
  if(closed)return;
  const main=owner();if(!main||main.isDestroyed())return;
  for(const side of ['left','right']){
   const data=railData(side);let record=rails.get(side);
   overflow[side]=[];
   if(!data.entries.length){if(record){send(record,'catalog',data);record.window.hide();record.visible=false;send(record,'visibility',{visible:false});}continue;}
   if(!record){record={key:'rail:'+side,kind:'rail',title:'Aieyra · '+(side==='left'?'团队':'扩展'),side,visible:false};rails.set(side,record);makeWindow(record,page('extension-rail.html')+'?side='+side,true);}
   record.layout=railLayout(main.getBounds(),area(main.getBounds()),data.entries.length,{size:side==='right'?defaults.tool_orb_size:defaults.orb_size,gap:defaults.orb_gap},side);
   if(record.layout.overflow)overflow[side]=data.entries;
   record.window.setBounds(record.layout.bounds);
   send(record,'catalog',railData(side));
   const visible=usable()&&!record.layout.overflow;record.visible=visible;
   if(!offscreen){if(visible)record.window.showInactive();else record.window.hide();}
   send(record,'visibility',{visible});
  }
  const signature=JSON.stringify(overflow);
  if(signature!==overflowSignature){overflowSignature=signature;main.webContents.send('workspace:extensionState',{kind:'layout',overflow});}
 }
 function layout(){
  layoutTimer=null;if(closed)return;
  refreshRails();
  for(const record of records.values()){
   if(record.placement==='attached')position(record);
   else if(recoverDisplays){const before=record.window.getBounds(),after=fit(before,area(before));if(['x','y','width','height'].some(k=>before[k]!==after[k]))record.window.setBounds(after);}
   if(!usable()&&record.visible&&record.placement==='attached'){record.window.hide();markVisible(record,false);}
   // Home also owns navigation and the containers for other embedded pages.
   // Restore that shared surface even when the selected page is settings/Link.
   else if(usable()&&record.requested&&!record.visible&&record.placement==='attached'&&(record.kind==='home'||!embedded(record)||contextPage===attachedPage(record)))show(record,false);
  }
  recoverDisplays=false;
 }
 function scheduleLayout(){if(layoutTimer===null)layoutTimer=setTimeout(layout,24);}
 const events=['move','resize','show','hide','minimize','restore'];for(const event of events)owner().on(event,scheduleLayout);
 const screenEvents=['display-added','display-removed','display-metrics-changed'];const screenChanged=()=>{recoverDisplays=true;scheduleLayout();};for(const event of screenEvents)screen.on(event,screenChanged);
 function getOrCreate(key){
  authorize(key);
  let record=records.get(key);if(record&&!record.window.isDestroyed()){
   if(record.failed)loadDocument(record);
   return record;
  }
  const spec=require('./module-catalog.cjs').MODULES.find(s=>s.id===key&&s.host==='surface');
  const row=spec?{kind:spec.id,key,title:spec.title}:conversations.get(key)||catalog.get(key);
  if(!row)throw Error('这项扩展当前不可用，请从当前光圈重新打开');
  // Bound retention: unopened entries have no observer renderer; completed,
  // hidden old views are released before a new one is created.
  if(records.size>=16)for(const [oldKey,old]of records){if(!old.requested&&!catalog.has(oldKey)&&!require('./module-catalog.cjs').MODULES.some(s=>s.id===oldKey)){old.destroying=true;old.window.destroy();if(records.size<16)break;}}
  if(records.size>=16)throw Error('已保留16个详情。请打开已有观察窗口，选择「结束观察」释放视图后重试。');
  record={...row,placement:'attached',visible:false,requested:false};records.set(key,record);
  const url=record.kind==='home'?page('index.html'):appSpec(record.kind)?page(appSpec(record.kind).page):['settings','contacts'].includes(record.kind)?page('index.html')+'?extension='+record.kind:record.kind==='conversation'?page('conversation.html')+'?id='+record.agent_id:page('extension.html');
  makeWindow(record,url);
  if(record.binding)hub.subscribe(key,record.binding,frame=>send(record,'frame',frame));
  trace('extension-created',key);return record;
 }
 function open(args={}){
  const key=String(args.key||'');if(key==='link'&&!records.has(key))return openLink(args);
  const record=getOrCreate(key);if(args.toggle&&record.visible)return hide(record);
  // Page navigation owns attached visibility. Preparing a renderer must not
  // briefly reveal it after the user has already chosen a newer destination.
  if(args.detached===true)detach(record,args);else if(!args.deferSurface||!embedded(record)||record.placement!=='attached')show(record);
  return {ok:true,...state(record)};
 }
 // 桌面模式：关窗就是真的关（回到后台，按后台规则休眠）；最小化缩到左上角。
 function parkable(record){return desk?.active()===true&&mainAvailable()&&embedded(record)&&record.placement==='detached'&&!!record.window.host;}
 function park(record,instant=false){rememberSettings(record);desk.take(record.key,record.window.host,{hide:()=>record.window.park(),instant});notify(record);return {ok:true};}
 function detach(record,args={}){
  authorize(record.key);
  if(record.key==='home')throw Error('首页固定在 OS 主窗口');
  if(embedded(record)){
   const saved=restoredBounds(record),settingsBounds=saved.bounds;
   const valid=settingsBounds&&['x','y','width','height'].every(k=>Number.isFinite(settingsBounds[k]));
   // 默认用最佳大小；只有用户亲手调过才沿用。位置都记着。
   const point=Number.isFinite(args.x)&&Number.isFinite(args.y)?{x:args.x,y:args.y,width:1,height:1}:null,work=area(point||(valid?settingsBounds:owner().getBounds()));
   record.customSize=saved.custom;
   const size=saved.custom&&valid?{width:settingsBounds.width,height:settingsBounds.height}:require('./module-window.cjs').bestWindowSize(work,defaults);
   const bounds=valid?{x:settingsBounds.x,y:settingsBounds.y,...size}:{x:work.x+Math.round((work.width-size.width)/2),y:work.y+Math.round((work.height-size.height)/2),...size};
   const minWidth=Math.min(defaults.minWidth,work.width),minHeight=Math.min(defaults.minHeight,work.height);
   record.window.setPlacement('detached',fit({...bounds,width:Math.max(minWidth,bounds.width),height:Math.max(minHeight,bounds.height)},work),{minWidth,minHeight});
  }
  else record.window.setParentWindow?.(null);
  record.placement='detached';
  if(Number.isFinite(args.x)&&Number.isFinite(args.y)){const previous=record.window.getBounds();record.window.setBounds(fit({...previous,x:Math.round(args.x-previous.width/2),y:Math.round(args.y-30)},area({x:args.x,y:args.y,width:1,height:1})));}
  show(record);notify(record);if(embedded(record)&&contextPage===attachedPage(record))navigate('home');trace('extension-detached',record.key);return {ok:true,...state(record)};
 }
 function dock(record,{quiet=false}={}){desk?.restore(record.key);if(desk?.active())quiet=true;if(!quiet)wakeOwner();rememberSettings(record);record.placement='attached';if(embedded(record))record.window.setPlacement('attached');else record.window.setParentWindow?.(owner());// 放回只是回到顶栏：用户正在看哪一页就还是哪一页，想看再点。
  if(quiet||embedded(record))hide(record,{stay:true});else show(record);trace('extension-docked',record.key);return {ok:true,...state(record)};}
 function fromEvent(event){
  const record=[...records.values(),...shells.values(),...rails.values()].find(r=>!r.window.isDestroyed()&&(r.window.webContents===event.sender||r.window.host?.webContents===event.sender));
  const shell=record?.window.host?.webContents===event.sender;
  if(!record||record.native&&!shell||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==(shell?record.window.hostURL:record.url))throw Error('无效的扩展界面来源');return record;
 }
	function receiptFields(args){return {call_id:String(args.call_id||''),receipt_generation:Number(args.receipt_generation)||0,receipt_version:String(args.receipt_version||''),input_offset:Number(args.input_offset)||0,output_offset:Number(args.output_offset)||0};}
	function receiptFence(record){
	 const life=record.receiptLife||0;
	 const assert=()=>{if(closed||records.get(record.key)!==record||!record.visible||record.destroying||record.failed||record.window.isDestroyed()||record.window.webContents.isDestroyed()||(record.receiptLife||0)!==life)throw Error('记录所属窗口已隐藏、关闭或更新，请重新展开');};
	 assert();return assert;
	}
 async function call(record,method,args={},chrome=false){
  if(record.external&&['dock','minimizeWindow','toggleMaximize','closeWindow'].includes(method))return record.control(method);
  if(method==='program'&&chrome){authorize(record.key);return require('./program-agent-overlay.cjs').programShellCall({record,args,invoke,electron,config,registerDrop});}
  if(method==='describe')return {ok:true,...state(record)};
  if(method==='sessionFocus'&&record.kind==='contacts'){const next=args.kind==='group'&&/^[a-f0-9]{32}$/.test(args.id||'')?{kind:'group',id:args.id}:null;if(record.sessionScope?.id!==next?.id||record.sessionScope?.kind!==next?.kind)record.receiptLife=(record.receiptLife||0)+1;record.sessionScope=next;notify(record);if(record.visible&&record.placement==='attached')owner()?.webContents.send('workspace:sessionFocus',record.sessionScope);return {ok:true};}
  if(method==='modalSurface'&&!chrome&&record.kind==='contacts'){if(typeof args.open!=='boolean')throw Error('无效的弹层状态');record.modal=args.open;record.modalSource?.set(record.modal);record.presence?.refresh();return {ok:true};}
  if(method==='catalog'&&record.kind==='rail')return railData(record.side);
  if(method==='open'&&record.kind==='rail')return open(args);
  if(method==='detach'&&record.kind==='rail')return open({...args,detached:true});
  if(method==='detach'&&record.kind!=='rail')return detach(record,args);
  if(method==='dock'&&record.kind!=='rail')return dock(record);
  if(method==='release'&&record.kind!=='rail'&&!embedded(record)){record.destroying=true;hub.unsubscribe(record.key);records.delete(record.key);record.window.destroy();refreshRails();return {ok:true};}
  if(method==='retireFocus'&&record.kind==='rail'){const main=owner();if(!offscreen&&!displayDebug&&record.window.isFocused()&&usable())main.focus();return {ok:true};}
  if(method==='hide'&&record.kind!=='rail')return hide(record);
  if(method==='closeWindow'&&record.kind!=='rail')return closeView(record);
  if(method==='focusMain'){const main=owner();if(main&&!main.isDestroyed()){if(main.isMinimized())main.restore();if(!offscreen&&!displayDebug){main.show();main.focus();}}return {ok:true};}
  if(method==='minimizeWindow'&&record.kind!=='rail'){if(parkable(record))return park(record);record.window.minimize();return {ok:true};}
  if(method==='toggleMaximize'&&record.kind!=='rail'){if(embedded(record)&&record.placement!=='detached')detach(record);record.placement='detached';record.window.isMaximized()?record.window.unmaximize():record.window.maximize();notify(record);return {ok:true};}
  if(method==='frame'&&record.binding)return hub.frame(record.key);
  if(method==='browserWorkSurface'&&!chrome&&record.kind==='conversation'){
   if(args.visible===true)receiptFence(record);
   return browserWorkSurface?.(args,record.window,record.agent_id)||{ok:true,hidden:true};
  }
  if(record.kind==='contacts'&&method==='conversation'&&args.action==='group_receipt'){
   const assert=receiptFence(record),group=record.sessionScope;
   if(group?.kind!=='group'||args.group_id!=null&&args.group_id!==group.id)throw Error('记录不属于当前群聊');
   const result=await invoke('conversation',{action:'group_receipt',group_id:group.id,member_id:String(args.member_id||''),...receiptFields(args)},record.window.host||owner());
   assert();if(record.sessionScope!==group)throw Error('当前群聊已切换');return result;
  }
  if(record.kind==='contacts'&&method==='conversation'&&args.action==='receipt')throw Error('请从所属私聊窗口读取记录');
  if(record.kind==='conversation'&&method==='conversation'&&args.action==='receipt'){
   const assert=receiptFence(record),id=record.agent_id;
   const result=await invoke('conversation',{action:'receipt',id,member_id:String(args.member_id||''),...receiptFields(args)},record.window.host||owner());
   assert();if(record.agent_id!==id)throw Error('当前会话已切换');return result;
  }
  if(record.kind==='conversation'&&method==='conversation'&&['terminal_read','program_projection'].includes(args.action)){
   const assert=receiptFence(record),id=record.agent_id;
   const result=await invoke('conversation',{...args,id},record.window.host||owner());
   assert();if(record.agent_id!==id)throw Error('当前会话已切换');return result;
  }
  if(record.binding&&method==='receipt'){
   const assert=receiptFence(record),scope=hub.assertScope(record.key,args),epoch=record.binding.core_epoch;
   if(args.core_epoch!=null&&args.core_epoch!==epoch)throw Error('记录所属Core已更新');
   const result=await core('workspace.receipt',{...scope,core_epoch:epoch,id:String(args.id||''),member_id:String(args.member_id||''),receipt_generation:Number(args.receipt_generation)||0,receipt_version:String(args.receipt_version||''),input_offset:Number(args.input_offset)||0,output_offset:Number(args.output_offset)||0,all_history:args.all_history===true});
   assert();hub.assertScope(record.key,scope);if(record.binding.core_epoch!==epoch)throw Error('记录所属Core已更新');return result;
  }
  if(record.kind==='contacts'&&['conversation','conversationOpen','conversationMenu','groupDraft','openHome'].includes(method))return invoke(method,method==='conversationOpen'?{...args,detached:record.placement==='detached'||!mainAvailable()}:args,record.window.host||owner());
  if(record.kind==='contacts'&&method==='themeLibrary'){
   if(!['list','image','like','prepare'].includes(args.action))throw Error('联系人只支持选择头像');
   if(args.action==='list')args={...args,category:'avatar'};
   if(args.action==='prepare')args={...args,target:'avatar'};
   return invoke(method,args,record.window.host||owner());
  }
  if(record.kind==='conversation'&&method==='conversation'){if(!['settings','configure','session_model','greet','send','retry_chat','cancel','snapshot','image','contact','contact_avatar','member_avatar','draft_load','draft_save','human_reply','terminal_read','program_projection'].includes(args.action))throw Error('此会话不支持该操作');const result=await invoke('conversation',{...args,id:record.agent_id},record.window.host||owner());if(args.action==='configure'&&successful(result)){record.title=result.title;notify(record);}return result;}
  if(record.kind==='conversation'&&['attachmentState','chooseAttachments','stageAttachmentPaths','stageAttachmentBytes','stageFileBytes','imageLibrary','attachmentMedia','attachmentReferences'].includes(method))return invoke('conversationAttachment',{id:record.agent_id,method,args},record.window.host||owner());
  if(record.kind==='conversation'&&method==='openLink')return invoke(method,args,record.window.host||owner());
  if(record.binding&&['terminals','terminalRead','toolImage'].includes(method)){
   const scope=hub.assertScope(record.key,args);
   const result=method==='terminals'?await core('workspace.terminals',scope):method==='terminalRead'?await core('workspace.terminal_read',{...scope,session_id:Number(args.session_id),session_generation:Number(args.session_generation)||0,offset:Number(args.offset)||0,terminal:args.terminal===true}):await core('workspace.tool_image',{...scope,image_id:String(args.image_id||'')});
   hub.assertScope(record.key,args);return result;
  }
  if(method==='document'&&record.kind==='document')return core('workspace.document',{task_id:record.binding.task_id,id:record.document_id});
  if(method==='halo'&&args.action==='read')return invoke(method,args,record.window);
  if(method==='halo'&&args.action==='reset'&&record.kind==='settings')return invoke(method,args,record.window);
  if(method==='profile')return invoke(method,args,record.window);
  if(method==='builtinRole'&&['contacts','conversation','settings'].includes(record.kind))return invoke(method,args,record.window.host||owner());
  if(method==='appearance'&&args.action==='os_appearance_read'){
   const value=await invoke(method,args,record.window);
   if(record.kind==='settings'&&!chrome)return value;
   if(value?.ok===false)return {ok:false,code:value.code,error:value.error};
   return publicAppearance(value)||{ok:false,error:'外观配置无法读取'};
  }
  if(record.kind==='settings'&&SETTINGS.has(method)){
   const result=await invoke(method,args,record.window.host||record.kind==='settings'&&owner()||record.window);
   if(successful(result)&&(['saveProfile','savePrompt','restorePrompt','restoreAllPrompts','undoPrompt'].includes(method)||method==='appearance'&&args.action==='os_appearance_update'||method==='onboard'&&!['onboarding_status','onboarding_draft','onboarding_parameters','onboarding_catalog'].includes(args.action))){
    owner()?.webContents.send('workspace:settingsChanged',{method});for(const other of records.values())send(other,'settingsChanged',{method});
   }
   return result;
  }
  throw Error('这个扩展不支持该操作');
 }
 const listener=async(event,payload={})=>{try{const record=fromEvent(event),method=String(payload.method||''),chrome=event.sender===record.window.host?.webContents;if(chrome&&!['describe','dock','minimizeWindow','toggleMaximize','closeWindow','profile','appearance','program'].includes(method))throw Error('窗口标题栏不支持该操作');if(chrome&&method==='appearance'&&payload.args?.action!=='os_appearance_read')throw Error('窗口标题栏只读取外观');return await call(record,method,payload.args||{},chrome);}catch(error){return {ok:false,error:String(error.message)};}};
 ipcMain.handle('extension:invoke',listener);
 const awake=(event,value)=>{const record=[...records.values()].find(r=>!r.window.isDestroyed()&&r.window.webContents===event.sender&&appSpec(r.kind));if(!record)return;record.awake=value===true;scheduleSleep(record);};
 ipcMain.on('plugin:awake',awake);
 return {
  // Control owns its service and loading; the shared surface host owns native
  // placement. Moving this record never releases or restarts that service.
  attachShell({kind,host,control}){
   const record={key:kind,kind,title:kind==='browser'?'浏览器':kind,placement:'detached',visible:true,external:true,control,window:{host,hostURL:page('settings-window.html'),webContents:host.webContents,isDestroyed:()=>host.isDestroyed()}};
   shells.set(host.id,record);const release=()=>{record.programOverlay?.close();record.programOverlay=null;shells.delete(host.id);};host.once('closed',release);return release;
  },
  nativePage({key,title,url,webPreferences}){
   if(key!=='link'||records.has(key))throw Error('原生页面已存在或类型无效');
   const record={key,kind:key,title,native:true,webPreferences,placement:'attached',visible:false,requested:false};records.set(key,record);
   const window=makeWindow(record,url);
   return {view:window.view,shown:()=>record.visible,layout({visible,bounds}){
    if(window.isDestroyed())return;
    if(record.placement==='detached')return;
    if(visible&&bounds)window.setSurface(bounds);
    record.requested=!!visible;markVisible(record,!!visible&&usable());
    if(record.visible)window.showInactive();else window.hide();
   },destroy(){record.destroying=true;window.destroy();}};
  },
  ready(key){return records.get(key)?.ready;},
  contents(key){return records.get(key)?.window.webContents;},
  window(key){return records.get(key)?.window;},
  releasePage(key){const r=records.get(key);return r?releaseSaved(r):{ok:true};},
  closePage(key){const r=records.get(key);return r?closeView(r):{ok:true};},
  registerConversation(row){if(!/^[a-f0-9]{32}$/.test(row?.id||''))throw Error('智能体标识无效');const key='conversation:'+row.id;conversations.set(key,{key,kind:'conversation',agent_id:row.id,title:String(row.title||'智能体').slice(0,120)});const record=records.get(key);if(record){record.title=String(row.title||'智能体');notify(record);}return key;},
  open,detach(args){const record=getOrCreate(String(args.key||''));return detach(record,args);},dock(args){const record=records.get(String(args.key||''));if(!record)throw Error('扩展窗口尚未打开');return dock(record);},
  publish(rows){
   const next=new Map();for(const row of Array.isArray(rows)?rows.slice(0,64):[]){if(!row||typeof row.key!=='string'||row.key.length>512||!['agent','plan','document'].includes(row.kind)||!validBinding(row.binding))continue;if(row.kind==='agent'&&row.key!==bindingKey(row.binding))continue;if(row.kind==='document'&&!/^[a-f0-9]{32}$/.test(row.document_id||''))continue;next.set(row.key,{kind:row.kind,key:row.key,title:String(row.title||'Agent').slice(0,120),state:String(row.state||''),phase:String(row.phase||''),summary:String(row.summary||'').slice(0,160),binding:{...row.binding},...(row.document_id?{document_id:row.document_id}:{})});}
   catalog=next;refreshRails();return {ok:true,count:catalog.size};
  },
  state(){return {ok:true,owner_window_id:owner()?.id,windows:[...records.values()].map(state),rails:[...rails.values()].map(r=>({side:r.side,visible:r.visible,layout:r.layout})),overflow,observation:hub.counts};},
  context({page:next}={}){contextPage=String(next||'home');refreshRails();return {ok:true};},
  setInset(x){workspaceInset=x;for(const record of records.values())if(embedded(record)&&record.kind!=='home')record.window.setInset(x);},
  surface({visible,bounds,key='settings',overlayClearance}={}){
   if(visible&&!records.has(key)&&appSpec(key))getOrCreate(key);
   const record=records.get(key);if(!record||!embedded(record)||record.placement!=='attached')return {ok:true};
   if(visible){
    const main=owner(),zoom=main.webContents.getZoomFactor(),[width,height]=main.getContentSize();
    if(!bounds||!['x','y','width','height'].every(k=>Number.isFinite(bounds[k]))||bounds.width<=0||bounds.height<=0)throw Error('设置显示区域无效');
    const x=Math.max(0,Math.ceil(bounds.x*zoom)),y=Math.max(0,Math.ceil(bounds.y*zoom));
    const right=Math.min(width,Math.floor((bounds.x+bounds.width)*zoom)),bottom=Math.min(height,Math.floor((bounds.y+bounds.height)*zoom));
    if(right<=x||bottom<=y)throw Error('设置显示区域超出主窗口');
    if(key==='settings')record.overlayClearance={bottom:Math.min(bounds.height,Math.max(0,Number(overlayClearance?.bottom)||0)),wide:overlayClearance?.wide===true};
    record.window.setSurface({x,y,width:right-x,height:bottom-y});
   }
   record.requested=visible===true;markVisible(record,record.requested&&usable());
   if(record.visible)record.window.showInactive();else record.window.hide();notify(record);return {ok:true,...state(record)};
  },
  // 悬停预览：看的这几秒里告诉页面它可见，暂停了的页面才有新内容。
  async preview(key){
   const record=records.get(String(key||''));
   if(!record||record.window.isDestroyed())return {ok:true,available:false,running:false};
   if(!record.visible){send(record,'visibility',{visible:true});clearTimeout(record.previewTimer);record.previewTimer=setTimeout(()=>{if(!record.window.isDestroyed()&&!record.visible)send(record,'visibility',{visible:false});},4000);}
   return {...await desk.preview(record.key,record.window.webContents,{ready:record.ready,isCurrent:()=>records.get(record.key)===record&&!record.window.isDestroyed()}),title:record.title,running:true};
  },
  deskChanged(){if(!desk?.active())desk?.restoreAll();for(const record of records.values())if(record.kind!=='rail')send(record,'state',state(record));onChange();},
  broadcast(name,value){for(const record of [...records.values(),...shells.values()])send(record,name,value);},
  close(){if(closed)return;closed=true;for(const r of shells.values())r.programOverlay?.close();shells.clear();for(const record of records.values())clearTimeout(record.sleepTimer);stopTheme?.();clearTimeout(layoutTimer);for(const event of events)owner()?.removeListener(event,scheduleLayout);for(const event of screenEvents)screen.removeListener(event,screenChanged);ipcMain.removeHandler('extension:invoke');ipcMain.removeListener('plugin:awake',awake);hub.close();for(const record of [...records.values(),...rails.values()]){rememberSettings(record);record.destroying=true;if(!record.window.isDestroyed())record.window.destroy();}records.clear();rails.clear();},
 };
}
module.exports={createExtensions};
