// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fakeWindow
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/esc-stop.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');

function fakeWindow(){
 const listeners={},docListeners={},timers=new Map();let now=0,nextTimer=1,observer=null;
 const classes=()=>{const set=new Set();return {add:v=>set.add(v),remove:v=>set.delete(v),contains:v=>set.has(v)};};
 const element=()=>{const text={textContent:''};return {hidden:false,dataset:{},style:{},classList:classes(),offsetWidth:1,setAttribute(){},set innerHTML(v){},querySelector:()=>text,remove(){},text};};
 const stop={hidden:false,disabled:false,clicks:0,click(){this.clicks++;}};
 const body={classList:classes(),appended:[],append(node){this.appended.push(node);}};
 const win={
  addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn);},removeEventListener(){},
  setTimeout:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
  performance:{now:()=>now},
  MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}},
 };
 const doc={defaultView:win,body,createElement:element,getElementById:id=>id==='stop'?stop:null,addEventListener:(type,fn)=>{(docListeners[type]??=[]).push(fn);},removeEventListener(){}};
 const advance=ms=>{now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}};
 const key=(init={})=>{const event={key:'Escape',repeat:false,isComposing:false,keyCode:27,defaultPrevented:false,stopped:false,...init,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};for(const fn of listeners.keydown||[])fn(event);return event;};
 return {win,doc,stop,body,advance,key,mutate:()=>observer?.(),fire:(type)=>{for(const fn of listeners[type]||[])fn();for(const fn of docListeners[type]||[])fn();}};
}

test('second Esc before the hint expires stops; the first one only hints and keeps its normal meaning',async()=>{
 const {bindEscStop}=await import('../ui/esc-stop.mjs'),w=fakeWindow();
 const esc=bindEscStop({doc:w.doc,stop:w.stop}),hint=esc.element;
 const first=w.key();
 assert.equal(first.defaultPrevented,false,'first Esc still folds input / goes back');
 assert.equal(hint.hidden,false);assert.equal(hint.dataset.state,'armed');assert.equal(hint.text.textContent,'再按一次 Esc 停止');assert.equal(w.stop.clicks,0);
 w.advance(2000);const second=w.key();
 assert.equal(w.stop.clicks,1);assert.equal(second.defaultPrevented,true);assert.equal(hint.dataset.state,'stopping');
});

test('hint expires after 2.5s and a late press starts over; repeat, IME, idle and blocked layers never stop',async()=>{
 const {bindEscStop}=await import('../ui/esc-stop.mjs'),w=fakeWindow();let block=false;
 const esc=bindEscStop({doc:w.doc,stop:w.stop,blocked:()=>block}),hint=esc.element;
 w.key();w.advance(2600);
 assert.equal(hint.dataset.state,'leaving');w.advance(300);assert.equal(hint.hidden,true);
 // 淡出过程中（还看得见）再按仍然停止。
 w.key();w.advance(2550);assert.equal(hint.dataset.state,'leaving');assert.equal(hint.hidden,false);w.key();assert.equal(w.stop.clicks,1,'second press during fade-out still stops');w.stop.clicks=0;w.advance(1000);
 w.key();assert.equal(w.stop.clicks,0,'late press only re-arms');
 const held=w.key({repeat:true});assert.equal(w.stop.clicks,0);assert.equal(held.defaultPrevented,true,'auto-repeat is swallowed while armed');
 w.key({isComposing:true});w.key({keyCode:229});assert.equal(w.stop.clicks,0);
 block=true;w.key();assert.equal(w.stop.clicks,0,'menus/dialogs keep their own Esc');
 block=false;w.stop.hidden=true;w.mutate();w.stop.hidden=false;w.key();assert.equal(w.stop.clicks,0,'task end clears the pending press');
});

test('a new turn, page change or window blur discard the pending press',async()=>{
 const {bindEscStop}=await import('../ui/esc-stop.mjs'),w=fakeWindow();let turn='t:1';
 bindEscStop({doc:w.doc,stop:w.stop,token:()=>turn});
 w.key();turn='t:2';w.key();assert.equal(w.stop.clicks,0);
 w.advance(500);w.fire('workspace-view-change');w.key();w.advance(500);w.fire('workspace-view-change');w.key();assert.equal(w.stop.clicks,0,'navigating away clears it');
 w.fire('blur');w.key();assert.equal(w.stop.clicks,0);
 w.key();assert.equal(w.stop.clicks,1);
});
