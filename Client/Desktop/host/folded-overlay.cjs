// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: portalReading; path; routes; overlayRoute; removeOverlayRoutes; createFoldedOverlay
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/folded-overlay.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {publicAppearance}=require('../../../Theme/runtime/projection.cjs');
function portalReading(text,current){
 if(!current||typeof text!=='string'||text.length>8192)return null;
 let value;try{value=JSON.parse(text);}catch{return null;}
 if(value?.key!==current.key||value.revision!==current.revision||!Number.isSafeInteger(value.sequence)||value.sequence<=current.sequence)return null;
 const anchor=(a,work)=>a===null||a&&typeof a==='object'&&typeof a.text==='string'&&a.text.length<=120&&typeof a.row==='string'&&a.row.length<=512&&Number.isFinite(a.offset)&&Math.abs(a.offset)<=1e8&&Number.isFinite(a.top)&&a.top>=0&&a.top<=1e8&&(!work||Number.isSafeInteger(a.block)&&a.block>=0);
 const state=(s,work)=>s&&typeof s.following==='boolean'&&anchor(s.anchor,work);
 if(!state(value.history,false)||value.work!==null&&(!state(value.work,true)||value.work.key!==current.work?.key))return null;
 return value;
}
const path=require('node:path'),{pathToFileURL}=require('node:url');
// Route by authenticated native view; several detached programs can coexist.
const routes=new WeakMap();
function overlayRoute(ipc,owner,channel,accept,handler){
 let registry=routes.get(ipc);if(!registry){registry=new Map();routes.set(ipc,registry);}
 let rows=registry.get(channel);if(!rows){rows=new Map();registry.set(channel,rows);ipc.handle(channel,(event,p)=>{for(const row of rows.values())if(row.accept(event))return row.handler(event,p);return {ok:false,error:'程序浮层已关闭'};});}
 rows.set(owner,{accept,handler});
}
function removeOverlayRoutes(ipc,owner){const registry=routes.get(ipc);if(!registry)return;for(const [channel,rows]of registry){rows.delete(owner);if(!rows.size){ipc.removeHandler(channel);registry.delete(channel);}}if(!registry.size)routes.delete(ipc);}
// A small native top layer above embedded WebContentsViews. It owns no model,
// task or composer state: all user actions return to the original OS renderer.
function createFoldedOverlay(options){
 const {electron,win,registerDrop=()=>{},onAction=null,onRead=null,theme=null,halo=null,blocked=()=>false,background=false}=options;
 const routeOwner={},register=(channel,handler)=>overlayRoute(electron.ipcMain,routeOwner,channel,event=>event.sender===view?.webContents,handler);
 const url=pathToFileURL(path.join(__dirname,'../ui/folded-overlay.html')).href+(background?'?surface=work':'');
 // 拆出窗关闭时它的浮层可能还在加载；宿主窗已销毁就不再回报。
 const notifyOwner=(channel,value)=>{if(!background&&!win.isDestroyed())win.webContents.send(channel,value);};
 let workOverlay=null;
 let target=win,quickOptions={},view=null,loaded=false,last=null,closed=false,shown=false,presented=false,unavailable=false,boundsKey='',zoom=null,revision=0,workspaceOffset=0,binding='',geometry=null,geometrySequence=0;
 const cancelGeometry=()=>{if(geometry)clearTimeout(geometry.timer);geometry=null;};
 function raise(){workOverlay?.raise();if(view&&!closed&&last?.visible&&!blocked(target))target.contentView.addChildView(view);}
 function paint(){
  if(!view||closed)return;
  const visible=last?.visible===true&&loaded&&!target.isDestroyed()&&!target.isMinimized()&&target.isVisible?.()!==false&&!blocked(target);
  if(!visible){hide();return;}
  const z=target.webContents.getZoomFactor(),[w,h]=target.getContentSize(),r=last.bounds;
  const baseX=Math.min(w-1,Math.max(0,Math.round(r.x*z))),x=baseX+(target===win&&!last.content?.sidebar&&!last.content?.layered?workspaceOffset:0),y=Math.min(h-1,Math.max(0,Math.round(r.y*z)));
  const bounds={x,y,width:Math.max(1,Math.min(w-baseX,Math.round(r.width*z))),height:Math.max(1,Math.min(h-y,Math.round(r.height*z)))};
  const key=JSON.stringify(bounds),nextBinding=JSON.stringify([last.content?.task_id,last.content?.core_epoch]);
  // Retire the old painted pixels before moving/resizing their native viewport.
  // Position-only drag is a compositor move and needs no renderer handoff.
  const prior=boundsKey?JSON.parse(boundsKey):null,sizeChanged=prior&&(prior.width!==bounds.width||prior.height!==bounds.height);
  if(!background&&shown&&(sizeChanged||binding!==nextBinding||z!==zoom)){
   if(!geometry){const token=++geometrySequence,timer=setTimeout(()=>{if(geometry?.token!==token)return;cancelGeometry();hide();unavailable=true;notifyOwner('workspace:foldedReady',{ready:false,reason:'unavailable'});},1800);timer.unref?.();geometry={token,timer};view.webContents.send('folded:prepare',{token});}
   return;
  }
  if(geometry)return;
  if(key!==boundsKey){view.setBounds(bounds);boundsKey=key;}
  if(z!==zoom){view.webContents.setZoomFactor(z);zoom=z;}
  // Chromium only establishes the viewport of a visible native view. Its
  // renderer remains transparent until it acknowledges this geometry.
  if(!presented){presented=true;view.setVisible(true);}
  // Geometry and renderer content must be applied before the first native
  // presentation. did-finish-load alone still contains the default ring size.
  binding=nextBinding;
  view.webContents.send('folded:frame',{...last.content,haloSelection:halo?.public()?.selection||null,appearanceTheme:publicAppearance(theme?.read()),frame_revision:++revision,surfaceWidth:bounds.width/z,surfaceHeight:bounds.height/z,surfaceScale:z});
 }
 const stopTheme=theme?.watch(paint);
 function ensure(){
  if(view||closed)return;
  view=new electron.WebContentsView({webPreferences:{preload:path.join(__dirname,'folded-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:true,offscreen:win.webContents.isOffscreen?.()===true}});
  registerDrop(view.webContents,u=>u===url);
  view.setBackgroundColor('#00000000');view.setVisible(false);target.contentView.addChildView(view);
  view.webContents.setWindowOpenHandler(()=>({action:'deny'}));view.webContents.on('will-navigate',event=>event.preventDefault());
  view.webContents.on('did-finish-load',()=>{loaded=true;unavailable=false;paint();});
  const failed=()=>{if(closed)return;cancelGeometry();loaded=false;shown=false;presented=false;unavailable=true;revision++;if(!view?.webContents.isDestroyed())view?.setVisible(false);notifyOwner('workspace:foldedReady',{ready:false,reason:'unavailable'});};
  view.webContents.on('render-process-gone',failed);
  void view.webContents.loadURL(url).catch(failed);
 }
 const actions=new Set(['toggle','history','input','send','resend','close','stop','escape','attachment','attachment_media','attachment_remove','compact','menu','home','layout','layer_settled','reference_reveal','canvas_references','preview','voice','hover','reading','decision','composition','move']);
 register('folded:prepared',(event,p={})=>{
  if(closed||!loaded||!view||!geometry||geometry.token!==p.token||target.isDestroyed()||target.isMinimized()||blocked(target)||event.sender!==view.webContents||event.senderFrame!==view.webContents.mainFrame||event.senderFrame.url!==url)return {ok:false};
  cancelGeometry();shown=false;paint();return {ok:true};
 });
 register('folded:read',async(event,p={})=>{
  if(closed||!loaded||!view||!onRead||target.isDestroyed()||blocked(target)||event.sender!==view.webContents||event.senderFrame!==view.webContents.mainFrame||event.senderFrame.url!==url||!last?.visible||!last.content?.program||p.task_id!==last.content.task_id||p.core_epoch!==last.content.core_epoch)return {ok:false,error:'程序页面已切换，请重试'};
  return onRead({...p,program:last.content.program});
 });
 register('folded:painted',(event,p={})=>{
  if(closed||!loaded||!view||geometry||target.isDestroyed()||target.isMinimized()||blocked(target)||event.sender!==view.webContents||event.senderFrame!==view.webContents.mainFrame||event.senderFrame.url!==url||!last?.visible||p.revision!==revision)return {ok:false};
  if(p.work_hidden===true){
   if(!background||last.content?.work?.active&&last.content.work.operations?.length)return {ok:false};
   last={...last,visible:false};hide();return {ok:true};
  }
  if(!shown){shown=true;view.webContents.send('folded:visibility',{visible:true});raise();options.onPresented?.();notifyOwner('workspace:foldedReady',{ready:true});}
  return {ok:true};
 });
 register('folded:action',async(event,p={})=>{
  if(background||closed||!loaded||!view||target.isDestroyed()||target.isMinimized()||blocked(target)||event.sender!==view.webContents||event.senderFrame!==view.webContents.mainFrame||event.senderFrame.url!==url||!last?.visible||!actions.has(p.action))return {ok:false,error:'此操作当前不可用'};
  if(p.task_id!==last.content.task_id||p.core_epoch!==last.content.core_epoch)return {ok:false,error:'任务已切换，请重试'};
  if(p.action==='move'&&(!last.content.layered||last.content.expanded||last.content.layer_closing))return {ok:false,error:'只有折叠态可以移动'};
  if(p.action==='reading'&&(last.content.program!=='home'||!portalReading(p.text,last.content.home_reading)))return {ok:false,error:'阅读位置已切换'};
  if(['input','send','decision','composition'].includes(p.action)&&(p.decision_key||'')!==(last.content.decision?.key||''))return {ok:false,error:'问题已变化，原输入已保留'};
  if(typeof p.text==='string'&&p.text.length>500000)return {ok:false,error:'输入过长'};
  if(p.edit_revision!==undefined&&(!Number.isSafeInteger(p.edit_revision)||p.edit_revision<0))return {ok:false,error:'输入版本无效'};
  if(onAction)return onAction(p);
  notifyOwner('workspace:foldedAction',{action:p.action,text:typeof p.text==='string'?p.text:undefined,edit_revision:p.edit_revision,decision_key:p.decision_key,task_id:p.task_id,core_epoch:p.core_epoch});return {ok:true};
 });
 const hide=()=>{cancelGeometry();if(!presented)return;shown=false;presented=false;revision++;view?.setVisible(false);if(loaded)view.webContents.send('folded:visibility',{visible:false});notifyOwner('workspace:foldedReady',{ready:false});};win.on('minimize',hide);win.on('restore',paint);win.on('hide',hide);win.on('show',paint);
 function setTarget(next=win){
  if(!next||next.isDestroyed())next=win;if(target===next)return;
  hide();for(const name of ['minimize','hide','closed'])target.removeListener(name,targetHidden);target.removeListener('resize',targetResized);
  if(view&&!target.isDestroyed())target.contentView.removeChildView(view);target=next;boundsKey='';zoom=null;
  if(view)target.contentView.addChildView(view);
  if(target!==win){for(const name of ['minimize','hide','closed'])target.on(name,targetHidden);target.on('resize',targetResized);}
 }
 function targetHidden(){hide();notifyOwner('workspace:quickInput',{open:false});}
 function targetResized(){if(target.isDestroyed())return;const z=target.webContents.getZoomFactor(),[w,h]=target.getContentSize();notifyOwner('workspace:quickInput',{open:true,width:w/z,height:h/z,...quickOptions});}
 return {holdsWork(task,epoch){return !!(last?.visible&&last.content?.task_id===task&&last.content?.core_epoch===epoch);},setOffset(x){const delta=x-workspaceOffset;workspaceOffset=x;if(view&&presented&&target===win&&!last?.content?.sidebar&&!last?.content?.layered){const b=view.getBounds();view.setBounds({...b,x:b.x+delta});boundsKey='';}},refreshHalo:paint,raise,target(next,options={}){quickOptions={bottomInset:Math.max(0,Math.min(400,Number(options.bottomInset)||0))};setTarget(next);targetResized();},surface(p={}){
  if(closed)return {ok:false};
  if(p.visible&&(!p.bounds||!['x','y','width','height'].every(k=>Number.isFinite(p.bounds[k]))||p.bounds.width<1||p.bounds.height<1))throw Error('Eyra浮层显示区域无效');
  if(!p.quick)setTarget(win);
  if(!background){
   // A program's own browser is already underneath the chat. Other tool
   // scenes use a retained, read-only native background, independent of the
   // folded chat's small hit rectangle. Home owns its background in its page.
   const operations=(p.content?.work?.operations||[]).filter(i=>!(p.content?.program==='browser'&&i.tool==='browser'));
   const active=!!(p.content?.work?.active&&operations.length);
   const visible=!!(p.visible&&p.content?.program&&p.content.program!=='home'&&(active||workOverlay?.holdsWork(p.content.task_id,p.content.core_epoch)));
   if(visible&&!workOverlay)workOverlay=createFoldedOverlay({...options,background:true,onAction:null,onPresented:raise});
   if(workOverlay){workOverlay.target(target);workOverlay.surface({...p,visible,bounds:p.content?.background_bounds||p.bounds,content:{...p.content,work:{...p.content?.work,hidden:false,operations}}});}
  }
  last=p;if(p.visible)ensure();paint();return {ok:true,visible:shown,ready:shown,unavailable,web_contents_id:view?.webContents.id};
 },close(){cancelGeometry();workOverlay?.close();workOverlay=null;stopTheme?.();for(const name of ['minimize','hide','closed'])target.removeListener(name,targetHidden);target.removeListener('resize',targetResized);closed=true;removeOverlayRoutes(electron.ipcMain,routeOwner);win.removeListener('minimize',hide);win.removeListener('restore',paint);win.removeListener('hide',hide);win.removeListener('show',paint);if(view){if(!target.isDestroyed())target.contentView.removeChildView(view);if(!view.webContents.isDestroyed())view.webContents.close();view=null;}}};
}
module.exports={createFoldedOverlay};
