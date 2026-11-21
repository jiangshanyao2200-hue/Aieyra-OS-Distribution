// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/shutdown.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createShutdown,releaseServices}=require('../host/shutdown.cjs');

test('repeated close waits for the core receipt before releasing bridges or exiting',async()=>{
 const events=[];let resolve,requests=0;
 const gate=new Promise(r=>resolve=r);
 const shutdown=createShutdown({request:async()=>{events.push('request');if(++requests===1)return {phase:'stopping',failures:{}};await gate;return {phase:'stopped',failures:{}};},pause:async()=>{},release:()=>events.push('release'),exit:()=>events.push('exit')});
 let blocked=0;shutdown.intercept({preventDefault(){blocked++;}});shutdown.intercept({preventDefault(){blocked++;}});
 const result=shutdown.start();assert.equal(shutdown.start(),result);
 await new Promise(r=>setImmediate(r));assert.deepEqual(events,['request','request']);assert.equal(blocked,2);
 resolve();assert.equal((await result).phase,'stopped');assert.deepEqual(events,['request','request','release','exit']);
 shutdown.intercept({preventDefault(){throw Error('terminal close was blocked');}});
});

test('shutdown waits for asynchronous service release and failure exit code survives repeated close',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r),events=[];
 const shutdown=createShutdown({request:async()=>({phase:'stopped',failures:{}}),release:()=>gate,exit:code=>events.push(code)});
 const closing=shutdown.start(1);assert.equal(shutdown.start(),closing);
 await new Promise(r=>setImmediate(r));assert.equal(shutdown.finished,false);assert.deepEqual(events,[]);
 resolve();await closing;assert.equal(shutdown.finished,true);assert.deepEqual(events,[1]);
});

test('one failed service never skips other releases and the merged receipt awaits every service',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r),events=[],reports=[];
 const shutdown=createShutdown({request:async()=>({phase:'stopped',failures:{task:'memory_save_unconfirmed'}}),
  release:()=>releaseServices({control:{close(){events.push('control');throw Error('private service detail');}},link:{close(){events.push('link');return gate;}},browser:{close(){events.push('browser');}}}),
  report:receipt=>reports.push(receipt),exit:code=>events.push(code)});
 const closing=shutdown.start();await new Promise(r=>setImmediate(r));assert.deepEqual(events,['control','link','browser']);assert.deepEqual(reports,[]);
 resolve();const receipt=await closing;assert.deepEqual(receipt.failures,{task:'memory_save_unconfirmed','host.control':'service_release_unconfirmed'});
 assert.equal(reports.length,1);assert.equal(reports[0],receipt);assert.equal(events.at(-1),1);assert.equal(JSON.stringify(receipt).includes('private service detail'),false);
});

test('release rejection becomes an incomplete receipt without an unhandled rejection',async()=>{
 const reports=[],codes=[];
 const shutdown=createShutdown({request:async()=>({phase:'stopped',failures:{}}),release:async()=>{throw Error('private release detail');},report:r=>reports.push(r),exit:code=>codes.push(code)});
 const receipt=await shutdown.start();assert.deepEqual(receipt.failures,{host:'host_release_unconfirmed'});assert.deepEqual(reports,[receipt]);assert.deepEqual(codes,[1]);
 assert.equal(JSON.stringify(receipt).includes('private release detail'),false);
});

test('failure arriving during an existing drain escalates its single exit',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r),codes=[];
 const shutdown=createShutdown({request:()=>gate,release:()=>{},exit:code=>codes.push(code)});
 const closing=shutdown.start();assert.equal(shutdown.start(1),closing);resolve({phase:'stopped',failures:{}});await closing;assert.deepEqual(codes,[1]);
});

test('unconfirmed memory or lost core is reported without claiming a clean finish',async()=>{
 for(const broken of [false,true]){
  const events=[];
  const shutdown=createShutdown({request:async()=>{if(broken)throw Error('private transport detail');return {phase:'stopped',failures:{task:'memory_save_unconfirmed'}};},report:r=>events.push(r),release:()=>events.push('release'),exit:()=>events.push('exit')});
  const result=await shutdown.start();assert.equal(events[1],result);assert.deepEqual([events[0],events[2]],['release','exit']);
  assert.equal(result.phase,broken?'unconfirmed':'stopped');assert.equal(JSON.stringify(result).includes('private transport detail'),false);
 }
});
