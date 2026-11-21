// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-bridge.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {startBrowserBridge}=require('../host/browser-bridge.cjs');
test('browser bridge authenticates local calls, preserves owner, and aborts a disconnected operation',async()=>{
 let calls=0,closed=false,aborted;
 const abortedPromise=new Promise(r=>aborted=r);
 const bridge=await startBrowserBridge({execute:async(owner,args,signal)=>{calls++;assert.equal(owner,'owned-session');if(args.action==='wait')return new Promise(resolve=>signal.addEventListener('abort',()=>{aborted();resolve({ok:false,error:'cancelled'});},{once:true}));return {ok:true,action:args.action};},close(){closed=true;}});
 try{
  for(const headers of [{origin:'https://untrusted.example'},{'sec-fetch-site':'same-origin'},{host:'other.local'}]){const status=await new Promise((resolve,reject)=>{const req=require('node:http').request(bridge.url,{method:'POST',headers},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('{}');});assert.equal(status,403);}
  assert.equal((await fetch(bridge.url+'x',{method:'POST',body:'{}'})).status,403);assert.equal(calls,0);
  const r=await fetch(bridge.url,{method:'POST',body:JSON.stringify({owner:'owned-session',arguments:{action:'tabs'}})});assert.deepEqual(await r.json(),{ok:true,action:'tabs'});
  const controller=new AbortController();const pending=fetch(bridge.url,{method:'POST',body:JSON.stringify({owner:'owned-session',arguments:{action:'wait'}}),signal:controller.signal}).catch(()=>{});
  while(calls<2)await new Promise(r=>setTimeout(r,5));controller.abort();await pending;
  await Promise.race([abortedPromise,new Promise((_,reject)=>setTimeout(()=>reject(Error('cancel not delivered')),1000).unref())]);
 }finally{bridge.close();}assert.ok(closed);
});
