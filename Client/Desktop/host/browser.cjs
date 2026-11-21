// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: browser-instance, projection
// Regions: path; createEmbeddedBrowser
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/browser.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const path=require('node:path'),fs=require('node:fs');
const {View,WebContentsView,BrowserWindow,screen}=require('electron');
function createEmbeddedBrowser({attachAgentShell=null,registerDrop=()=>{},authorize=()=>{},deskPark=()=>null,win,config,secretExecutable,offscreen=false,displayDebug=false,onChange=()=>{},onDock=()=>{},onEyra=()=>{},mainAvailable=()=>true,presence=null,nativeModal=null,canReference=()=>false,onReference=async()=>{},accountSession=()=>null}){
 const theme=require('./window-theme.cjs').createWindowTheme(config),profileStore=require('./profile.cjs').createProfileStore(config);
 const eyra=()=>{const p=profileStore.read(),appearance=theme.read().settings;return {name:p.eyraName||'Eyra',avatar:p.eyraAvatar||'',size:p.chatLayout?.eyraAvatar,ring:p.roles?.matrix?.ring,innerAnimation:appearance?.inner_animation,spreadAnimation:appearance?.spread_animation};};
 const portalFile=()=>path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'modules','browser','window.json');
 function readPortalBounds(){try{const value=require('./json-storage.cjs').inspectJson(portalFile()).value;return value?.custom===true&&Number.isFinite(value.bounds?.width)&&Number.isFinite(value.bounds?.height)?value:null;}catch{return null;}}
 function savePortalBounds(owned){try{fs.mkdirSync(path.dirname(portalFile()),{recursive:true});require('./json-storage.cjs').atomicWriteJson(portalFile(),{version:2,bounds:owned.getBounds(),custom:true});}catch{}}
 const tabGroups=new Map(),groups=new Set(),submissions=new Map(),resumedMessages=new Set();let runtime,selected='',artifactGroup='',shown=false,rect=null,closed=false,workspaceInset=0,work=null,surfaceGroups=null;
 function parentGroup(group,parent,host){if(group.parentView!==parent){group.parentView?.removeChildView(group.container);parent.addChildView(group.container);group.parentView=parent;}if(group.win!==host)group.bindWindow?.(host);}
 function clearWork(){if(!work)return;const old=work;work=null;for(const e of ['destroying','closed'])old.source.removeListener(e,old.release);old.source.removeListener('host-changing',old.moving);for(const e of ['show','hide','resize','minimize','restore'])old.source.removeListener(e,layout);layout();}
 function workSurface(value={},source=win,translated=source===win,owner){
  if(value.visible!==true){if(work?.source===source)clearWork();return {ok:true};}
  if(!source||source.isDestroyed()||!source.isVisible())return {ok:true,hidden:true};
  const requestTab=String(value.tab_id||'');
  if(owner!==undefined&&!runtime?.status().groups.some(g=>g.owner===owner&&g.active_tab_id===requestTab&&!g.detached)){
   if(work?.source===source)clearWork();
   return {ok:true,hidden:true};
  }
  const r=value.bounds,z=source.webContents.getZoomFactor(),size=source.view?source.view.getBounds():null,[width,height]=size?[size.width,size.height]:source.getContentSize();
  if(!r||!['x','y','width','height'].every(k=>Number.isFinite(r[k]))||r.width<=0||r.height<=0)throw Error('Invalid browser work surface');
  const x=Math.max(0,Math.ceil(r.x*z)),y=Math.max(0,Math.ceil(r.y*z)),bounds={x,y,width:Math.max(0,Math.min(width-x,Math.floor(r.width*z))),height:Math.max(0,Math.min(height-y,Math.floor(r.height*z)))};
  if(work?.source!==source){clearWork();work={source,translated,release:()=>clearWork(),moving:()=>{for(const group of groups)if(group.inWork)group.bindWindow(win);}};for(const e of ['destroying','closed'])source.on(e,work.release);source.on('host-changing',work.moving);for(const e of ['show','hide','resize','minimize','restore'])source.on(e,layout);}
  if(work.requestTab!==requestTab){work.tab=requestTab;work.requestTab=requestTab;work.userSelected=false;}
  Object.assign(work,{bounds,offset:workspaceInset,owner});layout();return {ok:true};
 }
 function workBounds(){const origin=work.source.view?.getBounds()||{x:0,y:0};return {...work.bounds,x:origin.x+work.bounds.x+(work.translated?workspaceInset-work.offset:0),y:origin.y+work.bounds.y};}
 function browserSurfaceGroup(group){return group.owner==='program/browser'||group.id===artifactGroup;}
 function state(){const result=runtime?.status()||{groups:[],count:0};return {...result,selected,shown,artifact_group_id:artifactGroup};}
 function changed(){const rows=runtime?.status().groups||[];if(!rows.some(g=>g.id===artifactGroup))artifactGroup='';if(!rows.some(g=>g.id===selected))selected=rows.find(browserSurfaceGroup)?.id||'';layout();onChange(state());}
 function layout(geometryOnly=false){for(const group of groups){
  if(geometryOnly===true&&(group.detached||(!group.onSurface&&!group.inWork)))continue;
  if(group.detached){const [width,height]=group.win.getContentSize();group.container.setVisible(true);const bar=attachAgentShell?Math.round(48*group.win.webContents.getZoomFactor()):0;group.container.setBounds({x:0,y:bar,width,height:Math.max(1,height-bar)});group.shellView.setBounds({x:0,y:0,width,height:Math.max(1,height-bar)});group.relayout?.();group.modalSource?.refresh();group.presence?.refresh();continue;}
  const projected=!shown&&work&&!work.source.isDestroyed()&&work.source.isVisible()&&!work.source.isMinimized?.()&&work.bounds?.width>0&&work.bounds?.height>0;
  const targetGroup=projected?(work.tab?(tabGroups.get(work.tab)||runtime?.status().groups.find(g=>g.active_tab_id===work.tab)?.id):work.userSelected?selected:''):selected;
  const tiles=shown&&rect&&surfaceGroups?.filter(id=>[...groups].some(g=>g.id===id&&!g.detached)),tileIndex=tiles?tiles.indexOf(group.id):-1;
  const active=(tiles?tileIndex>=0:group.id===targetGroup)&&!closed&&(shown&&!!rect||projected&&(work.owner===undefined||group.owner===work.owner)),wasWork=group.inWork;group.onSurface=!!(active&&!projected);group.inWork=!!(active&&projected);
  const host=group.inWork?(work.source.host||work.source.owner||work.source):win,parent=host.contentView;
  if(geometryOnly!==true){
   parentGroup(group,parent,host);if(group.inWork&&(!wasWork||group.workSource!==work.source))parent.addChildView(group.container);
   group.workSource=group.inWork?work.source:null;group.container.setVisible(!!active);
  }
  if(active){let target=group.inWork?workBounds():{...rect,x:rect.x+workspaceInset,width:Math.max(1,rect.width-workspaceInset)};
   if(!group.inWork&&tiles?.length>1){const gap=12,columns=Math.min(tiles.length,Math.max(1,Math.floor((target.width+gap)/492))),rows=Math.ceil(tiles.length/columns),width=Math.floor((target.width-gap*(columns-1))/columns),height=Math.floor((target.height-gap*(rows-1))/rows);target={x:target.x+tileIndex%columns*(width+gap),y:target.y+Math.floor(tileIndex/columns)*(height+gap),width:Math.max(1,width),height:Math.max(1,height)};}
   group.container.setBounds(target);group.shellView.setBounds({x:0,y:0,width:target.width,height:target.height});group.relayout?.();}
  if(geometryOnly!==true){group.modalSource?.refresh();group.presence?.refresh();}
 }}
 function mount({owner,profile,fp}){
  const container=new View();container.setBounds({x:0,y:0,width:fp.width,height:fp.height+96});container.setVisible(false);win.contentView.addChildView(container);
  const shellView=new WebContentsView({webPreferences:{preload:path.join(__dirname,'../src/browser-shell-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  shellView.setBackgroundColor('#00000000');container.addChildView(shellView);shellView.setBounds({x:0,y:0,width:fp.width,height:fp.height+96});
  let portal=null,disposed=false;
  const group={win,owner,profile,eyra,openEyra:onEyra,canReference,onReference:reference=>onReference(reference,{detached:group.detached,window:group.win,bottomInset:group.shelfHeight??0}),showReference:()=>{if(group.detached)group.win.showInactive();else{selected=group.id;onDock();}},embedded:true,detached:false,container,shellView,shell:shellView.webContents,
   visible:()=>!closed&&!group.win.isMinimized?.()&&(group.detached?group.win.isVisible():group.win.isVisible()&&(group.inWork?!!work&&work.source.isVisible():group.onSurface===true&&shown&&!!rect)),
   ready:shellView.webContents.loadFile(path.join(__dirname,'../../../Program/official/browser/ui/browser-shell.html'),{query:{embedded:'1'}}),
   place(detached,{returnToMain=true,x,y}={}){
    if(disposed||closed)throw Error('Browser group closed');if(detached===group.detached){if(detached){if(!offscreen){if(displayDebug)portal.showInactive();else{portal.show();portal.focus();}}}return;}
    if(detached){
     const {bestWindowSize,moduleWindowSpec}=require('./module-window.cjs'),spec=moduleWindowSpec();
     const point=Number.isFinite(x)&&Number.isFinite(y)?{x:Math.round(x),y:Math.round(y)}:null;
     const display=point?screen?.getDisplayNearestPoint?.(point):screen?.getDisplayMatching?.(win.getBounds());
     const work=display?.workArea||screen?.getPrimaryDisplay?.().workArea||{width:fp.width,height:fp.height+96};
     const best=bestWindowSize(work,spec),saved=readPortalBounds()?.bounds||best;
     const minWidth=Math.min(spec.minWidth,work.width),minHeight=Math.min(spec.minHeight,work.height);
     const width=Math.min(work.width,Math.max(minWidth,saved.width)),height=Math.min(work.height,Math.max(minHeight,saved.height));
     portal=new BrowserWindow({width,height,minWidth,minHeight,useContentSize:true,show:false,focusable:!offscreen&&!displayDebug,backgroundColor:'#08090b',title:'Aieyra · 浏览器 · '+profile,autoHideMenuBar:true,...(attachAgentShell?{frame:false}:{titleBarStyle:'hidden',titleBarOverlay:{color:'#11151d',symbolColor:'#cbd5e1',height:44}}),webPreferences:{additionalArguments:attachAgentShell?['--aieyra-extension-kind=shell']:[],preload:path.join(__dirname,attachAgentShell?'extension-preload.cjs':'module-background-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen}});
     if(attachAgentShell)group.releaseAgentShell=attachAgentShell({kind:'browser',host:portal,control:method=>{if(method==='dock')group.place(false);else if(method==='minimizeWindow')portal.minimize();else if(method==='toggleMaximize')portal.isMaximized()?portal.unmaximize():portal.maximize();else portal.close();return {ok:true};}});
     portal.webContents.on('did-finish-load',()=>portal?.webContents.send('module:theme',theme.read()));void portal.loadFile(path.join(__dirname,attachAgentShell?'../ui/settings-window.html':'../ui/module-background.html'));
     portal.setMenu(null);if(displayDebug||offscreen)require('../src/window-presentation.cjs').apply(portal,'display');
     if(Number.isFinite(x)&&Number.isFinite(y)){const previous=portal.getBounds(),point={x:Math.round(x),y:Math.round(y)},area=screen.getDisplayNearestPoint(point).workArea;require('./module-window.cjs').restoreModuleBounds(portal,require('./extension-layout.cjs').fit({...previous,x:Math.round(x-previous.width/2),y:Math.round(y-30)},area));}
     group.parentView.removeChildView(container);portal.contentView.addChildView(container);group.parentView=portal.contentView;group.inWork=false;group.detached=true;
     group.bindWindow(portal);portal.on('resize',layout);
     // 用户亲手调过大小就记下来；桌面模式里最小化缩到左上角。
     portal.on('resized',()=>savePortalBounds(portal));
     portal.on('minimize',()=>{const park=deskPark();if(park?.active()&&mainAvailable()){const owned=portal,bounds=owned.getNormalBounds();owned.restore();require('./module-window.cjs').restoreModuleBounds(owned,bounds);layout();park.take('browser',owned,{instant:true,beforeHide:()=>preview(group,{capture:true})});}});
     require('../src/interface-zoom.cjs').forConfig(config).attach(portal,{minimum:[480,380],overlay:!attachAgentShell,overlayHeight:44,changed:layout});
     portal.on('close',event=>{if(disposed||closed)return;event.preventDefault();if(mainAvailable())group.place(false);else runtime.closeGroup(group.id);});
     if(!offscreen)portal.showInactive();
    }else{
     const old=portal;group.releaseAgentShell?.();group.releaseAgentShell=null;group.presence?.unparent();old.contentView.removeChildView(container);win.contentView.addChildView(container);group.parentView=win.contentView;group.detached=false;portal=null;group.bindWindow(win);selected=group.id;old.removeListener('resize',layout);old.destroy();
    }
    layout();changed();if(!detached&&returnToMain)onDock();
   },
   selectGroup(target){if(!groups.has(target))throw Error('Unknown browser group');if(group.inWork&&work?.owner!==undefined&&target.owner!==work.owner)throw Error('Browser group belongs to another conversation');if(target===group)return;const fromDetached=group.detached;if(group.inWork&&work){work.tab='';work.userSelected=true;}if(fromDetached)group.place(false,{returnToMain:false});selected=target.id;if(fromDetached&&!target.detached)target.place(true);else if(target.detached)target.win.showInactive();layout();changed();},
   dispose(){if(disposed)return;disposed=true;group.releaseAgentShell?.();group.releaseAgentShell=null;group.modalSource?.release();group.presence?.destroy();groups.delete(group);for(const [tab,id]of tabGroups)if(id===group.id)tabGroups.delete(tab);if(!group.win.isDestroyed())group.parentView.removeChildView(container);if(!group.shell.isDestroyed())group.shell.close();if(portal&&!portal.isDestroyed()){portal.removeListener('resize',layout);portal.destroy();}portal=null;}
  };
  group.parentView=win.contentView;groups.add(group);group.modalSource=nativeModal?.register(group.shell,{window:()=>group.win,visible:()=>!disposed&&group.visible()});group.presence=presence?.mount({window:()=>group.win,visible:()=>mainAvailable()&&!group.detached&&!group.inWork&&group.visible()&&!group.panelOverlay,bottomInset:()=>group.shelfHeight??0,onGeometry:({ring})=>{if(group.presenceSize!==ring){group.presenceSize=ring;group.refreshChrome?.();}}});return group;
 }
 // A successfully accepted user message is the handback. Browser tool calls
 // wait for that decision so a fast model cannot race the send receipt.
 function userMessage(owner,commit,requestId=''){
  const job=(submissions.get(owner)||Promise.resolve()).then(async()=>{const result=await commit();const key=owner+'/'+requestId;if(result?.ok!==false&&(!requestId||!resumedMessages.has(key))){if(requestId){resumedMessages.add(key);while(resumedMessages.size>512)resumedMessages.delete(resumedMessages.values().next().value);}await runtime?.resume(owner);}return result;});
  const gate=job.catch(()=>{});submissions.set(owner,gate);void gate.then(()=>{if(submissions.get(owner)===gate)submissions.delete(owner);});return job;
 }
 async function execute(owner,args,signal){while(submissions.has(owner))await submissions.get(owner);const result=await ensure().execute(owner,args,signal);if(result.ok!==false&&result.tab_id){const rows=runtime.status().groups,group=rows.find(g=>g.owner===owner&&(result.group_id?g.id===result.group_id:g.active_tab_id===result.tab_id));if(group)tabGroups.set(result.tab_id,group.id);while(tabGroups.size>100)tabGroups.delete(tabGroups.keys().next().value);layout();}return result;}
 function revealProgramTab(group){
  if(group.owner!=='program/browser')return false;
  selected=group.id;
  if(group.detached){if(!group.win.isVisible()&&!offscreen)group.win.showInactive();}
  else if(!shown&&mainAvailable())onDock();
  layout();return true;
 }
 function ensure(){
  authorize();
  if(closed)throw Error('Browser host closed');
  if(!runtime){let language='zh-CN';try{language=JSON.parse(fs.readFileSync(config,'utf8').replace(/^\uFEFF/, '')).language||language;}catch{}
   runtime=require('../src/browser-runtime.cjs').createBrowserRuntime({storage:require('../src/paths.cjs').privatePath(config,'browser'),secretExecutable,interfaceConfig:config,language,mount,onInteract:revealProgramTab,onChange:changed,onArtifactPage:(wc,origin)=>registerDrop(wc,url=>{try{return new URL(url).origin===origin;}catch{return false;}}),accountSession});}
  return runtime;
 }
 function surface(value={}){
  // Layout updates never replay renderer selection; only an explicit user choice changes it.
  if(value.select_group!==undefined){if(![...groups].some(g=>g.id===value.select_group&&browserSurfaceGroup(g)))throw Error('Unknown browser group');selected=value.select_group;}
  if(Array.isArray(value.group_ids)){const ids=[...new Set(value.group_ids)];if(ids.some(id=>![...groups].some(g=>g.id===id&&browserSurfaceGroup(g))))throw Error('Unknown native browser instance');surfaceGroups=ids.slice(0,12);}else surfaceGroups=null;
  const variables={};for(const [key,v] of Object.entries(value.appearance?.variables||{}))if(['--ui-text','--ui-text-2','--ui-accent','--browser-font','--browser-size'].includes(key)&&typeof v==='string'&&v.length<=400)variables[key]=v;
  for(const group of groups)group.appearance={variables,reduced:value.appearance?.reduced===true};
  if(shown&&value.visible!==true)void preview();
  shown=value.visible===true;
  if(shown){const r=value.bounds,z=win.webContents.getZoomFactor(),[width,height]=win.getContentSize();
   if(!r||!['x','y','width','height'].every(k=>Number.isFinite(r[k]))||r.width<=0||r.height<=0)throw Error('Invalid browser surface');
   const x=Math.max(0,Math.ceil(r.x*z)),y=Math.max(0,Math.ceil(r.y*z));
   const w=Math.min(width-x,Math.floor(r.width*z)),h=Math.min(height-y,Math.floor(r.height*z));rect=w>0&&h>0?{x,y,width:w,height:h}:null;
  }
  layout();for(const group of groups)group.refreshChrome?.();return {ok:true,...state()};
 }
 const stopTheme=theme.watch(value=>{for(const group of groups)if(group.detached&&!group.win.isDestroyed())group.win.webContents.send('module:theme',value);});
 const ownerContents=win.webContents;
 const hide=()=>{shown=false;if(!win.isDestroyed())layout();};ownerContents.on('did-start-navigation',hide);
 function previewTarget(group){if(!group)group=[...groups].find(g=>g.id===selected)||[...groups][0];return group&&groups.has(group)?{...runtime?.previewTarget(group.id),cached:group.detached?!group.win.isVisible():!group.visible()}:null;}
 function captureTarget(){
  const visibleGroups=[...groups].filter(group=>group.visible()&&(group.detached||group.onSurface));
  const selectedGroup=visibleGroups.find(group=>group.id===selected);
  const group=selectedGroup||(visibleGroups.length===1?visibleGroups[0]:null);
  const target=group&&runtime?.previewTarget(group.id);
  return target?{...target,surface:group.shell,owner:group.win,detached:group.detached}:null;
 }
 async function preview(group,{capture=false}={}){const target=previewTarget(group);if(!target?.contents)return {ok:true,available:false,running:false};return {...await deskPark()?.preview('browser',target.contents,{ready:target.ready,identity:target.identity,cached:capture?false:target.cached,isCurrent:()=>{const now=previewTarget(group);return now?.contents===target.contents&&now?.identity===target.identity;}}),running:true};}

 async function projection(tabID,{metadataOnly=false,owner}={}){
  // The caller resolved this tab from its authenticated immutable tool receipt.
  const row=runtime?.status().groups.find(g=>g.active_tab_id===tabID&&(owner===undefined||g.owner===owner));
  const group=row&&[...groups].find(g=>g.id===row.id),target=group&&runtime.previewTarget(group.id);
  if(!target)return {ok:true,available:false,tab_id:tabID};
  const info={program:'browser',tab_id:tabID,identity:target.identity,profile:row.profile,control:row.control};
  if(metadataOnly&&!group.detached)return {ok:true,available:true,native:true,...info};
  const current=()=>!closed&&runtime?.previewTarget(group.id)?.identity===target.identity&&runtime.status().groups.some(g=>g.id===group.id&&g.active_tab_id===tabID);
  const image=await deskPark()?.preview('browser-projection:'+group.id,target.contents,{ready:target.ready,identity:target.identity,isCurrent:current});
  if(!current())return {ok:true,available:false,changed:true,tab_id:tabID};
  return {...image,...info};
 }
 return {projection,workSurface,captureTarget,refreshProfile(){for(const group of groups)group.refreshChrome?.();},setInset(x){if(x!==workspaceInset){workspaceInset=x;layout(true);}},preview:()=>preview(),closeModule(){for(const group of [...groups])if(group.detached){if(mainAvailable())group.place(false);else runtime.closeGroup(group.id);}return {ok:true,...state()};},async placeModule(owner,detached,point={}){let rows=[...groups].filter(g=>!detached||g.owner===owner);if(!rows.length&&detached){await ensure().user(owner,{action:'open'});rows=[...groups].filter(g=>g.owner===owner);}if(detached){const active=rows.find(g=>g.detached)||rows.find(g=>g.id===selected)||rows[0];active?.place(true,point);}else for(const group of rows)group.place(false);return {ok:true,...state()};},status:()=>({ok:true,...state()}),surface,revealReference:(owner,reference)=>ensure().revealReference(owner,reference),execute,userMessage,
  async user(owner,args){const result=await ensure().user(owner,args);if(result.tab_id){selected=runtime.status().groups.find(g=>g.active_tab_id===result.tab_id)?.id||selected;changed();}return {...result,...state()};},
  async openArtifact(owner,file){const result=await ensure().openArtifact(owner,file);if(result.tab_id){const group=runtime.status().groups.find(g=>g.owner===owner&&g.active_tab_id===result.tab_id);if(group){artifactGroup=group.id;selected=group.id;changed();onDock();}}return {...result,...state()};},
  suspend(){clearWork();hide();runtime?.close();runtime=null;selected='';changed();},
  close(){if(closed)return;clearWork();hide();closed=true;stopTheme();runtime?.close();ownerContents.removeListener('did-start-navigation',hide);}};
}
module.exports={createEmbeddedBrowser};
