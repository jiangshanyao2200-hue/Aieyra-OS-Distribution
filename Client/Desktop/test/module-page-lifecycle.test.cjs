// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: tick; deferred; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/module-page-lifecycle.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function fixture(t){
 const listeners=new Map(),frames=new Map(),requests=[],nodes=new Map();let serial=0;
 const prior={ResizeObserver:global.ResizeObserver,requestAnimationFrame:global.requestAnimationFrame,cancelAnimationFrame:global.cancelAnimationFrame};
 global.ResizeObserver=class{observe(){}disconnect(){}};
 global.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};global.cancelAnimationFrame=id=>frames.delete(id);
 t.after(()=>{for(const [key,value]of Object.entries(prior)){if(value===undefined)delete global[key];else global[key]=value;}});
 const node=()=>({dataset:{},classList:{add(){}},append(n){nodes.set(n.id,n);},setAttribute(){},addEventListener(){},getBoundingClientRect:()=>({x:16,y:56,width:900,height:600})});
 for(const id of ['screen','view-surface','view-content','view-title','home-button','settings-view'])nodes.set(id,node());
 const doc={body:node(),defaultView:{MutationObserver:class{observe(){}disconnect(){}},addEventListener(){},CustomEvent},createElement:node,getElementById:id=>nodes.get(id),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(k,f){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(f);},removeEventListener(k,f){listeners.get(k)?.delete(f);},dispatchEvent(e){for(const f of listeners.get(e.type)||[])f(e);}};
 const {setupNavigation}=await import('../ui/navigation.mjs'),navigation=setupNavigation(doc);
 const navigate=value=>value?navigation.open(value,value):navigation.home();
 const opened=deferred();const api={extensionOpen:()=>opened.promise,extensionSurface:p=>{const d=deferred();requests.push({p,d});return d.promise;}};
 return {doc,navigation,api,opened,requests,navigate,frame(){for(const [id,fn]of frames){frames.delete(id);fn();}}};
}
test('a late native show is followed by the latest hide, including close',async t=>{
 const {setupModulePage}=await import('../ui/module-page.mjs'),f=await fixture(t),page=setupModulePage(f.api,f.navigation,{key:'notes',title:'便签',doc:f.doc});
 const open=page.open();f.requests[0].d.resolve({ok:true});await tick();f.requests.length=0;f.opened.resolve({placement:'attached'});await open;
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].p.visible,true);
 f.navigate('');assert.equal(f.requests.length,1,'do not race hide against an in-flight show');
 f.requests[0].d.resolve({ok:true});await tick();assert.equal(f.requests.length,2);assert.equal(f.requests[1].p.visible,false);
 f.requests[1].d.resolve({ok:true});await tick();page.close();assert.equal(f.requests.at(-1).p.visible,false);f.requests.at(-1).d.resolve({ok:true});await tick();
});
test('a delayed open cannot return from another page to the old module',async t=>{
 const {setupModulePage}=await import('../ui/module-page.mjs'),f=await fixture(t),page=setupModulePage(f.api,f.navigation,{key:'notes',title:'便签',doc:f.doc});
 const open=page.open();f.navigate('settings-view');f.opened.resolve({placement:'attached'});await open;
 assert.equal(f.navigation.is('settings-view'),true);assert.ok(f.requests.every(r=>r.p.visible===false));
 page.close();for(let i=0;i<f.requests.length;i++){f.requests[i].d.resolve({ok:true});await tick();}
});
test('returning to Home while already there cancels a native page still opening',async t=>{
 const {setupModulePage}=await import('../ui/module-page.mjs'),f=await fixture(t),page=setupModulePage(f.api,f.navigation,{key:'notes',title:'便签',doc:f.doc});
 const open=page.open();f.navigation.resume();f.opened.resolve({placement:'attached'});await open;f.frame();
 assert.equal(f.navigation.current,'');assert.ok(f.requests.every(r=>r.p.visible===false));
 page.close();for(let i=0;i<f.requests.length;i++){f.requests[i].d.resolve({ok:true});await tick();}
});
test('selecting the same current page cancels an in-flight native open',async t=>{
 const {setupModulePage}=await import('../ui/module-page.mjs'),f=await fixture(t),page=setupModulePage(f.api,f.navigation,{key:'notes',title:'便签',doc:f.doc});
 f.navigate('settings-view');const open=page.open();f.navigate('settings-view');f.opened.resolve({placement:'attached'});await open;
 assert.equal(f.navigation.current,'settings-view');assert.ok(f.requests.every(r=>r.p.visible===false));
 page.close();for(let i=0;i<f.requests.length;i++){f.requests[i].d.resolve({ok:true});await tick();}
});
test('the most recently requested native page wins when opens resolve out of order',async t=>{
 const {setupModulePage}=await import('../ui/module-page.mjs'),f=await fixture(t),second=deferred();
 const notes=setupModulePage(f.api,f.navigation,{key:'notes',title:'便签',doc:f.doc}),contacts=setupModulePage({...f.api,extensionOpen:()=>second.promise},f.navigation,{key:'contacts',title:'联系人',doc:f.doc});
 const a=notes.open(),b=contacts.open();f.opened.resolve({placement:'attached'});await a;
 assert.equal(f.navigation.current,'','older request must not activate while the newer page is loading');
 second.resolve({placement:'attached'});await b;assert.equal(f.navigation.current,'contacts-module-view');
 notes.close();contacts.close();for(let i=0;i<f.requests.length;i++){f.requests[i].d.resolve({ok:true});await tick();}
});
