// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/live-transcript.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict');
function fixture(){
 let time=0,seq=0;const frames=new Map(),events=new Map();
 const scroll={scrollTop:0,clientHeight:60,get scrollHeight(){return Math.max(60,node.textContent.length);},addEventListener(k,f){events.set(k,f);},removeEventListener(k){events.delete(k);}};
 const doc={hidden:false,body:{dataset:{},classList:{contains:()=>false}}};
 const win={performance:{now:()=>time},requestAnimationFrame:f=>{frames.set(++seq,f);return seq;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false})};doc.defaultView=win;
 const node={ownerDocument:doc,isConnected:true,textContent:'',dataset:{}};
 return {node,scroll,doc,frames,events,tick(t){time=t;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(f=>f(t));}};
}
test('tool transcript streams once, follows new text and manual reading settles without losing content',async()=>{
 const {createLiveTranscript}=await import('../ui/live-transcript.mjs'),f=fixture(),view=createLiveTranscript(f.node,f.scroll);
 const text='甲乙丙丁'.repeat(100);view.update(text);f.tick(180);assert.equal(f.node.textContent.length,200);assert.equal(f.scroll.scrollTop,140);
 f.events.get('wheel')({type:'wheel'});f.scroll.scrollTop=40;assert.equal(f.node.textContent,text);assert.equal(f.frames.size,0);
 view.update(text+'下一行');assert.equal(f.node.textContent,text+'下一行');assert.equal(f.scroll.scrollTop,40);assert.equal(f.frames.size,0);
 view.update(text+'下一行');assert.equal(f.frames.size,0,'unchanged polling never replays');view.close();assert.equal(f.events.size,0);
});
test('hidden/reduced motion and suspend always expose full receipt and cancel scheduled work',async()=>{
 const {createLiveTranscript}=await import('../ui/live-transcript.mjs'),f=fixture(),view=createLiveTranscript(f.node,f.scroll);
 view.update('abc'.repeat(100));f.doc.hidden=true;f.tick(100);assert.equal(f.node.textContent.length,300);assert.equal(f.frames.size,0);
 f.doc.hidden=false;view.update('new text');view.suspend();assert.equal(f.node.textContent,'new text');assert.equal(f.frames.size,0);view.close();
});
