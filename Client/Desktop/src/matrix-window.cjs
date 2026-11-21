// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; config; presentation; bridge; socket; input
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/matrix-window.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),net=require('node:net');
let config,descriptor,win;
const presentation=require('./window-presentation.cjs');
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
const bridge=JSON.parse(process.env.AIEYRA_MATRIX_WINDOW_BRIDGE||'{}');
delete process.env.AIEYRA_MATRIX_WINDOW_BRIDGE;
if(!Number.isInteger(bridge.port)||bridge.port<1||bridge.port>65535||!/^[a-f0-9]{64}$/.test(bridge.token||''))throw Error('Invalid Matrix window bridge');
const socket=net.connect(bridge.port,'127.0.0.1');
socket.on('error',()=>app.quit());socket.on('close',()=>app.quit());
socket.once('connect',()=>socket.write(JSON.stringify({token:bridge.token})+'\n'));
const input=readline.createInterface({input:socket});
// 父进程退出可令 socket 发出 ECONNRESET；readline 会再次转发该错误，
// 两处都要收尾，否则 Electron 默认异常弹窗会留下孤立窗口和缓存锁。
input.on('error',()=>app.quit());
input.once('line',async line=>{
 try{
  config=JSON.parse(line);
  if(config.task_id && (!/^[a-f0-9]{32}$/.test(config.task_id)||!/^[a-f0-9]{32}$/.test(config.session_id||'')))throw Error('invalid task identity');
  app.setPath('userData',config.task_id?path.join(require('./paths.cjs').privatePath(config.config,'runtime'),'os',config.session_id,'task-windows',config.task_id):require('./paths.cjs').privatePath(config.config,'matrix_profile'));
  descriptor=JSON.parse(fs.readFileSync(config.discovery,'utf8'));
  const url=new URL(descriptor.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw Error('invalid bridge');
  await app.whenReady();
  win=new BrowserWindow({width:1060,height:760,minWidth:640,minHeight:480,show:false,backgroundColor:'#000000',title:config.task_id?'Aieyra OS · Matrix':'Matrix',autoHideMenuBar:true,titleBarStyle:'hidden',titleBarOverlay:{color:'#000000',symbolColor:'#f4f4f4',height:36},icon:path.join(__dirname,'../assets/os.ico'),webPreferences:{preload:path.join(__dirname,'matrix-window-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  presentation.apply(win,config.presentation);
  require('./interface-zoom.cjs').forConfig(config.config).attach(win,{minimum:[420,320],overlay:true});
  input.on('line',line=>{try{
   const value=JSON.parse(line);if(!['show','hide'].includes(value.action))throw Error('unknown window action');
   if(value.presentation!==undefined)presentation.apply(win,value.presentation);
   win.webContents.send('matrix:presentation',win.aieyraPresentation);
   if(value.action==='hide')win.hide();else win.showInactive();
   socket.write(JSON.stringify({action:value.action,presentation:win.aieyraPresentation})+'\n');
  }catch{socket.destroy();}});
  ipcMain.handle('matrix:call',async(event,p)=>{
   if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('unknown caller');
   if(p?.action==='agents.cancel'&&win.aieyraPresentation!=='interactive')return {ok:false,error:'display_only'};
   const allowed=['describe','agents.list','agents.status','agents.activity','agents.cancel','matrix.status'];
   if(!allowed.includes(p?.action))throw Error('unknown operation');
   if(config.task_id){
    if(['describe','matrix.status'].includes(p.action))return {ok:false,error:'task_scope_only'};
    if(p.action!=='agents.list'&&p.arguments?.id!==config.task_id)return {ok:false,error:'task_scope_only'};
   }
   try{const response=await fetch(descriptor.url,{method:'POST',headers:{Authorization:'Bearer '+descriptor.token,'Content-Type':'application/json'},body:JSON.stringify(p),redirect:'error',signal:AbortSignal.timeout(10000)});const data=await response.json();if(config.task_id&&p.action==='agents.list'&&Array.isArray(data.data))data.data=data.data.filter(r=>r.id===config.task_id);return data;}
   catch{return {ok:false,error:'connection_unavailable'};}
  });
  ipcMain.handle('matrix:locale',()=>{try{return JSON.parse(fs.readFileSync(config.config,'utf8').replace(/^\uFEFF/,'')).language||'zh-CN';}catch{return 'zh-CN';}});
  ipcMain.on('matrix:close',event=>{if(event.sender===win.webContents&&win.aieyraPresentation==='interactive')win.close();});
  ipcMain.on('matrix:presentation-ready',event=>{if(event.sender===win.webContents)win.webContents.send('matrix:presentation',win.aieyraPresentation);});
  const visibility=()=>{if(!win.isDestroyed())win.webContents.send('matrix:visibility',win.isVisible()&&!win.isMinimized());};
  for(const name of ['show','hide','minimize','restore'])win.on(name,visibility);
  ipcMain.on('matrix:visibility-ready',event=>{if(event.sender===win.webContents)visibility();});
  win.once('ready-to-show',()=>{win.showInactive();socket.write(JSON.stringify({ready:true})+'\n');});
  await win.loadFile(path.join(__dirname,'../renderer/matrix-window.html'));
 }catch{app.quit();}
});
app.on('window-all-closed',()=>app.quit());
