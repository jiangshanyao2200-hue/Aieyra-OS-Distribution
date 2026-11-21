// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/contacts-measure.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

// Exercise the actual sidebar closure without starting the contact editor or
// Core polling. Native placement and animation remain the GUI scene's job.
function fixture(){
 let reads=0,writes=0,next=0,resize;const frames=new Map(),timers=new Map(),moves=[];
 const style=()=>{const values=new Map();return {getPropertyValue:key=>values.get(key)||'',setProperty(key,value){values.set(key,value);writes++;}};};
 const body={style:style(),classList:{toggle(){}}},dock=Object.assign(new EventTarget(),{style:style(),width:800,getBoundingClientRect(){reads++;return {left:16};}});
 Object.defineProperty(dock,'clientWidth',{get(){reads++;return this.width;}});
 const button=()=>({style:style(),margin:0,hidden:false,inert:false,setAttribute(){},get offsetHeight(){reads++;return 36;},getBoundingClientRect(){reads++;return {width:36};}}),menuButton=button(),home=button(),apps=button(),newButton=button();
 const win=Object.assign(new EventTarget(),{innerWidth:1280,Event,requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{constructor(fn){resize=fn;}observe(){}},getComputedStyle(node){reads++;return {columnGap:'8px',paddingLeft:'0',paddingRight:'0',marginLeft:'0',marginRight:node.margin+'px'};}});
 const doc=Object.assign(new EventTarget(),{fonts:new EventTarget(),getElementById:id=>id==='dock-home'?home:id==='dock-apps'?apps:null}),slide={x:0,to(x,options){moves.push({x,options});}};
 const context={body,dock,menuButton,win,doc,slide,newButton,drawer:{hidden:true},positionPicker(){},closePicker(){},bio:{hide(){}},previews:{hide(){}},paintDrawer(){},store:{refresh:async()=>{}},localStorage:{setItem(){}},motionAllowed:()=>false,motionDuration:()=>0,setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)};
 const source=fs.readFileSync(path.join(__dirname,'../ui/contacts.mjs'),'utf8'),start=source.indexOf(' let isOpen=false,painted='),end=source.indexOf(" doc.addEventListener('keydown'",start);
 assert(start>=0&&end>start);vm.runInNewContext(source.slice(start,end)+'\nglobalThis.controls={measure,setDrawer,scheduleMeasure};',context);
 return {...context,frames,timers,moves,home,apps,get reads(){return reads;},get writes(){return writes;},get controls(){return context.controls;},observe(width=dock.width,height=36){resize([{target:dock,contentRect:{width,height}}]);},frame(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}};
}

test('closed sidebar skips button geometry and unchanged ResizeObserver boxes do no work',()=>{
 const f=fixture();f.controls.measure();const writes=f.writes;
 for(let i=0;i<500;i++)f.controls.measure();for(let i=0;i<500;i++)f.observe();assert.equal(f.frames.size,1);f.frame();assert.equal(f.reads,0);assert.equal(f.writes,writes);
 for(let i=0;i<500;i++)f.observe();assert.equal(f.frames.size,0);assert.equal(f.body.style.getPropertyValue('--sd-width'),'307px');
});

test('open sidebar batches layout and CSS writes, preserves narrow travel and keeps its closing reserve',()=>{
 const f=fixture();f.observe();f.controls.setDrawer(true);assert.equal(f.frames.size,0,'explicit opening consumes any queued measurement');
 const reads=f.reads,writes=f.writes;f.controls.measure();assert.equal(f.writes,writes,'same layout must not rewrite inherited CSS or dock reserve');
 const measured=f.reads;for(let i=0;i<500;i++)f.observe();assert.equal(f.frames.size,0);assert.equal(f.reads,measured);assert(measured>reads);
 f.win.innerWidth=800;f.dock.width=260;f.observe(270);f.observe(260);assert.equal(f.frames.size,1);f.frame();
 assert.equal(f.body.style.getPropertyValue('--sd-width'),'232px');assert.equal(f.dock.style.getPropertyValue('--workspace-menu-reserve'),'136px');
 f.apps.margin=60;f.doc.dispatchEvent(new Event('workspace-theme-change'));f.doc.fonts.dispatchEvent(new Event('loadingdone'));assert.equal(f.frames.size,1);f.frame();assert.equal(f.dock.style.getPropertyValue('--workspace-menu-reserve'),'76px','theme/font changes recompute available room even if dock size is unchanged');
 f.slide.x=232;f.controls.setDrawer(false);assert.equal(f.dock.style.getPropertyValue('--workspace-menu-reserve'),'76px','closing retains navigation room until the motion settles');assert.equal(f.moves.at(-1).x,0);
 for(const fn of f.timers.values())fn();assert.equal(f.dock.style.getPropertyValue('--workspace-menu-reserve'),'0px');assert.equal(f.drawer.hidden,true);
});
