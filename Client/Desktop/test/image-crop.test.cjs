// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: load
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/image-crop.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const load=()=>import(pathToFileURL(path.join(__dirname,'../ui/image-crop.mjs')).href);

test('crop bounds cover the frame and clamp dragging to the image edges',async()=>{
 const {cropBounds}=await load();
 const b=cropBounds(1000,500,1,9999,-9999,320,320);
 assert.equal(b.scale,320/500);
 assert.equal(b.x,(1000*b.scale-320)/2);assert.equal(Math.abs(b.y),0);
});

test('the cropped source region matches what the frame shows, at original resolution',async()=>{
 const {cropBounds,cropSource}=await load();
 const centered=cropSource(1600,1000,cropBounds(1600,1000,1,0,0,480,300),480,300);
 assert.deepEqual([centered.sx,centered.sy,centered.sw,centered.sh],[0,0,1600,1000]);
 const zoomed=cropSource(1600,1000,cropBounds(1600,1000,2,0,0,480,300),480,300);
 assert.deepEqual([zoomed.sx,zoomed.sy,zoomed.sw,zoomed.sh],[400,250,800,500]);
 const b=cropBounds(1600,1000,2,240,0,480,300),left=cropSource(1600,1000,b,480,300);
 assert.equal(left.sx,0,'dragged fully right shows the left edge');
});

test('avatar crop can zoom out until the whole picture fits inside the circle, and stays inside the frame',async()=>{
 const {cropBounds,roundMinZoom}=await load();
 const z=roundMinZoom(1600,900,320);
 const b=cropBounds(1600,900,z,9999,9999,320,320);
 // 整张图的对角线正好等于圆的直径。
 assert.ok(Math.abs(Math.hypot(1600*b.scale,900*b.scale)-320)<1e-6);
 // 比框小时只能在框内移动，不会拖出框外。
 assert.ok(1600*b.scale/2+b.x<=160+1e-6&&900*b.scale/2+b.y<=160+1e-6);
 assert.equal(roundMinZoom(100,100,320)<1,true);
});
