// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/chat-layer-preferences.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createChatLayerPreferences}=require('../host/chat-layer-preferences.cjs');
test('home fold preferences persist while programs start folded each launch and preserve corrupt originals',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-chat-fold-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'runtime','ui','chat-layers.json'),first=createChatLayerPreferences(file);
 assert.equal(first.call({key:'home:first'}).open,null);first.call({key:'home:first',open:false});first.call({key:'program:browser:second',open:true});
 assert.equal(first.call({key:'program:browser:second'}).open,true,'page switches retain this launch choice');
 first.call({key:'coding:other',open:true});assert.equal(first.call({key:'coding:other'}).open,true);
 const reopened=createChatLayerPreferences(file);assert.equal(reopened.call({key:'home:first'}).open,false);assert.equal(reopened.call({key:'program:browser:second'}).open,false);assert.equal(reopened.call({key:'coding:other'}).open,false);
 assert.throws(()=>reopened.call({key:'../file',open:true}));assert.throws(()=>reopened.call({key:'home:first',open:'false'}));
 fs.writeFileSync(file,'corrupt original');assert.throws(()=>reopened.call({key:'home:first',open:true}));assert.equal(fs.readFileSync(file,'utf8'),'corrupt original');
});
test('folded positions persist independently of launch-only expansion and reject malformed coordinates',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-chat-position-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'layers.json'),prefs=createChatLayerPreferences(file);
 prefs.call({key:'program:settings:sera',position:{x:.32,y:.16}});prefs.call({key:'program:settings:sera',open:true});prefs.call({key:'home:one',open:false,position:{x:1,y:0}});
 const next=createChatLayerPreferences(file);assert.deepEqual(next.call({key:'program:settings:sera'}),{ok:true,open:false,position:{x:.32,y:.16}});assert.deepEqual(next.call({key:'home:one'}),{ok:true,open:false,position:{x:1,y:0}});assert.equal(next.call({key:'program:browser:navi'}).position,undefined);
 for(const position of [{x:NaN,y:0},{x:0,y:2},{x:0},{x:0,y:1,extra:0},[0,1],null])assert.throws(()=>next.call({key:'home:one',position}));
 assert.deepEqual(next.call({key:'home:one'}).position,{x:1,y:0});
});
