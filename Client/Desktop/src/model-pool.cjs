// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: crypto; spec; caps; catalog; PARAM_KEYS; parameters; identity; connectionID; metadata; validateKeyHistory; migrate; kindOf; usable; clearSubconscious; clearRoles; validateRoles; setRole; assignRoles; activate; synchronize; validate; editDraft; openEditor; action
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/model-pool.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const crypto=require('node:crypto');
const spec=()=>require('./spec.cjs');
const caps=require('./model-capabilities.cjs');
const catalog=require('./model-catalog.cjs');
const {supportsImages}=require('./image-capabilities.cjs');
const PARAM_KEYS=['max_tokens','temperature','top_p','thinking_type','reasoning_effort','response_format','stream','stream_include_usage','user_id','model_options'];
const parameters=s=>Object.fromEntries(PARAM_KEYS.map(k=>[k,structuredClone(s[k]??spec().defaults()[k])]));
const identity=s=>require('./provider-settings.cjs').identity(s);
const connectionID=p=>p.connection_id||(['custom','bailian'].includes(identity(p))?identity(p)+'-'+crypto.createHash('sha256').update(String(p.base_url||'').replace(/\/+$/,'')).digest('hex').slice(0,16):identity(p));
function metadata(p){
 const provider=p.provider||identity(p),meta=caps.bundled.providers[provider]?.[p.model]||{};
 return {provider,meta,model:{id:p.model,name:p.name,api_protocol:p.api_protocol,output_limit:p.output_limit||meta.limit?.output||393216,supported_parameters:p.supported_parameters||[]}};
}
function validateKeyHistory(history){
 if(!Array.isArray(history)||history.length>8||history.some(k=>typeof k!=='string'||k.length>4096||/[\r\n]/.test(k)))throw Error('密钥列表格式无效');
}
// 迁移只在内存中完成；真正落盘仍走统一保存与版本锁。现有模型和参数全部保留。
function migrate(input){
 const s=structuredClone(input);
 // Go 的 nil slice 写为 null；Enabled *bool 的 nil（缺省或 null）表示启用。
 // 两个池版本共用读入规范化，保留显式 false，非法值仍报错，不改原对象或磁盘。
 for(const c of s.provider_connections||[]){
  if(c.api_key_history==null)c.api_key_history=[];
  validateKeyHistory(c.api_key_history);
 }
 for(const p of s.api_profiles||[]){
  if(p.enabled==null)p.enabled=true;
  if(typeof p.enabled!=='boolean')throw Error('模型启用状态无效');
 }
 // 保留已保存的 vision 元数据，并补入已实测支持的模型；实际图片权限仍由 activate 的实测矩阵判定。
 if(s.model_pool_version===1){for(const p of s.api_profiles||[]){require('./known-models.cjs').upgrade(p);catalog.initialize(p,s);p.vision=p.vision===true||supportsImages(p);p.parameter_specs=caps.forProfile(p);catalog.migrateThinking(p);}return clearSubconscious(s);}
 let entries=Array.isArray(s.api_profiles)?s.api_profiles:[];
 if(!entries.length&&s.api_key&&s.model)entries=[{id:s.active_profile||s.model,name:spec().lookupModel(s.model)?.name||s.model,model:s.model,base_url:s.base_url,api_key:s.api_key,api_key_history:s.api_key_history||[],api_protocol:s.api_protocol||'responses',adapter:s.adapter||'deepseek',context_window:s.model_context_window||1000000,tool_calls:true,vision:!!spec().lookupModel(s.model)?.vision,parameters:parameters(s)}];
 const active=s.active_profile||s.model;
 s.provider_connections=Array.isArray(s.provider_connections)?s.provider_connections:[];
 s.api_profiles=entries.map(p=>{
  const {provider,meta,model}=metadata(p);const id=connectionID(p);
  p={...p,base_url:require('./api.cjs').normalizeBaseUrl(p.base_url)};
  let c=s.provider_connections.find(x=>x.id===id);
  if(!c){c={id,provider,base_url:p.base_url,api_key:p.api_key||'',api_key_history:p.api_key_history||[],request_timeout_seconds:s.request_timeout_seconds||300};s.provider_connections.push(c);}
  if(p.id===active){c.api_key_history=[...s.api_key_history||p.api_key_history||[],...c.api_key_history||[],c.api_key].filter(Boolean);c.api_key=s.api_key||p.api_key||'';}
  // 旧模型各自保存过的 Key 合并进连接历史；迁移不能因模型顺序丢掉非活动凭据。
  const merged=[...new Set([c.api_key,...c.api_key_history||[],p.api_key,...p.api_key_history||[]].filter(Boolean))];
  if(merged.length>8)throw Error('旧配置同一供应商超过 8 把密钥，请先整理密钥列表后迁移');
  c.api_key_history=merged;
  const opts=structuredClone(p.parameters||parameters(s));opts.model_options||={};
  if(p.id===active)Object.assign(opts,parameters(s));
  if(p.adapter==='openai'&&p.api_protocol==='responses'&&meta.reasoning===true)opts.model_options.reasoning_summary??='auto';
  const next={...p,vision:supportsImages(p),provider,connection_id:id,enabled:p.enabled!==false,reasoning:meta.reasoning===true,output_limit:model.output_limit,parameters:opts};
  delete next.api_key;delete next.api_key_history;
  require('./known-models.cjs').upgrade(next);catalog.initialize(next,s);next.parameter_specs=caps.forProfile(next);catalog.migrateThinking(next);
  // 旧 Router 元数据没有保留参数目录；保留旧参数能力，刷新目录后获得更细的配置。
  if(p.parameters?.max_tokens>0&&!next.parameter_specs.some(x=>x.key==='max_tokens'))next.parameter_specs.unshift({key:'max_tokens',type:'integer',min:1,max:model.output_limit});
  if(p.parameters?.response_format==='json_object'&&!next.parameter_specs.some(x=>x.key==='response_format'))next.parameter_specs.push({key:'response_format',type:'enum',values:['text','json_object']});
  return next;
 });
 if(!s.provider_connections.length&&s.api_key)s.provider_connections.push({id:identity(s),provider:identity(s),base_url:s.base_url,api_key:s.api_key,api_key_history:s.api_key_history||[],request_timeout_seconds:s.request_timeout_seconds||300});
 s.active_profile=s.api_profiles.find(p=>p.id===active&&p.enabled)?.id||'';
 s.matrix_profile=s.matrix_profile||s.active_profile;
 s.model_pool_version=1;return clearSubconscious(s);
}
// Media entries can be stored without a chat probe; only chat entries may own a dialogue role.
const kindOf=p=>['image','video'].includes(p?.kind)?p.kind:'chat';
const usable=(s,id,kind)=>typeof id==='string'&&!!id&&!!s.api_profiles?.some(p=>p.id===id&&p.enabled!==false&&kindOf(p)===kind);
function clearSubconscious(s){
 if(!usable(s,s.subconscious_profile,'chat'))s.subconscious_profile='';
 return clearRoles(s);
}
// 模型连接页的角色键（matrix_alternates / vision_profile / execution_profile / image_profiles）：引用的条目被移除或停用时一起清掉。
// 类型错误留给 validate 报告，这里不静默改写。
function clearRoles(s){
 if(Array.isArray(s.matrix_alternates)&&s.matrix_alternates.every(id=>typeof id==='string'))s.matrix_alternates=[...new Set(s.matrix_alternates)].filter(id=>id!==s.matrix_profile&&usable(s,id,'chat'));
 for(const key of ['vision_profile','execution_profile'])if(typeof s[key]==='string'&&s[key]&&!usable(s,s[key],'chat'))s[key]='';
 if(Array.isArray(s.image_profiles)&&s.image_profiles.every(id=>typeof id==='string'))s.image_profiles=s.image_profiles.filter(id=>s.api_profiles?.some(p=>p.id===id&&p.enabled!==false)).slice(0,1);
 if(typeof s.video_profile==='string'&&s.video_profile&&!s.api_profiles?.some(p=>p.id===s.video_profile&&p.enabled!==false))s.video_profile='';
 s.image_generation_enabled=!!s.image_profiles?.length;
 return s;
}
function validateRoles(s){
 for(const key of ['matrix_alternates','image_profiles'])if(s[key]!==undefined&&(!Array.isArray(s[key])||s[key].length>16||s[key].some(id=>typeof id!=='string'||!id||id.length>200)))throw Error(key+' 需为最多 16 个模型池标识');
 for(const key of ['vision_profile','execution_profile','video_profile'])if(s[key]!==undefined&&typeof s[key]!=='string')throw Error(key+' 需为模型池标识');
 for(const key of ['collaboration_enabled','vision_enabled','execution_enabled'])if(s[key]!==undefined&&typeof s[key]!=='boolean')throw Error(key+' 需为 true 或 false');
 if(s.image_generation_enabled!==undefined&&typeof s.image_generation_enabled!=='boolean')throw Error('image_generation_enabled 需为 true 或 false');
}
function setRole(s,id,role){
 if(!['main','subconscious'].includes(role))throw Error('role 仅支持 main 或 subconscious');
 if(role==='subconscious'&&id===''){s.subconscious_profile='';return s;}
 const p=s.api_profiles.find(p=>p.id===id&&p.enabled!==false);if(!p)throw Error('请先在模型池启用此模型');
 if(kindOf(p)!=='chat')throw Error('媒体模型不能担任对话角色');
 if(role==='main'){s.matrix_profile=id;s.active_profile=id;}else s.subconscious_profile=id;
 return s;
}
function assignRoles(s,id,p,fallback=[]){
 if(p.role!==undefined&&p.roles!==undefined)throw Error('role 和 roles 请只传一项');
 const roles=p.roles??(p.role!==undefined?[p.role]:fallback);
 if(!Array.isArray(roles)||roles.length>2||roles.some(role=>!['main','subconscious'].includes(role))||new Set(roles).size!==roles.length)throw Error('roles 仅支持 main / subconscious');
 for(const role of roles)setRole(s,id,role);return s;
}
function activate(input,p){
 p=require('./known-models.cjs').upgrade(structuredClone(p));
 catalog.initialize(p,input);
 const s={...input};if(p.enabled===false)throw Error('该模型已禁用，请在模型池中启用');
 const c=s.provider_connections?.find(x=>x.id===connectionID(p));
 return {...s,...parameters(p.parameters||{}),compact_at_tokens:p.compact_at_tokens,active_profile:p.id,api_key:c?c.api_key:p.api_key||'',api_key_history:structuredClone(c?.api_key_history||p.api_key_history||[]),base_url:p.base_url,api_protocol:p.api_protocol,adapter:p.adapter,model:p.model,model_context_window:p.context_window,model_vision:supportsImages(p),request_timeout_seconds:c?.request_timeout_seconds||s.request_timeout_seconds||300};
}
function synchronize(s){
 clearSubconscious(s);
 const p=s.api_profiles.find(x=>x.id===s.active_profile&&x.enabled!==false);
 return p?activate(s,p):{...s,active_profile:'',api_key:'',api_key_history:[],model_options:{}};
}
function validate(s,forRequest=false){
 if(s.model_pool_version!==1)return;
 validateRoles(s);clearSubconscious(s);
 if(!Array.isArray(s.api_profiles)||s.api_profiles.length>128)throw Error('模型池最多容纳 128 个模型');
 if(!Array.isArray(s.provider_connections)||s.provider_connections.length>64)throw Error('供应商连接数量无效');
 const ids=new Set(),connections=new Set();
 for(const c of s.provider_connections){
  if(!c.id||connections.has(c.id))throw Error('供应商连接标识重复');connections.add(c.id);
  if(typeof c.api_key!=='string'||c.api_key.length>4096||/[\r\n]/.test(c.api_key))throw Error('接口密钥格式无效');
  validateKeyHistory(c.api_key_history);
  const fixed=require('./provider-settings.cjs').PROVIDERS.find(p=>p.id===c.provider);
  if(c.provider==='bailian')require('./bailian.cjs').assertEndpoint(c.base_url);
  else if(fixed&&fixed.base_url!==c.base_url)throw Error('供应商地址不匹配');
  if(!Number.isInteger(c.request_timeout_seconds)||c.request_timeout_seconds<10||c.request_timeout_seconds>3600)throw Error('请求超时需在 10–3600 秒');
 }
 for(const p of s.api_profiles){
  if(typeof p.enabled!=='boolean')throw Error('模型启用状态无效');
  if(!p.id||ids.has(p.id))throw Error('模型池标识重复');ids.add(p.id);
  if(!connections.has(p.connection_id))throw Error('模型对应的供应商连接不存在');
  const c=s.provider_connections.find(c=>c.id===p.connection_id);
  if(c.base_url!==p.base_url)throw Error('模型与供应商入口不匹配');
  if(p.kind!==undefined&&!['chat','image','video'].includes(p.kind))throw Error('模型类型无效');
  // 生图模型不走对话与工具调用，不需要工具往返或上下文预算。
  if(kindOf(p)==='chat'&&(!Number.isInteger(p.context_window)||p.context_window<catalog.contextMinimum(p)))throw Error('模型缺少有效的上下文预算');
  caps.validate(p);
 }
 if(s.matrix_profile&&!usable(s,s.matrix_profile,'chat'))throw Error('Matrix 必须是池内已启用的对话模型');
 if(s.active_profile&&!s.api_profiles.some(p=>p.id===s.active_profile&&p.enabled!==false))throw Error('当前模型已从模型池移除或禁用');
 if(forRequest&&!s.active_profile)throw Error('请先在模型池启用并选择一个模型');
}
function editDraft(s){
 if(!s.__pool_edit)return s;
 const index=s.api_profiles.findIndex(p=>p.id===s.__pool_edit);if(index<0)throw Error('正在编辑的模型已移除');
 const values=Object.fromEntries(Object.entries(s).filter(([k])=>k.startsWith('__param_')).map(([k,v])=>[k.slice(8),v]));
 s.api_profiles[index]=caps.edit(s.api_profiles[index],values);return s;
}
function openEditor(s,id){
 const p=s.api_profiles.find(p=>p.id===id);if(!p)throw Error('模型池中没有此模型');
 for(const k of Object.keys(s))if(k.startsWith('__param_'))delete s[k];
 s.__pool_edit=id;s.__matrix_model=id;
 for(const f of [...caps.forProfile(p),...catalog.contextFields(p)].filter(f=>['reasoning_effort','reasoning_enabled','reasoning_budget','thinking_type','thinking_mode','context_window'].includes(f.key))){
  let v=caps.get(p,f.key);if(v===undefined||f.key==='max_tokens'&&v===0)v='';
  if(Array.isArray(v))v=v.join('\n');s['__param_'+f.key]=v;
 }
 return s;
}
function action(input,action,id){
 let s=migrate(input);const p=s.api_profiles.find(x=>x.id===id);
 if(action==='edit')return openEditor(editDraft(s),id);
 if(action==='select'){
  if(!p||p.enabled===false)throw Error('请先在模型池启用此模型');
  if(kindOf(p)!=='chat')throw Error('媒体模型不能担任对话角色');
  s=editDraft(s);s.matrix_profile=id;s.active_profile=id;return openEditor(s,id);
 }
 if(action==='cancel'){delete s.__pool_edit;return s;}
 s=editDraft(s);
 if(action==='apply'){delete s.__pool_edit;return s;}
 if(action==='subconscious')return setRole(s,id,'subconscious');
 if(!p)throw Error('模型池中没有此模型');
 const current=s.api_profiles.find(x=>x.id===id);
 if(action==='toggle')current.enabled=!current.enabled;
 else if(action==='matrix'||action==='main'){setRole(s,id,'main');}
 else if(action==='use'){if(!current.enabled)throw Error('请先启用模型');if(kindOf(current)!=='chat')throw Error('媒体模型不能担任对话角色');s.active_profile=id;}
 else if(action==='remove'){s.api_profiles=s.api_profiles.filter(x=>x.id!==id);if(s.__pool_edit===id)delete s.__pool_edit;}
 else throw Error('未知模型池操作');
 if(!s.api_profiles.some(x=>x.id===s.active_profile&&x.enabled))s.active_profile='';
 if(!s.api_profiles.some(x=>x.id===s.matrix_profile&&x.enabled))s.matrix_profile='';
 if(!s.api_profiles.some(x=>x.id===s.__matrix_model&&x.enabled)){
  delete s.__pool_edit;s.__matrix_model='';
  for(const key of Object.keys(s))if(key.startsWith('__param_'))delete s[key];
 }
 return clearSubconscious(s);
}
module.exports={PARAM_KEYS,parameters,connectionID,migrate,activate,synchronize,validate,editDraft,openEditor,action,clearSubconscious,clearRoles,validateRoles,kindOf,setRole,assignRoles};
