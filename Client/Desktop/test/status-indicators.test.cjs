// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/status-indicators.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
function fixture(){
 const doc=new EventTarget(),win=new EventTarget(),media=new EventTarget(),timers=new Map(),frames=new Map(),nodes=new Map(),observers=[],reads={style:0,layout:0,measure:0},font={size:'14px',glyph:6};let next=0;
 doc.createElement=()=>({style:{},setAttribute(){},remove(){},getBoundingClientRect(){reads.measure++;return {width:Math.max(...this.textContent.split('\n').map(t=>t.length*font.glyph))};}});
 doc.createElementNS=()=>({setAttribute(){}});
 doc.hidden=false;doc.fonts=new EventTarget();doc.defaultView=win;win.innerWidth=1400;media.matches=false;win.matchMedia=()=>media;win.setTimeout=fn=>{timers.set(++next,fn);return next;};win.clearTimeout=id=>timers.delete(id);win.queueMicrotask=queueMicrotask;
 win.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};win.cancelAnimationFrame=id=>frames.delete(id);
 win.getComputedStyle=n=>{reads.style++;return {display:'flex',fontFamily:'Test',fontSize:font.size,columnGap:'8',paddingLeft:'12',paddingRight:'12',getPropertyValue:()=>'.24s'};};
 win.ResizeObserver=class{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 const node=(id,width=32)=>{const n=Object.assign(new EventTarget(),{id,ownerDocument:doc,style:{setProperty(k,v){this[k]=v;}},dataset:{},children:[],append(){},attrs:{},classList:{contains:()=>false},clientWidth:width,getBoundingClientRect:()=>{reads.layout++;return {width};},setAttribute(k,v){this.attrs[k]=v;},checkVisibility:()=>true,contains:n=>n===doc.activeElement&&n===root,matches:()=>false});nodes.set(id,n);return n;};
 doc.body=node('body');const root=node('session-indicators'),bar=node('bar',1400),dock=node('desktop-dock',1000);dock.children=Array.from({length:8},(_,i)=>node('dock'+i,36));root.parentElement=bar;bar.children=[dock,root,node('controls',120)];
 for(const id of ['usage-anchor','model-display','usage-total','usage-current','model-name','input-count','output-count','cache-count','compression-count'])node(id);
 nodes.get('model-display').parentElement=node('model-slot');doc.getElementById=id=>nodes.get(id);
 nodes.get('model-display').querySelector=()=>({append(){}});
 return {doc,win,media,timers,frames,nodes,root,bar,observers,reads,font,flushFrame(){const pending=[...frames];frames.clear();for(const [,fn]of pending)fn();},tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}};
}
test('status rotation has one clock, survives usage updates and pauses for reading, hidden and reduced motion',async()=>{
 const {setupStatusIndicators}=await import('../ui/session-status.mjs'),{usageSummary}=await import('../ui/status.mjs'),{setupMotion}=await import('../ui/motion.mjs'),f=fixture();
 const c=setupStatusIndicators(f.doc),data={scope:'one',model:'Test',usage:usageSummary([])};
 try{c.update(data);f.flushFrame();assert.equal(f.timers.size,1);const first=[...f.timers.keys()][0];c.update(data);assert.equal([...f.timers.keys()][0],first,'data refresh cannot postpone rotation');
 assert.equal(f.nodes.get('model-display').dataset.wide,'true','dock flex allocation does not hide available space');f.tick();assert.equal(f.nodes.get('usage-current').dataset.metric,'output');assert.equal(f.nodes.get('model-display').dataset.expanded,'true');
 f.root.dispatchEvent(new Event('pointerenter'));assert.equal(f.timers.size,0);f.root.dispatchEvent(new Event('pointerleave'));assert.equal(f.timers.size,1);
 f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.timers.size,0);f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));f.flushFrame();assert.equal(f.timers.size,1);
 f.media.matches=true;f.media.dispatchEvent(new Event('change'));assert.equal(f.timers.size,0);assert.equal(f.nodes.get('model-display').dataset.expanded,'true');
 c.update({...data,scope:'two'});assert.equal(f.nodes.get('usage-current').dataset.metric,'input');f.win.innerWidth=f.bar.clientWidth=640;f.win.dispatchEvent(new Event('resize'));f.flushFrame();assert.equal(f.root.dataset.compact,'true');assert.equal(f.nodes.get('model-display').dataset.expanded,'false');assert.equal(f.nodes.get('usage-anchor').dataset.tip,'累计　0.00M\n输入　0.00M\n输出　0.00M\n缓存命中　未报告\n上下文　—');
 }finally{c.close();setupMotion(f.doc).close();}assert.equal(f.timers.size,0);
});

test('identical streaming indicators avoid layout while precise usage and state changes stay live',async()=>{
 const {setupStatusIndicators}=await import('../ui/session-status.mjs'),{usageSummary}=await import('../ui/status.mjs'),{setupMotion}=await import('../ui/motion.mjs'),f=fixture();
 const c=setupStatusIndicators(f.doc),usage=usageSummary([]),data={scope:'one',model:'Test',title:'Eyra',active:true,usage};
 try{
  c.update(data);assert.deepEqual(f.reads,{style:0,layout:0,measure:0},'new metrics publish without reading layout in the snapshot task');f.flushFrame();const initial={...f.reads},clock=[...f.timers.keys()][0],width=f.root.style['--usage-width'];
  for(let i=0;i<30;i++)c.update({...data,usage:{...usage,unshown:i}});
  assert.deepEqual(f.reads,initial,'unchanged stream snapshots cannot remeasure the titlebar');assert.equal([...f.timers.keys()][0],clock);
  usage.input=1;c.update(data);
  assert.match(f.nodes.get('usage-anchor').dataset.tip,/输入　0\.000001M/,'the precise tooltip updates even when the compact value is unchanged');assert.deepEqual(f.reads,initial,'precise data updates do not force a synchronous layout');f.flushFrame();assert(f.reads.layout>initial.layout);assert.equal(f.root.style['--usage-width'],width);assert.equal([...f.timers.keys()][0],clock);
  c.update({...data,title:'Cota',active:false});assert.match(f.nodes.get('usage-anchor').attrs['aria-label'],/^Cota ·/);assert.equal(f.nodes.get('model-display').dataset.active,'false');
  c.update({...data,unconfigured:true});assert.equal(f.nodes.get('usage-anchor').disabled,true);assert.equal(f.nodes.get('model-name').textContent,'选择模型');assert.equal(f.timers.size,0);
  c.update({...data,model:'Other'});assert.equal(f.nodes.get('model-name').textContent,'Other');assert.equal(f.nodes.get('usage-anchor').disabled,false);assert.equal(f.frames.size,1,'changed metrics share one pending layout');f.flushFrame();assert.equal(f.timers.size,1);
 }finally{c.close();setupMotion(f.doc).close();}
});

test('font completion, theme and real container changes invalidate identical data and close releases them',async()=>{
 const {setupStatusIndicators}=await import('../ui/session-status.mjs'),{usageSummary}=await import('../ui/status.mjs'),{setupMotion}=await import('../ui/motion.mjs'),f=fixture();
 const c=setupStatusIndicators(f.doc),data={scope:'one',model:'Test',usage:usageSummary([])};
 try{
  c.update(data);f.flushFrame();const width=f.root.style['--model-width'],measured=f.reads.measure;
  f.font.glyph=10;f.doc.fonts.dispatchEvent(new Event('loadingdone'));f.flushFrame();
  assert.notEqual(f.root.style['--model-width'],width,'a newly loaded face must remeasure even when computed font strings match');assert(f.reads.measure>measured);
  const loaded=f.root.style['--model-width'];f.font.size='20px';f.font.glyph=12;f.doc.dispatchEvent(new Event('workspace-theme-change'));f.flushFrame();
  assert.notEqual(f.root.style['--model-width'],loaded);
  f.bar.clientWidth=400;f.observers[0].callback([]);f.flushFrame();assert.equal(f.root.dataset.compact,'true','container resizing does not require new usage data');
  f.win.innerWidth=f.bar.clientWidth=640;f.win.dispatchEvent(new Event('resize'));f.flushFrame();assert.equal(f.nodes.get('model-display').dataset.wide,'false');
  f.font.glyph=9;f.doc.fonts.dispatchEvent(new Event('loadingdone'));assert.equal(f.frames.size,1);const late=[...f.frames.values()][0];
  c.close();const closed={...f.reads};assert.equal(f.observers[0].disconnected,true);assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);late();
  for(const event of ['workspace-theme-change','visibilitychange'])f.doc.dispatchEvent(new Event(event));
  f.doc.fonts.dispatchEvent(new Event('loadingdone'));f.win.dispatchEvent(new Event('resize'));f.observers[0].callback([]);c.update(data);
  assert.deepEqual(f.reads,closed,'closed indicators cannot measure or restart from late data and resize callbacks');assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);
 }finally{c.close();setupMotion(f.doc).close();}
});

test('hidden status cancels a pending fit and resumes with only the latest scope and typography',async()=>{
 const {setupStatusIndicators}=await import('../ui/session-status.mjs'),{usageSummary}=await import('../ui/status.mjs'),{setupMotion}=await import('../ui/motion.mjs'),f=fixture();
 const c=setupStatusIndicators(f.doc),data={scope:'one',model:'First',usage:usageSummary([])};
 try{
  c.update(data);assert.equal(f.frames.size,1);
  f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
  c.update({...data,scope:'two',model:'Latest'});f.font.glyph=9;f.doc.fonts.dispatchEvent(new Event('loadingdone'));f.observers[0].callback([]);
  assert.equal(f.nodes.get('model-name').textContent,'Latest','hidden data retains the new scope without waiting for a render');assert.equal(f.frames.size,0);assert.deepEqual(f.reads,{style:0,layout:0,measure:0});
  f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));f.win.dispatchEvent(new Event('resize'));assert.equal(f.frames.size,1);f.flushFrame();
  assert.equal(f.root.style['--model-width'],'106px','the resumed width belongs to the latest model and loaded face');assert.equal(f.timers.size,1);
 }finally{c.close();setupMotion(f.doc).close();}
 assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
