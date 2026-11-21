// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/provider-probe-session.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {probe}=require('../src/system-settings.cjs'),{providerSessionHeaders}=require('../src/api.cjs');
test('alpha: OpenCode protocol probe includes a stable routing session through tool roundtrip',async t=>{
 const original=global.fetch,seen=[];t.after(()=>{global.fetch=original;});
 global.fetch=async(url,options)=>{
  seen.push(options.headers['x-opencode-session']);
  if(url.endsWith('/models'))return Response.json({data:[{id:'fixture-go'}]});
  const body=JSON.parse(options.body);
  if(body.messages.at(-1)?.role==='tool')return Response.json({choices:[{message:{role:'assistant',content:body.messages.at(-1).content},finish_reason:'stop'}]});
  const fn=body.tools[0].function;
  return Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'call-fixture',type:'function',function:{name:fn.name,arguments:JSON.stringify({token:fn.parameters.properties.token.enum[0]})}}]},finish_reason:'tool_calls'}]});
 };
 const r=await probe({base_url:'https://opencode.ai/zen/go/v1',api_key:'fake',model:'fixture-go',api_protocol:'chat_completions'},'alpha-session');
 assert.equal(r.ok,true);assert.equal(r.tool_calls,true);assert.deepEqual(seen,['alpha-session','alpha-session','alpha-session']);
 assert.deepEqual(providerSessionHeaders('https://other.example/v1','alpha-session'),{});
});
