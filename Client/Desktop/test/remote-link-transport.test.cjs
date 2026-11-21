// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; modulePath
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/remote-link-transport.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const modulePath=import('../ui/remote-link.mjs');
test('renderer transport sends account metadata and preserves Fetch JSON isolation',async()=>{
 const {remoteLinkTransport}=await modulePath,seen=[],account={userID:19,sessionKey:'fixture-login-0001'},data={success:true,data:{items:[]}};
 const transport=remoteLinkTransport({remoteLink:async p=>{seen.push(p);return {ok:true,status:200,value:data};}},()=>account);
 const result=await transport('https://api.aieyra.cn/api/aieyra/cloud-instances/self?page=1',{method:'GET'});assert.equal(result.ok,true);const json=await result.json();json.data.items.push(1);assert.deepEqual(data.data.items,[]);
 assert.equal(seen[0].userID,19);assert.equal(seen[0].sessionKey,account.sessionKey);assert.equal(Object.hasOwn(seen[0],'headers'),false);assert.equal(Object.hasOwn(seen[0],'cookies'),false);
});
test('transport forwards cancellation and discards a delayed same-user login response',async()=>{
 const {remoteLinkTransport}=await modulePath;let account={userID:19,sessionKey:'fixture-login-0001'},release;const seen=[];
 const transport=remoteLinkTransport({remoteLink:p=>{seen.push(p);return p.action==='request'?new Promise(r=>release=r):Promise.resolve({ok:true});}},()=>account);
 const signal=new AbortController(),pending=transport('https://api.aieyra.cn/api/aieyra/cloud-instances/remote-entitlement',{method:'GET',signal:signal.signal});signal.abort();account={userID:19,sessionKey:'fixture-login-0002'};release({ok:true,status:200,value:{success:true}});
 await assert.rejects(pending,{name:'AbortError'});assert.equal(seen[1].action,'cancel');assert.equal(seen[1].requestID,seen[0].requestID);assert.equal(seen[1].sessionKey,'fixture-login-0001');
});
test('transport preserves service errors and never retries a deployment write',async()=>{
 const {remoteLinkTransport}=await modulePath;let calls=0;const transport=remoteLinkTransport({remoteLink:async()=>{calls++;return {ok:false,code:'remote_service_unavailable',error:'fixture lost receipt'};}},()=>({userID:19,sessionKey:'fixture-login-0001'}));
 await assert.rejects(transport('https://api.aieyra.cn/api/aieyra/cloud-instances/1/remote-deployments',{method:'POST',body:'{}'}),{code:'remote_service_unavailable'});assert.equal(calls,1);
});
