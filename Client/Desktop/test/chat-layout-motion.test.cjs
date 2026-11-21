// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/chat-layout-motion.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

test('sending after an upward gesture invalidates its queued scroll events and keeps following',async()=>{
 const {createChatReadingIntent}=await import('../ui/chat-reading.mjs');let time=10;
 const intent=createChatReadingIntent({now:()=>time});
 intent.input({type:'wheel',deltaY:-240});assert.equal(intent.following,false);
 time+=16;intent.reset();
 assert.equal(intent.scrolled(false),false,'old browser/layout scroll events are no longer reader input');
 assert.equal(intent.following,true);
 time+=16;assert.equal(intent.scrolled(false),false);assert.equal(intent.following,true);
 intent.input({type:'wheel',deltaY:-32});intent.scrolled(false);assert.equal(intent.following,false,'a new human gesture still pauses the new turn');
 intent.input({type:'wheel',deltaY:640});intent.scrolled(true);assert.equal(intent.following,true);
});

test('history restoration and nested readers keep independent following intent',async()=>{
 const {createChatReadingIntent}=await import('../ui/chat-reading.mjs');let time=0;
 const intent=createChatReadingIntent({now:()=>time});
 intent.reset(false);assert.equal(intent.following,false);assert.equal(intent.scrolled(true),false);
 for(const event of [{type:'wheel',deltaY:0,deltaX:500},{type:'keydown',key:'Enter'},{type:'wheel',deltaY:-400,target:{closest:()=>({})}}])assert.equal(intent.input(event),false);
 assert.equal(intent.following,false);
 intent.input({type:'keydown',key:'End'});intent.scrolled(true);assert.equal(intent.following,true);
 time=1000;assert.equal(intent.scrolled(false),false,'later layout growth must not change the reader intent');assert.equal(intent.following,true);
 intent.input({type:'keydown',key:'PageUp'});assert.equal(intent.following,false);
 intent.reset();assert.equal(intent.scrolled(false),false,'scope/native revision reset rejects old gesture windows too');assert.equal(intent.following,true);
});

for(const paused of [false,true])test('finished reply expansion rechecks natural scroll range; reader paused='+paused,async()=>{
 const {createChatLayoutMotion}=await import('../ui/chat-reading.mjs');let finish,next=0,following=true;const frames=new Map();
 const box=height=>({x:0,y:0,top:0,bottom:height,width:600,height});
 const doc={body:{dataset:{},classList:{contains:()=>false}},createElement:()=>({style:{},setAttribute(){},remove(){}}),defaultView:{performance:{now:()=>0},matchMedia:()=>({matches:false}),requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)}};
 const row={ownerDocument:doc,dataset:{id:'reply',response:'true'},classList:{contains:()=>false},querySelector:()=>null,getBoundingClientRect:()=>box(500),animate(){
  // The real row-height animation initially clips the finished reply, so its
  // final scroll range is unavailable to the first call to follow().
  root.scrollHeight=300;const finished=new Promise(resolve=>{finish=()=>{root.scrollHeight=750;resolve();};});return {finished,cancel(){}};
 }};
 const root={ownerDocument:doc,clientWidth:600,clientHeight:300,scrollHeight:750,scrollTop:0,append(){},querySelectorAll:()=>[row],getBoundingClientRect:()=>box(300),scrollTo({top}){this.scrollTop=top;}};
 const motion=createChatLayoutMotion(root,{live:()=>row,following:()=>following});
 try{
  motion.commit(new Map([['reply',{node:row,rect:box(100)}]]));assert.equal(root.scrollTop,0);
  if(paused)following=false;
  finish();await new Promise(resolve=>setImmediate(resolve));
  for(let at=16;frames.size&&at<4000;at+=16){const callbacks=[...frames.values()];frames.clear();for(const tick of callbacks)tick(at);}
  assert.equal(root.scrollTop,paused?0:450,paused?'finishing the animation must respect a new reading gesture':'the natural end is followed after its height has actually been revealed');
 }finally{motion.close();}
 assert.equal(frames.size,0);
});

test('footer refit measures before writing and scopes changing geometry to its actual consumers',async()=>{
 const {bindChatBottomRoom}=await import('../ui/chat-layout.mjs');const frames=[],events=[],values=new Map();let height=656,top=700,refit;
 const read=key=>events.push('read:'+key),style=owner=>({getPropertyValue:key=>values.get(owner+key)||'',setProperty(key,value){events.push('write:'+owner+key);values.set(owner+key,value);}});
 const body={dataset:{},style:style('body')},stage={style:style('stage')},emergence={style:style('emergence')};
 const anchor={parentElement:body,getAnimations:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect(){read('avatar');return {left:76,width:120};}};
 const scroller={style:style('scroller'),get clientHeight(){read('height');return height;},parentElement:{getBoundingClientRect(){read('parent');return {bottom:800};}},querySelector:()=>null,querySelectorAll:()=>[]};
 const bar={style:style('bar'),classList:{contains:()=>true},checkVisibility:()=>true,getBoundingClientRect(){read('footer');return {left:20,top,height:800-top};}};
 const win={requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},addEventListener(){},getComputedStyle(node){read('style');return node===scroller?{paddingTop:'20px',paddingBottom:'24px'}:{left:'20px'};},ResizeObserver:class{constructor(fn){refit=fn;}observe(){}unobserve(){}},MutationObserver:class{observe(){}}};
 const doc={body,defaultView:win,addEventListener(){},getElementById:id=>({conversation:scroller,'bottom-bar':bar,'eyra-trigger':anchor,stage,emergence}[id]||null)};
 const sample=()=>{events.length=0;frames.shift()();const first=events.findIndex(e=>e.startsWith('write:'));assert.ok(first>=0);assert.ok(events.slice(first).every(e=>e.startsWith('write:')),'a footer write must not force another style or geometry read in the same measurement');assert.ok(events.every(e=>!e.startsWith('write:body')));};
 bindChatBottomRoom(doc);sample();
 assert.equal(emergence.style.getPropertyValue('--chat-work-available-height'),'612px');assert.equal(scroller.style.getPropertyValue('--chat-bottom-inset'),'112px');assert.equal(stage.style.getPropertyValue('--chat-bottom-inset'),'112px');assert.equal(bar.style.getPropertyValue('--chat-input-left'),'76px');
 height=606;top=650;refit();sample();
 assert.equal(emergence.style.getPropertyValue('--chat-work-available-height'),'562px');assert.equal(scroller.style.getPropertyValue('--chat-bottom-inset'),'162px');assert.equal(bar.style.getPropertyValue('--chat-input-left'),'76px');
});

test('changing reduced motion preserves the current reading position; explicit reset and viewport refit may move back',async()=>{
 const {createChatLayoutMotion}=await import('../ui/chat-reading.mjs');let reduced=false,removed=false,next=0;const frames=new Map();
 const doc={hidden:false,body:{dataset:{},classList:{contains:()=>false}},createElement:()=>({style:{},setAttribute(){},remove(){removed=true;}}),defaultView:{matchMedia:()=>({matches:reduced}),requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)}};
 const root={ownerDocument:doc,clientWidth:608,clientHeight:656,scrollHeight:929,scrollTop:50.4,append(){},scrollTo({top,behavior}){assert.equal(behavior,'instant');this.scrollTop=top;}};
 const motion=createChatLayoutMotion(root);
 try{
  motion.follow();root.scrollTop=273;motion.follow();assert.equal(root.scrollTop,273);
  reduced=true;motion.follow();assert.equal(root.scrollTop,273,'a preference change cannot discard the already preserved reading position');
  motion.follow({snap:true});assert.equal(root.scrollTop,273,'an explicit reset still uses the natural content position');
  root.scrollTop=212;root.clientHeight=700;root.scrollHeight=950;motion.follow();assert.equal(root.scrollTop,250,'a changed viewport still refits to the content');
 }finally{motion.close();}
 assert.equal(removed,true);assert.equal(frames.size,0);
});

test('Halo relocation overflow never becomes a chat following target, including a queued scroll frame',async()=>{
 const {createChatLayoutMotion}=await import('../ui/chat-reading.mjs'),frames=new Map();let sequence=0,writes=0;
 const doc={body:{dataset:{},classList:{contains:()=>false}},createElement:()=>({style:{},setAttribute(){},remove(){}}),defaultView:{matchMedia:()=>({matches:false}),requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id)}};
 const root={ownerDocument:doc,clientWidth:800,clientHeight:660,scrollHeight:660,scrollTop:0,append(){},scrollTo({top}){writes++;this.scrollTop=top;}};
 const motion=createChatLayoutMotion(root);
 try{
  motion.follow({snap:true});assert.equal(root.scrollTop,0);
  root.scrollHeight=712;motion.follow();assert.equal(frames.size,1);
  doc.body.dataset.chatTransition='playing';const pending=[...frames.values()];frames.clear();for(const tick of pending)tick(10);
  const before=writes;motion.follow();motion.follow({snap:true});assert.equal(writes,before);assert.equal(root.scrollTop,0);assert.equal(frames.size,0);
  root.scrollHeight=660;doc.body.dataset.chatTransition='idle';motion.follow({snap:true});assert.equal(root.scrollTop,0);
  root.scrollHeight=760;motion.follow({snap:true});assert.equal(root.scrollTop,100,'real content still follows after the avatar settles');
 }finally{motion.close();}
 assert.equal(frames.size,0);
});

test('the newest submitted user row remains visible when no current assistant row exists yet',async()=>{
 const {createChatLayoutMotion}=await import('../ui/chat-reading.mjs'),animations=[],rect={x:0,y:0,top:0,bottom:100,width:600,height:100};
 const doc={body:{dataset:{},classList:{contains:()=>false}},createElement:()=>({style:{},setAttribute(){},remove(){}}),defaultView:{matchMedia:()=>({matches:false}),getComputedStyle:()=>({getPropertyValue:()=>''}),requestAnimationFrame:()=>1,cancelAnimationFrame(){}}};
 const node=()=>({ownerDocument:doc,dataset:{},getBoundingClientRect:()=>rect,animate(frames){const a={finished:Promise.resolve(),cancel(){}};animations.push({node:this,frames});return a;}}),header=node(),text=node(),row=node();
 row.dataset.id='pending-user';row.classList={contains:name=>name==='user'};row.querySelector=selector=>selector.includes('chat-name')?header:selector.includes('chat-text')?text:null;
 const root={ownerDocument:doc,clientWidth:600,clientHeight:300,scrollHeight:300,scrollTop:0,append(){},querySelectorAll:()=>[row],getBoundingClientRect:()=>rect,scrollTo({top}){this.scrollTop=top;}};
 const motion=createChatLayoutMotion(root,{live:()=>row});
 try{motion.commit(new Map(),{kind:'send'});assert.equal(animations.length,1);assert.equal(animations[0].node,row);assert(animations.every(a=>a.frames.every(f=>f.opacity===undefined||f.opacity===1)),'the pending user must never inherit assistant opacity entrance');}
 finally{motion.close();}
});

test('empty program chat aligns its composer before the first visible message and ignores hidden prior avatars',async()=>{
 const {bindChatBottomRoom}=await import('../ui/chat-layout.mjs'),frames=[],values=new Map(),mutations=[];let shown=false;
 const style={getPropertyValue:k=>values.get(k)||'',setProperty:(k,v)=>values.set(k,v)},body={dataset:{programAgent:'true'}},hidden={checkVisibility:()=>false};
 const ring={parentElement:body,getAnimations:()=>[],closest:()=>null,checkVisibility:()=>shown,getBoundingClientRect:()=>({left:58,width:120})};
 const scroller={style,clientHeight:600,clientWidth:800,clientLeft:10,checkVisibility:()=>true,getBoundingClientRect:()=>({left:20}),parentElement:{getBoundingClientRect:()=>({bottom:800})},querySelector:()=>null,querySelectorAll:s=>s.includes('data-work')?[]:[ring,hidden]};
 const bar={style,classList:{contains:()=>true},checkVisibility:()=>true,getBoundingClientRect:()=>({left:20,top:700,height:60})};
 const win={requestAnimationFrame:fn=>{frames.push(fn);return 1;},addEventListener(){},getComputedStyle:n=>n===scroller?{paddingLeft:'28px',paddingTop:'20px',paddingBottom:'24px'}:{left:'20px'},ResizeObserver:class{observe(){}unobserve(){}},MutationObserver:class{constructor(fn){mutations.push(fn);}observe(){}}};
 const doc={body,defaultView:win,addEventListener(){},getElementById:id=>id==='bottom-bar'?bar:null,querySelector:()=>scroller};
 bindChatBottomRoom(doc);frames.shift()();assert.equal(values.get('--chat-input-left'),'58px');
 shown=true;mutations[0]([{type:'attributes'}]);frames.shift()();assert.equal(values.get('--chat-input-left'),'58px','first visible message must retain the original input baseline');
});

test('native program room uses its visible reader instead of the retained hidden legacy conversation',async()=>{
 const {bindChatBottomRoom}=await import('../ui/chat-layout.mjs'),frames=[],values=new Map(),observed=[],mutations=[];
 const style=id=>({getPropertyValue:k=>values.get(id+k)||'',setProperty(k,v){values.set(id+k,v);}}),body={dataset:{programAgent:'true'},style:style('body')};
 const row={style:style('row')},legacy={clientHeight:0},emergence={style:style('legacy')},anchor={parentElement:body,getAnimations:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:44,width:120})};
 const scroller={style:style('reader'),clientHeight:208,parentElement:{getBoundingClientRect:()=>({bottom:520})},querySelector:()=>anchor,querySelectorAll:s=>s.includes('data-work')?[row]:[anchor]};
 const bar={style:style('bar'),classList:{contains:()=>true},checkVisibility:()=>true,getBoundingClientRect:()=>({left:16,top:440,height:80})};
 const win={requestAnimationFrame:f=>frames.push(f),addEventListener(){},getComputedStyle:n=>n===scroller?{paddingTop:'20px',paddingBottom:'24px'}:{left:'16px'},ResizeObserver:class{observe(n){observed.push(n);}unobserve(){}},MutationObserver:class{constructor(f){mutations.push(f);}observe(){}}};
 const doc={body,defaultView:win,addEventListener(){},querySelector:()=>scroller,getElementById:id=>({conversation:legacy,'eyra-trigger':{getAnimations(){throw Error('hidden legacy avatar must not be used');}},'bottom-bar':bar,emergence}[id]||null)};
 bindChatBottomRoom(doc);frames.shift()();
 assert.equal(row.style.getPropertyValue('--chat-work-available-height'),'164px');assert.equal(bar.style.getPropertyValue('--chat-input-left'),'44px');assert.equal(emergence.style.getPropertyValue('--chat-work-available-height'),'');assert.ok(observed.includes(scroller));
 mutations[0]([{type:'childList',addedNodes:[{matches:()=>false}],removedNodes:[]}]);assert.equal(frames.length,0,'streaming paragraph mutations do not schedule unrelated footer measurement');
 mutations[0]([{type:'attributes'}]);assert.equal(frames.length,1,'a newly active work row is measured on the next frame');
});
