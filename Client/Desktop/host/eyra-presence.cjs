// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; states; publicFrame; profileFrame; presenceGeometry; createEyraPresence
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/eyra-presence.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {publicAppearance}=require('../../../Theme/runtime/projection.cjs');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {presenceRingSize}=require('../ui/eyra-presence-geometry.mjs');
const states=new Set(require('../../../Halo/contract/definition.mjs').STATES);
const {effect}=require('../../../Halo/official/effects.mjs');
// Bounded current work projection; no history, task, draft or model config.
function publicFrame(value={},previous=null){
 const raw=value.instrument||{},data={};
 for(const key of ['state','effect','carry','recent','longWait','name','role'])if(typeof raw.data?.[key]==='string')data[key]=raw.data[key].slice(0,80);
 if(!states.has(data.state))data.state='idle';
 // 没带 avatar 表示没变（界面只在变化时才传），沿用上一帧。
 const avatar=raw.avatar===undefined&&previous?previous.instrument.avatar:typeof raw.avatar==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(raw.avatar)&&raw.avatar.length<=180000?raw.avatar:'';
 const summary=value.summary&&['thinking','body'].includes(data.state)?{name:String(data.name||'Eyra').slice(0,80),label:data.state==='thinking'?'正在思考':'正在回应',body:String(value.summary.body||'').slice(-1600)}:null;
 return {instrument:{data,label:String(raw.label||data.name||'Eyra').slice(0,120),code:data.state==='tool'?String(raw.code||'>_01').slice(0,12):'>_01',avatar,avatarHidden:!avatar||raw.avatarHidden===true,glyph:String(raw.glyph||'').slice(0,4)},ringSize:Math.min(144,Math.max(64,Number(value.ringSize)||104)),effect:effect(value.effect),reduced:value.reduced===true,...(summary?{summary}:{})};
}
function profileFrame(profile={}){return publicFrame({ringSize:profile.chatLayout?.ring||110,instrument:{data:{state:'idle',name:profile.eyraName||'Eyra'},avatar:profile.eyraAvatar,avatarHidden:!profile.eyraAvatar},effect:profile.roles?.matrix?.ring});}
function presenceGeometry(width,height,zoom=1,preferred=104,bottomInset=0,summary=false){
 const z=Number.isFinite(zoom)&&zoom>0?zoom:1,logicalHeight=height/z;
 const ring=presenceRingSize(logicalHeight,preferred);
 return {ring,zoom:z,bounds:{x:Math.round(16*z),y:Math.max(0,Math.round(height-(ring+48+Math.max(0,Number(bottomInset)||0))*z)),width:Math.max(1,Math.min(width-Math.round(16*z),Math.round((ring+32+(summary?360:0))*z))),height:Math.min(height,Math.round((ring+32)*z))}};
}
function createEyraPresence({electron,initial={},theme=null,halo=null,enabled=true,blocked=()=>false,onHome=async()=>{},onInput=async()=>{}}){
 const {ipcMain,WebContentsView}=electron,url=pathToFileURL(path.join(__dirname,'../ui/eyra-presence.html')).href;
 const surfaces=new Set(),windows=new Map(),offsets=new WeakMap();let frame=publicFrame(initial),signature=JSON.stringify(frame),closed=false,suppressed=null;
 const stopTheme=theme?.watch(()=>{for(const s of surfaces)s.refresh();});
 // Many inactive projections can share one OS window. Subscribe once per
 // native owner and release its listeners when the last projection leaves.
 function watchWindow(win,refresh){
  let entry=windows.get(win);
  if(!entry){
   entry={callbacks:new Set(),events:['show','hide','minimize','restore','resize']};
   entry.dispatch=()=>{for(const callback of [...entry.callbacks])callback();};
   windows.set(win,entry);for(const name of entry.events)win.on(name,entry.dispatch);
  }
  entry.callbacks.add(refresh);
  return ()=>{entry.callbacks.delete(refresh);if(!entry.callbacks.size){for(const name of entry.events)win.removeListener(name,entry.dispatch);windows.delete(win);}};
 }
 function trusted(event){return [...surfaces].find(s=>s.view?.webContents===event.sender&&event.senderFrame===event.sender.mainFrame&&event.senderFrame.url===url);}
 const painted=(event,p)=>{const s=trusted(event);if(!s||!s.visible||blocked(s.win)||s.revision!==p?.revision)return {ok:false};s.view.webContents.send('eyra:visibility',{visible:true});return {ok:true};};
 const home=async event=>{const s=trusted(event);if(!s?.visible||blocked(s.win))return {ok:false,error:'此页面当前不可用'};try{await onHome();return {ok:true};}catch(e){return {ok:false,error:String(e.message)};}};
 ipcMain.handle('eyra:painted',painted);ipcMain.handle('eyra:home',home);
 ipcMain.handle('eyra:input',async event=>{const s=trusted(event);if(!s?.visible||blocked(s.win))return {ok:false};try{await onInput(s.win,{bottomInset:s.bottomInset||0});return {ok:true};}catch(e){return {ok:false,error:String(e.message)};}});
 function mount({window:windowOf,visible=()=>true,onGeometry=()=>{},bottomInset=()=>0}){
  const s={view:null,win:null,loaded:false,failed:false,retries:0,visible:false,revision:0,key:'',stops:[]};surfaces.add(s);
  function hide(){if(!s.view||!s.visible)return;s.visible=false;s.key='';s.revision++;if(s.loaded&&!s.view.webContents.isDestroyed())s.view.webContents.send('eyra:visibility',{visible:false});s.view.setVisible(false);}
  function bind(win){if(s.win===win)return;for(const stop of s.stops)stop();s.stops=[];if(s.win&&!s.win.isDestroyed()&&s.view)s.win.contentView.removeChildView(s.view);s.win=win;if(win&&s.view)win.contentView.addChildView(s.view);if(win)s.stops.push(watchWindow(win,refresh));}
  function refresh(){
   if(closed||!surfaces.has(s))return;if(!enabled){hide();return;}const win=windowOf();if(!win||win.isDestroyed()){hide();return;}bind(win);
   const [width,height]=win.getContentSize();s.bottomInset=Math.max(0,Number(bottomInset())||0);const geometry=presenceGeometry(width,height,win.webContents.getZoomFactor(),frame.ringSize,s.bottomInset,!!frame.summary);s.baseBounds={...geometry.bounds};geometry.bounds.x+=offsets.get(win)||0;onGeometry(geometry);
   if(blocked(win)||win===suppressed||!visible()||!win.isVisible()||win.isMinimized()){hide();return;}
   if(!s.view){s.view=new WebContentsView({webPreferences:{preload:path.join(__dirname,'eyra-presence-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:true}});s.view.setBackgroundColor('#00000000');s.view.setVisible(false);win.contentView.addChildView(s.view);
    s.view.webContents.setWindowOpenHandler(()=>({action:'deny'}));s.view.webContents.on('will-navigate',e=>e.preventDefault());
    s.view.webContents.on('did-finish-load',()=>{s.loaded=true;s.failed=false;s.key='';refresh();});s.view.webContents.on('render-process-gone',()=>{hide();s.loaded=false;s.failed=true;});
    void s.view.webContents.loadURL(url).catch(()=>hide());
   }
   if(s.failed&&s.retries<2){s.failed=false;s.retries++;void s.view.webContents.loadURL(url).catch(()=>hide());}
   if(!s.loaded)return;
   const appearance=theme?.read(),themeCss=appearance?.settings?.theme_css||'',appearanceTheme=publicAppearance(appearance),haloSelection=halo?.public()?.selection||null,key=JSON.stringify([signature,geometry,themeCss,appearanceTheme,haloSelection]);if(s.visible&&key===s.key){win.contentView.addChildView(s.view);return;}
   s.key=key;s.visible=true;s.view.setBounds(geometry.bounds);s.view.webContents.setZoomFactor(geometry.zoom);win.contentView.addChildView(s.view);s.view.setVisible(true);
   s.view.webContents.send('eyra:frame',{...frame,themeCss,appearanceTheme,haloSelection,ringSize:geometry.ring,width:geometry.bounds.width/geometry.zoom,height:geometry.bounds.height/geometry.zoom,revision:++s.revision});
  }
  function destroy(){if(!surfaces.delete(s))return;hide();for(const stop of s.stops)stop();if(s.view){if(s.win&&!s.win.isDestroyed())s.win.contentView.removeChildView(s.view);if(!s.view.webContents.isDestroyed())s.view.webContents.close();}s.view=null;}
  s.refresh=refresh;s.destroy=destroy;
  return {refresh,destroy,unparent(){hide();bind(null);},raise(){if(s.visible&&s.view&&s.win&&!s.win.isDestroyed()&&!blocked(s.win))s.win.contentView.addChildView(s.view);},state:()=>({visible:s.visible,web_contents_id:s.view?.webContents.id})};
 }
 return {mount,setOffset(win,x){offsets.set(win,x);for(const s of surfaces)if(s.win===win&&s.visible&&s.view&&s.baseBounds)s.view.setBounds({...s.baseBounds,x:s.baseBounds.x+x});},suppress(win){if(suppressed===win)return;suppressed=win;for(const s of surfaces)s.refresh();},read:()=>structuredClone(frame),setFrame(value){const next=publicFrame(value,frame),key=JSON.stringify(next);if(key===signature)return;frame=next;signature=key;for(const s of surfaces)s.refresh();},refresh(){for(const s of surfaces)s.refresh();},close(){if(closed)return;closed=true;stopTheme?.();for(const s of [...surfaces])s.destroy();ipcMain.removeHandler('eyra:painted');ipcMain.removeHandler('eyra:home');ipcMain.removeHandler('eyra:input');}};
}
module.exports={createEyraPresence,publicFrame,profileFrame,presenceGeometry};
