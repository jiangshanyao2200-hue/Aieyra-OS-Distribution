// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/scroll-edges.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function fixture(){
 let dirty=false,reads=0,styles=0,writes=0,flushes=0,serial=0,mutate;const frames=new Map(),doc=new EventTarget(),win=new EventTarget();
 const read=()=>{reads++;if(dirty){flushes++;dirty=false;}};
 class Element extends EventTarget{
  constructor({overflow='auto',height=100,total=300,top=0}={}){super();this.ownerDocument=doc;this.nodeType=1;this.children=[];this.isConnected=true;this.overflow=overflow;this.height=height;this.total=total;this.top=top;this.hidden=false;this.classList={add(){dirty=true;writes++;},remove(){}};this.dataset=new Proxy({},{set(target,key,value){target[key]=value;dirty=true;writes++;return true;}});this.style=new Proxy({setProperty(key,value){this[key]=value;}},{set(target,key,value){target[key]=value;dirty=true;writes++;return true;}});}
  append(child){child.parentElement=this;this.children.push(child);}
  closest(selector){if(selector==='[hidden]')return this.hidden?this:this.parentElement?.closest(selector);if(selector==='.work-transcript')return this.workTranscript?this:this.parentElement?.closest(selector);return this;}
  matches(){return true;}
  querySelectorAll(){return this.children.flatMap(child=>[child,...child.querySelectorAll()]);}
  get clientHeight(){read();return this.height;}get scrollHeight(){read();return this.total;}get scrollTop(){read();return this.top;}
 }
 const outer=new Element({top:50}),inner=new Element({overflow:'visible'});outer.append(inner);Object.assign(doc,{defaultView:win,hidden:false,body:{dataset:{}},querySelectorAll:()=>[outer,inner]});
 const context={Element,document:doc,window:win,getComputedStyle:node=>{styles++;if(dirty){flushes++;dirty=false;}return {overflowY:node.overflow,visibility:node.visibility||'visible',display:'block'};},requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},MutationObserver:class{constructor(fn){mutate=fn;}observe(){}disconnect(){}}};
 const source=fs.readFileSync(path.join(__dirname,'../ui/scroll-edges.mjs'),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'');
 vm.runInNewContext(source+'\nglobalThis.edges={trimScrollFragments,setupScrollEdges};',context);
 return {doc,outer,inner,frames,edges:context.edges,mutation:records=>mutate(records),frame(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());dirty=false;},get reads(){return reads;},get styles(){return styles;},get writes(){return writes;},get flushes(){return flushes;}};
}

test('scroll edges batch all viewport reads before writing masks and preserve the actual outer scroller',()=>{
 const f=fixture(),close=f.edges.setupScrollEdges(f.doc);try{
  f.frame();assert.equal(f.flushes,0,'an inner/outer batch must not force layout between mask writes');assert.equal(f.reads,3,'overflow-visible inner content does not read scroll geometry');
  assert.equal(f.outer.style['--fade-top'],'14px');assert.equal(f.outer.style['--fade-bottom'],'14px');assert.equal(f.inner.style.maskImage,'none');
  const writes=f.writes;f.mutation([{type:'characterData',target:{parentElement:f.inner}}]);f.frame();assert.equal(f.writes,writes,'unchanged edges do not rewrite CSS');
  f.outer.total=600;f.outer.top=500;f.mutation([{type:'characterData',target:{parentElement:f.inner}}]);f.frame();assert.equal(f.outer.style['--fade-top'],'14px');assert.equal(f.outer.style['--fade-bottom'],'0px','inner content mutation still refreshes the outer scroll container');
 }finally{close();}assert.equal(f.frames.size,0);
});

test('hidden and disconnected scroll containers skip measurement and resume their true edge state when revealed',()=>{
 const f=fixture();f.outer.hidden=true;f.edges.trimScrollFragments(f.inner);assert.equal(f.styles,0);assert.equal(f.reads,0);assert.equal(f.writes,0);
 f.outer.hidden=false;f.inner.visibility='hidden';f.edges.trimScrollFragments(f.inner);assert.equal(f.reads,0);assert.equal(f.writes,0);
 f.inner.visibility='visible';f.inner.overflow='auto';f.inner.top=200;f.edges.trimScrollFragments(f.inner);assert.equal(f.inner.style['--fade-top'],'14px');assert.equal(f.inner.style['--fade-bottom'],'0px');
 const reads=f.reads,styles=f.styles;f.inner.isConnected=false;f.edges.trimScrollFragments(f.inner);assert.equal(f.reads,reads);assert.equal(f.styles,styles);
});

test('fixed work reader streaming and inner scrolling do not remeasure ancestor masks',()=>{
 const f=fixture();f.inner.workTranscript=true;const close=f.edges.setupScrollEdges(f.doc);
 try{
  f.frame();const reads=f.reads,styles=f.styles;
  for(let i=0;i<50;i++){
   f.mutation([{type:'characterData',target:{parentElement:f.inner}},{type:'childList',target:f.inner,addedNodes:[f.inner],removedNodes:[]}]);
   const event=new Event('scroll');Object.defineProperty(event,'target',{value:f.inner});f.doc.dispatchEvent(event);f.frame();
  }
  assert.equal(f.reads,reads);assert.equal(f.styles,styles);
  f.outer.total=600;f.outer.top=500;
  const event=new Event('scroll');Object.defineProperty(event,'target',{value:f.outer});f.doc.dispatchEvent(event);f.frame();
  assert.ok(f.reads>reads);assert.equal(f.outer.style['--fade-bottom'],'0px','the real outer scroller still updates');
 }finally{close();}
});
