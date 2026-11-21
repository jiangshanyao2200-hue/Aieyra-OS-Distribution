// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Halo/test/transition.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {relocateHalo}=require('../runtime/transition.mjs');
function fixture({custom=false,allowed=true}={}){
 const nodes=[],animations=[];
 const doc={body:{animate(){},append(node){nodes.push(node);}},createElement(){return {style:{},setAttribute(){},append(){},remove(){this.removed=true;}};}};
 const surface={ownerDocument:doc,querySelector:()=>custom?{}:null};
 const motion={motionAllowed:()=>allowed,motionDuration:()=>360,animateUI(node,frames,options){let finish;const animation={node,frames,options,cancelled:false,finished:new Promise(resolve=>finish=resolve),finish:()=>finish(),cancel(){this.cancelled=true;finish();}};animations.push(animation);return animation;}};
 const from={left:10,top:20,width:100,height:100},to={left:200,top:300,width:100,height:100};
 return {nodes,animations,run:options=>relocateHalo(surface,from,to,{motion,...options})};
}
test('custom Halo relocation never adds classic particle layers and remains cancellable',()=>{
 const f=fixture({custom:true}),stop=f.run();assert.equal(f.nodes.length,0);assert.equal(f.animations.length,1);assert.equal(f.animations[0].frames.at(-1).opacity,1);stop();assert.ok(f.animations[0].cancelled);
});
test('classic relocation keeps particles, releases the layer and cancels all owned animations',async()=>{
 const f=fixture(),stop=f.run();assert.equal(f.nodes.length,1);assert.equal(f.nodes[0].className,'pulsar-layer');assert.equal(f.animations.length,17);stop();await Promise.resolve();assert.ok(f.animations.every(a=>a.cancelled));assert.ok(f.nodes[0].removed);
});
test('occlusion and reduced motion suppress particle layers without delaying the destination',()=>{
 const blocked=fixture(),stop=blocked.run({obstructed:true});assert.equal(blocked.nodes.length,0);assert.equal(blocked.animations.length,1);stop();
 const reduced=fixture({allowed:false});reduced.run()();assert.equal(reduced.nodes.length,0);assert.equal(reduced.animations.length,0);
});

test('relocation completion includes the last particle and releases layers on finish or cancellation',async()=>{
 const f=fixture(),stop=f.run({duration:420,ringDuration:112});let done=false;stop.finished.then(()=>done=true);
 assert.equal(f.animations[0].options.duration,420);assert.equal(f.animations.at(-1).options.duration,112);
 for(const a of f.animations.slice(0,-1))a.finish();await Promise.resolve();assert.equal(done,false);assert(!f.nodes[0].removed);
 f.animations.at(-1).finish();await stop.finished;assert.equal(done,true);assert(f.nodes[0].removed);
 const cancelled=fixture(),release=cancelled.run();release();await release.finished;assert(cancelled.nodes[0].removed);assert(cancelled.animations.every(a=>a.cancelled));
 const custom=fixture({custom:true}),quiet=custom.run();quiet();await quiet.finished;assert.equal(custom.nodes.length,0);
 const reduced=fixture({allowed:false});await reduced.run().finished;assert.equal(reduced.animations.length,0);
});
