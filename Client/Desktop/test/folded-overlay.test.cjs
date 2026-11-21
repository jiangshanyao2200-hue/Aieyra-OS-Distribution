// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/folded-overlay.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createFoldedOverlay}=require('../host/folded-overlay.cjs');
test('native viewport handoff retires old pixels before applying only the latest geometry and rejects stale acknowledgements',async()=>{
 const handlers=new Map(),sent=[],views=[],win=new EventEmitter();
 Object.assign(win,{webContents:{send(){},getZoomFactor:()=>1},contentView:{addChildView(){},removeChildView(){}},getContentSize:()=>[1000,800],isVisible:()=>true,isMinimized:()=>false,isDestroyed:()=>false});
 class View{constructor(){views.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},send:(...v)=>sent.push(v),setZoomFactor(){},setWindowOpenHandler(){},isDestroyed:()=>false,close(){},loadURL:async url=>{this.webContents.mainFrame.url=url;}});}setBackgroundColor(){}setVisible(v){this.visible=v;}setBounds(v){this.bounds=v;}}
 const overlay=createFoldedOverlay({win,electron:{WebContentsView:View,ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)}}});
 const content={program:'settings',task_id:'sera',core_epoch:'one',layered:true,expanded:false},small={x:0,y:642,width:446,height:158},full={x:0,y:48,width:1000,height:752};
 try{
  overlay.surface({visible:true,bounds:small,content});const view=views[0],event={sender:view.webContents,senderFrame:view.webContents.mainFrame};view.webContents.emit('did-finish-load');const painted=handlers.get('folded:painted'),prepared=handlers.get('folded:prepared'),revision=()=>sent.findLast(([c])=>c==='folded:frame')[1].frame_revision;
  const old=revision();assert.equal(painted(event,{revision:old}).ok,true);
  overlay.surface({visible:true,bounds:full,content:{...content,expanded:true}});const token=sent.findLast(([c])=>c==='folded:prepare')[1].token;assert.deepEqual(view.bounds,small);
  const latest={x:50,y:50,width:500,height:300};overlay.surface({visible:true,bounds:latest,content:{...content,task_id:'mira',core_epoch:'two'}});assert.equal(sent.filter(([c])=>c==='folded:prepare').length,1);assert.deepEqual(view.bounds,small);
  assert.equal(prepared(event,{token:token-1}).ok,false);assert.equal(prepared({...event,senderFrame:{url:event.senderFrame.url}},{token}).ok,false);assert.equal(painted(event,{revision:old}).ok,false);
  assert.equal(prepared(event,{token}).ok,true);assert.deepEqual(view.bounds,latest);assert.equal(sent.findLast(([c])=>c==='folded:frame')[1].task_id,'mira');assert.equal(painted(event,{revision:old}).ok,false);assert.equal(painted(event,{revision:revision()}).ok,true);
  overlay.surface({visible:true,bounds:full,content});const pending=sent.findLast(([c])=>c==='folded:prepare')[1].token;overlay.surface({visible:false});assert.equal(prepared(event,{token:pending}).ok,false);assert.equal(view.visible,false);
 }finally{overlay.close();assert.equal(handlers.size,0);}
});
test('原生Eyra只接受自身主框架当前任务；隐藏/最小化停动画，关闭移除IPC',async()=>{
 const handlers=new Map(),views=[],sent=[];let minimized=false;const counts={bounds:0,zoom:0,visible:0,raise:0};
 const win=new EventEmitter();Object.assign(win,{webContents:{send:(...a)=>sent.push(a),getZoomFactor:()=>1.25},contentView:{addChildView(){counts.raise++;},removeChildView(){}},getContentSize:()=>[800,500],isMinimized:()=>minimized,isDestroyed:()=>false});
 class View{constructor(){views.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},send:(...a)=>sent.push(a),setZoomFactor(){counts.zoom++;},setWindowOpenHandler(){},isDestroyed:()=>false,close(){},loadURL:async url=>{this.webContents.mainFrame.url=url;}});}setBackgroundColor(){}setVisible(v){counts.visible++;this.visible=v;}setBounds(r){counts.bounds++;this.bounds=r;}}
 let selection={id:'example.halo'};
 const overlay=createFoldedOverlay({halo:{public:()=>({selection})},win,electron:{WebContentsView:View,ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)}}});
 const frame={visible:true,bounds:{x:700,y:450,width:500,height:200},content:{task_id:'a',core_epoch:'1',haloSelection:{id:'renderer.cannot.select'}}};
 assert.equal(overlay.surface(frame).ready,false);const view=views[0],event={sender:view.webContents,senderFrame:view.webContents.mainFrame},act=handlers.get('folded:action');
 assert.equal((await act(event,{action:'send',task_id:'a',core_epoch:'1'})).ok,false);
 view.webContents.emit('did-finish-load');assert(!sent.some(([c,p])=>c==='workspace:foldedReady'&&p.ready),'loading must not hand over before content layout');assert(view.bounds.x+view.bounds.width<=800);assert(view.bounds.y+view.bounds.height<=500);
 const painted=handlers.get('folded:painted'),ack=()=>painted(event,{revision:sent.findLast(([c])=>c==='folded:frame')[1].frame_revision});
 assert.equal(painted(event,{revision:0}).ok,false);assert(!sent.some(([c,p])=>c==='workspace:foldedReady'&&p.ready));ack();assert.equal(view.visible,true);
 assert.deepEqual(sent.findLast(([c])=>c==='folded:frame')[1].haloSelection,selection);selection=null;overlay.refreshHalo();assert.equal(sent.findLast(([c])=>c==='folded:frame')[1].haloSelection,null);
 const initialCounts={...counts};for(let i=0;i<20;i++)overlay.surface({...frame,content:{...frame.content,body:'增量'+i}});assert.deepEqual(counts,initialCounts,'文字更新不得反复设置原生几何、显隐和层级');
 assert.equal((await act({...event,senderFrame:{url:event.senderFrame.url}},{action:'send',task_id:'a',core_epoch:'1'})).ok,false);
 assert.equal((await act(event,{action:'send',task_id:'b',core_epoch:'1'})).ok,false);
 assert.equal((await act(event,{action:'input',task_id:'a',core_epoch:'1',text:'草稿'})).ok,true);
 minimized=true;win.emit('minimize');assert.equal(view.visible,false);assert(sent.some(([c,v])=>c==='folded:visibility'&&v.visible===false));assert.equal((await act(event,{action:'send',task_id:'a',core_epoch:'1'})).ok,false);
 minimized=false;win.emit('restore');assert.equal(sent.findLast(([c])=>c==='workspace:foldedReady')[1].ready,false);ack();assert.equal(view.visible,true);
 overlay.surface({visible:false});assert.equal(view.visible,false);overlay.close();assert.equal(handlers.size,0);assert.equal(win.listenerCount('restore'),0);
});

test('modal blocks native paint, late acknowledgements, actions and raises until the latest folded frame can resume',async()=>{
 const handlers=new Map(),views=[],sent=[];let blocked=false,raises=0,themeChanged;
 const win=new EventEmitter();Object.assign(win,{webContents:{send:(...v)=>sent.push(v),getZoomFactor:()=>1},contentView:{addChildView(){raises++;},removeChildView(){}},getContentSize:()=>[900,700],isVisible:()=>true,isMinimized:()=>false,isDestroyed:()=>false});
 class View{constructor(){views.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},send:(...v)=>sent.push(v),setZoomFactor(){},setWindowOpenHandler(){},isDestroyed:()=>false,close(){},loadURL:async url=>{this.webContents.mainFrame.url=url;}});}setBackgroundColor(){}setVisible(v){this.visible=v;}setBounds(b){this.bounds=b;}}
 const overlay=createFoldedOverlay({win,blocked:()=>blocked,theme:{read:()=>({}),watch:fn=>{themeChanged=fn;return ()=>{};}},electron:{WebContentsView:View,ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)}}});
 try{
  const frame={visible:true,bounds:{x:0,y:0,width:300,height:200},content:{task_id:'current',core_epoch:'one',body:'之前'}};overlay.surface(frame);const view=views[0],event={sender:view.webContents,senderFrame:view.webContents.mainFrame};view.webContents.emit('did-finish-load');
  const painted=handlers.get('folded:painted'),action=handlers.get('folded:action'),old=sent.findLast(([n])=>n==='folded:frame')[1].frame_revision;assert.equal(painted(event,{revision:old}).ok,true);
  blocked=true;assert.equal(painted(event,{revision:old}).ok,false);assert.equal((await action(event,{action:'input',task_id:'current',core_epoch:'one'})).ok,false);overlay.refreshHalo();assert.equal(view.visible,false);const before=raises;
  overlay.surface({...frame,content:{...frame.content,body:'最新正文',draft:'保留草稿'}});themeChanged();win.emit('restore');overlay.raise();assert.equal(raises,before);assert.equal(view.visible,false);assert.equal(painted(event,{revision:old}).ok,false);
  blocked=false;overlay.refreshHalo();const latest=sent.findLast(([n])=>n==='folded:frame')[1];assert.equal(views.length,1);assert.equal(latest.body,'最新正文');assert.equal(latest.draft,'保留草稿');assert.equal(painted(event,{revision:old}).ok,false);assert.equal(painted(event,{revision:latest.frame_revision}).ok,true);assert.equal(view.visible,true);
 }finally{overlay.close();}
});

test('拆出窗关闭时浮层加载失败不向已销毁的宿主窗回报',async()=>{
 const handlers=new Map(),views=[];let destroyed=false,rejectLoad;
 const win=new EventEmitter();Object.assign(win,{webContents:{get send(){if(destroyed)throw TypeError('Object has been destroyed');return ()=>{};},getZoomFactor:()=>1},contentView:{addChildView(){},removeChildView(){}},getContentSize:()=>[800,500],isVisible:()=>true,isMinimized:()=>false,isDestroyed:()=>destroyed});
 class View{constructor(){views.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},send(){},setZoomFactor(){},setWindowOpenHandler(){},isDestroyed:()=>destroyed,close(){},loadURL:()=>new Promise((_resolve,reject)=>{rejectLoad=reject;})});}setBackgroundColor(){}setVisible(v){if(destroyed)throw TypeError('Object has been destroyed');this.visible=v;}setBounds(){}}
 const overlay=createFoldedOverlay({win,electron:{WebContentsView:View,ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)}}});
 const unhandled=[],listen=error=>unhandled.push(error);process.on('unhandledRejection',listen);
 try{
  overlay.surface({visible:true,bounds:{x:0,y:0,width:300,height:200},content:{task_id:'a',core_epoch:'1'}});assert.equal(views.length,1);
  destroyed=true;rejectLoad(Error('ERR_ABORTED'));await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  views[0].webContents.emit('render-process-gone');
  assert.deepEqual(unhandled,[]);
 }finally{process.off('unhandledRejection',listen);destroyed=false;overlay.close();}
});

test('renderer failure retires native readiness, rejects stale paint and keeps the fallback until real recovery',async()=>{
 const handlers=new Map(),views=[],sent=[];
 const win=new EventEmitter();Object.assign(win,{webContents:{send:(...v)=>sent.push(v),getZoomFactor:()=>1},contentView:{addChildView(){},removeChildView(){}},getContentSize:()=>[900,700],isVisible:()=>true,isMinimized:()=>false,isDestroyed:()=>false});
 class View{constructor(){views.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},send:(...v)=>sent.push(v),setZoomFactor(){},setWindowOpenHandler(){},isDestroyed:()=>false,close(){},loadURL:async url=>{this.webContents.mainFrame.url=url;}});}setBackgroundColor(){}setVisible(v){this.visible=v;}setBounds(){}}
 const overlay=createFoldedOverlay({win,electron:{WebContentsView:View,ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)}}}),frame={visible:true,bounds:{x:0,y:0,width:300,height:200},content:{task_id:'current',core_epoch:'one'}};
 try{
  overlay.surface(frame);const view=views[0],event={sender:view.webContents,senderFrame:view.webContents.mainFrame},painted=handlers.get('folded:painted');view.webContents.emit('did-finish-load');
  const old=sent.findLast(([n])=>n==='folded:frame')[1].frame_revision;assert.equal(painted(event,{revision:old}).ok,true);assert.equal(overlay.surface(frame).ready,true);
  view.webContents.emit('render-process-gone');assert.equal(view.visible,false);assert.deepEqual(sent.findLast(([n])=>n==='workspace:foldedReady')[1],{ready:false,reason:'unavailable'});
  const failed=overlay.surface(frame);assert.equal(failed.ready,false);assert.equal(failed.visible,false);assert.equal(failed.unavailable,true);assert.equal(painted(event,{revision:old}).ok,false);
  overlay.surface({visible:false});assert.equal(overlay.surface(frame).unavailable,true,'navigation does not claim the crashed renderer recovered');
  view.webContents.emit('did-finish-load');const latest=sent.findLast(([n])=>n==='folded:frame')[1].frame_revision;
  assert.equal(painted(event,{revision:old}).ok,false);assert.equal(painted(event,{revision:latest}).ok,true);assert.equal(overlay.surface(frame).unavailable,false);
  overlay.surface({visible:false});assert.deepEqual(sent.findLast(([n])=>n==='workspace:foldedReady')[1],{ready:false},'normal hiding is distinct from native failure');
  overlay.close();const count=sent.length;view.webContents.emit('render-process-gone');assert.equal(sent.length,count,'closed owners receive no late failure');
 }finally{overlay.close();}
});

test('home reading returns only through the authenticated current presentation and rejects stale scopes',async()=>{
 const handlers=new Map(),views=[],actions=[];
 const win=new EventEmitter();Object.assign(win,{webContents:{send(){},getZoomFactor:()=>1},contentView:{addChildView(){},removeChildView(){}},getContentSize:()=>[900,700],isMinimized:()=>false,isDestroyed:()=>false});
 class View{constructor(){views.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},send(){},setZoomFactor(){},setWindowOpenHandler(){},isDestroyed:()=>false,close(){},loadURL:async url=>{this.webContents.mainFrame.url=url;}});}setBackgroundColor(){}setVisible(){}setBounds(){}}
 const overlay=createFoldedOverlay({win,onAction:p=>{actions.push(p);return {ok:true};},electron:{WebContentsView:View,ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)}}});
 const reading={key:'home:epoch:history',revision:3,sequence:0,history:{following:true,anchor:null},work:{key:'home:epoch:work',following:true,anchor:null}},content={program:'home',task_id:'home',core_epoch:'epoch',home_reading:reading},frame={visible:true,bounds:{x:0,y:0,width:800,height:600},content};
 try{
  overlay.surface(frame);const view=views[0];view.webContents.emit('did-finish-load');const event={sender:view.webContents,senderFrame:view.webContents.mainFrame},act=handlers.get('folded:action');
  const state={...reading,sequence:1,work:{...reading.work,following:false,anchor:{row:'text:1',block:0,text:'早期思考',offset:-18,top:300}}},call=(value=state,extra={})=>act(event,{action:'reading',task_id:'home',core_epoch:'epoch',text:JSON.stringify(value),...extra});
  assert.equal((await call()).ok,true);assert.equal(actions.length,1);assert.equal(JSON.parse(actions[0].text).work.anchor.top,300);
  for(const value of [{...state,key:'foreign'},{...state,revision:2},{...state,sequence:0},{...state,work:{...state.work,key:'next-generation'}},{...state,history:{following:false,anchor:{row:'x',text:'x',offset:0,top:-1}}}])assert.equal((await call(value)).ok,false);
  assert.equal((await call(state,{task_id:'other'})).ok,false);assert.equal((await call(state,{core_epoch:'other'})).ok,false);assert.equal(actions.length,1);
  overlay.surface({...frame,content:{...content,home_reading:{...reading,sequence:1}}});assert.equal((await call()).ok,false,'late duplicate cannot replace the accepted position');
  overlay.surface({...frame,content:{...content,program:'browser'}});assert.equal((await call({...state,sequence:2})).ok,false,'program conversation cannot write the home reader');
  overlay.surface({visible:false});assert.equal((await call({...state,sequence:2})).ok,false);assert.equal(actions.length,1);
 }finally{overlay.close();}
});


test('native decision input, submission and IME stay bound to the exact displayed question',async()=>{
 const handlers=new Map(),views=[],actions=[];
 const win=new EventEmitter();Object.assign(win,{webContents:{send(){},getZoomFactor:()=>1},contentView:{addChildView(){},removeChildView(){}},getContentSize:()=>[900,700],isMinimized:()=>false,isDestroyed:()=>false});
 class View{constructor(){views.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},send(){},setZoomFactor(){},setWindowOpenHandler(){},isDestroyed:()=>false,close(){},loadURL:async url=>{this.webContents.mainFrame.url=url;}});}setBackgroundColor(){}setVisible(){}setBounds(){}}
 const overlay=createFoldedOverlay({win,onAction:p=>{actions.push(p);return {ok:true};},electron:{WebContentsView:View,ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)}}});
 const content={task_id:'home',core_epoch:'epoch',decision:{key:'question-v2'}};
 try{
  overlay.surface({visible:true,bounds:{x:0,y:0,width:700,height:500},content});const view=views[0];view.webContents.emit('did-finish-load');const event={sender:view.webContents,senderFrame:view.webContents.mainFrame},act=handlers.get('folded:action');
  for(const action of ['input','send','decision','composition']){
   assert.equal((await act(event,{action,task_id:'home',core_epoch:'epoch',decision_key:'question-v1',text:'old input'})).ok,false);
   assert.equal((await act(event,{action,task_id:'home',core_epoch:'epoch',decision_key:'question-v2',text:action==='composition'?'start':'current input'})).ok,true);
  }
  assert.equal(actions.length,4);overlay.surface({visible:true,bounds:{x:0,y:0,width:700,height:500},content:{...content,decision:null}});
  assert.equal((await act(event,{action:'send',task_id:'home',core_epoch:'epoch',decision_key:'question-v2'})).ok,false);
  assert.equal((await act(event,{action:'input',task_id:'home',core_epoch:'epoch',decision_key:'',text:'ordinary draft'})).ok,true);
 }finally{overlay.close();}
});

test('program background remains separate when chat folds, stays below chat and shares authenticated readers',async()=>{
 const handlers=new Map(),views=[],sent=[],order=[],reads=[];let raises=0;
 const win=new EventEmitter();Object.assign(win,{webContents:{send:(...v)=>sent.push(v),getZoomFactor:()=>1},contentView:{addChildView(v){raises++;const i=order.indexOf(v);if(i>=0)order.splice(i,1);order.push(v);},removeChildView(v){order.splice(order.indexOf(v),1);}},getContentSize:()=>[900,700],isVisible:()=>true,isMinimized:()=>false,isDestroyed:()=>false});
 class View{constructor(){views.push(this);this.frames=[];this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},send:(channel,value)=>{if(channel==='folded:frame')this.frames.push(value);},setZoomFactor(){},setWindowOpenHandler(){},isDestroyed:()=>false,close(){this.closed=true;},loadURL:async url=>{this.webContents.mainFrame.url=url;}});}setBackgroundColor(){}setVisible(v){this.visible=v;}setBounds(b){this.bounds=b;}}
 const overlay=createFoldedOverlay({win,onRead:p=>{reads.push(p);return {ok:true};},electron:{WebContentsView:View,ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)}}});
 const content={program:'contacts',task_id:'mira',core_epoch:'one',background_bounds:{x:16,y:50,width:868,height:634},work:{active:true,operations:[{id:'call',tool:'agents'}]}},frame={visible:true,bounds:{x:16,y:60,width:868,height:620},content};
 try{
  overlay.surface(frame);assert.equal(views.length,2);
  const work=views.find(v=>v.webContents.mainFrame.url.endsWith('?surface=work')),chat=views.find(v=>v!==work),event=v=>({sender:v.webContents,senderFrame:v.webContents.mainFrame}),ack=v=>handlers.get('folded:painted')(event(v),{revision:v.frames.at(-1).frame_revision});
  chat.webContents.emit('did-finish-load');ack(chat);work.webContents.emit('did-finish-load');ack(work);
  assert.deepEqual(order,[work,chat],'first background presentation must not cover chat');assert.equal(sent.filter(([c,p])=>c==='workspace:foldedReady'&&p.ready).length,1,'background cannot signal chat readiness');
  const stable=raises;for(let i=0;i<10;i++)overlay.surface({...frame,content:{...content,label:'working '+i}});assert.equal(raises,stable,'ordinary work updates must not reorder native layers');
  overlay.surface({...frame,bounds:{x:16,y:620,width:100,height:64},content:{...content,expanded:false}});assert.deepEqual(work.bounds,content.background_bounds);assert.equal(work.visible,true);assert.equal(chat.bounds.height,620,'painted geometry must remain until the renderer retires its old frame');assert.equal(handlers.get('folded:prepared')(event(chat),{token:1}).ok,true);assert.equal(chat.bounds.height,64);ack(chat);
  const read=handlers.get('folded:read');assert.equal((await read(event(work),{task_id:'mira',core_epoch:'one',action:'receipt'})).ok,true);assert.equal(reads[0].program,'contacts');assert.equal((await read(event(work),{task_id:'other',core_epoch:'one',action:'receipt'})).ok,false);
  assert.equal((await handlers.get('folded:action')(event(work),{task_id:'mira',core_epoch:'one',action:'send'})).ok,false,'read-only work cannot submit chat actions');
  const painted=handlers.get('folded:painted'),finishWork=revision=>painted(event(work),{revision,work_hidden:true});
  const finished={...frame,content:{...content,work:{...content.work,active:false}}};
  overlay.surface(finished);
  const exiting=work.frames.at(-1).frame_revision;
  assert.equal(work.visible,true);
  assert.equal(work.frames.at(-1).work.active,false);
  overlay.surface(frame);
  assert.equal(finishWork(exiting).ok,false);
  assert.equal(finishWork(work.frames.at(-1).frame_revision).ok,false);
  assert.equal(work.visible,true);
  overlay.surface(finished);
  assert.equal(finishWork(work.frames.at(-1).frame_revision).ok,true);
  assert.equal(work.visible,false);
  overlay.surface({visible:false});assert.equal(work.visible,false);assert.equal(chat.visible,false);
 }finally{overlay.close();assert.equal(handlers.size,0);assert(views.every(v=>v.webContents.closed));}
});
