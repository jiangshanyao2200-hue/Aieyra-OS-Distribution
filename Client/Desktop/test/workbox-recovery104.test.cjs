// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; deferred; settle; invoke; bridge; documentFixture; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workbox-recovery104.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
let invoke;
const bridge={invoke:payload=>invoke(payload)};

// Mount the production workbox controller and result renderer. Only DOM,
// timers and the public RPC boundary are supplied by this small fixture.
function documentFixture(){
 let doc;
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentNode=null;this.dataset={};this.attrs=new Map();this.listeners=new Map();this.style={};this.className='';this._text='';this.hidden=false;this.disabled=false;this.open=false;this.value='';this.scrollTop=0;this.classList={contains:k=>this.className.split(' ').includes(k),add:(...ks)=>{this.className=[...new Set([...this.className.split(' '),...ks])].join(' ');},remove:(...ks)=>{this.className=this.className.split(' ').filter(k=>!ks.includes(k)).join(' ');}};}
  get childNodes(){return this.children;}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}set textContent(v){this.replaceChildren();this._text=String(v);}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  append(...nodes){for(const n of nodes){n.remove();this.children.push(n);n.parentNode=this;}}
  replaceChildren(...nodes){for(const n of [...this.children])n.remove();this._text='';this.append(...nodes);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}}
  after(n){const parent=this.parentNode;if(!parent)return;n.remove();const at=parent.children.indexOf(this);parent.children.splice(at+1,0,n);n.parentNode=parent;}
  setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){if(k==='open')return this.open?'':null;if(k.startsWith('data-'))return this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??null;return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}
  matches(s){const tag=s.match(/^[a-z]+/i);if(tag&&this.tagName!==tag[0].toUpperCase())return false;for(const c of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(c[1]))return false;for(const a of s.matchAll(/\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]/g)){const value=this.getAttribute(a[1]);if(value===null||a[2]!==undefined&&value!==a[2])return false;}return true;}
  querySelectorAll(s){return this.children.flatMap(n=>[...(n.matches(s)?[n]:[]),...n.querySelectorAll(s)]);}querySelector(s){return this.querySelectorAll(s)[0]||null;}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}closest(s){for(let n=this;n;n=n.parentNode)if(n.matches(s))return n;return null;}focus(){doc.activeElement=this;}
  addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(fn);}removeEventListener(k,fn){this.listeners.get(k)?.delete(fn);}
  emit(type){this['on'+type]?.({type,target:this});for(const fn of this.listeners.get(type)||[])fn({type,target:this});}
  click(){if(!this.disabled)this.emit('click');}showModal(){this.open=true;}close(){this.open=false;this.emit('close');}
 }
 const listeners=new Map();doc={hidden:true,defaultView:{addEventListener(){},removeEventListener(){}},getSelection:()=>({isCollapsed:true,rangeCount:0}),createElement:tag=>new Node(tag),addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener:(k,fn)=>listeners.get(k)?.delete(fn)};
 doc.body=new Node('body');doc.activeElement=doc.body;doc.head=new Node('head');
 const dialog=new Node('dialog'),root=new Node('article'),notice=new Node('p');dialog.id='detail';root.id='detail-body';notice.id='app-notice';dialog.append(root);doc.body.append(dialog,notice);
 doc.getElementById=id=>[dialog,root,notice].find(n=>n.id===id)||null;
 return {doc,dialog,root,notice};
}
async function fixture(t,{state='running',runner=false}={}){
 const f=documentFixture(),previous=new Map(),timers=new Map();let timerID=0;
 for(const [key,value]of Object.entries({document:f.doc,window:{aieyraApp:bridge},setTimeout:fn=>{timers.set(++timerID,fn);return timerID;},clearTimeout:id=>timers.delete(id)})){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const packageID='mod:example.images-workflow@'+'a'.repeat(64),requests=[],mutations=[];let pending=null;
 const instance={schema:'aieyra.workbox-state/1',id:'owned-workflow',owner:'owned-user',package:packageID,title:'Owned recovery',state,revision:7,created:'2026-11-10T00:00:00Z',error:'unresolved original request',definition:{input:{properties:{}},steps:[{id:'generate',title:'原请求'}]},steps:[{id:'generate',state:'in_flight',attempts:1,invocation:'original-image-batch',receipt:'original-image-batch'}],outputs:{}};
 const change=next=>{instance.state=next;instance.steps[0].state=next==='unknown'?'unknown':'completed';instance.revision++;};
 invoke=async payload=>{
  assert.equal(payload.action,'mod_workflow');const p=payload.request;assert.equal(p.package,packageID);requests.push(structuredClone(p));
  if(p.action==='describe')return {definition:instance.definition,workdir:'owned-fixture'};
  if(p.action==='list')return {instances:[structuredClone(instance)],total:1,next_offset:1};
  assert.equal(p.action,'call');const command=p.command;
  if(command.action==='status')return {instance:structuredClone(instance)};
  assert.equal(p.owner,instance.owner);assert.equal(command.id,instance.id);assert.equal(command.expected_revision,instance.revision);assert.match(command.request_id,/^[\da-f-]{36}$/);
  mutations.push(structuredClone(p));const gate=pending;pending=null;if(gate)await gate.promise;
  if(command.action==='recover'&&runner)return {ok:false,error:'workflow runner is busy; inspect after stopping'};
  if(command.action==='recover'){change('unknown');return {instance:structuredClone(instance)};}
  assert.equal(command.action,'cancel');runner=false;change('unknown');return {instance:structuredClone(instance)};
 };
 const {openWorkboxes}=await import('../ui/workboxes.mjs');
 t.after(()=>{f.dialog.close();for(const [key,value]of previous)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];});
 await openWorkboxes({enabled:true,digest:'a'.repeat(64),manifest:{id:'example.images-workflow',name:'Owned recovery'}});await settle();
 return {...f,requests,mutations,instance,button(label){const footer=f.root.children.find(n=>n.tagName==='FOOTER');return footer.children.find(n=>n.textContent===label);},recover(){const b=this.button('检查已有回执');assert(b,'active workflow must offer explicit original-receipt recovery');b.click();return settle();},hold(){return pending=deferred();},digest:()=>f.root.querySelector('.workbox-digest')};
}

test('a live runner rejects recovery without trapping the real workflow UI or preventing cancel',async t=>{
 const f=await fixture(t,{runner:true});await f.recover();
 assert.match(f.notice.textContent,/runner is busy/);assert.equal(f.instance.state,'running');assert.equal(f.digest().dataset.state,'running');assert.equal(f.button('检查已有回执').disabled,false);assert.equal(f.button('取消').disabled,false);
 f.button('取消').click();await settle();assert.deepEqual(f.mutations.map(p=>p.command.action),['recover','cancel']);assert.equal(f.digest().dataset.state,'unknown');assert.equal(f.instance.steps[0].attempts,1);assert.equal(f.instance.steps[0].receipt,'original-image-batch');
 await f.recover();assert.deepEqual(f.mutations.map(p=>p.command.action),['recover','cancel','recover']);assert.equal(f.digest().dataset.state,'unknown');assert(f.root.textContent.includes('original-image-batch'));
});

for(const state of ['running','pause_requested','cancel_requested'])test('a saved '+state+' workflow with no runner can inspect its original receipt through the mounted UI',async t=>{
 const f=await fixture(t,{state});await f.recover();
 assert.deepEqual(f.mutations.map(p=>p.command.action),['recover']);assert.equal(f.instance.revision,8);assert.equal(f.digest().dataset.state,'unknown');assert(f.root.textContent.includes('unresolved original request'));assert(f.root.textContent.includes('original-image-batch'));assert.equal(f.instance.steps[0].attempts,1);assert.equal(f.instance.steps[0].invocation,'original-image-batch');assert.equal(f.button('检查已有回执').disabled,false);
});

test('pending recovery locks actual action buttons and the production busy guard rejects repeated handlers',async t=>{
 const f=await fixture(t),first=f.button('检查已有回执');assert(first,'running workflow recovery action');const gate=f.hold();first.click();await settle();
 const recovery=f.button('检查已有回执'),cancel=f.button('取消');assert.equal(recovery.disabled,true);assert.equal(cancel.disabled,true);assert.equal(f.button('关闭').disabled,false);
 recovery.click();cancel.click();first.onclick();recovery.onclick();await settle();assert.deepEqual(f.mutations.map(p=>p.command.action),['recover']);
 gate.resolve();await settle();assert.equal(f.digest().dataset.state,'unknown');assert.equal(f.button('检查已有回执').disabled,false);assert.equal(f.instance.steps[0].attempts,1);
});
