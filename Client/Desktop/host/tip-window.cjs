// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; instances; listen; forget; createTipWindow; locate; listenTips
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/tip-window.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url');
// 顶栏下面是原生视图，页面里画的提示框会被压住。这里用一个不抢焦点、不接鼠标的小窗来画。
// 每个窗口一个提示小窗，量尺寸的通道共用一条。
const {publicAppearance}=require('../../../Theme/runtime/projection.cjs');
const {modelCardData}=require('../ui/model-card.mjs');
const {previewCardData}=require('../ui/preview-card.mjs');
const {tooltipRows}=require('../ui/tooltip-content.mjs');
const instances=new Map();let channel=null;
function listen(electron){
 if(channel)return;channel=electron.ipcMain;
 channel.handle('tip:size',(event,p)=>{for(const tip of instances.values())if(tip.owns(event.sender))return tip.sized(p);return {ok:false};});
}
function forget(win){instances.delete(win);if(!instances.size&&channel){channel.removeHandler('tip:size');channel=null;}}
function createTipWindow({electron,win,offscreen=false,theme=null}){
 if(instances.has(win))return instances.get(win).api;
 const url=pathToFileURL(path.join(__dirname,'../ui/tooltip.html')).href;
 let view=null,loaded=false,pending=null,sequence=0,closed=false,presented=false,closing=null,bounds=null,zoom=null,painting=null;
 function cancelPaint(){if(painting)clearTimeout(painting.timer);painting=null;if(view&&!view.isDestroyed())view.webContents.setBackgroundThrottling(true);}
 function cancelExit(){if(closing)clearTimeout(closing.timer);closing=null;}
 function hidden(){cancelExit();cancelPaint();presented=false;if(view&&!view.isDestroyed()){view.hide();if(loaded)view.webContents.send('tip:frame',{id:0,phase:'clear'});}}
 function hide(immediate=false){
  pending=null;
  if(immediate||!presented||!loaded){hidden();return {ok:true};}
  if(!closing){const exit={id:++sequence};closing=exit;exit.timer=setTimeout(()=>{if(closing===exit)hidden();},500);exit.timer.unref?.();view.webContents.send('tip:frame',{id:exit.id,phase:'hide'});}
  return {ok:true};
 }
 function send(){if(pending&&loaded&&view&&!view.isDestroyed()){
  const frame={text:pending.text,model:pending.model,preview:pending.preview,rows:pending.rows,appearanceTheme:publicAppearance(theme?.read())},signature=JSON.stringify(frame);
  if(signature===pending.sent)return;pending.sent=signature;pending.revision++;
  if(zoom!==pending.zoom){zoom=pending.zoom;view.webContents.setZoomFactor(zoom);}
  view.webContents.send('tip:frame',{...frame,id:pending.id,revision:pending.revision,visible:presented});
 }}
 function reveal(){
  const asked=pending,popup=view;if(!asked||presented||asked.layoutRevision!==asked.revision||painting?.id===asked.id&&painting.revision===asked.revision)return;
  cancelPaint();const paint={id:asked.id,revision:asked.revision};painting=paint;
  // Hidden capturePage can remain pending when Chromium reuses a resized popup.
  // Render a transparent, non-activating window and wait for its actual frames.
  popup.setOpacity(0);popup.webContents.setBackgroundThrottling(false);
  if(!offscreen&&!popup.isVisible())popup.showInactive();
  paint.timer=setTimeout(()=>{if(painting===paint)hide(true);},2000);paint.timer.unref?.();
  popup.webContents.send('tip:frame',{id:paint.id,revision:paint.revision,phase:'prepare'});
 }
 const stopTheme=theme?.watch(send);
 function ensure(){
  if(view)return;
  view=new electron.BrowserWindow({parent:win,width:40,height:24,show:false,frame:false,resizable:false,movable:false,skipTaskbar:true,transparent:true,hasShadow:false,focusable:false,webPreferences:{preload:path.join(__dirname,'tip-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:true,offscreen}});
  view.setIgnoreMouseEvents(true);
  view.webContents.setWindowOpenHandler(()=>({action:'deny'}));view.webContents.on('will-navigate',event=>event.preventDefault());
  const popup=view;
  view.webContents.on('did-finish-load',()=>{if(closed||view!==popup)return;loaded=true;send();});
  view.webContents.on('render-process-gone',()=>{if(view!==popup)return;hide(true);loaded=false;popup.destroy();view=null;bounds=null;zoom=null;});
  void view.webContents.loadURL(url).catch(()=>{if(view===popup)hide(true);});
 }
 const sized=(p={})=>{
  if(closed||win.isDestroyed())return {ok:false};
  if(p.hidden&&closing?.id===p.id){hidden();return {ok:true};}
  if(p.painted){
   if(!pending||pending.id!==p.id||pending.revision!==p.revision||pending.layoutRevision!==p.revision||painting?.id!==p.id||painting.revision!==p.revision)return {ok:false};
   cancelPaint();presented=true;view.setOpacity(1);view.webContents.send('tip:frame',{id:p.id,revision:p.revision,phase:'present'});return {ok:true};
  }
  if(!pending||p.id!==pending.id||p.revision!==pending.revision||!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<=0||p.height<=0)return {ok:false};
  const z=pending.zoom,owner=win.getContentBounds(),area=electron.screen.getDisplayMatching(owner).workArea;
  const width=Math.min(area.width,Math.ceil(p.width*z)),height=Math.min(area.height,Math.ceil(p.height*z)),a=pending.anchor,ox=owner.x+pending.offset.x,oy=owner.y+pending.offset.y;
  const below=Math.round(oy+(a.y+a.height)*z)+8,fits=below+height<=area.y+area.height;
  const y=fits?below:Math.max(area.y,Math.round(oy+a.y*z)-8-height);
  const x=Math.max(area.x,Math.min(area.x+area.width-width,Math.round(ox+(a.x+a.width/2)*z-width/2)));
  const next={x,y,width,height};if(!bounds||Object.keys(next).some(k=>next[k]!==bounds[k])){view.setBounds(next);bounds=next;}
  pending.layoutRevision=p.revision;reveal();
  return {ok:true};
 };
 const dismiss=()=>hide(true);
 function close(){if(closed)return;closed=true;stopTheme?.();hide(true);forget(win);if(!win.isDestroyed())for(const event of ['move','resize','hide','minimize','blur'])win.removeListener(event,dismiss);view?.destroy();view=null;}
 for(const event of ['move','resize','hide','minimize','blur'])win.on(event,dismiss);
 win.once('closed',close);
 const api={
  // offset：发起提示的视图在窗口里的位置；contents：它的缩放跟谁走。
  call(p={},{offset={x:0,y:0},contents=win.webContents}={}){
   if(closed||win.isDestroyed())return {ok:false};
   if(p.action==='hide')return hide(p.immediate===true);
   if(p.action!=='show'||typeof p.text!=='string'||!p.text||p.text.length>4000||![p.x,p.y,p.width,p.height].every(Number.isFinite))throw Error('提示内容无效');
   const next={text:p.text,model:modelCardData(p.model),preview:previewCardData(p.preview),rows:tooltipRows(p.rows),anchor:{x:p.x,y:p.y,width:p.width,height:p.height},offset:{...offset},zoom:contents.getZoomFactor()},signature=JSON.stringify(next);
   if(pending?.signature===signature)return {ok:true};
   cancelExit();cancelPaint();ensure();pending={...next,id:++sequence,revision:0,signature};send();return {ok:true};
  },
  state:()=>({text:pending?.text||'',visible:!!pending&&presented&&!!view&&!view.isDestroyed()&&view.isVisible()}),
  close,
 };
 instances.set(win,{api,sized,owns:sender=>!!view&&!view.isDestroyed()&&sender===view.webContents});
 listen(electron);
 return api;
}
// 发起提示的页面可能是窗口本身，也可能是窗口里嵌着的视图（浏览器外壳、拆出外壳、Eyra 小窗）。
// 顺着视图树找到它，提示框按它在窗口里的位置对齐。
function locate(electron,sender){
 const walk=(view,x,y)=>{for(const child of view.children||[]){const b=child.getBounds(),at={x:x+b.x,y:y+b.y};if(child.webContents===sender)return at;const hit=walk(child,at.x,at.y);if(hit)return hit;}return null;};
 for(const win of electron.BrowserWindow.getAllWindows()){
  if(win.isDestroyed())continue;
  if(win.webContents===sender)return {win,offset:{x:0,y:0}};
  const offset=walk(win.contentView,0,0);if(offset)return {win,offset};
 }
 return null;
}
function listenTips({electron,offscreen=false,theme=null}){
 electron.ipcMain.handle('ui:tip',(event,p)=>{
  const found=locate(electron,event.sender);if(!found)return {ok:false};
  return createTipWindow({electron,win:found.win,offscreen,theme}).call(p,{offset:found.offset,contents:event.sender});
 });
 return ()=>electron.ipcMain.removeHandler('ui:tip');
}
module.exports={createTipWindow,listenTips};
