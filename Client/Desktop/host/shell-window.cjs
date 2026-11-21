// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; BAR; listening; listen; ShellWindow
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/shell-window.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {EventEmitter}=require('node:events');
const path=require('node:path');
// 装外部内容（登录页、预览、中心程序）的窗口。内容在 WebContentsView 里，碰不到外壳；
// 标题栏由 OS 自己画，不出现系统标题栏和默认菜单。对外的用法和 BrowserWindow 一样。
const {publicAppearance}=require('../../../Theme/runtime/projection.cjs');
const BAR=40,shells=new Set();
let listening=false;
function listen(ipcMain){
 if(listening)return;listening=true;
 ipcMain.handle('shell-window:action',(event,p={})=>{
  const shell=[...shells].find(s=>!s.host.isDestroyed()&&s.host.webContents===event.sender);if(!shell)return {ok:false};
  if(p.action==='describe')return {ok:true,title:shell.title,bar:BAR,resizable:shell.resizable};
  if(p.action==='theme')return publicAppearance(shell.theme?.read())||{ok:true};
  if(p.action==='minimize')shell.host.minimize();
  else if(p.action==='maximize'&&shell.resizable)shell.host.isMaximized()?shell.host.unmaximize():shell.host.maximize();
  else if(p.action==='close')shell.host.close();
  return {ok:true};
 });
}
class ShellWindow extends EventEmitter {
 constructor({electron,title='',width=1100,height=760,minWidth=360,minHeight=320,parent,modal=false,resizable=true,offscreen=false,theme=null,icon,backgroundColor='#0b0d12',webPreferences={}}){
  super();listen(electron.ipcMain);this.title=title;this.resizable=resizable;this.theme=theme;
  const {BrowserWindow,WebContentsView}=electron;
  this.host=new BrowserWindow({title,width,height,minWidth,minHeight,parent,modal,resizable,maximizable:resizable,minimizable:!modal,show:false,frame:false,backgroundColor:'#08090b',autoHideMenuBar:true,...(icon?{icon}:{}),webPreferences:{preload:path.join(__dirname,'shell-window-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen}});
  this.view=new WebContentsView({webPreferences:{...webPreferences,offscreen}});this.view.setBackgroundColor(backgroundColor);
  this.webContents=this.view.webContents;this.host.contentView.addChildView(this.view);shells.add(this);
  const layout=()=>{if(this.host.isDestroyed())return;const [w,h]=this.host.getContentSize();this.view.setBounds({x:0,y:BAR,width:w,height:Math.max(1,h-BAR)});};
  this.layout=layout;layout();this.host.on('resize',layout);
  for(const name of ['close','move','resize','show','hide','minimize','restore','maximize','unmaximize','focus','blur'])this.host.on(name,(...args)=>this.emit(name,...args));
  const paintTheme=()=>{if(!this.host.isDestroyed())this.host.webContents.send('shell-window:theme',publicAppearance(theme?.read()));};
  const stopTheme=theme?.watch(paintTheme);this.host.webContents.on('did-finish-load',paintTheme);
  this.host.once('closed',()=>{stopTheme?.();shells.delete(this);if(!this.webContents.isDestroyed())this.webContents.close();this.emit('closed');});
  this.webContents.once('did-finish-load',()=>this.emit('ready-to-show'));
  this.webContents.on('page-title-updated',(event,next)=>this.emit('page-title-updated',event,next));
  void this.host.loadFile(path.join(__dirname,'../ui/window-shell.html')).catch(()=>{});
 }
 loadURL(url){return this.webContents.loadURL(url);}
 isDestroyed(){return this.host.isDestroyed();}
 isVisible(){return this.host.isVisible();}
 isMinimized(){return this.host.isMinimized();}
 isMaximized(){return this.host.isMaximized();}
 getBounds(){return this.host.getBounds();}
 setBounds(bounds){this.host.setBounds(bounds);}
 getContentSize(){return this.host.getContentSize();}
 setMinimumSize(w,h){this.host.setMinimumSize(w,h);}
 show(){this.host.show();}
 hide(){this.host.hide();}
 focus(){this.host.focus();this.webContents.focus();}
 minimize(){this.host.minimize();}
 restore(){this.host.restore();}
 close(){if(!this.host.isDestroyed())this.host.close();}
 destroy(){if(!this.host.isDestroyed())this.host.destroy();}
}
module.exports={ShellWindow,SHELL_BAR:BAR};
