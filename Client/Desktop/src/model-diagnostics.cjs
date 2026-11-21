// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: crypto; usage; text; complete; toolCalls; diagnose
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/model-diagnostics.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Agent和设置共用的工具往返/缓存检查；只用合成消息，不使用个人Prompt或原会话。
const crypto=require('node:crypto'),spec=require('./spec.cjs'),pool=require('./model-pool.cjs'),caps=require('./model-capabilities.cjs'),api=require('./api.cjs');
function usage(reply,protocol='chat_completions'){
 const u=require('./model-observation.cjs').observeUsage(protocol,reply);
 return {input_tokens:u.input_tokens,output_tokens:u.output_tokens,cache_hit_tokens:u.cache_read_tokens};
}
function text(protocol,r){return protocol==='responses'?(r.output||[]).flatMap(i=>i.content||[]).map(c=>c.text||'').join(''):protocol==='anthropic_messages'?(r.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(''):protocol==='google_generate'?(r.candidates?.[0]?.content?.parts||[]).filter(c=>!c.thought).map(c=>c.text||'').join(''):r.choices?.[0]?.message?.content||'';}
function complete(protocol,r){return protocol==='responses'?r.status==='completed':protocol==='anthropic_messages'?['end_turn','tool_use'].includes(r.stop_reason):protocol==='google_generate'?r.candidates?.[0]?.finishReason==='STOP':['stop','tool_calls'].includes(r.choices?.[0]?.finish_reason);}
function toolCalls(protocol,r){return (protocol==='responses'?r.output?.filter(x=>x.type==='function_call'):protocol==='anthropic_messages'?r.content?.filter(x=>x.type==='tool_use'):protocol==='google_generate'?r.candidates?.[0]?.content?.parts?.filter(x=>x.functionCall):r.choices?.[0]?.message?.tool_calls)||[];}
async function diagnose(input,id,mode='all',send=api.requestModel){
 if(!['all','tools','cache'].includes(mode))throw Error('诊断类型仅支持all/tools/cache');
 const p=input.api_profiles.find(p=>p.id===id);if(!p)throw Error('模型池中没有此模型');const s=pool.activate(input,p);pool.validate(s,true);if(!s.api_key)throw Error('请先配置此供应商的密钥');
 s.max_tokens=Math.min(p.output_limit||2048,2048);s.thinking_type='disabled';s.response_format='text';s.model_options=s.api_protocol==='responses'&&s.adapter==='openai'&&caps.forProfile(p).some(f=>f.key==='reasoning_summary')?{reasoning_summary:'auto'}:{};s.__diagnostic_session='aieyra-diagnostic-'+crypto.randomUUID();
 const protocol=s.api_protocol,report={model:p.model,api_protocol:protocol,at:new Date().toISOString(),mode,requests:0,tools:null,cache:[],errors:[]};
 async function request(body){report.requests++;if(protocol==='responses'&&new URL(s.base_url).hostname==='opencode.ai')body.include=['reasoning.encrypted_content'];return send(s,body);}
 try{
  if(mode!=='cache'){
   const nonce=crypto.randomBytes(6).toString('hex'),challenge=crypto.randomBytes(12).toString('hex'),name='verify_matrix';
   const fn={name,description:'Return the given nonce to receive a separate result.',parameters:{type:'object',properties:{nonce:{type:'string'}},required:['nonce'],additionalProperties:false}};
   const body=spec.buildRequest(s,[{role:'user',content:`Call ${name} with nonce ${nonce}. After the tool result reply with only its value.`}],false);
   if(protocol==='responses')body.tools=[{type:'function',...fn}];else if(protocol==='anthropic_messages')body.tools=[{name,description:fn.description,input_schema:fn.parameters}];else if(protocol==='google_generate')body.tools=[{functionDeclarations:[{name,description:fn.description,parametersJsonSchema:fn.parameters}]}];else body.tools=[{type:'function',function:fn}];
   const first=await request(body);if(!complete(protocol,first))throw Error('工具请求没有完整结束');
   const calls=toolCalls(protocol,first);
   if(calls?.length!==1)throw Error('模型没有返回唯一验证工具');const call=calls[0];
   const callName=protocol==='google_generate'?call.functionCall.name:protocol==='chat_completions'?call.function.name:call.name;
   const args=protocol==='anthropic_messages'?call.input:protocol==='google_generate'?call.functionCall.args:JSON.parse(protocol==='responses'?call.arguments:call.function.arguments);
   if(callName!==name||!args||args.nonce!==nonce||Object.keys(args).length!==1)throw Error('工具参数验证失败');
   if(protocol!=='google_generate'&&!(protocol==='responses'?call.call_id:call.id))throw Error('工具调用标识缺失');
   const follow=structuredClone(body);
   if(protocol==='responses')follow.input.push(...first.output,{type:'function_call_output',call_id:call.call_id,output:challenge});
   else if(protocol==='anthropic_messages')follow.messages.push({role:'assistant',content:first.content},{role:'user',content:[{type:'tool_result',tool_use_id:call.id,content:challenge}]});
   else if(protocol==='google_generate')follow.contents.push(first.candidates[0].content,{role:'user',parts:[{functionResponse:{name,response:{value:challenge}}}]});
   else follow.messages.push(first.choices[0].message,{role:'tool',tool_call_id:call.id,content:challenge});
   const second=await request(follow);report.tools={ok:complete(protocol,second)&&toolCalls(protocol,second).length===0&&text(protocol,second).trim()===challenge,first_usage:usage(first,protocol),second_usage:usage(second,protocol)};
  }
  if(mode!=='tools'){
   const prefix='Fixed synthetic cache reference: alpha 17 beta 29 gamma 41. Preserve order.\n'.repeat(350);
   for(let n=0;n<3;n++){const start=Date.now(),body=spec.buildRequest(s,[{role:'system',content:prefix},{role:'user',content:`Measurement ${n}; reply OK.`}],false);const r=await request(body);report.cache.push({...usage(r,protocol),completed:complete(protocol,r),elapsed_ms:Date.now()-start});}
  }
 }catch(e){report.errors.push({status:e.apiError?.status||0,message:e.apiError?'HTTP '+e.apiError.status+(e.apiError.hint?': '+e.apiError.hint:''):String(e.message).split(s.api_key).join('[redacted]')});}
 return {ok:!report.errors.length&&(report.tools===null||report.tools.ok)&&report.cache.every(r=>r.completed),report};
}
module.exports={diagnose,usage};
