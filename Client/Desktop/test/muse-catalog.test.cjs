// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: catalog
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/muse-catalog.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const catalog=require('../src/model-catalog.cjs'),caps=require('../src/model-capabilities.cjs');

test('Muse catalog separates chat, generation and unavailable video without borrowing OpenCode evidence',()=>{
 for(const base_url of ['https://fast.aieyra.cn/v1']){
  const rows=catalog.rows({base_url},[{id:'muse-spark',api_protocol:'responses',available:false,reason:'not_verified',tool_calls:true}]);
  const spark=rows.find(r=>r.id==='muse-spark'),image=rows.find(r=>r.id==='muse-image'),video=rows.find(r=>r.id==='muse-video');
  assert.equal(spark.available,true);assert.equal(spark.api_protocol,'chat_completions');assert.equal(spark.tool_calls,false);assert.equal(spark.execution_available,false);assert.equal(spark.catalog_context_window,null);
  assert.equal(image.kind,'image');assert.equal(image.available,true);assert.equal(video.available,false);assert.equal(video.kind,'video');
  const p={...spark,model:spark.id,base_url,adapter:'openai',parameters:{max_tokens:500,model_options:{reasoning_effort:'high'}}};catalog.upgrade(p);
  assert.deepEqual(caps.forProfile(p).map(x=>x.key),['stream']);caps.validate(p);assert.throws(()=>caps.edit(p,{max_tokens:100}),/不支持/);
 }
 assert.equal(catalog.find({base_url:'https://opencode.ai/zen/go/v1',model:'muse-spark',api_protocol:'chat_completions'}),undefined);
 assert.equal(catalog.find({base_url:'https://fast.aieyra.cn/v1',model:'muse-spark-1.3-contributor',api_protocol:'chat_completions'}),undefined);
 assert.equal(catalog.provider({base_url:'https://relay.invalid/meta-muse/v1'}),'');
});

test('Muse connection drafts and preview use the same minimal chat contract',()=>{
 const {draftProfile}=require('../host/connection.cjs'),spec=require('../src/spec.cjs');
 const p=draftProfile({model:'muse-spark',base_url:'https://fast.aieyra.cn/v1'});
 assert.equal(p.api_protocol,'chat_completions');assert.equal(p.tool_calls,false);assert.equal(p.response_verified,false);
 const body=spec.buildRequest({...spec.defaults(),...p,max_tokens:1000,model_options:{reasoning_effort:'high'},stream_include_usage:false},[{role:'tool',tool_call_id:'call',content:'fact'}],true);
 assert.deepEqual(Object.keys(body).sort(),['messages','model','stream','stream_options']);assert.deepEqual(body.stream_options,{include_usage:true});assert.equal(body.messages[0].role,'user');assert.match(body.messages[0].content,/fact/);
 assert.throws(()=>draftProfile({model:'muse-spark',base_url:p.base_url,api_protocol:'responses'}),/Chat Completions/);
 assert.throws(()=>draftProfile({model:'muse-image',base_url:p.base_url}),/生成入口/);
});
