// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: observeUsage; observe
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/model-observation.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 只描述供应商实际返回的公开通道；密文和签名只计数，不伪称可读思考。
function observeUsage(protocol,reply){
 const google=protocol==='google_generate',chat=protocol==='chat_completions';
 const u=(google?reply.usageMetadata||reply.usage:reply.usage||reply.usageMetadata)||{};
 const primary=chat?u.prompt_tokens_details:u.input_tokens_details,secondary=chat?u.input_tokens_details:u.prompt_tokens_details;
 const detail=(chat?u.completion_tokens_details:u.output_tokens_details)||{},fallback=(chat?u.output_tokens_details:u.completion_tokens_details)||{};
 const input=chat?u.prompt_tokens??u.input_tokens:u.input_tokens??u.prompt_tokens;
 const output=chat?u.completion_tokens??u.output_tokens:u.output_tokens??u.completion_tokens;
 const cache=primary?.cached_tokens??secondary?.cached_tokens??u.cache_read_input_tokens??u.prompt_cache_hit_tokens;
 const reasoning=detail.reasoning_tokens??detail.thinking_tokens??fallback.reasoning_tokens??fallback.thinking_tokens;
 return {input_tokens:(google?u.promptTokenCount??input:input??u.promptTokenCount)??null,output_tokens:(google?u.candidatesTokenCount??output:output??u.candidatesTokenCount)??null,cache_read_tokens:(google?u.cachedContentTokenCount??cache:cache??u.cachedContentTokenCount)??null,reasoning_tokens:(google?u.thoughtsTokenCount??reasoning:reasoning??u.thoughtsTokenCount)??null};
}
function observe(protocol,reply){
 let text='',thought='',summary='',encrypted=0,signatures=0,tools=0,completed=false;
 if(protocol==='responses'){
  completed=reply.status==='completed';
  for(const item of reply.output||[]){
   if(item.type==='function_call')tools++;
   if(typeof item.encrypted_content==='string'&&item.encrypted_content)encrypted++;
   for(const p of item.content||[]){if(p.type==='output_text')text+=p.text||'';if(p.type==='reasoning_text')thought+=p.text||'';}
   for(const p of item.summary||[])if(p.type==='summary_text')summary+=p.text||'';
  }
 }else if(protocol==='anthropic_messages'){
  completed=['end_turn','tool_use'].includes(reply.stop_reason);
  for(const p of reply.content||[]){if(p.type==='text')text+=p.text||'';if(p.type==='thinking')thought+=p.thinking||'';if(p.type==='redacted_thinking')encrypted++;if(p.signature)signatures++;if(p.type==='tool_use')tools++;}
 }else if(protocol==='google_generate'){
  completed=reply.candidates?.[0]?.finishReason==='STOP';
  for(const p of reply.candidates?.[0]?.content?.parts||[]){if(p.thought)thought+=p.text||'';else text+=p.text||'';if(p.thoughtSignature)signatures++;if(p.functionCall)tools++;}
 }else{
  const c=reply.choices?.[0];completed=['stop','tool_calls'].includes(c?.finish_reason);text=c?.message?.content||'';thought=c?.message?.reasoning_content||c?.message?.reasoning||'';tools=c?.message?.tool_calls?.length||0;
  for(const d of c?.message?.reasoning_details||[]){if(d.type==='reasoning.summary')summary+=d.summary||'';else if(d.type==='reasoning.text')thought+=d.text||'';else if(d.type==='reasoning.encrypted')encrypted++;}
 }
 const observed={completed,reply_chars:typeof text==='string'?text.length:0,thought_chars:typeof thought==='string'?thought.length:0,summary_chars:summary.length,encrypted_items:encrypted,signature_items:signatures,tool_calls:tools,...observeUsage(protocol,reply)};
 observed.visibility=observed.thought_chars?'text':observed.summary_chars?'summary':encrypted?'encrypted_only':observed.reasoning_tokens>0?'usage_only':'not_observed';
 return observed;
}
module.exports={observe,observeUsage};
