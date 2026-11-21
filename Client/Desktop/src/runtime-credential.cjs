// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: identity; keyFor
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/runtime-credential.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 调试凭据与唯一模型身份绑定；只在发送时读取，不进入配置和保存回执。
function identity(settings){
 const selected=settings.api_profiles?.find(p=>p.id===settings.active_profile)?.adapter_package;
 return require('./api.cjs').normalizeBaseUrl(settings.base_url)+'|'+settings.api_protocol+'|'+settings.model+(selected?'|adapter:'+selected.id+'@'+selected.digest:'');
}
function keyFor(settings,env=process.env){
 const profile=settings.api_profiles?.find(p=>p.id===settings.active_profile);
 if(profile&&profile.enabled!==false&&profile.model===settings.model&&profile.base_url===settings.base_url&&profile.api_protocol===settings.api_protocol&&env.AIEYRA_RUNTIME_PROFILE===settings.active_profile&&env.AIEYRA_RUNTIME_PROVIDER_IDENTITY===identity(settings)){
  const key=String(env.AIEYRA_RUNTIME_API_KEY||'').trim();
  if(key&&key.length<=4096&&!/[\r\n]/.test(key))return key;
 }
 return settings.api_key;
}
module.exports={keyFor,identity};
