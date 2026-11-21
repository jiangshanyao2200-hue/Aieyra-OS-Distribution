// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; token; fixture; browse
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-transport.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createCommunityClient}=require('../host/community.cjs');
const token='a'.repeat(43),digest='b'.repeat(64),id='official.avatar-one',origin='https://osupdate.aieyra.cn';
function fixture({now=Date.now}={}){
 const requests=[];let publicKey,refuse=false,hold=null,respond=null;
 const client=createCommunityClient({now,fetchImpl:async(url,options)=>{
  const route=new URL(url).pathname;
  if(route.endsWith('/start')){publicKey=JSON.parse(options.body).publicKey;return Response.json({flow:'fixture',authorizationUrl:'https://api.aieyra.cn/aieyra/os/authorize?flow=fixture'});}
  if(route.endsWith('/exchange'))return Response.json({accessToken:token,expiresAt:now()+3600000,user:{id:'9001'}});
  if(route.endsWith('/logout'))return Response.json({ok:true});
  requests.push({url,options});if(hold)await hold;
  if(respond)return respond(url,options);
  return refuse?Response.json({error:'expired fixture session'},{status:401}):Response.json({ok:true,items:[],item:{id}});
 }});
 const login=()=>client.connect({id:'9001'},{fetch:async()=>Response.json({callbackUrl:origin+'/auth/desktop-callback?state=fixture&code=fake'})});
 return {client,requests,login,key:()=>publicKey,refuse:value=>refuse=value,hold:value=>hold=value,respond:value=>respond=value};
}
test('theme transport permits public browsing and signs only explicit likes with the item revision',async()=>{
 const f=fixture();try{
  await f.client.themeRequest({action:'list',category:'background'});const browse=f.requests[0];
  assert.equal(browse.options.headers.authorization,undefined);assert.equal(new URL(browse.url).searchParams.get('orientation'),'landscape');
  assert.equal(new URL(browse.url).searchParams.get('platform'),'windows');
  await assert.rejects(()=>f.client.themeRequest({action:'like',id,digest,liked:true}),/登录/);
  await assert.rejects(()=>f.client.themeMedia({id,digest,variant:'file'}),/登录/);
  await f.login();await f.client.themeRequest({action:'like',id,digest,liked:true});const {url,options}=f.requests.at(-1),h=options.headers;
  assert.deepEqual(JSON.parse(options.body),{liked:true,expectedDigest:digest});
  const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),payload=['aieyra-os-proof-v2',sha(token),'POST',new URL(url).pathname,h['x-os-time'],h['x-os-nonce'],sha(options.body)].join('\n');
  assert.equal(crypto.verify(null,Buffer.from(payload),f.key(),Buffer.from(h['x-os-signature'],'base64url')),true);
  const media=await f.client.themeMedia({id,digest,variant:'file'});media.assertCurrent();assert.equal(f.requests.at(-1).options.headers.authorization,'Bearer '+token);
  for(const bad of ['https://evil.invalid/a','../avatar','official.avatar/secret'])await assert.rejects(()=>f.client.themeMedia({id:bad,digest,variant:'file'}),/地址/);
 }finally{f.client.close();}
});
test('expired theme sessions notify subscribers and late originals cannot survive logout',async()=>{
 const f=fixture();let notified=0;f.client.subscribe(()=>notified++);try{
  await f.login();const before=notified;f.refuse(true);
  await assert.rejects(()=>f.client.themeRequest({action:'like',id,digest,liked:true}),/expired/);
  assert.equal(f.client.status().signedIn,false);assert.equal(notified,before+1);
  f.refuse(false);await f.login();let release;f.hold(new Promise(resolve=>release=resolve));
  const pending=f.client.themeMedia({id,digest,variant:'file'});await f.client.logout();release();
  await assert.rejects(pending,/取消|切换/);
 }finally{f.client.close();}
});

const browse={action:'list',category:'avatar'};
for(const scenario of [
 {name:'HTML 429 with Retry-After seconds',response:()=>new Response('<html>rate limited</html>',{status:429,headers:{'retry-after':'60'}}),status:429,delay:60000},
 {name:'HTML 503 with Retry-After date',response:time=>new Response('<html>unavailable</html>',{status:503,headers:{'retry-after':new Date(time+45000).toUTCString()}}),status:503,delay:45000},
 {name:'HTML 503 without Retry-After',response:()=>new Response('<html>unavailable</html>',{status:503}),status:503,delay:5000},
 {name:'invalid successful JSON',response:()=>new Response('<html>invalid successful response</html>'),code:'cloud_response_invalid',delay:5000},
 {name:'network failure',response:()=>{throw new TypeError('fixture disconnected');},code:'cloud_unavailable',delay:5000}
])test(scenario.name+' retains its cause, coalesces callers and cools down all theme endpoints',async()=>{
 let time=1000000;const f=fixture({now:()=>time});try{
  f.respond(()=>scenario.response(time));
  const failures=await Promise.allSettled([f.client.themeRequest(browse),f.client.themeRequest(browse)]);assert.equal(f.requests.length,1);
  assert(failures.every(result=>result.status==='rejected'));const error=failures[0].reason;
  assert.equal(error.status,scenario.status);if(scenario.code)assert.equal(error.code,scenario.code);assert.equal(error.retryAfterMs,scenario.delay);
  if(scenario.status)assert.match(error.message,new RegExp('HTTP '+scenario.status));
  await assert.rejects(f.client.themeRequest({...browse,category:'background'}),e=>e.code==='theme_cooldown'&&e.status===scenario.status);
  await assert.rejects(f.client.themeMedia({id,digest,variant:'preview'}),e=>e.code==='theme_cooldown');assert.equal(f.requests.length,1);
  time+=scenario.delay-1;await assert.rejects(f.client.themeRequest(browse),e=>e.code==='theme_cooldown');assert.equal(f.requests.length,1);
  time++;f.respond(()=>Response.json({items:[],nextCursor:null}));assert.equal((await f.client.themeRequest(browse)).nextCursor,null);assert.equal(f.requests.length,2);
  f.respond(()=>new Response('unavailable',{status:503}));await assert.rejects(f.client.themeRequest({...browse,category:'background'}),e=>e.status===503&&e.retryAfterMs===5000,'successful recovery resets exponential backoff');
 }finally{f.client.close();}
});
test('a media CDN failure shares its retry deadline with catalogue requests',async()=>{
 let time=1000000;const f=fixture({now:()=>time});try{
  f.respond(()=>new Response('<html>CDN busy</html>',{status:503,headers:{'retry-after':'30'}}));
  await assert.rejects(f.client.themeMedia({id,digest,variant:'preview'}),e=>e.status===503&&e.retryAfterMs===30000);
  await assert.rejects(f.client.themeRequest(browse),e=>e.code==='theme_cooldown');assert.equal(f.requests.length,1);
  time+=30000;f.respond(()=>new Response('fixture image'));const result=await f.client.themeMedia({id,digest,variant:'preview'});assert.equal(await result.response.text(),'fixture image');assert.equal(f.requests.length,2);
 }finally{f.client.close();}
});
test('theme metadata concurrency is bounded and queued requests resume without duplicate work',async()=>{
 const f=fixture();let release,active=0,maximum=0;const gate=new Promise(resolve=>release=resolve);try{
  f.respond(async()=>{active++;maximum=Math.max(maximum,active);await gate;active--;return Response.json({item:{id}});});
  const pending=Array.from({length:10},(_,i)=>f.client.themeRequest({action:'read',id:'official.avatar-'+i}));
  while(f.requests.length<4)await new Promise(setImmediate);assert.equal(f.requests.length,4);assert.equal(maximum,4);
  release();await Promise.all(pending);assert.equal(f.requests.length,10);assert.equal(maximum,4);
 }finally{release();f.client.close();}
});
test('image concurrency remains bounded until response bodies are consumed', {timeout:3000},async()=>{
 const f=fixture(),streams=[];try{
  f.respond(()=>new Response(new ReadableStream({start(controller){streams.push(controller);controller.enqueue(Buffer.from('image'));}})));
  const pending=Promise.all(Array.from({length:10},(_,i)=>f.client.themeMedia({id:'official.avatar-'+i,digest,variant:'preview'}).then(result=>result.response.text())));
  while(f.requests.length<4)await new Promise(setImmediate);assert.equal(f.requests.length,4);
  await new Promise(setImmediate);assert.equal(f.requests.length,4,'receiving headers does not free download slots');
  let completed=0;
  while(completed<10){while(completed<streams.length)streams[completed++].close();await new Promise(setImmediate);}
  assert.deepEqual(await pending,Array(10).fill('image'));
 }finally{f.client.close();}
});
test('an interrupted image body releases its slot and cools down new theme requests',async()=>{
 const f=fixture();let source;try{
  f.respond(()=>new Response(new ReadableStream({start(controller){source=controller;}})));
  const result=await f.client.themeMedia({id,digest,variant:'preview'}),reading=result.response.text();source.error(new Error('fixture body interruption'));
  await assert.rejects(reading,e=>e.code==='cloud_unavailable');
  await assert.rejects(f.client.themeRequest(browse),e=>e.code==='theme_cooldown');assert.equal(f.requests.length,1);
 }finally{f.client.close();}
});
for(const cancel of ['logout','close'])test(cancel+' cancels active and queued public theme requests with a finite queue',async()=>{
 const f=fixture();let release;const gate=new Promise(resolve=>release=resolve);try{
  f.respond(async()=>{await gate;return Response.json({item:{id}});});
  const pending=Promise.allSettled(Array.from({length:80},(_,i)=>f.client.themeRequest({action:'read',id:'official.avatar-'+i})));
  while(f.requests.length<4)await new Promise(setImmediate);if(cancel==='logout')await f.client.logout();else f.client.close();
  assert(f.requests.every(request=>request.options.signal.aborted));release();const results=await pending;
  assert.equal(f.requests.length,4);assert(results.every(result=>result.status==='rejected'&&['cloud_cancelled','theme_busy'].includes(result.reason.code)));
  assert.equal(results.filter(result=>result.reason.code==='theme_busy').length,12,'queued requests have a fixed upper bound');
 }finally{release();f.client.close();}
});
test('an older concurrent success cannot clear a newer failure cooldown',async()=>{
 let time=1000000,release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),f=fixture({now:()=>time});try{
  f.respond(async url=>{if(new URL(url).searchParams.get('category')==='avatar'){started();await gate;return Response.json({items:[]});}return new Response('unavailable',{status:503});});
  const earlier=f.client.themeRequest(browse);await ready;
  await assert.rejects(f.client.themeRequest({...browse,category:'background'}),e=>e.status===503);release();await earlier;
  await assert.rejects(f.client.themeRequest(browse),e=>e.code==='theme_cooldown');assert.equal(f.requests.length,2);
 }finally{release();f.client.close();}
});
test('non-JSON expired sessions retain HTTP 401 and revoke their account binding',async()=>{
 const f=fixture();try{
  await f.login();f.respond(()=>new Response('<html>unauthorized</html>',{status:401}));
  await assert.rejects(f.client.themeRequest({action:'read',id}),e=>e.status===401&&/HTTP 401/.test(e.message));assert.equal(f.client.status().signedIn,false);
 }finally{f.client.close();}
});
