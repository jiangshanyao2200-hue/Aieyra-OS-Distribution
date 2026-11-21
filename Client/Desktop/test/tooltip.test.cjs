// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture; flush
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/tooltip.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
function fixture(){
 const doc=new EventTarget(),win=new EventTarget();doc.defaultView=win;doc.hidden=false;let mutation,visibilityChecks=0,geometryReads=0;
 class Element extends EventTarget{
  constructor(){super();this.ownerDocument=doc;this.nodeType=1;this.dataset={};this.style={};this.attrs={};this.children=[];this.className='';this.isConnected=false;this.hovered=false;this.classList={contains:key=>this.className.split(' ').includes(key)};}
  append(node){node.parentElement=this;node.isConnected=true;this.children.push(node);}
  remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
  contains(node){return node===this||this.children.some(n=>n.contains(node));}
  hasAttribute(key){return key in this.attrs;}getAttribute(key){return this.attrs[key]??null;}setAttribute(key,value){this.attrs[key]=String(value);}removeAttribute(key){delete this.attrs[key];}
  querySelectorAll(){return [];}matches(selector){return selector===':hover'?this.hovered:selector===':focus-visible'?this.focused:false;}
  closest(selector){if(selector==='[data-tip]')return this.dataset.tip?this:this.parentElement?.closest(selector);return null;}
  checkVisibility(){visibilityChecks++;if(!this.isConnected)return false;for(let node=this;node;node=node.parentElement)if(node.hidden||node.cssHidden)return false;return true;}
  getBoundingClientRect(){geometryReads++;return {left:20,top:20,bottom:44,width:180,height:24};}
  showPopover(){this.open=true;}hidePopover(){this.open=false;}
  animate(){let resolve,reject;const finished=new Promise((yes,no)=>{resolve=yes;reject=no;}),timer=setTimeout(()=>resolve(),160);return {finished,cancel(){clearTimeout(timer);reject(Error('cancelled'));}};}
 }
 doc.createElement=()=>new Element();doc.documentElement=new Element();doc.documentElement.isConnected=true;doc.body=new Element();doc.body.isConnected=true;doc.documentElement.append(doc.body);
 Object.assign(win,{innerWidth:1280,innerHeight:800,queueMicrotask,setTimeout:(...args)=>setTimeout(...args),clearTimeout:id=>clearTimeout(id),getComputedStyle:node=>({opacity:node.style.opacity||'1',getPropertyValue:()=> '160ms'}),MutationObserver:class{constructor(fn){mutation??=fn;}observe(){}disconnect(){}},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
 const anchor=text=>{const node=new Element();node.dataset.tip=text;doc.body.append(node);return node;};
 function event(where,type,target,relatedTarget){const e=new Event(type);Object.defineProperties(e,{target:{value:target},relatedTarget:{value:relatedTarget}});where.dispatchEvent(e);}
 return {doc,win,anchor,event,mutate:records=>mutation(records),get visibilityChecks(){return visibilityChecks;},get geometryReads(){return geometryReads;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('tooltip survives unrelated focus changes and internal focus movement, then leaves once',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {setupTooltips}=await import('../ui/tooltip.mjs'),f=fixture(),state=setupTooltips(f.doc);t.after(()=>state.close());
 const anchor=f.anchor('稳定提示'),other=f.anchor('其他'),child=f.doc.createElement('span');anchor.append(child);state.showNow(anchor);const bubble=f.doc.body.children.at(-1);assert.equal(bubble.textContent,'稳定提示');
 f.event(f.doc,'focusout',other,null);assert.equal(bubble.isConnected,true);f.event(f.doc,'focusout',anchor,child);assert.equal(bubble.isConnected,true);
 anchor.hovered=true;f.event(f.doc,'focusout',anchor,other);assert.equal(bubble.isConnected,true);assert(anchor.getAttribute('aria-describedby'));
 anchor.hovered=false;f.event(f.doc,'focusout',anchor,other);assert.equal(anchor.getAttribute('aria-describedby'),null);assert.equal(bubble.isConnected,true,'fade keeps its painted node until completion');
 t.mock.timers.tick(200);await flush();assert.equal(bubble.isConnected,false);
});
test('titlebar scroll fitting repositions the same tooltip without a new hover delay or a replacement node',async t=>{
 const {setupTooltips}=await import('../ui/tooltip.mjs'),f=fixture(),state=setupTooltips(f.doc);t.after(()=>state.close());const anchor=f.anchor('稳定提示');anchor.hovered=true;state.showNow(anchor);const bubble=f.doc.body.children.at(-1),count=f.doc.body.children.length;
 for(let i=0;i<20;i++)f.event(f.win,'scroll',f.doc.body,null);state.showNow(anchor);
 assert.equal(f.doc.body.children.length,count);assert.equal(f.doc.body.children.at(-1),bubble);assert.equal(bubble.isConnected,true);assert.equal(bubble.style.top,'52px');
});
test('a cancelled preview read cannot overwrite or reopen the next native tooltip',async t=>{
 const {setupTooltips,configureTooltips,setPreviewTooltip}=await import('../ui/tooltip.mjs'),f=fixture(),frames=[],state=setupTooltips(f.doc);t.after(()=>state.close());
 configureTooltips(f.doc,{native:()=>payload=>{frames.push(payload);return Promise.resolve({ok:true});}});
 const first=f.anchor('旧预览'),next=f.anchor('新提示');let resolve;setPreviewTooltip(first,()=>new Promise(done=>{resolve=done;}),{title:'旧预览',module:'browser'});state.showNow(first);state.hide();state.showNow(next);const count=frames.length;
 resolve({title:'迟到旧预览',module:'browser',state:'ready'});await flush();assert.equal(frames.length,count);assert.equal(frames.at(-1).text,'新提示');assert.equal(frames.at(-1).action,'show');
});
test('streaming outside a pending or visible tooltip performs no anchor visibility or geometry reads',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {setupTooltips}=await import('../ui/tooltip.mjs'),f=fixture(),state=setupTooltips(f.doc);t.after(()=>state.close());
 const anchor=f.anchor('先前提示'),stream=f.anchor('独立聊天');f.event(f.doc,'pointerover',anchor,null);
 const update=()=>f.mutate([{type:'childList',target:stream,addedNodes:[f.doc.createElement('p')],removedNodes:[]}]);
 for(let i=0;i<500;i++)update();assert.equal(f.visibilityChecks,0);assert.equal(f.geometryReads,0,'hover delay remains free of layout checks');
 t.mock.timers.tick(180);const bubble=f.doc.body.children.at(-1),visibility=f.visibilityChecks,geometry=f.geometryReads,id=anchor.getAttribute('aria-describedby');assert.equal(bubble.textContent,'先前提示');assert(id);
 for(let i=0;i<500;i++)update();assert.equal(f.visibilityChecks,visibility);assert.equal(f.geometryReads,geometry);assert.equal(anchor.getAttribute('aria-describedby'),id);
 anchor.dataset.tip='更新提示';f.mutate([{type:'attributes',target:anchor,attributeName:'data-tip'}]);assert.equal(bubble.textContent,'更新提示');assert.equal(anchor.getAttribute('aria-describedby'),id);
 anchor.dataset.tip='';f.mutate([{type:'attributes',target:anchor,attributeName:'data-tip'}]);assert.equal(anchor.getAttribute('aria-describedby'),null);t.mock.timers.tick(200);await flush();assert.equal(bubble.isConnected,false);
});
test('hidden ancestors cancel pending tooltips and removing or moving an open anchor updates its bubble',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {setupTooltips}=await import('../ui/tooltip.mjs'),f=fixture(),state=setupTooltips(f.doc);t.after(()=>state.close());
 const anchor=f.anchor('稳定提示');f.event(f.doc,'pointerover',anchor,null);f.doc.body.hidden=true;f.mutate([{type:'attributes',target:f.doc.body,attributeName:'hidden'}]);t.mock.timers.tick(500);assert.equal(f.visibilityChecks,0);assert.equal(anchor.getAttribute('aria-describedby'),null);
 f.doc.body.hidden=false;state.showNow(anchor);const bubble=f.doc.body.children.at(-1),reads=f.geometryReads;
 f.mutate([{type:'childList',target:f.doc.body,addedNodes:[anchor],removedNodes:[anchor]}]);assert(f.geometryReads>reads,'moving the retained anchor repositions the same bubble');assert.equal(f.doc.body.children.at(-1),bubble);
 anchor.remove();f.mutate([{type:'childList',target:f.doc.body,addedNodes:[],removedNodes:[anchor]}]);assert.equal(anchor.getAttribute('aria-describedby'),null);t.mock.timers.tick(200);await flush();assert.equal(bubble.isConnected,false);
});
test('unchanged live model publications avoid visibility, geometry and native repaint while same-label capability changes still update',async t=>{
 const {setupTooltips,configureTooltips,setModelTooltip}=await import('../ui/tooltip.mjs'),f=fixture(),state=setupTooltips(f.doc),frames=[];t.after(()=>state.close());
 configureTooltips(f.doc,{native:()=>payload=>{frames.push(payload);return Promise.resolve({ok:true});}});
 const model={id:'deepseek',name:'DeepSeek',info:{context_window:128000,price:{input:1,output:2}}},anchor=f.anchor('模型'),other=f.anchor('其他模型');setModelTooltip(anchor,()=>model);state.showNow(anchor);
 const visibility=f.visibilityChecks,geometry=f.geometryReads,count=frames.length,bubble=f.doc.body.children.at(-1),id=anchor.getAttribute('aria-describedby');assert(visibility>0,'initial show still checks actual visibility');assert.equal(frames.at(-1).model.info.price.input,1);
 for(let i=0;i<500;i++){setModelTooltip(anchor,()=>model);setModelTooltip(other,{id:'other'});f.mutate([{type:'attributes',target:anchor,attributeName:'data-tip'}]);}
 assert.equal(f.visibilityChecks,visibility);assert.equal(f.geometryReads,geometry);assert.equal(frames.length,count);assert.equal(f.doc.body.children.at(-1),bubble);assert.equal(anchor.getAttribute('aria-describedby'),id);
 model.info.price.input=3;setModelTooltip(anchor,()=>model);assert.equal(anchor.dataset.tip,'DeepSeek');assert.equal(frames.length,count+1);assert.equal(frames.at(-1).model.info.price.input,3);assert(f.visibilityChecks>visibility);assert(f.geometryReads>geometry);
});
test('CSS visibility invalidation stays local to the active anchor and its ancestors and closes native tips',async t=>{
 const {setupTooltips,configureTooltips,setModelTooltip}=await import('../ui/tooltip.mjs'),f=fixture(),state=setupTooltips(f.doc),frames=[];t.after(()=>state.close());
 configureTooltips(f.doc,{native:()=>payload=>{frames.push(payload);return Promise.resolve({ok:true});}});
 const anchor=f.anchor('稳定提示'),stream=f.anchor('独立聊天');state.showNow(anchor);const visibility=f.visibilityChecks,geometry=f.geometryReads,count=frames.length;
 for(let i=0;i<500;i++)f.mutate([{type:'attributes',target:stream,attributeName:i%2?'style':'class'}]);
 assert.equal(f.visibilityChecks,visibility);assert.equal(f.geometryReads,geometry);assert.equal(frames.length,count);
 anchor.cssHidden=true;f.mutate([{type:'attributes',target:anchor,attributeName:'class'}]);assert.equal(frames.at(-1).action,'hide');assert.equal(anchor.getAttribute('aria-describedby'),null);
 anchor.cssHidden=false;state.showNow(anchor);f.doc.body.cssHidden=true;f.mutate([{type:'attributes',target:f.doc.body,attributeName:'style'}]);assert.equal(frames.at(-1).action,'hide');assert.equal(anchor.getAttribute('aria-describedby'),null);
 f.doc.body.cssHidden=false;setModelTooltip(anchor,{id:'deepseek'});state.showNow(anchor);anchor.hidden=true;setModelTooltip(anchor,{id:'deepseek'});assert.equal(frames.at(-1).action,'hide');assert.equal(anchor.getAttribute('aria-describedby'),null);
});

test('publishing another readout does not refresh or dismiss the active tooltip',async t=>{
 const {setupTooltips,configureTooltips,setTooltipRows,setModelTooltip}=await import('../ui/tooltip.mjs'),f=fixture(),state=setupTooltips(f.doc),frames=[];t.after(()=>state.close());
 configureTooltips(f.doc,{native:()=>payload=>{frames.push(payload);return Promise.resolve({ok:true});}});
 let modelReads=0;const model={id:'active',name:'当前模型'},active=f.anchor('当前模型'),other=f.anchor('其他指标');
 setModelTooltip(active,()=>{modelReads++;return model;});state.showNow(active);const before={models:modelReads,frames:frames.length,geometry:f.geometryReads,visibility:f.visibilityChecks};
 for(let i=0;i<30;i++){setTooltipRows(other,[{label:'输入',value:String(i)}]);setModelTooltip(other,{id:'other',name:'另一模型'+i});}
 assert.deepEqual({models:modelReads,frames:frames.length,geometry:f.geometryReads,visibility:f.visibilityChecks},before,'another anchor cannot read or paint this model');
 active.hidden=true;setTooltipRows(other,[{label:'输入',value:'31'}]);assert.equal(frames.length,before.frames,'other publications do not own dismissal');
 f.mutate([{type:'attributes',target:active,attributeName:'hidden'}]);assert.equal(frames.at(-1).action,'hide');assert.equal(active.getAttribute('aria-describedby'),null,'the owning visibility observer still retires hidden tips');
 active.hidden=false;state.showNow(other);const shown=frames.length;setTooltipRows(other,[{label:'输入',value:'32'}]);assert.equal(frames.length,shown+1);assert.equal(frames.at(-1).rows[0].value,'32','the addressed readout still updates immediately');
});
