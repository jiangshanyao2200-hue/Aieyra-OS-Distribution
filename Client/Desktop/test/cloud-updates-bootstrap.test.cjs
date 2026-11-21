// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/cloud-updates-bootstrap.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
 const intervals=[],timeouts=[],calls=[];let resolveBootstrap;
 const pending=new Promise(resolve=>{resolveBootstrap=resolve;});
 const module={exports:{}};
 const actual={...fs,existsSync:()=>true};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../host/cloud-updates.cjs'),'utf8'),{
  module,require:id=>id==='../src/managed-update-bootstrap.cjs'?{promoteBootstrap:()=>pending}:id==='node:fs'?actual:require(id),
  process:{env:{}},URL,AbortSignal,fetch:()=>{throw Error('unexpected network');},
  setTimeout:fn=>{timeouts.push(fn);return {unref(){}};},clearTimeout(){},
  setInterval:fn=>{intervals.push(fn);return {unref(){}};},clearInterval(){}
 });
 const updates=module.exports.createCloudUpdates({app:{quit(){throw Error('unexpected exit');}},window:()=>({isDestroyed:()=>false,webContents:{send(){}}}),root:__dirname,initial:{},descriptor:()=>({}),core:async(action,args)=>{calls.push({action,args});return {phase:'idle'};}});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 return {updates,calls,timeouts,intervals,flush,resolveBootstrap};
}
test('status and handoff wait for bootstrap triggered by tick',async()=>{
 const f=fixture();f.updates.start();f.updates.ready();f.intervals[0]();await f.flush();
 assert.equal(f.calls.filter(c=>c.args?.action==='status').length,0);
 f.resolveBootstrap({phase:'complete'});await f.flush();
 assert.equal(f.calls.filter(c=>c.args?.action==='status').length,1);f.updates.close();
});
test('concurrent startup bootstrap defers the whole update tick',async()=>{
 const f=fixture();f.updates.start();f.updates.ready();f.timeouts[0]();f.intervals[0]();await f.flush();
 assert.equal(f.calls.filter(c=>c.args?.action==='status').length,0);
 f.resolveBootstrap({phase:'complete'});await f.flush();f.intervals[0]();await f.flush();
 assert.equal(f.calls.filter(c=>c.args?.action==='status').length,1);f.updates.close();
});
test('closing a host during bootstrap prevents later handoff',async()=>{
 const f=fixture();f.updates.start();f.updates.ready();f.intervals[0]();f.updates.close();
 f.resolveBootstrap({phase:'complete'});await f.flush();
 assert.equal(f.calls.filter(c=>c.args?.action==='status').length,0);
});
