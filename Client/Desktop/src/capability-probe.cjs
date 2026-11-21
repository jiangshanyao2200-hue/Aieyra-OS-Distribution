// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: caps; crypto; candidates; sample; probe
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/capability-probe.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 探测只说明服务端是否接受该请求；不把200当作模型遵循参数的证明。
const caps=require('./model-capabilities.cjs'),pool=require('./model-pool.cjs'),spec=require('./spec.cjs'),api=require('./api.cjs');
const crypto=require('node:crypto');
function candidates(p){
 return caps.forProfile(p).filter(f=>!['stream','thinking_type'].includes(f.key)&&!caps.isSampling(f.key));
}
function sample(f){
 if(f.key==='max_tokens')return Math.min(1024,f.max);
 if(f.type==='boolean')return true;
 if(f.type==='strings')return ['AIEYRA_STOP_71'];
 if(f.type==='enum')return f.values.includes('low')?'low':f.values.includes('auto')?'auto':f.values.includes('json_object')?'json_object':f.values[0];
 if(f.key==='reasoning_budget')return Math.max(f.min,1024);
 return Math.min(f.max,Math.max(f.min,1));
}
async function probe(settings,p,requested,send=api.sample,descriptors){
 if(p.enabled===false)throw Error('请先启用此模型再探测');
 let choices=candidates(p);
 if(descriptors){
  if(!Array.isArray(descriptors)||descriptors.length>8)throw Error('每次最多验证8个新参数');
  const seen=new Set(choices.map(f=>f.key));
  for(const raw of descriptors){const f=require('./parameter-descriptors.cjs').validate(raw);if(f.wire_path.some(k=>caps.isSampling(k)))throw Error('采样参数不再支持配置');if(seen.has(f.key))throw Error('参数已存在，请先使用已有规格');seen.add(f.key);choices.push(f);}
 }
 if(requested){if(!Array.isArray(requested)||requested.length>12||requested.some(k=>!choices.some(f=>f.key===k)))throw Error('探测参数列表无效');choices=choices.filter(f=>requested.includes(f.key));}
 choices=choices.slice(0,12);
 const clean=structuredClone(p);clean.parameters=pool.parameters({...spec.defaults(),max_tokens:1024,thinking_type:'disabled',model_options:{},response_format:'text'});
 const outputLimit=Math.min(p.output_limit||4096,caps.forProfile(p).find(f=>f.key==='max_tokens')?.max||4096);
 clean.parameters.max_tokens=Math.min(1024,outputLimit);
 clean.parameter_specs=[...caps.forProfile(p).filter(f=>f.key!=='max_tokens'),{key:'max_tokens',type:'integer',min:1,max:outputLimit}];
 const results=[],accepted=[],start=Date.now(),session='aieyra-probe-'+crypto.randomUUID();let requests=0;
 async function run(profile){const s=pool.activate({...settings,api_profiles:settings.api_profiles.map(p=>p.id===profile.id?profile:p)},profile);s.request_timeout_seconds=20;s.__diagnostic_session=session;requests++;return send(s);}
 try{await run(clean);}catch(e){return {ok:false,code:'baseline_failed',results:[],status:e.apiError?.status||0,notice:e.apiError?.hint||'基础请求未成功，未继续探测参数'};}
 for(const f of choices){
  if(Date.now()-start>120000){results.push({key:f.key,state:'not_tested',reason:'time_limit'});continue;}
  const value=sample(f);let attempt=structuredClone(clean);attempt.parameter_specs=[...caps.forProfile(attempt).filter(x=>x.key!==f.key),f];
  try{
   if(f.key==='reasoning_budget')attempt.parameters.max_tokens=Math.min(outputLimit,value+256);
   attempt=caps.edit(attempt,{[f.key]:value});
   if(p.adapter==='deepseek'&&f.key==='reasoning_effort')attempt.parameters.thinking_type='enabled';
   const response=await run(attempt);accepted.push({...f,evidence:'request_accepted'});results.push({key:f.key,state:'request_accepted',sample:value,elapsed_ms:response.elapsedMs});
  }catch(e){const status=e.apiError?.status||0;results.push({key:f.key,state:[400,422].includes(status)?'rejected':'inconclusive',status});if([401,402,403,429].includes(status))break;}
 }
 return {ok:true,at:new Date().toISOString(),model:p.model,api_protocol:p.api_protocol,accepted,results,semantic_support:'not_proven',requests};
}
module.exports={probe,candidates};
