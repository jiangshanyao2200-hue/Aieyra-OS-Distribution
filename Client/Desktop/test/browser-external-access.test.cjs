// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; tab; access
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-external-access.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createBrowserExternalAccess}=require('../../../Program/official/browser/service/browser-external-access.cjs');
const tab='0123456789abcdef',scope={group_id:'group',profile:'default',control:'agent',tabs:[{tab_id:tab,active:true}]};
async function access(t,execute,options={}){
 const service=createBrowserExternalAccess({execute,describe:()=>scope,...options});t.after(()=>service.close());
 assert.equal(service.summary().enabled,false);assert.equal(service.guide().token,null);
 const guide=await service.start();assert.match(guide.base_url,/^http:\/\/127\.0\.0\.1:\d+$/);assert.equal(guide.token.length,64);
 // Native HTTP preserves hostile Host/Origin headers; fetch may overwrite Host.
 const call=(path,{body,headers={},method}={})=>new Promise((resolve,reject)=>{
  const raw=body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body);
  const request=http.request(guide.base_url+'/api/browser/v1'+path,{agent:false,method:method||(body===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+guide.token,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}},response=>{let text='';response.setEncoding('utf8');response.on('data',part=>text+=part);response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});});
  request.on('error',reject);request.setTimeout(5000,()=>request.destroy(Error('test HTTP timeout')));request.end(raw);
 });
 return {service,guide,call};
}
test('external browser access requires an exact native loopback bearer and never advertises it in status',async t=>{
 let executions=0;const {guide,call}=await access(t,async()=>{executions++;return {ok:true};});
 const status=await call('/status');assert.equal(status.status,200);assert.deepEqual(status.body.scope,scope);assert.ok(!JSON.stringify(status).includes(guide.token));
 for(const headers of [{Authorization:''},{Authorization:'Bearer '+('x'.repeat(64))},{Authorization:'Bearer '+('é'.repeat(64))},{Origin:'http://example.org'},{Host:'example.org'},{'Sec-Fetch-Site':'same-origin'}]){
  const result=await call('/status',{headers});assert.ok([401,403].includes(result.status));
 }
 const query=await call('/status?token='+guide.token,{headers:{Authorization:''}});assert.equal(query.status,401);assert.equal(executions,0);
});
test('one request id has one execution, including concurrent retry, lost reply lookup and conflict',async t=>{
 let executions=0,release,entered;const enteredPromise=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const {call}=await access(t,async(args)=>{executions++;entered();await gate;return {ok:true,tab_id:args.tab_id,content:'真实结果'};});
 const body={request_id:'same-id',arguments:{action:'snapshot',tab_id:tab}},first=call('/execute',{body});await enteredPromise;
 const pending=await call('/execute',{body});assert.equal(pending.status,202);assert.equal(pending.body.state,'running');
 assert.equal((await call('/requests/same-id')).body.state,'running');
 release();const complete=await first;assert.equal(complete.body.result.content,'真实结果');
 assert.deepEqual((await call('/execute',{body:{arguments:{tab_id:tab,action:'snapshot'},request_id:'same-id'}})).body,complete.body);
 assert.deepEqual((await call('/requests/same-id')).body,complete.body);assert.equal(executions,1);
 const conflict=await call('/execute',{body:{...body,arguments:{action:'click',tab_id:tab}}});assert.equal(conflict.status,409);assert.equal(executions,1);
});
test('the external surface rejects owner/profile injection, files, settings and page scripts before dispatch',async t=>{
 let executions=0;const {call}=await access(t,async()=>{executions++;return {ok:true};});
 for(const args of [{action:'evaluate',script:'1'},{action:'upload',files:['fixture-upload.txt']},{action:'settings'},{action:'open',url:'https://example.org',profile:'other'},{action:'snapshot',owner:'another'},{action:'snapshot',tab_id:'bad'},{action:'toString'}]){
  const result=await call('/execute',{body:{request_id:'deny-'+executions,arguments:args}});assert.equal(result.status,400);
 }
 assert.equal(executions,0);assert.equal((await call('/execute',{body:'{'})).status,400);
 assert.equal((await call('/execute',{body:'x'.repeat(65537)})).status,413);
 assert.equal((await call('/requests/missing')).status,404);
});
test('timeouts become unknown even if an executor ignores cancellation, and retries never redispatch',async t=>{
 let executions=0;const {call}=await access(t,()=>{executions++;return new Promise(()=>{});},{operationTimeoutMs:25});
 const body={request_id:'timeout',arguments:{action:'click',tab_id:tab,revision:'r',element_id:1}};
 const result=await call('/execute',{body});assert.equal(result.body.state,'unknown');assert.match(result.body.result.error,/outcome_unknown/);
 assert.equal((await call('/requests/timeout')).body.state,'unknown');assert.equal((await call('/execute',{body})).body.state,'unknown');assert.equal(executions,1);
});
test('revocation interrupts in-flight work, closes its listener, and a new capability cannot reuse it',async t=>{
 let entered,aborted=false;const ready=new Promise(r=>entered=r);
 const {service,guide,call}=await access(t,(_args,signal)=>new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted=true;resolve({ok:false});},{once:true});entered();}));
 const request=call('/execute',{body:{request_id:'active',arguments:{action:'snapshot',tab_id:tab}}}).catch(()=>null);await ready;service.close();await request;
 assert.equal(aborted,true);assert.equal(service.summary().enabled,false);assert.equal(service.guide().token,null);await assert.rejects(fetch(guide.base_url+'/api/browser/v1/status'));await assert.rejects(service.start());
 const next=await access(t,async()=>({ok:true}));assert.notEqual(next.guide.token,guide.token);
 assert.equal((await next.call('/status',{headers:{Authorization:'Bearer '+guide.token}})).status,401);
});
test('a closed browser group expires its capability before accepting an operation',async t=>{
 let alive=true,executions=0;const {call}=await access(t,async()=>{executions++;return {ok:true};},{alive:()=>alive});alive=false;
 assert.equal((await call('/execute',{body:{request_id:'closed',arguments:{action:'tabs'}}})).status,410);assert.equal(executions,0);
});
test('the bounded receipt ledger rejects a full grant without evicting and replaying old effects',async t=>{
 let executions=0;const {call}=await access(t,async()=>({ok:true,sequence:++executions}));
 for(let i=0;i<64;i++)assert.equal((await call('/execute',{body:{request_id:'item-'+i,arguments:{action:'tabs'}}})).body.result.sequence,i+1);
 assert.equal((await call('/execute',{body:{request_id:'overflow',arguments:{action:'tabs'}}})).status,429);
 assert.equal((await call('/execute',{body:{request_id:'item-0',arguments:{action:'tabs'}}})).body.result.sequence,1);assert.equal(executions,64);
});
