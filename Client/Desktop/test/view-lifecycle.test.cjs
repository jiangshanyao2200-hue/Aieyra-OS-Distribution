// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture; settle; scope; snapshot
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/view-lifecycle.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

function fixture(){
 const intervals=new Map(),timeouts=new Map(),frames=new Map(),listeners=new Map(),windowListeners=new Map(),observers=[];
 let sequence=0;
 class Node{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.hidden=false;this.textContent='';this.style={setProperty(){}};const classes=new Set();this.classList={contains:value=>classes.has(value),add:(...values)=>values.forEach(v=>classes.add(v)),remove:(...values)=>values.forEach(v=>classes.delete(v)),toggle:(value,on)=>{if(on??!classes.has(value))classes.add(value);else classes.delete(value);}};}
  get isConnected(){return this===doc.body||!!this.parent?.isConnected;}
  get ownerDocument(){return doc;}
  get childNodes(){return this.children;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  insertBefore(node,at){node.remove();node.parent=this;const index=this.children.indexOf(at);if(index<0)this.children.push(node);else this.children.splice(index,0,node);}
  replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
  setAttribute(name,value){this[name]=value;}removeAttribute(name){if(name==='style')this.style={setProperty(){}};else delete this[name];}
  getBoundingClientRect(){return {width:this.isConnected?400:0,height:this.isConnected?180:0,left:0,top:0};}
  closest(selector){if(selector==='[hidden]')return this.hidden?this:this.parent?.closest(selector)||null;return null;}
  addEventListener(type,fn){this.handlers??=new Map();if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}removeEventListener(type,fn){this.handlers?.get(type)?.delete(fn);}dispatchEvent(event){for(const fn of this.handlers?.get(event.type)||[])fn(event);}
  cloneNode(){return new Node(this.tagName);}
  querySelector(selector){const direct=selector.startsWith(':scope > '),cls=selector.replace(':scope > ','').slice(1);for(const child of this.children){if(String(child.className||'').split(/\s+/).includes(cls))return child;const nested=!direct&&child.querySelector(selector);if(nested)return nested;}return null;}
  // This lifecycle fixture needs a stable SVG child, not a rendering engine.
  // Complete geometry and animation are exercised by halo-state-user in Electron.
  insertAdjacentHTML(position,markup){assert.equal(position,'afterbegin');assert.match(markup,/^<svg /);const node=new Node('svg');node.className=markup.match(/class="([^"]+)"/)[1];this.insertBefore(node,this.children[0]);}
 }
 class Observer{constructor(fn){this.fn=fn;observers.push(this);}observe(node){this.target=node;}disconnect(){this.disconnected=true;}}
 const win={ResizeObserver:Observer,MutationObserver:Observer,CustomEvent:class{},getComputedStyle:()=>({visibility:'visible'}),
  setInterval(fn){const id=++sequence;intervals.set(id,fn);return id;},clearInterval(id){intervals.delete(id);},
  setTimeout(fn){const id=++sequence;timeouts.set(id,fn);return id;},clearTimeout(id){timeouts.delete(id);},
  requestAnimationFrame(fn){const id=++sequence;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},matchMedia:()=>({matches:true}),
  addEventListener(type,fn){if(!windowListeners.has(type))windowListeners.set(type,new Set());windowListeners.get(type).add(fn);},
  removeEventListener(type,fn){windowListeners.get(type)?.delete(fn);},dispatchEvent(event){for(const fn of windowListeners.get(event.type)||[])fn(event);}};
 const doc={defaultView:win,visibilityState:'visible',createElement:tag=>new Node(tag),createElementNS:(_ns,tag)=>new Node(tag),createTextNode:text=>Object.assign(new Node('#text'),{textContent:text}),querySelector:()=>null,
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
  removeEventListener(type,fn){listeners.get(type)?.delete(fn);}};
 doc.body=new Node('body');doc.head=new Node('head');
 const emit=type=>{for(const fn of listeners.get(type)||[])fn();};
 const resize=target=>{for(const observer of observers)if(observer.target===target&&!observer.disconnected)observer.fn([{target,contentRect:target.getBoundingClientRect()}]);};
 const flushFrames=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
 return {doc,intervals,timeouts,frames,listeners,windowListeners,observers,emit,resize,flushFrames,make:(tag,cls,text)=>{const n=new Node(tag);n.className=cls;n.textContent=text||'';return n;}};
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const scope={task_id:'task',agent_id:'worker',generation:1};
const snapshot={core_epoch:'one',session_id:'task',roles:[{id:'worker',role:'execution',generation:1,activity:{items:[]}}]};

test('collaborating instances share six preview slots without opening foreign terminal sessions',async()=>{
 const {setupStage}=await import('../ui/stage.mjs');
 const f=fixture(),root=f.make('section');f.doc.body.append(root);
 root.getBoundingClientRect=()=>({width:900,height:900,left:0,top:0});
 const stage=setupStage(root,{api:new Proxy({},{get(){throw Error('read-only previews must not query foreign terminal scopes');}}),doc:f.doc,roles:[]});
 const members=Array.from({length:30},(_,i)=>({id:'instance-'+i,name:'Cota '+i,generation:1,state:'running',activity:{items:[{id:'call',tool:'exec_command',state:'running',generation:1,started_at:i,sequence:1}]}}));
 stage.paint({session_id:'one',link:{scope:'one',members}},null,{show:true});
 assert.equal(root.children.length,6);assert.equal(root.dataset.overflow,'24');assert.equal(f.intervals.size,0);
 const reading=root.children[0],role=reading.dataset.role;f.doc.activeElement=reading.children[1];
 assert.equal(root.querySelector('.stage-pin'),null,'work previews have no pin action');
 stage.paint({session_id:'one',link:{scope:'one',members:members.map(m=>({...m,activity:{items:m.activity.items.map(item=>({...item,state:'failed'}))}}))}},null,{show:true});
 assert.ok(root.children.includes(reading));assert.equal(reading.dataset.role,role);
 stage.paint({session_id:'two',link:{scope:'two',members:[]}},null,{show:true});
 assert.equal(root.children.length,0);stage.close();
});

test('waiting previews resize without a new snapshot and release resize work on close',async()=>{
 const {setupStage}=await import('../ui/stage.mjs');
 const f=fixture(),root=f.make('section');f.doc.body.append(root);
 let box={width:900,height:900,left:0,top:0};root.getBoundingClientRect=()=>box;
 const stage=setupStage(root,{api:{},doc:f.doc,roles:[]});
 const members=Array.from({length:30},(_,i)=>({id:'waiting-'+i,name:'Cota '+i,generation:1,state:'running',activity:{items:[{id:'call',tool:'exec_command',state:'running',generation:1,sequence:1}]}}));
 stage.paint({session_id:'waiting',link:{scope:'waiting',members}},null,{show:true});f.flushFrames();
 assert.equal(root.children.length,6);
 box={...box,width:360,height:340};f.doc.defaultView.dispatchEvent({type:'resize'});f.flushFrames();f.flushFrames();
 assert.equal(root.children.length,2,'window resize alone restores readable preview height');
 assert.equal(root.dataset.overflow,'28');
 box={...box,height:180};const observer=f.observers.find(o=>o.target===root);observer.fn();f.flushFrames();f.flushFrames();
 assert.equal(root.children.length,1,'container-only resize also recomputes capacity');
 f.doc.defaultView.dispatchEvent({type:'resize'});assert.equal(f.frames.size,1);
 stage.close();assert.equal(f.frames.size,0,'close cancels pending reflow');
 assert.ok(observer.disconnected);assert.ok([...f.windowListeners.values()].every(set=>set.size===0));
 observer.fn();f.doc.defaultView.dispatchEvent({type:'resize'});f.flushFrames();
 assert.equal(root.children.length,0,'late resize cannot revive a closed stage');
});

test('member original reads use the current mother scope and the member original generation',async()=>{
 const {setupStage}=await import('../ui/stage.mjs'),f=fixture(),root=f.make('section'),reads=[];f.doc.body.append(root);
 const stage=setupStage(root,{doc:f.doc,roles:[],api:{receipt:async args=>{reads.push(args);return {ok:true,input:'输入',output:'输出',input_size:6,output_size:6,next_input:0,next_output:0,receipt_version:'original'};}}});
 const member={id:'linked-member',generation:4,activity:{items:[{id:'opaque:invocation:call',tool:'memory',state:'completed',generation:4,preview:{ok:true},sequence:1}]}};
 stage.paint({core_epoch:'epoch',session_id:'mother-task',roles:[{role:'matrix',id:'mother-agent',generation:7}],link:{scope:'room',members:[member]}},null,{show:true});
 const reader=root.querySelector('.hx-receipt');assert.ok(reader);assert.equal(reads.length,0,'opening a work preview does not eagerly read originals');reader.open=true;reader.ontoggle();await settle();
 assert.deepEqual(reads,[{task_id:'mother-task',agent_id:'mother-agent',id:'opaque:invocation:call',member_id:'linked-member',generation:7,receipt_generation:4,core_epoch:'epoch',all_history:true,input_offset:0,output_offset:0}]);
 const next={core_epoch:'epoch',session_id:'mother-task',roles:[{role:'matrix',id:'mother-agent',generation:8}],link:{scope:'room',members:[member]}};
 stage.paint(next,null,{show:true});assert.equal(root.querySelector('.hx-receipt'),reader,'same original reader survives a new view generation');
 reader.children[1].children[4].onclick();await settle();assert.equal(reads.length,2);assert.deepEqual(reads[1],{...reads[0],generation:8});
 stage.paint({...next,roles:[{...next.roles[0],id:'replacement-agent'}]},null,{show:true});reader.children[1].children[4].onclick();await settle();assert.equal(reads.length,2,'a retained original never rebinds to a replacement actor');
 stage.close();assert.equal(root.children.length,0);
});

test('terminal hiding releases its poller and reopening reads the same session from its saved byte cursor',async()=>{
 const {createTerminalView}=await import('../ui/desktop/terminal-view.mjs');
 const f=fixture(),calls=[],pending=[];
 const api={
  terminals:async target=>{calls.push(['list',target]);return {ok:true,...scope,sessions:[{session_id:7,generation:1,state:'running',description:'检查',logged_bytes:6}]};},
  terminalRead:target=>{calls.push(['read',target]);return new Promise(resolve=>pending.push(()=>resolve({ok:true,...scope,result:{ok:true,session_id:7,generation:1,state:'running',output:target.offset?'':'中文',next_offset:6,logged_bytes:6}})));}
 };
 const view=createTerminalView({api,doc:f.doc,getScope:()=>scope});
 view.update(snapshot);assert.equal(f.intervals.size,0,'unopened view has no polling timer');assert.equal(calls.length,0);
 f.doc.body.append(view.element);f.resize(view.element.querySelector('.terminal-view-screen'));view.update(snapshot);await settle();
 assert.equal(f.intervals.size,1);assert.equal(pending.length,1);
 view.suspend();assert.equal(f.intervals.size,0);
 pending.shift()();await settle();
 assert.equal(view.sessions[0].session_id,7,'hiding retains the existing terminal session');
 const hiddenCalls=calls.length;f.emit('visibilitychange');await settle();assert.equal(calls.length,hiddenCalls);
 view.update(snapshot);await settle();assert.equal(f.intervals.size,1);
 assert.equal(calls.filter(([type])=>type==='read').at(-1)[1].offset,6,'resume continues after the accepted hidden receipt');
 f.doc.visibilityState='hidden';f.emit('visibilitychange');assert.equal(f.intervals.size,0,'hidden document has no polling timer');
 pending.shift()?.();await settle();
 f.doc.visibilityState='visible';f.emit('visibilitychange');await settle();assert.equal(f.intervals.size,1);
 view.close();view.close();assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);
 assert.ok(f.observers.every(o=>o.disconnected));assert.ok([...f.listeners.values()].every(set=>set.size===0));
 assert.ok(calls.every(([type])=>['list','read'].includes(type)),'view actions only read existing sessions');
});

test('returning to chat follows the terminal bottom even when no new output arrived',async()=>{
 const {createTerminalView}=await import('../../../Tool/base/official/terminal/presentation/desktop.mjs');
 const f=fixture();let terminal;
 class Terminal{
  constructor(){terminal=this;this.options={};this.buffer={active:{baseY:100,viewportY:100}};this.parser={registerOscHandler(){}};this.writes=[];}
  loadAddon(){}onSelectionChange(){}hasSelection(){return false;}clearSelection(){}reset(){}
  write(text,done){this.writes.push(text);done();}
  scrollToBottom(){this.buffer.active.viewportY=this.buffer.active.baseY;}dispose(){}
 }
 const transcript={scope:null,sessions:[],bind(_snapshot,value){this.scope=value;return true;},ingest(){},rows(){return [];},segments(){return [{kind:'output',text:'retained output\n'}];}};
 const view=createTerminalView({doc:f.doc,transcript,getScope:()=>scope,loadTerminal:async()=>({Terminal,FitAddon:class{fit(){}}}),openTerminal(){}});
 f.doc.body.append(view.element);f.resize(view.element.querySelector('.terminal-view-screen'));view.update(snapshot);await settle();assert.deepEqual(terminal.writes,['retained output\n']);
 const screen=view.element.querySelector('.terminal-view-screen');screen.dispatchEvent({type:'wheel',deltaY:-100});terminal.buffer.active.viewportY=50;
 view.refresh();await settle();assert.equal(terminal.buffer.active.viewportY,50,'unchanged refresh preserves manual reading');
 for(const fn of f.listeners.get('pointerdown'))fn({target:f.doc.body});await settle();
 assert.equal(terminal.buffer.active.viewportY,100,'clicking chat restores the latest visible output without waiting for a write');
 assert.deepEqual(terminal.writes,['retained output\n'],'resuming does not replay the output');view.close();
});

test('hiding a search pane cancels typing, keeps its complete query and does not replay unchanged text',async()=>{
 const {setupStageTools}=await import('../ui/stage-tools.mjs');
 const f=fixture();f.doc.defaultView.matchMedia=()=>({matches:false});
 const tools=setupStageTools({api:{},doc:f.doc,make:f.make,reduced:()=>false});
 const pane={body:f.make('div'),node:f.make('section'),state:f.make('span')};
 const item={id:'search-one',tool:'web_search',state:'running',revision:1,targets:['正在检查隐藏视图资源']};
 tools.fillSearch(pane,[item]);assert.equal(f.intervals.size,1);
 tools.suspend(pane);assert.equal(f.intervals.size,0);
 assert.equal([...pane.groups.values()][0].text.textContent,item.targets[0]);
 tools.fillSearch(pane,[item]);assert.equal(f.intervals.size,0,'unchanged query does not replay its animation');
 tools.fillSearch(pane,[{...item,id:'search-two',targets:['另一个搜索']}]);assert.equal(f.intervals.size,1);
 tools.close(pane);assert.equal(f.intervals.size,0);
 assert.ok(f.observers.every(o=>o.disconnected),'search geometry observers are released on close');
});

test('search panes replace identical receipt IDs after task generation changes',async()=>{
 const {setupStageTools}=await import('../ui/stage-tools.mjs');
 const f=fixture(),tools=setupStageTools({api:{},doc:f.doc,make:f.make,reduced:()=>true,role:'execution'});
 const pane={body:f.make('div'),node:f.make('section'),state:f.make('span')};
 const item=answer=>({id:'same',tool:'web_search',state:'completed',revision:1,preview:JSON.stringify({ok:true,query:'same query',searches:[{results:[{title:'source',url:'https://example.invalid'}]}],answer})});
 tools.fillSearch(pane,[item('old answer')],snapshot);
 const variants=[{...snapshot,session_id:'second'},{...snapshot,roles:[{...snapshot.roles[0],id:'second'}]},{...snapshot,roles:[{...snapshot.roles[0],generation:2}]},{...snapshot,core_epoch:'restarted'}];
 for(const [i,next] of variants.entries()){tools.fillSearch(pane,[item('answer '+i)],next);assert.equal([...pane.groups.values()][0].answer.textContent,'answer '+i);assert.equal(pane.groups.size,1);}
 tools.close(pane);assert.equal(f.intervals.size,0);
});

test('late image receipts do not paint a hidden pane and reopening reuses the image already read',async()=>{
 const {setupStageTools}=await import('../ui/stage-tools.mjs');
 const f=fixture();let finish,reads=0;
 const tools=setupStageTools({api:{toolImage:()=>{reads++;return new Promise(resolve=>finish=resolve);}},doc:f.doc,make:f.make,reduced:()=>true,role:'execution'});
 const pane={body:f.make('div'),node:f.make('section'),state:f.make('span')};
 const item={id:'image-one',tool:'view_image',state:'completed',revision:1,preview:JSON.stringify({image_id:'image-1',path:'snapshot.png'})};
 tools.fillImage(pane,[item],snapshot,{});await settle();assert.equal(reads,1);
 tools.suspend(pane);finish({ok:true,image_id:'image-1',mime:'image/png',data:'aW1hZ2U='});await settle();
 assert.equal(pane.view.img.src,undefined,'hidden pane ignores its late paint');
 tools.fillImage(pane,[item],snapshot,{});await settle();
 assert.equal(reads,1);assert.equal(pane.view.img.src,'data:image/png;base64,aW1hZ2U=');
 tools.close(pane);assert.ok(f.observers.every(o=>o.disconnected));
});

test('image authorization follows task, agent, generation and Core restart even for identical receipts',async()=>{
 const {setupStageTools}=await import('../ui/stage-tools.mjs');
 const f=fixture(),calls=[],pending=[];
 const tools=setupStageTools({api:{toolImage:target=>{calls.push(target);return new Promise(resolve=>pending.push(resolve));}},doc:f.doc,make:f.make,reduced:()=>true,role:'execution'});
 const pane={body:f.make('div'),node:f.make('section'),state:f.make('span')};
 const item={id:'same-receipt',tool:'view_image',state:'completed',revision:1,preview:JSON.stringify({image_id:'same-image',path:'snapshot.png'})};
 const variants=[snapshot,{...snapshot,session_id:'second-task'},{...snapshot,roles:[{...snapshot.roles[0],id:'second-agent'}]},{...snapshot,roles:[{...snapshot.roles[0],generation:2}]},{...snapshot,core_epoch:'restarted'}];
 for(const next of variants){
  tools.fillImage(pane,[item],next,{});await settle();
  assert.equal(pane.view.img.src,undefined,'previous authorized bytes must be cleared before new scope loads');
 }
 assert.equal(calls.length,variants.length,'every authorization scope needs its own host read');
 assert.deepEqual(calls[1],{task_id:'second-task',agent_id:'worker',generation:1,image_id:'same-image'});
 pending.at(-1)({ok:true,image_id:'same-image',mime:'image/png',data:'bmV3'});await settle();
 assert.equal(pane.view.img.src,'data:image/png;base64,bmV3');
 pending[0]({ok:true,image_id:'same-image',mime:'image/png',data:'b2xk'});await settle();
 assert.equal(pane.view.img.src,'data:image/png;base64,bmV3','late old scope cannot repaint');
 tools.fillImage(pane,[item],{...snapshot,roles:[]},{});await settle();
 assert.equal(pane.view.img.src,undefined,'missing scope cannot retain another scope image');
 tools.close(pane);
});

test('a failed or cancelled image clears the previously displayed snapshot and late completion',async()=>{
 const {setupStageTools}=await import('../ui/stage-tools.mjs');
 const f=fixture();let finish;
 const tools=setupStageTools({api:{toolImage:()=>new Promise(resolve=>finish=resolve)},doc:f.doc,make:f.make,reduced:()=>true,role:'execution'});
 const pane={body:f.make('div'),node:f.make('section'),state:f.make('span')};
 const item={id:'image',tool:'view_image',state:'completed',revision:1,preview:JSON.stringify({image_id:'one',path:'snapshot.png'})};
 tools.fillImage(pane,[item],snapshot,{});await settle();
 finish({ok:true,image_id:'one',mime:'image/png',data:'b2xk'});await settle();
 assert.ok(pane.view.img.src);
 tools.fillImage(pane,[{...item,state:'cancelled',revision:2}],snapshot,{});await settle();
 assert.equal(pane.view.img.src,undefined);assert.equal(pane.view.src,'');
 tools.close(pane);
});

test('the real stage consumer suspends its terminal on hide and releases it on close',async()=>{
 const {setupStage}=await import('../ui/stage.mjs');
 const f=fixture(),root=f.make('section');f.doc.body.append(root);
 const stage=setupStage(root,{api:{},doc:f.doc,role:'execution'});
 const presentation={liveActivities:()=>[{id:'command',tool:'exec_command',state:'running',sequence:1}]};
 stage.paint(snapshot,presentation,{show:false});assert.equal(f.intervals.size,0);assert.equal(root.children.length,0);
 stage.paint(snapshot,presentation,{show:true});f.resize(root.querySelector('.terminal-view-screen'));await settle();assert.equal(f.intervals.size,1);
 const terminal=root.children[0].children[1].children[0];
 stage.paint(snapshot,presentation,{show:false});assert.equal(f.intervals.size,0);
 stage.paint(snapshot,presentation,{show:true});await settle();assert.equal(f.intervals.size,1);
 assert.equal(root.children[0].children[1].children[0],terminal,'same terminal view is reused');
 stage.close();stage.close();assert.equal(f.intervals.size,0);assert.equal(root.children.length,0);
 stage.paint(snapshot,presentation,{show:true});assert.equal(root.children.length,0,'closed stage cannot create another view');
 assert.ok(f.observers.every(o=>o.disconnected));
});

test('shared team operation area reads only Matrix, even while vision and a legacy executor have activities',async()=>{
 const {setupStage}=await import('../ui/stage.mjs');
 const f=fixture(),root=f.make('section');f.doc.body.append(root);
 const stage=setupStage(root,{api:{},doc:f.doc});
 const next={...snapshot,roles:[{id:'leader',role:'matrix',generation:1,state:'running'},{id:'vision',role:'project',generation:1,state:'running'},...snapshot.roles]};
 const requested=[];
 const presentation={liveActivities:role=>{requested.push(role);return [{id:role+'-command',tool:'exec_command',state:'running',sequence:1}];}};
 stage.paint(next,presentation,{show:true});f.resize(root.querySelector('.terminal-view-screen'));await settle();
 assert.ok(requested.length);assert.ok(requested.every(role=>role==='matrix'));
 assert.equal(f.intervals.size,1,'only Matrix terminal polls');
 assert.equal(root.children.length,1,'vision does not allocate another operation pane');
 stage.paint(next,{liveActivities:role=>role==='project'?[{id:'map',tool:'project',state:'running'}]:[{id:'delegate',tool:'team',state:'running'}]},{show:true});
 assert.equal(f.intervals.size,0,'vision alone cannot keep the terminal polling');
 assert.equal(root.children.length,0,'waiting for a map does not replace the operation display with a team card');
 stage.close();stage.close();assert.ok(f.observers.every(o=>o.disconnected));
});


test('search source activation preserves modified composer shortcuts',async()=>{
 const {setupStageTools}=await import('../ui/stage-tools.mjs');
 const f=fixture(),tools=setupStageTools({api:{},doc:f.doc,make:f.make,reduced:()=>true});
 const pane={body:f.make('div'),node:f.make('section'),state:f.make('span')};
 tools.fillSearch(pane,[{id:'source',state:'completed',revision:1,preview:{ok:true,query:'q',searches:[{results:[{title:'source',url:'https://example.invalid'}]}]}}]);
 const hit=[...pane.groups.values()][0].list.children[0];
 for(const modifier of ['ctrlKey','metaKey','altKey','shiftKey']){let prevented=false;hit.dispatchEvent({type:'keydown',key:'Enter',[modifier]:true,preventDefault(){prevented=true;}});assert.equal(prevented,false,modifier+' must reach the host shortcut');assert.equal(hit.classList.contains('open'),false);}
 let prevented=false;hit.dispatchEvent({type:'keydown',key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(hit.classList.contains('open'),true);
 tools.close(pane);
});
