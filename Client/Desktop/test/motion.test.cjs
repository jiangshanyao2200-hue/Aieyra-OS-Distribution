// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/motion.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function fixture(){
 const classes=new Set(),media=new EventTarget(),doc=new EventTarget(),win=new EventTarget();let mutation;
 media.matches=false;doc.hidden=false;doc.body={dataset:{},classList:{contains:n=>classes.has(n)}};
 win.matchMedia=()=>media;win.MutationObserver=class{constructor(fn){mutation=fn;}observe(){}disconnect(){}};
 win.getComputedStyle=()=>({getPropertyValue:()=>'.24s'});doc.defaultView=win;
 const node={ownerDocument:doc,animate(frames,options){let reject,resolve;const a={options,frames,cancelled:false,finished:new Promise((ok,no)=>{resolve=ok;reject=no;}),cancel(){this.cancelled=true;reject(Error('cancelled'));},finish:()=>resolve()};return a;}};
 return {doc,win,node,media,classes,mutate:()=>mutation()};
}
test('completed filled exits remain replaceable and cancellable before the next native presentation',async()=>{
 const {animateUI,cancelMotion,setupMotion}=await import('../ui/motion.mjs'),f=fixture();
 const exit=animateUI(f.node,[{opacity:1},{opacity:0}],{key:'portal-transfer',fill:'both'});
 exit.finish();await Promise.resolve();
 assert.equal(setupMotion(f.doc).active.size,0,'finished effects no longer count as running animations');
 const enter=animateUI(f.node,[{opacity:0},{opacity:1}],{key:'portal-transfer'});
 assert.equal(exit.cancelled,true,'old zero-opacity fill must not return after entry finishes');
 enter.finish();await Promise.resolve();
 const nextExit=animateUI(f.node,[],{key:'portal-transfer',fill:'forwards'});
 nextExit.finish();await Promise.resolve();cancelMotion(f.node,'portal-transfer');
 assert.equal(nextExit.cancelled,true,'hide also removes a completed fill');
 setupMotion(f.doc).close();
});

test('motion replaces only its own channel and follows hidden/reduced state without stale completions',async()=>{
 const {animateUI,setupMotion,observeMotion}=await import('../ui/motion.mjs'),f=fixture(),changes=[];
 const stop=observeMotion(f.doc,v=>changes.push(v));
 const first=animateUI(f.node,[],{key:'layout'}),second=animateUI(f.node,[],{key:'layout'}),exit=animateUI(f.node,[],{key:'exit'});
 assert.equal(first.cancelled,true);assert.equal(second.cancelled,false);assert.equal(exit.options.duration,240);
 await Promise.resolve();assert.equal(setupMotion(f.doc).active.size,2);
 f.doc.body.dataset.visible='false';f.mutate();await Promise.resolve();
 assert.equal(second.cancelled,true);assert.equal(exit.cancelled,true);assert.equal(setupMotion(f.doc).active.size,0);
 assert.equal(animateUI(f.node,[]),null);assert.equal(f.doc.body.dataset.uiHidden,'true');
 f.doc.body.dataset.visible='true';f.mutate();const restored=animateUI(f.node,[]);assert.ok(restored);
 f.media.matches=true;f.media.dispatchEvent(new Event('change'));await Promise.resolve();assert.equal(restored.cancelled,true);
 assert.deepEqual(changes,[false,true,false]);stop();setupMotion(f.doc).close();
});
test('turning off motion flushes received text even when no new stream frame arrives',async()=>{
 const {createTypewriter}=await import('../ui/typewriter.mjs'),{setupMotion}=await import('../ui/motion.mjs'),f=fixture();
 const frames=new Map();let id=0;f.win.document=f.doc;f.win.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};f.win.cancelAnimationFrame=n=>frames.delete(n);
 const target={classList:{toggle(){},remove(){}}},writer=createTypewriter({win:f.win,render:(n,t)=>n.text=t});
 writer.show(target,'正文不应被减弱动效开关截断。'.repeat(40),{done:true});assert.ok(writer.active);
 f.classes.add('reduce-motion');f.mutate();assert.equal(writer.active,false);assert.equal(target.text,'正文不应被减弱动效开关截断。'.repeat(40));assert.equal(frames.size,0);
 writer.detach();setupMotion(f.doc).close();
});

test('native surface visibility pauses home motion even when Chromium still reports visible, then restores and unsubscribes',async()=>{
 const {bindSurfaceVisibility,animateUI,setupMotion}=await import('../ui/motion.mjs'),f=fixture();let receive,stopped=0;
 const close=bindSurfaceVisibility({onSurfaceVisibility(fn){receive=fn;return ()=>stopped++;}},f.doc);
 const animation=animateUI(f.node,[]);receive({visible:false});f.mutate();await Promise.resolve();
 assert.equal(f.doc.hidden,false);assert.equal(f.doc.body.dataset.uiHidden,'true');assert.equal(animation.cancelled,true);
 receive({visible:true});f.mutate();assert.equal(f.doc.body.dataset.uiHidden,'false');assert.ok(animateUI(f.node,[]));
 close();close();receive({visible:false});assert.equal(stopped,1);assert.equal(f.doc.body.dataset.visible,'true');setupMotion(f.doc).close();
});
