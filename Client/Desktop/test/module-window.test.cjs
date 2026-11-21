// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; dockFixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/module-window.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict');
const {restoreModuleBounds}=require('../host/module-window.cjs');
test('原生边框/DPI向外取整不在反复恢复时累积，无法满足的系统约束也不会循环',()=>{
 const target={x:127,y:36,width:961,height:651};let bounds,calls=0;
 const win={setBounds(b){calls++;bounds={...b,width:b.width+1,height:b.height+1};},getBounds:()=>({...bounds})};
 for(let i=0;i<4;i++){restoreModuleBounds(win,target);assert.deepEqual(bounds,target);}assert.equal(calls,8);
 let constrained=0;restoreModuleBounds({setBounds(){constrained++;},getBounds:()=>({...target,width:1000})},target);assert.equal(constrained,3);
});

function dockFixture(){
 const {EventEmitter}=require('node:events'),{DockableView}=require('../host/dockable-view.cjs');
 const hosts=[];
 class Contents extends EventEmitter{
  constructor(){super();this.destroyed=false;this.messages=[];}
  isDestroyed(){return this.destroyed;}
  send(...args){if(this.destroyed)throw Error('Object has been destroyed');this.messages.push(args);}
  setWindowOpenHandler(){}setZoomFactor(){}getZoomFactor(){return 1;}close(){this.destroyed=true;}
 }
 class Window extends EventEmitter{
  constructor(){super();this.webContents=new Contents();this.destroyed=false;this.children=new Set();this.contentView={addChildView:v=>this.children.add(v),removeChildView:v=>this.children.delete(v)};this.bounds={x:0,y:0,width:800,height:600};}
  getContentSize(){return [800,600];}isDestroyed(){return this.destroyed;}
  setBounds(value){this.bounds=value;}getBounds(){return this.bounds;}
  loadURL(){return new Promise((resolve,reject)=>{this.loaded=resolve;this.failed=reject;});}
  destroy(){this.destroyed=true;this.webContents.close();this.emit('closed');}
 }
 const owner=new Window();
 class Host extends Window{constructor(){super();hosts.push(this);}}
 class View{constructor(){this.webContents=new Contents();}setBackgroundColor(){}setVisible(){}setBounds(){} }
 const view=new DockableView({electron:{BrowserWindow:Host,WebContentsView:View},owner,options:{webPreferences:{}}});
 return {view,owner,hosts};
}

test('放回后旧顶栏完成加载，不访问已销毁窗口或重复发出就绪事件',()=>{
 const {view,hosts}=dockFixture();let ready=0;view.on('host-ready',()=>ready++);
 view.setPlacement('detached');const old=hosts[0];view.setPlacement('attached');
 assert.doesNotThrow(()=>old.webContents.emit('did-finish-load'));
 assert.equal(ready,0);assert.equal(view.isDestroyed(),false);view.destroy();
});

test('再次独立后旧窗口的加载、调整尺寸与关闭回调不能影响当前宿主',()=>{
 const {view,hosts}=dockFixture();let ready=0,resizes=0,closes=0;
 view.on('host-ready',()=>ready++);view.on('resize',()=>resizes++);view.on('close',()=>closes++);
 view.setPlacement('detached');const old=hosts[0];view.setPlacement('attached');view.setPlacement('detached');const current=hosts[1],before=resizes;
 assert.doesNotThrow(()=>{old.webContents.emit('did-finish-load');old.emit('resize');old.emit('close',{});old.emit('show');});
 assert.equal(resizes,before);assert.equal(closes,0);assert.equal(view.host,current);
 current.webContents.emit('did-finish-load');assert.equal(ready,1);assert.equal(current.webContents.messages.length,1);view.destroy();
});

test('旧壳的异步加载失败被丢弃，当前壳的真实加载失败仍可观察',async()=>{
 const {view,hosts}=dockFixture(),errors=[];view.on('host-error',e=>errors.push(e.message));
 view.setPlacement('detached');const old=hosts[0];view.setPlacement('attached');old.failed(Error('old aborted'));await Promise.resolve();
 assert.deepEqual(errors,[]);view.setPlacement('detached');hosts[1].failed(Error('current failed'));await Promise.resolve();assert.deepEqual(errors,['current failed']);view.destroy();
});

test('重复拆放保留同一页面且最终释放唯一owner监听器',()=>{
 const {view,owner,hosts}=dockFixture(),contents=view.webContents;
 for(let i=0;i<50;i++){view.setPlacement('detached');hosts.at(-1).webContents.emit('did-finish-load');view.setPlacement('attached');assert.equal(view.webContents,contents);assert.equal(owner.listenerCount('resize'),1);}
 view.destroy();view.destroy();assert.equal(owner.listenerCount('resize'),0);assert.equal(owner.children.size,0);assert.equal(contents.isDestroyed(),true);assert.ok(hosts.every(w=>w.isDestroyed()));
});
