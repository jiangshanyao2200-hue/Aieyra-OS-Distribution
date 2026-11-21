// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: load
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/eyra-float.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const load=()=>import(pathToFileURL(path.join(__dirname,'../ui/eyra-float.mjs')).href);

test('docked Eyra sits at the left above the input row and is lifted when the composer opens',async()=>{
 const {eyraLayout}=await load();
 const closed=eyraLayout({width:1280,height:740});
 assert.deepEqual([closed.x,closed.y,closed.v,closed.h],[50,690,'above','left']);
 const open=eyraLayout({width:1280,height:740,lift:70});
 assert.equal(open.y,620);assert.ok(open.y+26<=740-24-70,'ball stays above the composer');
});

test('dragged Eyra flips its bubbles near the top or right edge and never leaves the screen',async()=>{
 const {eyraLayout}=await load();
 const topRight=eyraLayout({width:1280,height:740,center:{x:1100,y:120}});
 assert.deepEqual([topRight.v,topRight.h],['below','right']);
 assert.equal(topRight.ax,1126);assert.equal(topRight.ay,94);
 const outside=eyraLayout({width:800,height:600,center:{x:-500,y:9999}});
 assert.deepEqual([outside.x,outside.y],[50,550]);
 assert.ok(outside.room>=80&&outside.wroom>=200);
});

test('bubble room shrinks with the space left around the ball',async()=>{
 const {eyraLayout}=await load();
 const low=eyraLayout({width:1280,height:740}),mid=eyraLayout({width:1280,height:740,center:{x:300,y:420}});
 assert.ok(low.room>mid.room);
 assert.equal(low.wroom,1280-24-24);
});
