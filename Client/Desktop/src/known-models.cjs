// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: bundled; lookup; upgrade
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/known-models.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 精确官方型号优先；原厂事实不赋予第三方入口工具权限。
const bundled=()=>require('./resources.cjs').read('模型资料.json');
function lookup(id){
 const original=String(id||'').replace(/:free$/,''),official=require('./model-catalog.cjs').nativeReference(original);
 const name=official?.id||original;
 if(official)return {
  id:name,reasoning:official.reasoning===true,reasoning_options:structuredClone(official.reasoning_options||[]),
  limit:{context:official.context_window,output:official.max_output,input:official.max_input},
  source:official.verification?.startsWith('official-')?'official_model_reference':'bundled_model_reference',
 };
 if(!/^(gpt-|gemini-|grok-)/.test(name))return null;
 const alias={'gemini-3.1-pro-preview':'gemini-3.1-pro','gemini-3-pro-preview':'gemini-3-pro','gemini-3-flash-preview':'gemini-3-flash'}[name]||name;
 return bundled().providers.opencode?.[alias]||null;
}
function upgrade(p){
 require('./model-catalog.cjs').upgrade(p);
 if(p.provider==='bailian')return p;
 const m=lookup(p.model);if(!m||!['responses','chat_completions','google_generate'].includes(p.api_protocol))return p;
 p.reasoning=m.reasoning===true;
 if((p.context_window_source==='conservative_client_budget'||!p.context_window)&&m.limit?.context>0){p.context_window=m.limit.context;p.context_window_source=m.source||'bundled_model_reference';if(m.limit.output>0)p.output_limit=m.limit.output;}
 if(!p.output_limit)p.output_limit=m.limit.output;
 return p;
}
module.exports={lookup,upgrade};
