// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: buildRequest; endpointMissing
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/native-protocols.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 连接测试/请求预览的协议镜像；聊天工具事务由 CORE 执行。
function buildRequest(s,messages,stream) {
 const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
 const turns=messages.filter(m=>m.role!=='system');
 if(s.api_protocol==='google_generate') {
  const body={contents:turns.map(m=>({role:m.role==='assistant'?'model':m.role,parts:[{text:m.content}]}))};
  if(system)body.systemInstruction={parts:[{text:system}]};
  if(s.max_tokens>0)body.generationConfig={maxOutputTokens:s.max_tokens};
  return require('./model-capabilities.cjs').apply(s,body);
 }
 const profile=s.api_profiles?.find(p=>p.id===s.active_profile);
 return require('./model-capabilities.cjs').apply(s,{model:s.model,messages:turns.map(m=>({role:m.role,content:[{type:'text',text:m.content}]})),max_tokens:s.max_tokens||profile?.output_limit||8192,stream:!!stream,...(system?{system}:{})});
}
// 选中的接口在这条线路上不存在时才换另一种协议重试：404/405/501，或网关把“未实现”包成 400/500/502。
function endpointMissing(result){
 if(!result||result.ok!==false)return false;
 if([404,405,501].includes(result.status))return true;
 return [400,500,502].includes(result.status)&&/not.?implemented|not.?supported|unsupported|no route|invalid url|unknown (?:url|endpoint|path)|未实现|不支持该接口/i.test((result.errors||[]).join(' '));
}
module.exports={buildRequest,endpointMissing};
