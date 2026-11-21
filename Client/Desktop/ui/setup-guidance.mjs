// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: connectionGuidance; initialGuideVisible
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/setup-guidance.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Connection facts select useful UI actions; they never retry or execute work.
export function connectionGuidance(greeting={},disconnected=false,ready){
 if(disconnected)return {title:'连接暂时中断',reason:'正在恢复与本机服务的连接，聊天记录会保留。',action:'',needsSetup:false};
 // A recent reopen can skip greeting entirely. Model readiness remains the
 // source of truth; a skipped greeting does not make an unconfigured API ready.
 if(ready===false&&greeting.state!=='offline')return {title:'Eyra 尚未连接模型',reason:'请先接入可用的 API，把模型加入模型池，再为 Eyra 选择主模型。',action:'settings',needsSetup:true};
 if(greeting.state!=='offline')return null;
 const detail=String(greeting.detail||greeting.error||'').trim();
 if(/(?:尚未|没有|未|请先).{0,12}(?:配置|设置|输入|接入).{0,12}(?:API|密钥|Key)|(?:API.?Key|密钥).{0,8}(?:未配置|为空|缺失|无效)|\b(?:401|403)\b|unauthorized|invalid.?api.?key/i.test(detail))
  return {title:'Eyra 尚未连接模型',reason:/401|403|unauthorized|invalid/i.test(detail)?'API 身份验证未通过，请检查密钥和账号状态。':'尚未配置可用的 API，请先在设置中接入 Aieyra API 或供应商。',action:'settings',needsSetup:true};
 if(/请先接入|模型池|选择.{0,6}模型|(?:模型|连接).{0,12}(?:不存在|未配置|未选择|未设置|已停用|已删除)|没有可用.{0,6}模型/.test(detail))
  return {title:'Eyra 尚未连接模型',reason:'请先把模型加入模型池，再到“模型连接”为 Eyra 选择主模型。',action:'settings',needsSetup:true};
 if(ready===false)return {title:'Eyra 尚未连接模型',reason:'请检查 API 和模型池配置，再为 Eyra 选择可用的主模型。',action:'settings',needsSetup:true};
 return {title:'Eyra 暂时离线',reason:detail&&!/^(?:您的)?Eyra处于离线状态[。.]?$/.test(detail.replaceAll(' ',''))?detail:'暂未连接成功。请检查网络或服务状态后重试。',action:'retry',needsSetup:false};
}

export function initialGuideVisible(snapshot={},profile={},flow={},dismissed=false){
 if(dismissed||flow.active||flow.submitted||flow.user)return false;
 if(snapshot.session_id&&snapshot.root_id&&snapshot.session_id!==snapshot.root_id)return false;
 return profile.initialized===false||flow.needsSetup===true;
}
