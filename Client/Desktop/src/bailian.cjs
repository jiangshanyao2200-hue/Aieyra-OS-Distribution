// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: DEFAULT_BASE_URL; matches; assertEndpoint; contextSource; millionContextModels; contextMetadata; thinkingModels; specs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/bailian.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Official compatible endpoints, including workspace-specific regional domains.
// https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
const DEFAULT_BASE_URL='https://dashscope.aliyuncs.com/compatible-mode/v1';
function matches(raw){
 try{
  const u=new URL(String(raw||''));
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname.replace(/\/+$/,'')==='/compatible-mode/v1'&&
   (['dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','dashscope-us.aliyuncs.com'].includes(u.hostname)||/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(cn-beijing|cn-hongkong|ap-southeast-1|ap-northeast-1)\.maas\.aliyuncs\.com$/.test(u.hostname));
 }catch{return false;}
}
function assertEndpoint(raw){if(!matches(raw))throw Error('百炼地址须为官方地域或业务空间的 HTTPS compatible-mode/v1 地址');}
const contextSource='https://help.aliyun.com/zh/model-studio/text-generation-model';
const millionContextModels=new Set(['qwen3.8-max','qwen3.8-max-0902','qwen3.8-flash','qwen3.7-plus','qwen3.7-plus-2026-05-26','qwen3.7-flash','qwen3.7-flash-2026-07-15']);
function contextMetadata(id){return millionContextModels.has(id)?{context_window:1000000,context_window_source:'official_model_reference',context_window_reference:contextSource}:{context_window:null};}
// Deliberately exact: other families and thinking-only models use their default.
// https://help.aliyun.com/zh/model-studio/deep-thinking
const thinkingModels=new Set(['qwen3.8-max','qwen3.8-max-0902','qwen3.8-flash','qwen3.8-27b','qwen3.7-max','qwen3.7-max-2026-05-20','qwen3.7-max-2026-06-08','qwen3.7-plus','qwen3.7-plus-2026-05-26','qwen3.7-flash','qwen3.7-flash-2026-07-15','qwen3.6-max-preview','qwen3.6-plus','qwen3.6-plus-2026-04-02','qwen3.6-flash','qwen3.6-flash-2026-04-16']);
function specs(m){
 const rows=[{key:'stream',type:'boolean'},{key:'max_tokens',type:'integer',min:1,max:m.output_limit||8192}];
 if(m.api_protocol==='chat_completions'&&thinkingModels.has(m.id))rows.push({key:'reasoning_enabled',type:'boolean',wire_path:['enable_thinking'],source:'https://help.aliyun.com/zh/model-studio/deep-thinking'});
 return rows;
}
module.exports={DEFAULT_BASE_URL,matches,assertEndpoint,specs,contextMetadata};
