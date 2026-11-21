// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; tickerURL; fixture; row; pair
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/ticker.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tickerURL='../ui/ticker.mjs';
function fixture(){
 const timers=new Map(),animations=[],observers=[];let sequence=0,now=0;
 const doc=new EventTarget(),win=new EventTarget(),media=new EventTarget();media.matches=false;doc.hidden=false;
 class Node{
  constructor(){this.ownerDocument=doc;this.dataset={};this.style={};this.children=[];this.attrs={};this.width=160;const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x)};}
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
  get textContent(){return this.value||this.children.map(n=>n.textContent).join('');}set textContent(v){this.value=String(v);}
  get clientWidth(){return this.width;}get scrollWidth(){return Math.max(this.width,this.textContent.length*7+20);}
  querySelector(s){return this.children.find(n=>('.'+n.className)===s)||this.children.map(n=>n.querySelector(s)).find(Boolean)||null;}
  getBoundingClientRect(){return {width:this.width};}checkVisibility(){return !this.hidden;}
  animate(frames,options){let resolve,reject;const a={frames,options,currentTime:0,playState:'running',cancelled:false,finished:new Promise((ok,no)=>{resolve=ok;reject=no;}),cancel(){this.cancelled=true;this.playState='idle';reject(Error('cancelled'));},finish(){this.currentTime=this.options.duration;this.playState='finished';resolve();}};animations.push(a);return a;}
 }
 doc.body=new Node();doc.createElement=()=>new Node();doc.defaultView=win;
 win.matchMedia=()=>media;win.getComputedStyle=()=>({getPropertyValue:()=>'.24s'});
 win.ResizeObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 win.setTimeout=(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:now+ms});return id;};win.clearTimeout=id=>timers.delete(id);
 const root=new Node();
 const move=delta=>{for(const a of animations)if(a.playState==='running')a.currentTime+=delta;now+=delta;};
 const advance=ms=>{const until=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;move(next[1].at-now);timers.delete(next[0]);next[1].fn();}move(until-now);};
 const scroll=()=>animations.filter(a=>!a.cancelled&&a.frames[0]?.transform).at(-1);
 const offset=()=>{const a=scroll();if(!a)return Number(root.children[0]?.children.at(-1)?.style.transform?.match(/translateX\(([-\d.]+)px\)/)?.[1]||0);const x=frame=>Number(frame.transform.match(/translateX\(([-\d.]+)px?\)/)?.[1]||0);return x(a.frames[0])+(x(a.frames[1])-x(a.frames[0]))*Math.min(1,a.currentTime/a.options.duration);};
 return {doc,root,timers,animations,observers,advance,scroll,offset,media};
}
const row=n=>[{key:'matrix',text:'Eyra · fixture-model · In '+n+'.00M · Out 0.10M · Cache 76% · Ctx 88.88%'}];
test('frequent usage updates keep the current horizontal reading position',async()=>{
 const {createTicker}=await import(tickerURL),f=fixture(),ticker=createTicker(f.root);ticker.update(row(1));f.advance(300);f.advance(1000);
 const before=f.offset();assert.ok(before<-20,'fixture has begun reading the long line');
 ticker.update(row(2));f.advance(300);const after=f.offset();
 try{assert.ok(after<=before,'same role usage update must not jump back to the start: '+before+' -> '+after);assert.equal(f.root.title,row(2)[0].text);}finally{ticker.dispose();}
});

const pair=n=>[...row(n),{key:'execution',text:'Cota · current usage'}];
test('updates during the end pause cannot starve the next role',async()=>{
 const {createTicker}=await import(tickerURL),f=fixture(),ticker=createTicker(f.root);
 try{ticker.update(pair(1));f.advance(300);f.scroll().finish();await Promise.resolve();
  for(let n=2;n<10;n++){ticker.update(pair(n));f.advance(200);}
  assert.equal(f.root.title,'Cota · current usage','the completed line must yield despite fresh counters');
 }finally{ticker.dispose();}
});
test('resizing continues from the reading position and clamps a shorter line',async()=>{
 const {createTicker}=await import(tickerURL),f=fixture(),ticker=createTicker(f.root);
 try{ticker.update(row(1));f.advance(1300);const before=f.offset();
  f.root.children[0].width=200;f.observers[0].fn();assert.ok(f.offset()<=before);
  f.root.children[0].width=1000;f.observers[0].fn();assert.equal(f.offset(),0);assert.ok(f.timers.size>0);
 }finally{ticker.dispose();}
});
test('hiding releases motion and timers; resuming renders only latest data',async()=>{
 const {createTicker}=await import(tickerURL),f=fixture(),ticker=createTicker(f.root);
 ticker.update(row(1));f.advance(1300);f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));
 assert.equal(f.timers.size,0);assert.ok(f.animations.every(a=>a.cancelled));
 ticker.update(row(9));assert.equal(f.timers.size,0);
 f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.root.title,row(9)[0].text);
 f.advance(300);assert.ok(f.scroll());ticker.dispose();assert.equal(f.timers.size,0);assert.equal(f.root.children[0].children.length,0);assert.ok(f.observers[0].disconnected);
});
test('counter updates do not displace a pending urgent announcement',async()=>{
 const {createTicker}=await import(tickerURL),f=fixture(),ticker=createTicker(f.root,{min:0});
 try{ticker.update(row(1));f.advance(300);
  const alert={key:'alert-1',kind:'alert',text:'Work needs attention'};
  ticker.update([...row(2),alert]);ticker.update([...row(3),alert]);f.advance(1);
  assert.equal(f.root.title,alert.text);
 }finally{ticker.dispose();}
});
test('reduced motion still rotates changing short lines and updates tone',async()=>{
 const {createTicker}=await import(tickerURL),f=fixture(),ticker=createTicker(f.root);f.media.matches=true;
 try{ticker.update([{key:'one',text:'First'},{key:'two',text:'Second'}]);f.advance(300);
  for(let n=0;n<22;n++){ticker.update([{key:'one',text:'First '+n,tone:'warn'},{key:'two',text:'Second'}]);f.advance(200);}
  assert.equal(f.root.title,'Second');assert.equal(f.animations.length,0);
  ticker.update([{key:'two',text:'Second',tone:'warn',kind:'alert'}]);assert.equal(f.root.dataset.tone,'warn');
 }finally{ticker.dispose();}
});
