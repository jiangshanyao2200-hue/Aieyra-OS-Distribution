// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: spec; withLegacyProfiles
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/pool-fixture.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 明确保存两个历史模型，避免测试依赖新版自动添加未选模型。
const spec=require('../src/spec.cjs');
function withLegacyProfiles(s){return {...s,api_profiles:spec.MODELS.map(m=>({id:m.id,name:m.name,model:m.id,adapter:'deepseek',base_url:s.base_url,api_protocol:s.api_protocol,api_key:s.api_key,api_key_history:s.api_key_history||[],context_window:1000000,tool_calls:true,vision:m.vision,parameters:Object.fromEntries(['max_tokens','temperature','top_p','thinking_type','reasoning_effort','response_format','stream','stream_include_usage','user_id'].map(k=>[k,s[k]]))}))};}
module.exports={withLegacyProfiles};
