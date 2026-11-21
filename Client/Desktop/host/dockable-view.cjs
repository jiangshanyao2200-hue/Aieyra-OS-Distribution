// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; DockableView
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/dockable-view.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {EventEmitter}=require('node:events');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {moduleWindowSpec,restoreModuleBounds}=require('./module-window.cjs');

// A page has one WebContentsView. Docking changes its native container, never
// the renderer, editor state or IPC identity. The detached window has no parent.
class DockableView extends EventEmitter {
 constructor({electron,owner,options,shellPreload}) {
  super();this.electron=electron;this.owner=owner;this.options=options;this.shellPreload=shellPreload;
  this.view=new electron.WebContentsView({webPreferences:options.webPreferences});
  this.webContents=this.view.webContents;this.view.setBackgroundColor('#00000000');
  this.inset=0;this.host=null;this.placement='attached';this.visible=false;this.destroyed=false;this.barHeight=moduleWindowSpec().barHeight;
  const [width,height]=owner.getContentSize();this.rect={x:0,y:56,width,height:Math.max(1,height-56)};
  owner.contentView.addChildView(this.view);this.view.setVisible(false);this.layout();
  this.ownerResize=()=>{if(this.placement==='attached'){this.layout();this.emit('resize');}};
  owner.on('resize',this.ownerResize);
 }
 layout(){
  if(this.destroyed)return;
  const [width,height]=this.host?this.host.getContentSize():[this.rect.width,this.rect.height];
  const bar=this.host?Math.round(this.barHeight*(this.host.webContents.getZoomFactor?.()||1)):0;
  this.view.setBounds(this.host?{x:0,y:bar,width:Math.max(1,width),height:Math.max(1,height-bar)}:{...this.rect,x:this.rect.x+this.inset,width:Math.max(1,this.rect.width-this.inset)});
  this.view.setVisible(this.visible);
 }
 setInset(x){
  if(x===this.inset)return;
  this.inset=x;
  if(this.placement==='attached'&&!this.destroyed)this.view.setBounds({...this.rect,x:this.rect.x+x,width:Math.max(1,this.rect.width-x)});
 }
 setSurface(bounds){this.rect={...bounds};if(this.placement==='attached'){this.layout();this.emit('resize');}}
 setPlacement(next,bounds,minimumSize){
  if(next===this.placement)return;
  this.emit('host-changing');
  if(next==='detached'){
   const host=new this.electron.BrowserWindow({...this.options,...minimumSize,webPreferences:{...this.options.webPreferences,preload:this.shellPreload||this.options.webPreferences.preload,additionalArguments:['--aieyra-extension-kind=shell']},parent:undefined,backgroundColor:'#08090b'});
   this.owner.contentView.removeChildView(this.view);host.contentView.addChildView(this.view);
   this.host=host;this.placement='detached';if(bounds)restoreModuleBounds(host,bounds);
   // Docking can destroy this shell while loadURL/native events are in flight.
   // Only its current live owner may publish readiness or mutate the shared view.
   const current=()=>!this.destroyed&&this.host===host&&!host.isDestroyed()&&!host.webContents.isDestroyed();
   this.hostURL=pathToFileURL(path.join(__dirname,'../ui/settings-window.html')).href;
   host.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   host.webContents.on('will-navigate',event=>event.preventDefault());
   host.webContents.once('did-finish-load',()=>{if(!current())return;host.webContents.send('extension:state',{barHeight:this.barHeight});this.emit('host-ready');});
   host.webContents.setZoomFactor?.(this.webContents.getZoomFactor?.()||1);
   void host.loadURL(this.hostURL).catch(error=>{if(current())this.emit('host-error',error);});
   host.on('close',event=>{if(current())this.emit('close',event);});
   host.on('resize',()=>{if(!current())return;host.webContents.setZoomFactor?.(this.webContents.getZoomFactor?.()||1);this.layout();this.emit('resize');});
   for(const event of ['move','show','hide','minimize','restore'])host.on(event,()=>{if(current())this.emit(event);});
   // 只有用户亲手拖完大小才触发。
   host.on('resized',()=>{if(current())this.emit('user-resized');});
   host.on('closed',()=>{if(this.host===host)this.destroy();});
  }else{
   const host=this.host;host.contentView.removeChildView(this.view);
   this.owner.contentView.addChildView(this.view);this.host=null;this.placement='attached';host.destroy();
  }
  this.layout();this.emit('resize');
 }
 loadURL(url){return this.webContents.loadURL(url);}
 getBounds(){
  if(this.host)return this.host.getBounds();
  const p=this.owner.getContentBounds();return {...this.rect,x:p.x+this.rect.x+this.inset,y:p.y+this.rect.y,width:Math.max(1,this.rect.width-this.inset)};
 }
 setBounds(bounds){if(this.host)this.host.setBounds(bounds);}
 getContentSize(){return this.host?this.host.getContentSize():[Math.max(1,this.rect.width-this.inset),this.rect.height];}
 isDestroyed(){return this.destroyed||this.webContents.isDestroyed();}
 isVisible(){return this.visible;}
 isMinimized(){return (this.host||this.owner).isMinimized();}
 isMaximized(){return !!this.host?.isMaximized();}
 isFocused(){return this.webContents.isFocused();}
 show(){this.visible=true;this.layout();this.host?.show();this.emit('show');}
 showInactive(){this.visible=true;this.layout();this.host?.showInactive();this.emit('show');}
 hide(){this.visible=false;this.layout();this.host?.hide();this.emit('hide');}
 // 缩到左上角：窗口藏起来，页面还挂着，预览能截到。
 park(){this.host?.hide();}
 focus(){(this.host||this.owner).focus();this.webContents.focus();}
 minimize(){(this.host||this.owner).minimize();}
 maximize(){this.host?.maximize();}
 unmaximize(){this.host?.unmaximize();}
 setIgnoreMouseEvents(...args){this.host?.setIgnoreMouseEvents(...args);}
 destroy(){
  if(this.destroyed)return;this.emit('destroying');this.destroyed=true;
  this.owner.removeListener('resize',this.ownerResize);
  const container=this.host||this.owner;if(!container.isDestroyed())container.contentView.removeChildView(this.view);
  if(!this.webContents.isDestroyed())this.webContents.close();
  const host=this.host;this.host=null;if(host&&!host.isDestroyed())host.destroy();this.emit('closed');
 }
}
module.exports={DockableView};
