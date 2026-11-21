// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/dock-fit.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('dock fitting batches measurements, preserves required controls and settles without toggling hidden nodes',async()=>{
 const {fitDock}=await import('../ui/dock-fit.mjs');let next=null,dirty=false,flushes=0,writes=0,reserve=0;
 class Node extends EventTarget{
  constructor(width=36,order=0){super();this.width=width;this.order=order;this.attrs=new Set();this.children=[];this.isConnected=true;this.hover=false;}
  getBoundingClientRect(){if(dirty){flushes++;dirty=false;}return {width:this.attrs.has('data-dock-overflow')||this.hidden?0:this.width};}
  get clientWidth(){return this.width;}
  setAttribute(k){if(!this.attrs.has(k)){this.attrs.add(k);writes++;dirty=true;}}
  hasAttribute(k){return this.attrs.has(k);}
  removeAttribute(k){if(this.attrs.delete(k)){writes++;dirty=true;}}
  querySelectorAll(){return this.children.flatMap(n=>n.children.length?n.children:[n]);}
  querySelector(){return null;}
  matches(){return this.hover;}
  contains(n){return this===n||this.children.includes(n);}
 }
 const win=Object.assign(new EventTarget(),{requestAnimationFrame:fn=>(next=fn,1),cancelAnimationFrame:()=>{next=null;},getComputedStyle:n=>({getPropertyValue:key=>key==='--workspace-menu-reserve'?reserve+'px':'',display:n.contents?'contents':n.hasAttribute('data-dock-overflow')?'none':'flex',order:n.order,columnGap:'8px',paddingLeft:'0',paddingRight:'0',marginLeft:'0',marginRight:'0'}),ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}}});
 const doc=Object.assign(new EventTarget(),{defaultView:win,activeElement:null}),dock=new Node(230),home=new Node(),apps=new Node(36,1000),wrapper=new Node(),pinned=new Node(48,900);
 wrapper.contents=true;wrapper.children=[pinned];const entries=Array.from({length:8},(_,i)=>new Node(36,i+1));dock.children=[home,...entries,wrapper,apps];dock.ownerDocument=doc;
 const tick=()=>{const fn=next;next=null;fn?.();};
 const fit=fitDock(dock,{doc,entries:()=>[...entries,pinned]});tick();
 const visible=()=>[home,...entries,pinned,apps].filter(n=>!n.hasAttribute('data-dock-overflow'));
 assert(visible().reduce((n,e)=>n+e.width,0)+(visible().length-1)*8<=dock.width);
 assert(!home.hasAttribute('data-dock-overflow')&&!apps.hasAttribute('data-dock-overflow'));
 const initial=writes;dirty=false;dock.dispatchEvent(new Event('pointerleave'));tick();assert.equal(writes,initial,'unchanged width must not restore and hide each overflow entry');assert.equal(flushes,0,'no synchronous layout read after visibility writes');
 dock.width=330;win.dispatchEvent(new Event('resize'));tick();assert(visible().length>4);assert.equal(flushes,1,'font/viewport invalidation performs one batched layout');
 // A translated dock has less painted room even though its layout width is
 // unchanged. The required Apps entry must stay reachable without rebuilding.
 const closedCount=visible().length;reserve=160;dock.dispatchEvent(new Event('workspace-dock-change'));tick();
 assert(visible().reduce((n,e)=>n+e.width,0)+(visible().length-1)*8+reserve<=dock.width,'sidebar translation is part of the visible width budget');
 assert(visible().length<closedCount&&!apps.hasAttribute('data-dock-overflow'));
 const insetWrites=writes;dock.dispatchEvent(new Event('workspace-dock-change'));tick();assert.equal(writes,insetWrites,'stable translation does not toggle overflow nodes');
 reserve=0;dock.dispatchEvent(new Event('workspace-dock-change'));tick();assert.equal(visible().length,closedCount,'closing restores the existing navigation entries');
 const protectedNode=entries[4];doc.activeElement=protectedNode;dock.width=130;fit.refresh();tick();assert(!protectedNode.hasAttribute('data-dock-overflow'),'keyboard focus is protected');
 dock.dispatchEvent(new Event('pointerdown'));const before=writes;dock.width=90;fit.refresh();tick();assert.equal(writes,before,'pressed controls must not move');win.dispatchEvent(new Event('pointerup'));tick();
 fit.close();assert(entries.every(n=>!n.hasAttribute('data-dock-overflow')));
});
