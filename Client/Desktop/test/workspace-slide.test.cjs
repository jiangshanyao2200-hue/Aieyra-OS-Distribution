// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-slide.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict');
test('drawer reverses from the displayed position and sends only the newest native offset under backpressure',async()=>{
 const {setupWorkspaceSlide,workspaceBounds}=await import('../ui/workspace-slide.mjs');
 const frames=new Map(),classes=new Set(),doc=new EventTarget(),win=new EventTarget(),media=new EventTarget();let now=0,serial=0,mutation;
 Object.assign(win,{performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>media,getComputedStyle:()=>({getPropertyValue:()=> '360ms'}),MutationObserver:class{constructor(fn){mutation=fn;}observe(){}disconnect(){}}});
 Object.assign(doc,{defaultView:win,body:{dataset:{},classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)}}});
 const node={ownerDocument:doc,style:{setProperty(key,v){this[key]=parseFloat(v);}},getBoundingClientRect(){return {x:Math.fround(16+(this.style['--workspace-x']||0)),y:56,width:900-(this.style['--workspace-inset']||0),height:600};}};
 doc.querySelectorAll=()=>[node];media.matches=false;
 const sent=[],settlements=[];let release,ownership,ownershipClosed=false;const blocked=new Promise(resolve=>release=resolve);
 const slide=setupWorkspaceSlide(doc,{onModuleState(fn){ownership=fn;return ()=>{ownershipClosed=true;};},workspaceShift:async p=>{sent.push(p.x);settlements.push(p.settled);if(sent.length===1)await blocked;return {ok:true};}});
 const step=t=>{now=t;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(t));};
 now=10;slide.to(300);step(8);assert.equal(slide.x,0,'rAF frame timestamp can precede the animation start within the same frame');step(90);const first=slide.x;assert(first>0&&first<300);assert.equal(node.getBoundingClientRect().width,900-first);
 assert.deepEqual(workspaceBounds(node),{x:16,y:56,width:900,height:600});
 slide.to(0);assert.equal(slide.x,first);step(180);assert(slide.x<first&&slide.x>0);
 assert.equal(workspaceBounds(node).x,16,'fractional reversal must not become a native one-pixel inset');
 slide.to(300);step(270);assert(slide.x>0&&slide.x<300);step(600);assert.equal(slide.x,300);
 assert.equal(node.getBoundingClientRect().width,600,'inline pages adapt to the remaining width once the drawer settles');
 assert.deepEqual(workspaceBounds(node),{x:16,y:56,width:900,height:600},'native proxy restores the base width so the host applies only one inset');
 release();await new Promise(r=>setImmediate(r));assert.deepEqual(sent,[0,300]);
 assert.deepEqual(settlements,[true,true],'backpressure preserves the final settled geometry');
 ownership({modules:{home:{detached:true}}});await new Promise(r=>setImmediate(r));
 ownership({modules:{home:{detached:false}}});await new Promise(r=>setImmediate(r));
 assert.deepEqual(sent,[0,300,300,300],'each native ownership transition restores the retained sidebar position');
 assert.equal(settlements.at(-1),true,'restoring ownership also restores the viewport inset');
 ownership({modules:{home:{detached:false}}});assert.equal(sent.length,4,'ordinary module snapshots do not republish geometry');
 slide.to(0);step(630);assert.equal(node.getBoundingClientRect().width,900-slide.x,'content follows the drawer continuously during reversal');assert.equal(workspaceBounds(node).width,900);
 classes.add('reduce-motion');mutation();assert.equal(slide.x,0);assert.equal(frames.size,0);
 assert.equal(node.getBoundingClientRect().width,900);assert.equal(workspaceBounds(node).width,900);
 slide.close();assert.equal(frames.size,0);assert.equal(ownershipClosed,true);
});
