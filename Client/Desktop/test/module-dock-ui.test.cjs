// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: load; classList; fakeTab; fakeDoc; pointer
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/module-dock-ui.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const load=()=>import(pathToFileURL(path.join(__dirname,'../ui/module-dock.mjs')).href);

function classList(){const set=new Set();return {add:(...v)=>v.forEach(x=>set.add(x)),remove:(...v)=>v.forEach(x=>set.delete(x)),toggle:(v,on)=>on?set.add(v):set.delete(v),contains:v=>set.has(v)};}
function fakeTab(){const tab=new EventTarget();Object.assign(tab,{dataset:{},hidden:false,attributes:{},classList:classList(),setAttribute(k,v){this.attributes[k]=v;},getBoundingClientRect:()=>({left:100,top:10,width:80,height:30,bottom:40}),setPointerCapture(){},releasePointerCapture(){},focus(){}});return tab;}
function fakeDoc(){const doc=new EventTarget();doc.defaultView={innerWidth:1000,innerHeight:700,screenX:50,screenY:60};doc.body={classList:classList(),append(){}};doc.createElement=()=>{const n=new EventTarget();Object.assign(n,{style:{},setAttribute(){},append(){},remove(){},focus(){},contains:()=>false});return n;};return doc;}
function pointer(type,x,y,extra={}){const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,screenX:x+50,screenY:y+60},extra);return e;}

test('movement starts dragging immediately; detached entries disappear and docking restores them',async()=>{
 const {setupModuleDock}=await load(),doc=fakeDoc(),tabs={link:fakeTab(),settings:fakeTab()},calls=[];let listener,menu;
 doc.body.append=n=>{menu=n;};doc.createElement=()=>{const n=new EventTarget();Object.assign(n,{style:{},children:[],setAttribute(){},append(child){this.children.push(child);},remove(){},focus(){},contains:()=>false});return n;};
 const api={moduleState:async()=>({modules:{link:{detached:false}}}),extensionState:async()=>({windows:[{key:'settings',placement:'detached'}]}),onModuleState:fn=>{listener=fn;},moduleDetach:async()=>({}),moduleAction:async p=>{calls.push(p);return {modules:{link:{detached:true}}};}};
 let page='link',home=0;const dock=setupModuleDock(api,{tabs,current:()=>page,goHome:()=>{home++;page='';}},doc);await new Promise(r=>setImmediate(r));
 assert.equal(tabs.settings.hidden,true);
 for(const [type,x,y]of [['pointerdown',120,20],['pointermove',500,750],['pointerup',500,760]])tabs.link.dispatchEvent(pointer(type,x,y));
 await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);const click=new Event('click',{cancelable:true});tabs.link.dispatchEvent(click);assert.equal(click.defaultPrevented,true);
 listener({modules:{link:{detached:false}}});
 tabs.link.dispatchEvent(pointer('contextmenu',120,20));await menu.children[0].onclick();await new Promise(r=>setImmediate(r));
 assert.equal(calls.length,2);assert.equal(calls[0].module,'link');assert.equal(tabs.link.hidden,true);assert.equal(home,1);
 assert.match(tabs.link.attributes['aria-description'],/独立窗口/);
 listener({modules:{link:{detached:false}}});assert.equal(tabs.link.hidden,false);assert.equal(tabs.settings.hidden,true);dock.close();
});

test('an already detached or failed Link retains a visible OS shortcut while settings keep their placement',async()=>{
 const {setupModuleDock}=await load(),doc=fakeDoc(),tabs={link:fakeTab(),settings:fakeTab()};let listener;
 const api={moduleState:async()=>({modules:{link:{detached:true,error:'启动未确认'}}}),moduleDetach:async()=>({}),onModuleState:fn=>{listener=fn;},extensionState:async()=>({windows:[{key:'settings',placement:'detached'}]})};
 const dock=setupModuleDock(api,{tabs},doc);await new Promise(r=>setImmediate(r));
 assert.equal(tabs.link.hidden,false);assert.equal(tabs.link.dataset.moduleState,'detached');assert.equal(tabs.settings.hidden,true);
 listener({modules:{link:{detached:false}}});
 assert.equal(tabs.link.hidden,false);assert.match(tabs.link.attributes['aria-description'],/菜单/);
 dock.close();
});

test('missing host support leaves tabs untouched',async()=>{
 const {setupModuleDock}=await load();const tab=fakeTab();
 setupModuleDock({},{tabs:{link:tab}},fakeDoc());
 assert.equal(tab.dataset.moduleState,undefined);
});

test('home captures a press for click continuity, releases on cancel and close, and never arms a drag',async()=>{
 const {setupModuleGestures}=await import(pathToFileURL(path.join(__dirname,'../ui/module-gestures.mjs')).href);
 const doc=fakeDoc(),tab=fakeTab(),captured=new Set();tab.setPointerCapture=id=>captured.add(id);tab.releasePointerCapture=id=>captured.delete(id);
 const g=setupModuleGestures({entries:[['home',tab]],detach:()=>assert.fail('home detached'),save:()=>assert.fail('home reordered'),doc,delay:1});
 tab.dispatchEvent(pointer('pointerdown',120,20));assert.equal(captured.has(1),true);await new Promise(r=>setTimeout(r,8));assert.equal(tab.classList.contains('module-dragging'),false);
 tab.dispatchEvent(pointer('pointerup',120,20));assert.equal(captured.size,0);const click=new Event('click',{cancelable:true});tab.dispatchEvent(click);assert.equal(click.defaultPrevented,false);
 tab.dispatchEvent(pointer('pointerdown',120,20));tab.dispatchEvent(pointer('pointercancel',120,20));assert.equal(captured.size,0);
 tab.dispatchEvent(pointer('pointerdown',120,20));g.close();assert.equal(captured.size,0);tab.dispatchEvent(pointer('pointerdown',120,20));assert.equal(captured.size,0);
});

test('releasing inside the dock during a reorder animation does not detach the dragged tab',async()=>{
 const {setupModuleGestures}=await import(pathToFileURL(path.join(__dirname,'../ui/module-gestures.mjs')).href);
 const doc=fakeDoc(),ids=['home','browser','contacts','settings','link'],tabs=new Map(ids.map(id=>[id,fakeTab()])),saved=[],detached=[];let frame;
 doc.defaultView.requestAnimationFrame=fn=>{frame=fn;return 1;};doc.defaultView.cancelAnimationFrame=()=>{frame=null;};
 doc.defaultView.getComputedStyle=host=>({transform:`matrix(1, 0, 0, 1, ${host.shift}, 0)`});
 doc.defaultView.DOMMatrixReadOnly=class{constructor(value){this.m41=Number(value.slice(7,-1).split(',')[4]);this.m42=0;}};
 for(const [id,tab]of tabs){
  tab.style={setProperty(){}};tab.shift=0;tab.width=id==='browser'?84:36;
  tab.getBoundingClientRect=()=>{const sorted=[...tabs.values()].sort((a,b)=>Number(a.style.order)-Number(b.style.order));const left=50+sorted.slice(0,sorted.indexOf(tab)).reduce((n,t)=>n+t.width+8,0)+tab.shift;return {left,right:left+tab.width,top:10,bottom:46,width:tab.width,height:36};};
  tab.animate=keyframes=>{tab.shift=parseFloat(keyframes[0].transform.slice(11))/2;return {cancel(){tab.shift=0;}};};
 }
 const gestures=setupModuleGestures({entries:[...tabs],detach:id=>detached.push(id),save:async order=>{saved.push(order);return {order};},doc});
 const browser=tabs.get('browser'),end=tabs.get('link').getBoundingClientRect().right+12;
 browser.dispatchEvent(pointer('pointerdown',110,28));browser.dispatchEvent(pointer('pointermove',end,28));frame();
 assert.ok(Math.max(...[...tabs.values()].map(t=>t.getBoundingClientRect().right))+48<end,'the animated visual bounds temporarily shrink past the release point');
 browser.dispatchEvent(pointer('pointerup',end,28));await new Promise(r=>setImmediate(r));
 assert.deepEqual(detached,[],'visual interpolation must not turn a docked release into detach');
 assert.deepEqual(saved,[['home','contacts','settings','link','browser']]);gestures.close();
});

test('clicking and cancelling navigation never erase a shared preview label',async()=>{
 const {setupModuleGestures}=await import('../ui/module-gestures.mjs'),doc=fakeDoc(),tab=fakeTab();
 let writes=0;Object.defineProperty(tab,'title',{get:()=>'',set(){writes++;}});tab.dataset.tip='浏览器 · 3 个标签';
 const g=setupModuleGestures({entries:[['browser',tab]],detach(){},save(){},doc});
 for(const end of ['pointerup','pointercancel']){tab.dispatchEvent(pointer('pointerdown',120,20));tab.dataset.tip='浏览器 · 4 个标签';tab.dispatchEvent(pointer(end,120,20));}
 assert.equal(writes,0);assert.equal(tab.dataset.tip,'浏览器 · 4 个标签');g.close();
});
test('drag feedback and cancellation preserve the common tooltip instead of an absorbed title',async()=>{
 const {setupModuleGestures}=await import('../ui/module-gestures.mjs'),doc=fakeDoc(),tab=fakeTab();let frame;
 tab.title='';tab.dataset.tip='浏览器 · 2 个标签';doc.defaultView.requestAnimationFrame=fn=>{frame=fn;return 1;};doc.defaultView.cancelAnimationFrame=()=>{};
 const g=setupModuleGestures({entries:[['browser',tab]],detach(){},save(){},doc});
 tab.dispatchEvent(pointer('pointerdown',120,20));tab.dispatchEvent(pointer('pointermove',400,200));frame();
 assert.match(tab.dataset.tip,/松开以独立打开/);tab.dispatchEvent(pointer('pointercancel',400,200));
 assert.equal(tab.dataset.tip,'浏览器 · 2 个标签');assert.equal(tab.title,'');g.close();
});
