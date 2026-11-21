// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: environment
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/notice-idle.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function environment(){
 const win=new EventTarget(),doc=new EventTarget();let inside=false,scans=0,writes=0,hides=0;
 class Node extends EventTarget{
  constructor(){super();this.ownerDocument=doc;this.children=[];this.style={};this.dataset={};this.hidden=false;this.attrs=new Map();this.hover=false;const classes=new Set();this.classList={add:(...a)=>a.forEach(v=>classes.add(v)),toggle:(v,on)=>on?classes.add(v):classes.delete(v)};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;writes++;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(){return this.hover;}
  setAttribute(key,value){this.attrs.set(key,String(value));writes++;}
  getAttribute(key){return this.attrs.get(key)??null;}
  hidePopover(){hides++;}
 }
 const notice=new Node(),child=new Node();notice.append(child);
 const selection={anchorNode:{},focusNode:{},anchorOffset:0,focusOffset:1,isCollapsed:false,rangeCount:1,getRangeAt:()=>({intersectsNode:()=>{scans++;return inside;}})};
 Object.assign(doc,{defaultView:win,activeElement:null,getSelection:()=>selection});
 return {doc,win,notice,child,selection,Node,setInside(value){inside=value;},get scans(){return scans;},get writes(){return writes;},get hides(){return hides;}};
}

test('notice selection caching preserves a hidden selected notice and refreshes changed boundaries before selectionchange',async()=>{
 const {createNoticeInteraction}=await import('../ui/system-notices.mjs'),f=environment(),changes=[],updates=[],interaction=createNoticeInteraction(f.notice,value=>changes.push(value));
 try{
  interaction.refresh();for(let i=0;i<500;i++)interaction.refresh();assert.equal(f.scans,1,'an unchanged chat range is checked only once');assert.equal(interaction.locked,false);
  f.setInside(true);f.selection.focusOffset++;interaction.refresh();assert.equal(interaction.locked,true,'synchronous selection movement is respected before its event');
  interaction.defer(()=>updates.push('old'),'paint');interaction.defer(()=>updates.push('latest'),'paint');f.notice.hidden=true;
  for(let i=0;i<500;i++)interaction.refresh();assert.equal(f.scans,2);assert.deepEqual(updates,[],'hidden text remains protected while selected');
  f.setInside(false);f.doc.dispatchEvent(new Event('selectionchange'));assert.equal(f.scans,3);assert.equal(interaction.locked,false);assert.deepEqual(updates,['latest']);assert.deepEqual(changes,[true,false]);
  interaction.dispose();f.doc.dispatchEvent(new Event('selectionchange'));assert.equal(f.scans,3);
 }finally{interaction.dispose();}
});

test('notice focus, hover, press and asynchronous holds continue to defer changes',async()=>{
 const {createNoticeInteraction}=await import('../ui/system-notices.mjs'),f=environment(),updates=[],interaction=createNoticeInteraction(f.notice);
 try{
  f.selection.isCollapsed=true;f.doc.activeElement=f.child;interaction.refresh();interaction.defer(()=>updates.push('focused'));assert.deepEqual(updates,[]);
  f.doc.activeElement=null;f.notice.dispatchEvent(new Event('focusout'));await new Promise(resolve=>queueMicrotask(resolve));assert.deepEqual(updates,['focused']);
  f.notice.hover=true;interaction.refresh();const press=new Event('pointerdown');Object.defineProperty(press,'button',{value:0});f.notice.dispatchEvent(press);
  f.notice.hover=false;f.notice.dispatchEvent(new Event('pointerleave'));interaction.defer(()=>updates.push('pressed'));assert.equal(interaction.locked,true);
  const release=interaction.hold();f.doc.dispatchEvent(new Event('pointerup'));assert.equal(interaction.locked,true);release();release();assert.equal(interaction.locked,false);assert.deepEqual(updates,['focused','pressed']);
 }finally{interaction.dispose();}
});

test('empty hidden system notices do not hide again, inspect selections or rewrite metadata on snapshots',async()=>{
 const {createNoticeInteraction}=await import('../ui/system-notices.mjs'),f=environment(),nodes=new Map(['system-slot','system-bubble','system-popover'].map(id=>[id,new f.Node()]));
 nodes.get('system-slot').hidden=true;nodes.get('system-popover').hidden=true;f.doc.getElementById=id=>nodes.get(id);
 const source=fs.readFileSync(path.join(__dirname,'../ui/system-notices.mjs'),'utf8'),context={document:f.doc,window:f.win,createNoticeInteraction,el:()=>new f.Node(),cancelMotion(){throw Error('hidden notice should not cancel motion');},animateUI(){throw Error('hidden notice should not animate');}};
 vm.runInNewContext(source.slice(source.indexOf('export function setupSystemNotices')).replace('export function','function')+'\nglobalThis.setup=setupSystemNotices;',context);
 const notices=context.setup({load:async()=>{},markRead:async()=>{}});notices.paint('home',[]);const writes=f.writes;
 for(let i=0;i<1000;i++)notices.paint('home',[]);
 assert.equal(f.scans,0);assert.equal(f.hides,0);assert.equal(f.writes,writes);assert.equal(notices.visible,false);
});
