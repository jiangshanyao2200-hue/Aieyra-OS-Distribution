// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: crypto; cfg; providers; catalog; protocols; contextParameters; profileInfo; savedConnection; draftProfile; visibleParameters; createConnection
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/connection.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 接入验证只发送一次文字请求；保存复用绑定配置/会话/版本的收据，不再联网。
const crypto=require('node:crypto');
const cfg=require('../src/config.cjs'),spec=require('../src/spec.cjs'),pool=require('../src/model-pool.cjs'),caps=require('../src/model-capabilities.cjs');
const providers=require('../src/provider-settings.cjs'),api=require('../src/api.cjs');
const catalog=require('../src/model-catalog.cjs');
const protocols=['responses','chat_completions','anthropic_messages','google_generate'];
const contextParameters=p=>({...p.parameters,...Object.fromEntries(['context_window','compact_at_tokens'].filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]))});
const profileInfo=p=>p?{...catalog.describe(p),context_window:p.context_window,compact_at_tokens:p.compact_at_tokens,output_limit:p.output_limit,output_reservation:catalog.outputReservation(p)}:{};
function savedConnection(s,p,base){
 if(p.user_slot){const cached=require('../src/user-connections.cjs').draft(s,p.user_slot);if(cached?.base_url===base)return cached;}
 const prior=s.api_profiles.find(x=>x.id===p.profile_id);
 const c=s.provider_connections.find(c=>c.id===(p.connection_id||prior?.connection_id));
 if(c&&c.base_url!==base)throw Error('新地址需要填写对应的密钥');
 return c;
}
function draftProfile(p,row={}) {
 const provider=providers.identity(p),known=provider==='deepseek'&&spec.lookupModel(p.model),protocol=p.api_protocol||row.api_protocol||(provider==='bailian'||catalog.museKind(p)==='chat'?'chat_completions':'responses');
 if(catalog.museKind(p)&&(catalog.museKind(p)!=='chat'||protocol!=='chat_completions'))throw Error('Muse 文本请使用 Chat Completions；媒体需要对应生成入口');
 if(p.user_slot==='bailian')require('../src/bailian.cjs').assertEndpoint(p.base_url);
 if(known&&!['responses','chat_completions'].includes(protocol))throw Error('此 DeepSeek 模型请使用 Responses 或 Chat Completions');
 if(!protocols.includes(protocol))throw Error('请选择支持的接口协议');
 const context=Number(row.context_window),budget=Number.isInteger(context)&&context>=8192&&context<=10000000?context:8192;
 let profile={id:'matrix-'+crypto.createHash('sha256').update((p.connection_id||p.base_url)+'\0'+p.model).digest('hex').slice(0,20),...(p.connection_id?{connection_id:p.connection_id}:{}),name:row.name||p.model,model:p.model,base_url:p.base_url,provider,adapter:known?'deepseek':'openai',api_protocol:protocol,context_window:budget,context_window_source:budget===context?(row.context_window_source||'provider_catalog'):'conservative_client_budget',output_limit:known?spec.MAX_TOKENS_LIMIT:Number.isInteger(row.output_limit)&&row.output_limit>0&&row.output_limit<=10000000?row.output_limit:8192,tool_calls:known?true:row.tool_calls===true,tool_validation:'not_tested',response_verified:false,enabled:true,vision:false,parameters:pool.parameters({...spec.defaults(),max_tokens:0,stream_include_usage:known?true:false,model_options:{}})};
 require('../src/known-models.cjs').upgrade(profile);
 catalog.upgrade(profile);
 profile.parameter_specs=row.api_protocol===protocol&&row.parameter_specs?.length?row.parameter_specs:caps.specs(provider,{id:p.model,api_protocol:protocol,output_limit:profile.output_limit});
 profile=caps.edit(profile,contextParameters(p));catalog.initialize(profile);return profile;
}
function visibleParameters(p){return Object.fromEntries([...caps.forProfile(p),...catalog.contextFields(p)].map(f=>[f.key,f.key==='max_tokens'&&!caps.get(p,f.key)?'':caps.get(p,f.key)??'']));}
function createConnection(file,read,save,recovery) {
 const receipts=new Map();
 function input(p,s){
  const prior=s.api_profiles.find(x=>x.id===p.profile_id);
  const connection=s.provider_connections.find(c=>c.id===p.connection_id);
  const base=require('../src/system-settings.cjs').baseURL(p.base_url||prior?.base_url||connection?.base_url),model=String(p.model||prior?.model||'').trim();
  if(!model||model.length>200||/[\x00-\x1f]/.test(model))throw Error('请选择或填写模型标识');
  let key=String(p.api_key||'').trim();
  if(!key&&prior){
   if(base!==prior.base_url)throw Error('新地址需要填写对应的密钥');
  }
  if(!key)key=savedConnection(s,p,base)?.api_key||'';
  if(!key||key.length>4096||/[\r\n]/.test(key))throw Error('请输入有效密钥');
  if(p.user_slot==='bailian')require('../src/bailian.cjs').assertEndpoint(base);
  return {...p,base_url:base,model,api_key:key,api_protocol:p.api_protocol||(providers.identity({base_url:base})==='bailian'?'chat_completions':'responses')};
 }
 return async function(action,p,session,s){
  if(action==='connection_draft'){
   if(p.user_slot){
    const c=require('../src/user-connections.cjs').draft(s,p.user_slot),fixed=providers.PROVIDERS.find(x=>x.id===p.user_slot);
    const saved=require('../src/user-connections.cjs').find(s,p.user_slot),profile=c&&saved&&c.base_url===saved.base_url&&(s.api_profiles.find(x=>x.id===saved.last_profile&&x.connection_id===saved.id)||s.api_profiles.find(x=>x.id===s.active_profile&&x.connection_id===saved.id)||s.api_profiles.find(x=>x.connection_id===saved.id));
    const models=c?catalog.rows(c,require('../src/catalog-store.cjs').createStore(file).get('catalog:'+providers.catalogID(c))?.models||[]):[];
    return {ok:true,version:cfg.version(file),user_slot:p.user_slot,provider:c?.provider||fixed?.id||'custom',base_url:c?.base_url||fixed?.base_url||(p.user_slot==='aieyra'?require('../src/user-connections.cjs').GATEWAY:''),connection_id:saved?.id||'',has_key:!!c?.api_key,models,profile_id:profile?.id||'',model:c?.model||profile?.model||'',api_protocol:profile?.api_protocol||fixed?.api_protocol||'responses',parameters:profile?visibleParameters(profile):{},parameter_specs:profile?caps.forProfile(profile):[],...profileInfo(profile),matrix_profile:s.matrix_profile,subconscious_profile:s.subconscious_profile};
   }
   const requested=providers.PROVIDERS.find(v=>v.id===p.provider);
   const selected=p.id||s.provider_last_profiles?.[p.provider]||s.matrix_profile||s.active_profile;
   const profile=requested?s.api_profiles.find(x=>x.id===selected&&x.provider===p.provider)||s.api_profiles.find(x=>x.provider===p.provider):s.api_profiles.find(x=>x.id===selected);
   if(requested&&!profile){const c=s.provider_connections.find(c=>c.id===requested.id&&c.base_url===requested.base_url);return {ok:true,version:cfg.version(file),provider:p.provider,base_url:requested.base_url,connection_id:c?.id,has_key:!!c?.api_key};}
   if(!profile)return {ok:true,version:cfg.version(file)};
   return {ok:true,version:cfg.version(file),profile_id:profile.id,connection_id:profile.connection_id,base_url:profile.base_url,model:profile.model,api_protocol:profile.api_protocol,provider:profile.provider,has_key:!!s.provider_connections.find(c=>c.id===profile.connection_id)?.api_key,parameters:visibleParameters(profile),parameter_specs:caps.forProfile(profile),fields:caps.fields(profile,'zh-CN'),observation:profile.response_observation,...profileInfo(profile),matrix_profile:s.matrix_profile,subconscious_profile:s.subconscious_profile};
  }
  if(action==='response_test'){
   for(const [id,r] of receipts)if(r.expires<Date.now())receipts.delete(id);
   if(p.receipt!==false&&receipts.size>=64)throw Error('检测收据过多，请稍后重试');
   const version=cfg.version(file),v=input(p,s),row=p.catalog_row||require('../src/catalog-store.cjs').createStore(file).get('catalog:'+providers.catalogID(v))?.models?.find(m=>m.id===v.model)||{};
   const prior=s.api_profiles.find(x=>x.id===p.profile_id&&x.model===v.model&&x.base_url===v.base_url&&x.api_protocol===v.api_protocol);
   const targetConnection=p.user_slot?'user-'+require('../src/user-connections.cjs').slot(p.user_slot):v.connection_id;
   const profile=prior&&(!targetConnection||prior.connection_id===targetConnection)?caps.edit(structuredClone(prior),contextParameters(p)):draftProfile({...v,connection_id:targetConnection},row);
   const settings={...spec.defaults(),...profile.parameters,base_url:v.base_url,api_key:v.api_key,model:v.model,api_protocol:v.api_protocol,adapter:profile.adapter,active_profile:profile.id,api_profiles:[profile],__diagnostic_session:session,system_prompt:''};
   settings.max_tokens=Math.min(catalog.outputReservation(profile),profile.adapter_package?4096:8192);
   if(profile.adapter_package&&Number(settings.model_options?.reasoning_budget)>3840)throw Error('当前思考预算超过短测试上限');
   const prompt=require('../src/resources.cjs').prompt(settings.response_format==='json_object'?'Matrix/连接检测/JSON响应.txt':'Matrix/连接检测/简短问候.txt');
   const body=spec.buildRequest(settings,[{role:'user',content:prompt}],false),started=performance.now();
   try{
    const reply=await api.requestModel(settings,body);let text='';
    if(v.api_protocol==='responses'&&reply.status==='completed')text=(reply.output||[]).filter(i=>i.type==='message').flatMap(i=>i.content||[]).filter(i=>i.type==='output_text').map(i=>i.text||'').join('');
    if(v.api_protocol==='chat_completions'&&reply.choices?.[0]?.finish_reason==='stop')text=reply.choices[0].message?.content||'';
    if(v.api_protocol==='anthropic_messages'&&reply.stop_reason==='end_turn')text=(reply.content||[]).filter(i=>i.type==='text').map(i=>i.text||'').join('');
    if(v.api_protocol==='google_generate'&&reply.candidates?.[0]?.finishReason==='STOP')text=(reply.candidates[0].content?.parts||[]).filter(i=>!i.thought).map(i=>i.text||'').join('');
    if(typeof text!=='string'||!text.trim())throw Error('模型没有返回完整文字回复');
    text=text.replaceAll(require('../src/runtime-credential.cjs').keyFor(settings),'[redacted]');
    const elapsed_ms=Math.round(performance.now()-started),id=crypto.randomUUID();
    profile.response_verified=true;
    const observation=require('../src/model-observation.cjs').observe(v.api_protocol,reply);
    profile.response_observation={...observation,at:new Date().toISOString(),source:'response_test'};
    if(p.receipt!==false)receipts.set(id,{profile,user_slot:p.user_slot,api_key:v.api_key,version,session,reply:text.replaceAll(v.api_key,'[redacted]').slice(0,160),expires:Date.now()+600000});
    return {ok:true,test_id:id,version,elapsed_ms,prompt,api_protocol:v.api_protocol,model:v.model,response_received:true,tool_roundtrip:false,observation,...profileInfo(profile),parameters:visibleParameters(profile),parameter_specs:caps.forProfile(profile),reply:text.replaceAll(v.api_key,'[redacted]').slice(0,160)};
   }catch(e){
    // 提示之后附上供应商自己的原话（截短、去掉 Key）：只写“稍后重试”看不出到底哪里出了问题。
    const a=e.apiError||{},hint=String(a.hint||'模型测试失败'),said=String(a.message||e.message||'').replace(/\s+/g,' ').trim().slice(0,140);
    const text=(a.status?'HTTP '+a.status+' · ':'')+hint+(said&&!hint.includes(said)?'（'+said+'）':'');
    return {ok:false,status:a.status||0,code:a.code||undefined,elapsed_ms:Math.round(performance.now()-started),prompt,errors:[text.replaceAll(v.api_key,'[redacted]')]};
   }
  }
  if(action==='response_save'){
   const proof=receipts.get(p.test_id);
   if(!proof||proof.session!==session||proof.expires<Date.now())return {ok:false,errors:['请先检测当前模型的响应']};
   if(p.expected_version!==proof.version||cfg.version(file)!==proof.version)return {ok:false,code:'version_conflict',errors:['配置已变化，请重新检测后保存']};
   const profile=structuredClone(proof.profile);profile.connection_id=pool.connectionID(profile);
   const previous=s.provider_connections.find(c=>c.id===profile.connection_id);
   const keys=proof.user_slot?[proof.api_key]:[...new Set([proof.api_key,...previous?.api_key_history||[],previous?.api_key].filter(Boolean))];
   if(keys.length>8)throw Error('此连接已保存8把密钥，请先整理历史');
   const connection={...previous,id:profile.connection_id,provider:profile.provider,base_url:profile.base_url,api_key:proof.api_key,api_key_history:keys,request_timeout_seconds:previous?.request_timeout_seconds||300,last_profile:profile.id,...(proof.user_slot?{user_slot:proof.user_slot}:{})};
   const all=s.api_profiles.filter(x=>x.id!==profile.id&&!(proof.user_slot&&x.connection_id===connection.id&&x.base_url!==connection.base_url)).concat(profile);
   const draft={...s,api_profiles:all,provider_connections:s.provider_connections.filter(c=>c.id!==profile.connection_id).concat(connection),...(proof.user_slot?{user_connections:{...s.user_connections,[proof.user_slot]:connection.id},user_connection_drafts:{...s.user_connection_drafts,[proof.user_slot]:{base_url:profile.base_url,api_key:proof.api_key,model:profile.model}}}:{})};
   pool.assignRoles(draft,profile.id,p,p.activate===false?[]:['main']);
   const next=pool.synchronize(draft),isMain=next.active_profile===profile.id;
   const result=save(next,proof.version);
   let recoverySaved=false;
   if(result.ok){receipts.delete(p.test_id);if(recovery&&isMain)try{recovery.checkpoint(next,profile,proof.api_key);recoverySaved=true;}catch{}}
   return {...result,model_id:profile.id,protocol:profile.api_protocol,context_source:profile.context_window_source,tool_roundtrip:false,...(result.ok?{...(isMain?{verified_response:proof.reply}:{}),recovery_saved:recoverySaved,...(!recoverySaved&&isMain?{warning:'连接已保存，但未能建立恢复点'}:{})}:{})};
  }
  throw Error('未知连接操作');
 };
}
module.exports={createConnection,draftProfile,visibleParameters,savedConnection};
