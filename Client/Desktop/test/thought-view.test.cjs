// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/thought-view.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

function fixture(){
 const nodes=[];
 class Node{
  constructor(tag){this.ownerDocument=doc;this.tag=tag;this.children=[];this.parentNode=null;this.value='';this.listeners=new Map();this.normalized=0;this.offsetHeight=20;this.classList={add(){}};nodes.push(this);}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  get firstChild(){return this.children[0];}
  get textContent(){return this.value+this.children.map(n=>n.textContent).join('');}
  set textContent(v){this.replaceChildren();this.value=v;}
  append(...items){for(const n of items){n.remove();n.parentNode=this;this.children.push(n);}}
  replaceChildren(...items){for(const n of this.children)n.parentNode=null;this.children=[];this.value='';this.append(...items);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
  replaceWith(next){const p=this.parentNode,i=p.children.indexOf(this);this.remove();p.children.splice(i,0,next);next.parentNode=p;}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  end(){this.listeners.get('animationend')?.();}
  normalize(){this.normalized++;}
 }
 const doc={createElement:tag=>new Node(tag),createTextNode:value=>{const n=new Node('#text');n.textContent=value;return n;}};
 doc.body=new Node('body');return {doc,nodes};
}
test('paced thinking text cannot mutate detached or newly attached views',async t=>{
 const {createThoughtView}=await import('../ui/thought-view.mjs');
 const queue=[],previous=[global.requestAnimationFrame,global.cancelAnimationFrame];
 global.requestAnimationFrame=fn=>{queue.push(fn);return queue.length;};global.cancelAnimationFrame=()=>{};
 t.after(()=>{[global.requestAnimationFrame,global.cancelAnimationFrame]=previous;if(!previous[0])delete global.requestAnimationFrame;if(!previous[1])delete global.cancelAnimationFrame;});
 const flush=()=>{while(queue.length)queue.shift()();};
 const f=fixture(),view=createThoughtView({doc:f.doc});
 view.attach(f.doc.body);view.update('甲');view.update('甲乙');
 const old=f.nodes.findLast(n=>n.className==='tv-text');
 view.detach();assert.doesNotThrow(flush);assert.equal(old.textContent,'');
 view.attach(f.doc.body);view.update('新');view.update('新字');
 const current=f.nodes.findLast(n=>n.className==='tv-text');
 flush();assert.equal(current.textContent,'新字');
 view.update('新字续');view.update('另一段');flush();assert.equal(current.textContent,'另一段');
 f.doc.hidden=true;view.update('隐藏时直接同步');view.update('隐藏时直接同步全部内容');assert.equal(current.textContent,'隐藏时直接同步全部内容');assert.equal(queue.length,0);
});
