'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

function fixture(){
 const frames=new Map(),observers=[],listeners=new Map();let sequence=0,layoutReads=0,selection=null;
 class Node{
  constructor(tag){this.tagName=tag?.toUpperCase();this.nodeType=tag?1:3;this.childNodes=[];this.parentNode=null;this.style={};this.attributes={};this.data='';this._height=100;this._client=100;this._top=0;this.scrollWrites=0;}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.childNodes.push(node);}}
  appendData(text){this.data+=text;}
  replaceChildren(...nodes){for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];this.append(...nodes);}
  remove(){if(this.parentNode){this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}}
  contains(node){for(let current=node;current;current=current.parentNode)if(current===this)return true;return false;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  get textContent(){return this.nodeType===3?this.data:this.childNodes.map(node=>node.textContent).join('');}
  get scrollHeight(){layoutReads++;return this._height;}
  get clientHeight(){layoutReads++;return this._client;}
  get scrollTop(){layoutReads++;return this._top;}
  set scrollTop(value){this.scrollWrites++;this._top=Math.max(0,Math.min(value,this._height-this._client));}
 }
 class Observer{
  constructor(callback){this.callback=callback;this.nodes=[];observers.push(this);}
  observe(node){this.nodes.push(node);}
  disconnect(){this.closed=true;this.nodes=[];}
 }
 const win={requestAnimationFrame(fn){const id=++sequence;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},ResizeObserver:Observer};
 const doc={defaultView:win,createElement:tag=>new Node(tag),createTextNode:text=>Object.assign(new Node(),{data:text}),getSelection:()=>selection,
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}};
 const screen=new Node('div');screen.ownerDocument=doc;
 const range=(start,end=start)=>({startContainer:start,endContainer:end,intersectsNode:node=>node.contains(start)||node.contains(end)});
 function select(ranges){
  selection={ranges,isCollapsed:!ranges.length,get rangeCount(){return this.ranges.length;},getRangeAt(i){return this.ranges[i];},removeRange(item){this.ranges=this.ranges.filter(range=>range!==item);this.isCollapsed=!this.ranges.length;},removeAllRanges(){this.ranges=[];this.isCollapsed=true;}};
  for(const fn of listeners.get('selectionchange')||[])fn();return selection;
 }
 return {doc,screen,frames,observers,listeners,range,select,Node,get layoutReads(){return layoutReads;},
  flush(){const batch=[...frames.values()];frames.clear();for(const fn of batch)fn();},
  get viewport(){return screen.childNodes[0];},get pre(){return this.viewport.childNodes[0];}};
}

test('readonly terminal preserves split RGB prompts, resets, Unicode and literal HTML',async()=>{
 const {createReadonlyTerminal}=await import('./readonly.mjs'),f=fixture(),view=createReadonlyTerminal(f.screen);
 view.append('\x1b[38;2;169;');view.append('192;236mEyra');view.append('\x1b[');view.append('0m <img src=x onerror=alert(1)> 中文\r');view.append('\n');
 assert.equal(f.viewport.className,'readonly-terminal');assert.equal(f.pre.tagName,'PRE');assert.equal(f.pre.textContent,'Eyra <img src=x onerror=alert(1)> 中文\n');
 assert.equal(f.pre.childNodes.length,2);assert.equal(f.pre.childNodes[0].tagName,'SPAN');assert.equal(f.pre.childNodes[0].style.color,'rgb(169, 192, 236)');assert.equal(f.pre.childNodes[1].nodeType,3);
 assert.equal(f.pre.childNodes[0].childNodes.length,1);assert.equal(f.pre.childNodes[1].data,' <img src=x onerror=alert(1)> 中文\n');view.close();
});

test('unknown escape/control strings stay ignored across every append boundary',async()=>{
 const {createReadonlyTerminal}=await import('./readonly.mjs');
 const input='a\x1b[2Jb\x1b]52;c;<b>clipboard</b>\x07c\x1bPignored\x1b\\d\x1b(B\x00\x08\x7f\x9b31me\x9dtitle\x9cf\x1b[38;2;999;1;1mg';
 for(let split=0;split<=input.length;split++){
  const f=fixture(),view=createReadonlyTerminal(f.screen);view.append(input.slice(0,split));view.append(input.slice(split));
  assert.equal(f.pre.textContent,'abcdefg','split '+split);assert.equal(f.pre.childNodes.length,1);view.close();
 }
 const f=fixture(),view=createReadonlyTerminal(f.screen);for(const ch of '\x1b[38;2;1;2;3m彩色\x1b[0m默认')view.append(ch);
 assert.equal(f.pre.textContent,'彩色默认');assert.equal(f.pre.childNodes[0].style.color,'rgb(1, 2, 3)');view.close();
});

test('continuous appends reuse text nodes and coalesce following without measuring on write',async()=>{
 const {createReadonlyTerminal}=await import('./readonly.mjs'),f=fixture(),view=createReadonlyTerminal(f.screen);
 for(let i=0;i<5000;i++)view.append('中文'+i+'\n');
 assert.equal(f.pre.childNodes.length,1);assert.equal(f.pre.childNodes[0].nodeType,3);assert.equal(f.frames.size,1);assert.equal(f.layoutReads,0);
 view.append('\x1b[38;2;10;20;30m');for(let i=0;i<1000;i++)view.append('色');
 view.append('\x1b[0m\x1b[38;2;10;20;30m末尾');
 assert.equal(f.pre.childNodes.length,2);assert.equal(f.pre.childNodes[1].childNodes.length,1);assert.equal(f.pre.childNodes[1].textContent,'色'.repeat(1000)+'末尾');
 f.viewport._height=4000;f.flush();assert.equal(f.viewport._top,3900);assert.equal(f.viewport.scrollWrites,1);view.close();
});

test('following waits for layout and both resize targets while paused readers keep their position',async()=>{
 const {createReadonlyTerminal}=await import('./readonly.mjs'),f=fixture();let following=true;
 const view=createReadonlyTerminal(f.screen,{following:()=>following});assert.deepEqual(f.observers[0].nodes,[f.viewport,f.pre]);
 view.append('first');assert.equal(f.viewport.scrollWrites,0);f.viewport._height=700;f.flush();assert.equal(f.viewport._top,600);
 f.viewport._height=900;f.observers[0].callback();assert.equal(f.viewport._top,600);f.flush();assert.equal(f.viewport._top,800);
 following=false;f.viewport._top=120;view.append('later');f.observers[0].callback();view.follow();f.flush();assert.equal(f.viewport._top,120);assert.equal(f.pre.textContent,'firstlater');
 following=true;for(let i=0;i<20;i++)view.follow();assert.equal(f.frames.size,1);following=false;f.flush();assert.equal(f.viewport._top,120,'a pending frame must honor a later pause');
 following=true;view.follow();f.flush();assert.equal(f.viewport._top,800);assert.equal(view.atBottom(),true);f.viewport._top=790;assert.equal(view.atBottom(),false);view.close();
});

test('selection pauses only this content and clearing keeps external and crossing ranges',async()=>{
 const {createReadonlyTerminal}=await import('./readonly.mjs'),f=fixture();let following=true,selected=0;
 const view=createReadonlyTerminal(f.screen,{following:()=>following,onSelect:()=>{following=false;selected++;}});view.append('current');
 const current=f.pre.childNodes[0],outside=new f.Node('div');outside.append(f.doc.createTextNode('outside'));const other=outside.childNodes[0];
 let selection=f.select([f.range(other)]);assert.equal(selected,0);view.clearSelection();assert.equal(selection.rangeCount,1);
 selection=f.select([f.range(current)]);assert.equal(selected,1);f.flush();assert.equal(f.viewport.scrollWrites,0);view.clearSelection();assert.equal(selection.rangeCount,0);
 selection=f.select([f.range(current),f.range(other)]);view.clearSelection();assert.equal(selection.rangeCount,1);assert.equal(selection.getRangeAt(0).startContainer,other);
 selection=f.select([f.range(current,other)]);view.clearSelection();assert.equal(selection.rangeCount,1);view.close();
});

test('reset clears partial controls and close releases its DOM, selection listener, observer and frame',async()=>{
 const {createReadonlyTerminal}=await import('./readonly.mjs'),f=fixture(),view=createReadonlyTerminal(f.screen);
 view.append('\x1b[38;2;1;2;3mold\x1b]unfinished');view.reset();view.append('new');
 assert.equal(f.pre.textContent,'new');assert.equal(f.pre.childNodes.length,1);assert.equal(f.pre.childNodes[0].nodeType,3);
 const pre=f.pre,viewport=f.viewport;assert.equal(f.frames.size,1);view.close();view.close();
 assert.equal(f.frames.size,0);assert.equal(f.listeners.get('selectionchange').size,0);assert.equal(f.observers[0].closed,true);assert.equal(f.screen.childNodes.length,0);
 view.append('late');view.reset();view.follow();f.flush();assert.equal(pre.textContent,'new');assert.equal(viewport.scrollWrites,0);assert.equal(f.frames.size,0);
});
