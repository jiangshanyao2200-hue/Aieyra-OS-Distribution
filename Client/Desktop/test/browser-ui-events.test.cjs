// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: load; turn; harness
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-ui-events.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const load=()=>import(pathToFileURL(path.join(__dirname,'../ui/browser.mjs')).href);
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t){
 const nodes=new Map();let writes=0,timers=0,cleared=0,interval;
 const node=()=>{const n=new EventTarget(),attrs=new Map();Object.assign(n,{dataset:{},children:[],after(child){this.sibling=child;},remove(){this.removed=true;},setAttribute(k,v){writes++;attrs.set(k,String(v));},getAttribute:k=>attrs.get(k),replaceChildren(...children){writes++;this.children=children;}});for(const key of ['textContent','title','hidden','disabled']){let value;Object.defineProperty(n,key,{get:()=>value,set(v){writes++;value=v;}});}return n;};
 const doc=new EventTarget();Object.assign(doc,{getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node,body:{classList:{contains:()=>false}},querySelector:()=>null});
 const globals={document:doc,window:new EventTarget(),MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},setInterval:fn=>{timers++;interval=fn;return 7;},clearInterval:id=>{if(id===7)cleared++;}};
 for(const [key,value]of Object.entries(globals)){const prior=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>prior?Object.defineProperty(globalThis,key,prior):delete globalThis[key]);}
 return {doc,nodes,get writes(){return writes;},get timers(){return timers;},get cleared(){return cleared;},tick:()=>interval?.()};
}
test('browser events replace polling, reject late initial reads, keep stable DOM and unsubscribe on close',async t=>{
 const {setupBrowser}=await load(),h=harness(t);let notify,resolve,stopped=0,reads=0;
 const api={browserUser:async()=>({}),browserSurface:async()=>({}),browserStatus:()=>{reads++;return new Promise(r=>resolve=r);},onBrowserChanged:fn=>{notify=fn;return ()=>stopped++;}};
 const ui=setupBrowser(api,{is:()=>false},h.doc);
 const current={count:2,selected:'live',groups:[{id:'live',owner:'program/browser',profile:'default',count:2,detached:true}]};notify(current);
 assert.equal(h.timers,0);assert.equal(h.nodes.get('browser-detached').hidden,false);const stable=h.writes;
 notify(structuredClone(current));assert.equal(h.writes,stable,'duplicate state must retain existing nodes');
 resolve({count:0,groups:[]});await turn();assert.equal(h.writes,stable,'initial response cannot replace a newer event');assert.equal(reads,1);
 notify({...current,groups:[{...current.groups[0],detached:false}]});assert.equal(h.nodes.get('browser-empty').hidden,true,'docking becomes visible from events');
 ui.close();const closed=h.writes;notify({count:0,groups:[]});assert.equal(h.writes,closed);assert.equal(stopped,1);
});
test('legacy hosts retain polling and a response after close cannot paint',async t=>{
 const {setupBrowser}=await load(),h=harness(t);let resolve,reads=0;
 const ui=setupBrowser({browserUser:async()=>({}),browserSurface:async()=>({}),browserStatus:()=>{reads++;return new Promise(r=>resolve=r);}},{is:()=>false},h.doc);
 assert.equal(h.timers,1);h.tick();assert.equal(reads,1,'in-flight reads coalesce');ui.close();const closed=h.writes;
 resolve({count:3,groups:[]});await turn();assert.equal(h.writes,closed);assert.equal(h.cleared,1);
});

test('native browser navigation never presents another OS conversation instance',async t=>{
 const {setupBrowser}=await load(),h=harness(t);let notify;
 const ui=setupBrowser({browserUser:async()=>({}),browserSurface:async()=>({}),browserStatus:async()=>({groups:[]}),onBrowserChanged:fn=>{notify=fn;}},{is:()=>false},h.doc);
 try{
  notify({selected:'other',count:5,groups:[{id:'other',owner:'os-other',profile:'default',count:4},{id:'native',owner:'program/browser',profile:'default',count:1}]});
  const rows=h.nodes.get('browser-groups').children;assert.equal(rows.length,1);assert.equal(rows[0].dataset.group,'native');assert.equal(h.nodes.get('browser-bubble').title,'浏览器 · 1 个标签');
 }finally{ui.close();}
});

test('the browser shows only the explicitly authorized artifact and regular browser groups',async t=>{
 const {setupBrowser}=await load(),h=harness(t);let notify;
 const ui=setupBrowser({browserUser:async()=>({}),browserSurface:async()=>({}),browserStatus:async()=>({groups:[]}),onBrowserChanged:fn=>{notify=fn;}},{is:()=>false},h.doc);
 try{
  const artifact={id:'artifact',owner:'task-a',profile:'artifact-example',count:1};
  const other={id:'other',owner:'task-b',profile:'artifact-other',count:2};
  notify({selected:'artifact',artifact_group_id:'artifact',groups:[artifact,other]});
  assert.equal(h.nodes.get('browser-empty').hidden,true);
  assert.deepEqual(h.nodes.get('browser-groups').children.map(node=>node.dataset.group),['artifact']);
  notify({selected:'other',groups:[other]});
 assert.equal(h.nodes.get('browser-empty').hidden,true);
  assert.deepEqual(h.nodes.get('browser-groups').children,[]);
 }finally{ui.close();}
});

test('entering an empty browser opens the default instance once',async t=>{
 const {setupBrowser}=await load(),h=harness(t),opened=[];
 let visible=false,state={groups:[]};
 globalThis.getComputedStyle=()=>({getPropertyValue:()=>'',fontFamily:'system-ui',fontSize:'14px'});
 t.after(()=>delete globalThis.getComputedStyle);
 h.doc.getElementById('browser-surface').getBoundingClientRect=()=>({x:0,y:0,width:640,height:480});
 const ui=setupBrowser({
  browserStatus:async()=>state,browserSurface:async()=>({}),onBrowserChanged:()=>{},
  browserUser:async request=>{
   opened.push(request.action);
   state={selected:'native',groups:[{id:'native',owner:'program/browser',profile:'default',count:1}]};
   return state;
  },
 },{is:()=>visible,open:()=>{visible=true;}},h.doc);
 try{
  await turn();
  assert.deepEqual(opened,[]);
  h.nodes.get('browser-bubble').onclick();
  h.doc.dispatchEvent(new Event('workspace-view-change'));
  await turn();
  h.doc.dispatchEvent(new Event('workspace-view-change'));
  assert.deepEqual(opened,['open']);
  assert.equal(h.nodes.get('browser-empty').hidden,true);
 }finally{ui.close();}
});
