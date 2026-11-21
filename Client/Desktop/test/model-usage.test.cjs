// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: counters
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/model-usage.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {observe}=require('../src/model-observation.cjs'),{usage}=require('../src/model-diagnostics.cjs');
const counters=(protocol,u)=>{const reply={usage:u},o=observe(protocol,reply),d=usage(reply,protocol);assert.deepEqual(d,{input_tokens:o.input_tokens,output_tokens:o.output_tokens,cache_hit_tokens:o.cache_read_tokens});return o;};
test('Chat counters use Chat fields when relay also sends zero Responses placeholders',()=>{
 const o=counters('chat_completions',{prompt_tokens:28,completion_tokens:19,input_tokens:0,output_tokens:0,prompt_tokens_details:{cached_tokens:7},input_tokens_details:{cached_tokens:0},completion_tokens_details:{reasoning_tokens:3},output_tokens_details:{reasoning_tokens:0}});
 assert.equal(o.input_tokens,28);assert.equal(o.output_tokens,19);assert.equal(o.cache_read_tokens,7);assert.equal(o.reasoning_tokens,3);
});
test('Responses counters use Responses fields when Chat aliases conflict',()=>{
 const o=counters('responses',{prompt_tokens:0,completion_tokens:0,input_tokens:24,output_tokens:16,prompt_tokens_details:{cached_tokens:0},input_tokens_details:{cached_tokens:8},completion_tokens_details:{reasoning_tokens:0},output_tokens_details:{reasoning_tokens:4}});
 assert.equal(o.input_tokens,24);assert.equal(o.output_tokens,16);assert.equal(o.cache_read_tokens,8);assert.equal(o.reasoning_tokens,4);
});
test('authoritative zero is kept even when other protocol aliases are nonzero',()=>{
 for(const protocol of ['chat_completions','responses']){
  const chat=protocol==='chat_completions',o=counters(protocol,{prompt_tokens:chat?0:9,completion_tokens:chat?0:8,input_tokens:chat?9:0,output_tokens:chat?8:0,prompt_tokens_details:{cached_tokens:chat?0:7},input_tokens_details:{cached_tokens:chat?7:0}});
  assert.equal(o.input_tokens,0);assert.equal(o.output_tokens,0);assert.equal(o.cache_read_tokens,0);
 }
});
test('absent counters remain unknown and absent primary fields allow compatibility aliases',()=>{
 for(const protocol of ['chat_completions','responses']){const empty=counters(protocol,{});assert.equal(empty.input_tokens,null);assert.equal(empty.output_tokens,null);assert.equal(empty.cache_read_tokens,null);assert.equal(empty.reasoning_tokens,null);}
 assert.equal(counters('chat_completions',{input_tokens:12,output_tokens:4}).input_tokens,12);
 assert.equal(counters('responses',{prompt_tokens:13,completion_tokens:5}).input_tokens,13);
});
test('Google native counters keep precedence over relay aliases',()=>{
 const reply={usageMetadata:{promptTokenCount:17,candidatesTokenCount:6,cachedContentTokenCount:5,thoughtsTokenCount:3,input_tokens:0,output_tokens:0}};
 const o=observe('google_generate',reply),d=usage(reply,'google_generate');assert.equal(o.input_tokens,17);assert.equal(o.output_tokens,6);assert.equal(o.cache_read_tokens,5);assert.equal(o.reasoning_tokens,3);assert.equal(d.input_tokens,17);
});
