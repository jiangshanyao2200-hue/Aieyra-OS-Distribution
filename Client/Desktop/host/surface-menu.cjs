// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; createSurfaceMenu
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/surface-menu.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url');

// Native child pages have their own input surface. A DOM z-index in the owner
// can paint above them while clicks still reach the child. Menus therefore own
// a small owned native window, sharing the same themed HTML for all surfaces.
function createSurfaceMenu({electron,win:defaultOwner,theme,offscreen=false,displayDebug=false}){
 const url=pathToFileURL(path.join(__dirname,'../ui/surface-menu.html')).href;
 let win=defaultOwner;
 let view=null,loaded=false,pending=null,sequence=0,closed=false,unwatch=[],presented=false,closing=null,bounds=null,zoom=null,painting=null,tips=null;
 function cancelPaint(){if(painting)clearTimeout(painting.timer);painting=null;if(view&&!view.isDestroyed())view.webContents.setBackgroundThrottling(true);}
 function cancelExit(){if(closing)clearTimeout(closing.timer);closing=null;}
 function hidden(){cancelExit();cancelPaint();presented=false;if(view&&!view.isDestroyed()){view.hide();if(loaded&&!view.webContents.isDestroyed())view.webContents.send('surface-menu:frame',{id:0,items:[]});}}
 function finish(value=null,{immediate=false,preserve=false}={}){
  const previous=pending;pending=null;cancelPaint();tips?.call({action:'hide',immediate:true});unwatch.splice(0).forEach(fn=>fn());previous?.resolve(value);
  if(preserve){cancelExit();return;}
  if(immediate||!presented||!loaded){hidden();return;}
  if(!closing){const exit={id:++sequence};closing=exit;exit.timer=setTimeout(()=>{if(closing===exit)hidden();},500);exit.timer.unref?.();view.webContents.send('surface-menu:frame',{id:exit.id,phase:'hide'});}
 }
 function reveal(){
  const asked=pending,popup=view;if(!asked||presented||asked.layoutRevision!==asked.revision||painting?.id===asked.id&&painting.revision===asked.revision)return;
  cancelPaint();const paint={id:asked.id,revision:asked.revision};painting=paint;
  // Match native tooltips: hidden resized surfaces cannot reliably capturePage.
  // Keep the native window transparent until its current frame is acknowledged.
  popup.setOpacity(0);popup.webContents.setBackgroundThrottling(false);
  if(!offscreen&&!popup.isVisible())popup.showInactive();
  paint.timer=setTimeout(()=>{if(painting===paint)finish(null,{immediate:true});},2000);paint.timer.unref?.();
  popup.webContents.send('surface-menu:frame',{id:paint.id,revision:paint.revision,phase:'prepare'});
 }
 function layout(width,height){
  if(!pending)return;
  const z=win.webContents.getZoomFactor(),owner=win.getContentBounds();
  const area=electron.screen.getDisplayMatching(owner).workArea;
  width=Math.min(area.width,Math.ceil(width*z));height=Math.min(area.height,Math.ceil(height*z));
  if(pending.attachment)width=Math.min(area.width,Math.ceil(Math.min(pending.attachment.width,owner.width/z)*z));
  const x=Math.max(area.x,Math.min(area.x+area.width-width,Math.round(owner.x+pending.x*z)));
  let y=Math.max(area.y,Math.min(area.y+area.height-height,Math.round(owner.y+pending.y*z)));
  if(pending.attachment){
   // Attached dropdowns never flip back over the titlebar when content grows.
   y=Math.max(area.y,Math.min(area.y+area.height-1,Math.round(owner.y+pending.y*z)));
   height=Math.min(height,Math.max(1,Math.ceil(pending.attachment.maxHeight*z)),Math.max(1,Math.min(area.y+area.height,owner.y+owner.height)-y));
  }
  const next={x,y,width,height};if(!bounds||Object.keys(next).some(k=>next[k]!==bounds[k])){view.setBounds(next);bounds=next;}
  pending.layoutRevision=pending.revision;reveal();
 }
 function paint(rows=pending?.rows){if(pending&&loaded){
  const z=win.webContents.getZoomFactor(),owner=win.getContentBounds(),attachment=pending.attachment?{kind:'topbar',width:Math.min(pending.attachment.width,Math.floor(owner.width/z)),maxHeight:Math.max(1,Math.min(pending.attachment.maxHeight,Math.floor(owner.height/z-pending.y)))}:null;
  const frame={items:pending.items,rows,apps:pending.apps,account:pending.account,models:pending.models,passive:pending.passive,theme:pending.theme,attachment,limits:attachment?{width:attachment.width,height:attachment.maxHeight}:{width:Math.max(190,Math.floor(owner.width/z)-12),height:Math.max(120,Math.floor(owner.height/z)-12)}},signature=JSON.stringify(frame);
  if(signature===pending.sent)return;pending.sent=signature;pending.revision++;
  if(zoom!==z){zoom=z;view.webContents.setZoomFactor(z);}view.webContents.send('surface-menu:frame',{...frame,id:pending.id,revision:pending.revision,visible:presented});
 }}
 const stopTheme=theme?.watch?.(()=>{if(pending){pending.theme=theme.read();paint(pending.rows?[]:undefined);}});
 function ensure(){
  if(view&&!view.isDestroyed())return;
  loaded=false;bounds=null;zoom=null;tips?.close();tips=null;
  view=new electron.BrowserWindow({parent:win,width:200,height:60,show:false,frame:false,resizable:false,skipTaskbar:true,transparent:true,hasShadow:false,focusable:!displayDebug,webPreferences:{preload:path.join(__dirname,'surface-menu-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:true,offscreen}});
  if(displayDebug)view.setIgnoreMouseEvents(true,{forward:true});
  view.on('blur',()=>finish());view.on('close',event=>{if(!closed){event.preventDefault();finish();}});
  view.webContents.setWindowOpenHandler(()=>({action:'deny'}));view.webContents.on('will-navigate',event=>event.preventDefault());
  const popup=view;
  view.webContents.on('did-finish-load',()=>{if(closed||view!==popup)return;loaded=true;paint();});
  view.webContents.on('render-process-gone',()=>{if(view!==popup)return;finish(null,{immediate:true});tips?.close();tips=null;loaded=false;popup.destroy();view=null;bounds=null;zoom=null;});
  void view.webContents.loadURL(url).catch(()=>{if(view===popup)finish(null,{immediate:true});});
 }
 function listen(contents,event,fn){contents.on(event,fn);unwatch.push(()=>contents.removeListener(event,fn));}
 const dismiss=()=>finish(null,{immediate:true});
 const ownerEvents=['resize','move','hide','minimize','close'];
 const watchOwner=()=>ownerEvents.forEach(event=>win.on(event,dismiss));
 const unwatchOwner=()=>ownerEvents.forEach(event=>win.removeListener(event,dismiss));
 watchOwner();
 electron.ipcMain.handle('surface-menu:action',(event,p={})=>{
  if(closed||event.sender!==view?.webContents||event.senderFrame!==view.webContents.mainFrame||event.senderFrame.url!==url)return {ok:false};
  if(p.action==='hidden'&&closing?.id===p.id){hidden();return {ok:true};}
  if(!pending||p.id!==pending.id)return {ok:false};
  if(p.action==='tip'&&pending.models){
   tips||=require('./tip-window.cjs').createTipWindow({electron,win:view,theme,offscreen});
   return tips.call(p.payload);
  }
  if(p.action==='painted'&&p.revision===pending.revision&&pending.layoutRevision===p.revision&&painting?.id===p.id&&painting.revision===p.revision){
   cancelPaint();presented=true;view.setOpacity(1);
   if(!offscreen&&!displayDebug&&!pending.passive){view.show();view.webContents.focus();}
   view.webContents.send('surface-menu:frame',{id:p.id,revision:p.revision,phase:'present'});
  }
  else if(p.action==='size'&&p.revision===pending.revision&&Number.isFinite(p.width)&&Number.isFinite(p.height)&&p.width>0&&p.width<=800&&p.height>0&&p.height<=800)layout(p.width,p.height);
  else if(p.action==='choose'&&pending.items.some(item=>item.id===p.value))finish(p.value);
  else if(p.action==='toggle'&&pending.onToggle&&pending.items.some(item=>item.id===p.value)){
   const asked=pending;
   void Promise.resolve(asked.onToggle(p.value)).then(apps=>{if(pending===asked&&apps){asked.apps=apps;paint();}}).catch(()=>{});
  }
  else if(p.action==='dismiss')finish();
  else if(p.action==='leave'&&pending.passive)finish();
  else return {ok:false};
  return {ok:true};
 });
 return {update({request_id,rows,account}){
  if(!pending||!request_id||pending.request_id!==request_id)return {ok:false,stale:true};
  if(account){if(JSON.stringify(account)===JSON.stringify(pending.account))return {ok:true,unchanged:true};pending.account=account;}
  else if(rows&&pending.rows){const updates=new Map(rows.map(row=>[row.id,row]));rows=pending.rows.filter(row=>updates.has(row.id)&&JSON.stringify(row)!==JSON.stringify(updates.get(row.id))).map(row=>updates.get(row.id));if(!rows.length)return {ok:true,unchanged:true};pending.rows=pending.rows.map(row=>updates.get(row.id)||row);}
  else return {ok:false,stale:true};
  paint(rows);return {ok:true};
 },dismiss(request_id,owner=defaultOwner){if(owner===win&&pending?.request_id===request_id)finish();return {ok:true};},accountChanged(state){if(pending?.account&&!state?.signedIn)finish();},open({x,y,items,rows,apps,onToggle,account,models,passive=false,request_id,attachment,owner=defaultOwner}){
  if(closed||owner.isDestroyed())return Promise.resolve(null);
  if(![x,y].every(Number.isFinite)||!Array.isArray(items)||!items.length||items.length>(rows||apps||models?201:12))throw Error('菜单位置或内容无效');
  if(attachment&&(attachment.kind!=='topbar'||![attachment.width,attachment.maxHeight].every(Number.isFinite)||attachment.width<=0||attachment.width>800||attachment.maxHeight<0||attachment.maxHeight>800))throw Error('菜单附着范围无效');
  if(owner!==win){
   dismiss();unwatchOwner();win=owner;watchOwner();
   if(view&&!view.isDestroyed())view.setParentWindow(win);
  }
  finish(null,{preserve:true});ensure();
  const result=new Promise(resolve=>{pending={id:++sequence,revision:0,x,y,items,rows,apps,onToggle,account,models,passive,request_id,attachment:attachment?{...attachment}:null,theme:theme?.read(),resolve};});
  const others=new Set([win.webContents,...win.contentView.children.map(child=>child.webContents)]);
  for(const contents of others){if(!contents||contents===view.webContents||contents.isDestroyed())continue;
   listen(contents,'before-mouse-event',(_event,input)=>{if(input.type==='mouseDown')finish();});
   listen(contents,'before-input-event',(_event,input)=>{if(input.key==='Escape')finish();});
  }
  paint();return result;
 },close(){if(closed)return;closed=true;stopTheme?.();finish(null,{immediate:true});tips?.close();tips=null;electron.ipcMain.removeHandler('surface-menu:action');unwatchOwner();if(view&&!view.isDestroyed())view.destroy();view=null;}};
}
module.exports={createSurfaceMenu};
