// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: dialogs; show
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/styled-dialog.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {app,BrowserWindow,ipcMain}=require('electron'),path=require('node:path');
const dialogs=new Map();
ipcMain.handle('aieyra-dialog:data',event=>dialogs.get(event.sender.id)?.data||null);
ipcMain.handle('aieyra-dialog:answer',(event,value)=>{
 const d=dialogs.get(event.sender.id);if(!d||d.win.aieyraPresentation!=='interactive'||event.senderFrame!==d.win.webContents.mainFrame||!Number.isInteger(value)||value<0||value>=d.data.buttons.length)return false;
 d.answer=value;d.win.close();return true;
});
function show(parent,{title,message,buttons=['知道了'],cancelId=0,defaultId=0,language='zh-CN',presentation=parent?.aieyraPresentation||(process.env.AIEYRA_PRESENTATION==='display'?'display':'interactive')}){
 const policy=require('./window-presentation.cjs');policy.mode(presentation);
 const agentPresentation=!!parent?.aieyraPresentation||!!process.env.AIEYRA_PRESENTATION;
 app.setAccessibilitySupportEnabled(true);
 return new Promise(resolve=>{
  const win=new BrowserWindow({parent:parent&&!parent.isDestroyed()?parent:undefined,modal:!!parent&&presentation==='interactive'&&!agentPresentation,width:500,height:320,resizable:false,minimizable:false,maximizable:false,show:false,backgroundColor:'#0a0a0a',title,titleBarStyle:'hidden',titleBarOverlay:{color:'#0a0a0a',symbolColor:'#ccc',height:36},autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'styled-dialog-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  policy.apply(win,presentation);
  require('./interface-zoom.cjs').inherit(win,parent,{size:[500,320],minimum:[280,200],overlay:true});
  win.setMenu(null);const id=win.webContents.id,entry={win,data:{title,message,buttons,defaultId,cancelId,language,presentation},answer:cancelId};dialogs.set(id,entry);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  win.on('closed',()=>{dialogs.delete(id);resolve({response:entry.answer});});
  // Agent 开放交互权限也不能代替用户激活窗口；用户主动设置对话保留正常焦点。
  win.once('ready-to-show',()=>{if(!win.isDestroyed()){if(presentation==='display'||agentPresentation)win.showInactive();else win.show();}});
  win.loadFile(path.join(__dirname,'../renderer/styled-dialog.html')).catch(()=>{entry.answer=cancelId;if(!win.isDestroyed())win.close();});
 });
}
module.exports={show};
