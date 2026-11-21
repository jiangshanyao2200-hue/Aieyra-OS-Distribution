// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; MIN; clamp; fit; preferenceFile; readPreference; writePreference; controllers; forConfig; inherit
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/interface-zoom.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Native page zoom re-rasterizes text and vectors. Never scale a screenshot or
// CSS transform the whole document. Preferences do not invalidate API proofs.
const fs=require('node:fs'),path=require('node:path');
const MIN=.8,MAX=1.75,STEP=.05;
const clamp=value=>Number.isFinite(value)?Math.round(Math.max(MIN,Math.min(MAX,value))*100)/100:1;
function fit(value,width,height,minWidth=360,minHeight=320){
 const limit=Math.max(MIN,Math.min(MAX,Math.floor(Math.min(width/minWidth,height/minHeight)*20)/20));
 return Math.min(clamp(value),limit);
}
function preferenceFile(config){return path.join(path.dirname(path.resolve(config)),'interface-preferences.json');}
function readPreference(file){
 try{const data=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));return clamp(data.zoom);}
 catch(error){if(error.code==='ENOENT')return 1;throw error;}
}
function writePreference(file,value,expected){
 const cfg=require('./config.cjs');
 return cfg.withWriteLock(file,expected,()=>{
  let data={};try{data=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid interface preferences');
  const temp=file+'.tmp.'+process.pid;
  try{fs.writeFileSync(temp,JSON.stringify({...data,zoom:clamp(value)},null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
  finally{fs.rmSync(temp,{force:true});}
 });
}
const controllers=new Map(),owners=new WeakMap(),inputs=new Map(),sessions=new WeakSet();let handlers=false;
function forConfig(config){
 const file=preferenceFile(config);if(controllers.has(file))return controllers.get(file);
 const {app,screen}=require('electron');
 let preferred=1,dirty=false,saveTimer,poll,closed=false,lastChange=0;
 try{preferred=readPreference(file);}catch{}
 const entries=new Map();
 function save(attempt=0){
  clearTimeout(saveTimer);if(!dirty)return;
  try{writePreference(file,preferred);dirty=false;}
  catch(error){
   if(error.code==='config_busy'&&attempt<4&&!closed){saveTimer=setTimeout(()=>save(attempt+1),150);saveTimer.unref();return;}
   for(const entry of entries.values())if(!entry.win.isDestroyed())entry.win.webContents.send('workspace:notice','界面比例已调整，但未能保存；请检查界面偏好文件。');
  }
 }
 function apply(entry){
  const {win,options}=entry;if(win.isDestroyed()||win.webContents.isDestroyed())return;
  if(options.size){
   const area=screen.getDisplayMatching(win.getBounds()).workArea;
   const width=Math.min(area.width-24,Math.round(options.size[0]*preferred));
   const height=Math.min(area.height-24,Math.round(options.size[1]*preferred));
   const [w,h]=win.getContentSize();
   if(w!==width||h!==height)win.setContentSize(Math.max(240,width),Math.max(200,height));
  }
  // Embedded content belongs to its container's scale. Fitting the smaller
  // content rectangle again makes Settings/conversations shrink behind a
  // normal-sized OS titlebar; a detached surface resumes its own size budget.
  const parent=options.zoomParent?.();
  const [w,h]=win.getContentSize(),z=parent&&!parent.isDestroyed()?parent.webContents.getZoomFactor():fit(preferred,w,h,...(options.minimum||[360,320]));
  if(Math.abs(win.webContents.getZoomFactor()-z)>.001)win.webContents.setZoomFactor(z);
  if(options.overlay){win.setTitleBarOverlay({height:Math.max(24,Math.round((options.overlayHeight||36)*z))});}
  options.changed?.(z);
 }
 function applyAll(){for(const entry of entries.values())apply(entry);}
 function acknowledge(){const cfg=require('./config.cjs');if(entries.size)require('./settings-observation.cjs').acknowledge(config,'interface',cfg.version(file),entries.values().next().value.win.id);}
 function change(win,direction){
  const entry=entries.get(win);if(!entry||win.isDestroyed()||win.aieyraPresentation==='display')return;
  const parent=entry.options.zoomParent?.();if(parent&&parent!==win&&entries.has(parent))return change(parent,direction);
  const now=Date.now();if(direction!=='reset'&&now-lastChange<45)return;
  lastChange=now;
  const value=direction==='reset'?1:clamp(win.webContents.getZoomFactor()+(direction==='in'?STEP:-STEP));
  // At a small-window boundary repeated wheel ticks must not queue invisible
  // enlargement. A resize can still restore a previously chosen larger scale.
  const [w,h]=win.getContentSize();
  const next=entry.options.size?value:fit(value,w,h,...(entry.options.minimum||[360,320]));
  if(preferred===next){apply(entry);return;}
  preferred=next;dirty=true;applyAll();clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(),240);saveTimer.unref();
 }
 function input(wc,owner){
  const target=()=>typeof owner==='function'?owner():owner;
  if(inputs.has(wc.id))return;
  const {ipcMain}=require('electron');
  if(!handlers){
   handlers=true;
   ipcMain.handle('aieyra-ui-zoom:enabled',event=>inputs.has(event.sender.id)&&event.senderFrame===event.sender.mainFrame);
   ipcMain.on('aieyra-ui-zoom:change',(event,direction)=>{
    if(event.senderFrame!==event.sender.mainFrame||!['in','out','reset'].includes(direction))return;
    inputs.get(event.sender.id)?.change(direction);
   });
  }
  inputs.set(wc.id,{change:direction=>change(target(),direction)});wc.once('destroyed',()=>inputs.delete(wc.id));
  if(!sessions.has(wc.session)){wc.session.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'interface-zoom-preload.cjs')});sessions.add(wc.session);}
  wc.setZoomMode('isolated');wc.setVisualZoomLevelLimits(1,1).catch(()=>{});
  wc.on('zoom-changed',(event,direction)=>{event.preventDefault();change(target(),direction);});
  wc.on('before-input-event',(event,input)=>{
   if(input.type!=='keyDown'||input.alt||!(input.control||(process.platform==='darwin'&&input.meta)))return;
   const direction=input.key==='0'?'reset':['+','='].includes(input.key)?'in':input.key==='-'?'out':null;
   if(direction){event.preventDefault();change(target(),direction);}
  });
 }
 function attach(win,options={}){
  if(entries.has(win))return api;
  const entry={win,options};entries.set(win,entry);owners.set(win,api);
  const wc=win.webContents;input(wc,win);
  wc.on('did-finish-load',()=>apply(entry));win.on('resize',()=>apply(entry));
  win.once('closed',()=>{entries.delete(win);if(!entries.size){save();if(poll){fs.unwatchFile(file,poll);poll=null;}}});
  if(!poll){poll=()=>{if(dirty||closed)return;try{preferred=readPreference(file);applyAll();acknowledge();}catch{}};fs.watchFile(file,{interval:500,persistent:false},poll);}
  apply(entry);return api;
 }
 const api={attach,input,get value(){return preferred;},file};controllers.set(file,api);
 app.once('before-quit',()=>{closed=true;save();if(poll)fs.unwatchFile(file,poll);});
 return api;
}
function inherit(win,parent,options){
 const controller=owners.get(parent)||forConfig(require('./paths.cjs').resolveConfigPath(''));
 return controller.attach(win,options);
}
module.exports={MIN,MAX,STEP,clamp,fit,preferenceFile,readPreference,writePreference,forConfig,inherit};
