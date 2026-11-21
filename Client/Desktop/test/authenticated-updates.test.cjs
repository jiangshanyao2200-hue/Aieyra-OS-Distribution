// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: sleep
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/authenticated-updates.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createManagedUpdates}=require('../src/managed-updates.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('release bursts during a request coalesce into one immediate signed recheck',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'os-update-burst-')),keys=crypto.generateKeyPairSync('ed25519');
 const release=n=>{const payload=Buffer.from(JSON.stringify({product:'aieyra-os',channel:'stable',id:`os-${n}`,version:`0.2.${n}`,sequence:n,publishedAt:'2026-11-07T00:00:00Z',artifacts:[{kind:'portable',name:'os.zip',size:10,sha256:'a'.repeat(64)}]}));return {algorithm:'Ed25519',payload:payload.toString('base64'),signature:crypto.sign(null,payload,keys.privateKey).toString('base64')};};
 let stream,checks=0,resolveInitial;
 const initial=new Promise(resolve=>{resolveInitial=resolve;});
 const manager=createManagedUpdates({root,publicKey:keys.publicKey,signedIn:()=>true,platform:'win32',fetchImpl:async(url,options)=>{
  if(url.endsWith('/events'))return new Response(new ReadableStream({start(controller){stream=controller;options.signal.addEventListener('abort',()=>controller.close(),{once:true});}}));
  checks++;if(checks===1){await initial;return Response.json(release(1));}return Response.json(release(4));
 }});
 t.after(()=>{resolveInitial();manager.close();fs.rmSync(root,{recursive:true,force:true});});
 manager.start();
 assert.equal(checks,1);
 const encode=new TextEncoder();
 for(let i=0;i<12;i++){stream.enqueue(encode.encode('event: release\r\n'));stream.enqueue(encode.encode('data: {}\r'));stream.enqueue(encode.encode('\n\r\n'));}
 await sleep(20);assert.equal(checks,1);
 resolveInitial();
 for(let i=0;i<100&&manager.status().release?.sequence!==4;i++)await sleep(10);
 assert.equal(manager.status().release.sequence,4);assert.equal(checks,2);
 await sleep(20);assert.equal(checks,2);
 manager.close();
});
test('updates do no network while logged out; login starts and logout aborts SSE',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'os-login-update-')),keys=crypto.generateKeyPairSync('ed25519');
 const payload=Buffer.from(JSON.stringify({product:'aieyra-os',channel:'stable',id:'os-0.2.17-6',version:'0.2.17',sequence:6,publishedAt:new Date().toISOString(),artifacts:[{kind:'portable',name:'os.zip',size:10,sha256:'a'.repeat(64)}]}));
 const envelope={algorithm:'Ed25519',payload:payload.toString('base64'),signature:crypto.sign(null,payload,keys.privateKey).toString('base64')};
 let signed=false,listener,requests=[],aborted=0;
 const manager=createManagedUpdates({root,publicKey:keys.publicKey,signedIn:()=>signed,subscribe:fn=>(listener=fn,()=>{listener=null;}),platform:'darwin',arch:'arm64',fetchImpl:async(url,options)=>{
  requests.push(url);if(url.endsWith('/events'))return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted++;reject(Error('aborted'));},{once:true}));return Response.json(envelope);
 }});
 t.after(()=>{manager.close();fs.rmSync(root,{recursive:true,force:true});});
 manager.start();await sleep(25);assert.equal(requests.length,0);assert.equal(manager.status().phase,'login_required');await assert.rejects(()=>manager.call({action:'check'}),/登录/);
 signed=true;listener();await sleep(30);assert.equal(requests.filter(x=>x.endsWith('/events')).length,1);assert.equal(manager.status().phase,'available');assert.equal(manager.status().manual,true);
 assert.match((await manager.call({action:'review'})).reason,/官网下载/);assert.ok(!fs.existsSync(path.join(root,'.aieyra-updates/os-0.2.17-6/download.zip')));
 signed=false;listener();await sleep(20);assert.equal(aborted,1);assert.equal(manager.status().release,null);const count=requests.length;await sleep(30);assert.equal(requests.length,count);
 signed=true;listener();await sleep(25);assert.equal(requests.filter(x=>x.endsWith('/events')).length,2);manager.close();assert.equal(listener,null);
});
