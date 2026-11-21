// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/file-drop-router.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createFileDropRouter}=require('../host/file-drop-router.cjs');
test('native drops require a registered top-level surface and bounded file payload',()=>{
 const handlers=new Map(),sent=[],ipcMain={handle:(k,f)=>handlers.set(k,f),removeHandler:k=>handlers.delete(k)};
 const router=createFileDropRouter({ipcMain,send:p=>sent.push(p)}),wc=new EventEmitter();wc.mainFrame={url:'file:///settings.html'};
 const call=(sender=wc,frame=wc.mainFrame,p={paths:['C:/owned/a.txt']})=>handlers.get('workspace:dropFiles')({sender,senderFrame:frame},p);
 assert.equal(call().ok,false);router.register(wc,u=>u==='file:///settings.html');assert.equal(call().ok,true);
 assert.equal(call(wc,{url:wc.mainFrame.url}).ok,false);wc.mainFrame.url='https://untrusted.invalid';assert.equal(call().ok,false);wc.mainFrame.url='file:///settings.html';
 assert.equal(call(wc,wc.mainFrame,{files:[{name:'ordinary.txt',bytes:new Uint8Array([65])}]}).ok,true);
 assert.equal(call(wc,wc.mainFrame,{paths:Array(11).fill('C:/a')}).ok,false);assert.equal(sent.length,2);
 wc.emit('destroyed');assert.equal(call().ok,false);router.close();assert.equal(handlers.size,0);
});
