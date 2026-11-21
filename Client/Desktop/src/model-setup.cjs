// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: crypto; spec; PRESETS; LEGACY; KNOWN; ROLE_KEYS; ROLE_TOOLS; SHELL_TOOLS; IMAGE; trim; sameBase; fixedProviders; isImageModel; mediaKind; source; hint; presetOf; displayName; groupOf; thinking; metadataIndex; metadataFor; usd; plain; info; THINKING_PARAMS; parameterList; entry; mask; connections; roles; presets; view; catalogRow; cleanKey; bindAieyra; aieyraID; bindAieyraKey; setKeyEnabled; addKey; editKey; removeKeys; prune; chatProfile; imageProfile; setRoles; setThinking; editThinking; THINK_KEYS; overlayThinking; agentThinking; setParam; setContext; imageEntry; redactKey; fallbackProtocol; failure; createModelSetup
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/model-setup.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 设置 · 模型（2026-10-14 轨 S）：Aieyra API、供应商、模型连接三页共用的后端。
// 用户只配两件事：模型池（Aieyra 一个池、供应商一个池）和基础模型（模型连接页）。
// 渲染层只拿到 Key 的末四位；Key 原文只在本进程与配置文件里，报错文字也先去掉 Key。
const crypto=require('node:crypto');
const spec=require('./spec.cjs'),pool=require('./model-pool.cjs'),caps=require('./model-capabilities.cjs');
const {GATEWAY,isAieyra}=require('./user-connections.cjs'),AIEYRA='user-aieyra';
// 供应商页“添加供应商”的可选项。固定供应商沿用 provider-settings 的身份与地址；其余是带预设地址的第三方连接。
// 用户 2026-10-16：只留 DeepSeek、阿里云百炼与自定义；OpenRouter、OpenCode 之后再适配。旧配置里已有的连接照常识别。
const PRESETS=[
 {id:'deepseek',name:'DeepSeek',fixed:true},
 {id:'bailian',name:'阿里云百炼',fixed:true},
 {id:'custom',name:'自定义'},
];
const LEGACY=[
 {id:'openai',name:'OpenAI',base_url:'https://api.openai.com/v1',api_protocol:'responses'},
 {id:'anthropic',name:'Anthropic',base_url:'https://api.anthropic.com/v1',api_protocol:'anthropic_messages'},
 {id:'gemini',name:'Gemini',base_url:'https://generativelanguage.googleapis.com/v1beta/openai',api_protocol:'chat_completions'},
 {id:'openrouter',name:'OpenRouter',fixed:true},
 {id:'opencode',name:'OpenCode Zen',fixed:true},
 {id:'opencode-go',name:'OpenCode Go',fixed:true},
];
const KNOWN=[...PRESETS,...LEGACY];
const ROLE_KEYS=['matrix_profile','matrix_alternates','subconscious_profile','vision_profile','execution_profile','collaboration_enabled','vision_enabled','execution_enabled','vision_tools','execution_tools','image_profiles','image_generation_enabled','video_profile'];
// Same official Agent definitions as Core; selecting exec_command adds its shell companions.
const ROLE_TOOLS=require('../../../Agent/official/definitions.cjs').toolChoices();
const SHELL_TOOLS=['terminal','write_stdin','read_shell_output'];
const IMAGE=/(^|[\/:_.-])(gpt-image|dall-e|imagen|flux|seedream|seededit|cogview|kolors|stable-diffusion|sdxl|sd3|midjourney|recraft|ideogram|jimeng|wanx|qwen-image|hunyuan-image)|(^|[-_])image($|[-_.])|text-to-image|(^|[-_])t2i($|[-_])/i;
const trim=v=>String(v||'').replace(/\/+$/,'');
const sameBase=(a,b)=>trim(a)===trim(b);
const fixedProviders=()=>require('./provider-settings.cjs').PROVIDERS;
function isImageModel(row){
 if(!row)return false;
 if(row.kind==='image'||row.image_generation===true)return true;
 if(Array.isArray(row.output_modalities)&&row.output_modalities.includes('image'))return true;
 if(Array.isArray(row.architecture?.output_modalities)&&row.architecture.output_modalities.includes('image'))return true;
 return IMAGE.test(String(row.id||row.model||''));
}
function mediaKind(row){
 if(row?.kind==='video'||row?.video_generation===true||row?.output_modalities?.includes('video')||row?.architecture?.output_modalities?.includes('video')||/(?:^|[\/:_.-])(?:video|veo|sora|kling)(?:$|[\/:_.-])|text-to-video/i.test(String(row?.id||row?.model||'')))return 'video';
 return isImageModel(row)?'image':'chat';
}
const source=p=>isAieyra(p)?'aieyra':'provider';
// 末四位提示：短 Key 不显示任何字符。
const hint=key=>{const k=String(key||'');return k.length>=12?k.slice(-4):'';};
function presetOf(c){
 if(c.preset&&KNOWN.some(p=>p.id===c.preset))return c.preset;
 if(c.provider&&c.provider!=='custom')return c.provider;
 return KNOWN.find(p=>p.base_url&&sameBase(p.base_url,c.base_url))?.id||'custom';
}
function displayName(c){
 if(sameBase(c.base_url,GATEWAY))return 'Aieyra';
 if(c.name&&c.name!==c.provider)return c.name;
 const preset=KNOWN.find(p=>p.id===presetOf(c));if(preset&&preset.id!=='custom')return preset.name;
 try{return new URL(c.base_url).host;}catch{return c.name||c.id;}
}
// 每把 Key 是一条 provider_connection；同一供应商的多把 Key 在界面上归成一组。
function groupOf(c){const preset=presetOf(c);return preset==='custom'||preset==='bailian'?preset+'|'+trim(c.base_url)+'|'+displayName(c):preset;}
function thinking(p){
 let specs;try{specs=caps.forProfile(p);}catch{return null;}
 const always=require('./model-catalog.cjs').rule(p)?.always_thinking;
 const adjustable=specs.filter(f=>(f.type!=='enum'||f.values.length>1)&&!(always&&['reasoning_enabled','thinking_type','thinking_mode'].includes(f.key)));
 const effort=adjustable.find(f=>f.key==='reasoning_effort');
 const f=effort||adjustable.find(f=>f.key==='thinking_mode')||adjustable.find(f=>f.key==='reasoning_enabled'||f.key==='thinking_type')||adjustable.find(f=>f.key==='reasoning_budget');if(!f)return null;
 const values=f.type==='boolean'?[true,false]:f.values?[...f.values]:[];
 let value=caps.get(p,f.key);
 if(effort&&specs.some(x=>x.key==='thinking_type')&&caps.get(p,'thinking_type')==='disabled'&&values.includes('none'))value='none';
 const budget=caps.get(p,'reasoning_budget'),budgetActive=specs.some(x=>x.key==='reasoning_budget')&&Number.isInteger(budget);
 const off=specs.some(x=>x.key==='reasoning_enabled'&&caps.get(p,x.key)===false||['thinking_type','thinking_mode'].includes(x.key)&&caps.get(p,x.key)==='disabled');
 const inactive=!!effort&&value!=='none'&&(budgetActive||off);
 const hint=inactive?(off?'思考已关闭；选择强度后开启。':'当前使用思考预算；选择强度后替换预算。'):'';
 return {key:f.key,label:caps.labels[f.key]?.[0]||f.key,type:f.type,values,min:f.min,max:f.max,value:value===undefined||value===null?'':value,inactive,hint};
}
// 悬停卡片的资料：价格、介绍、能力。只来自随版本附带的目录与元数据，不联网、不含 Key。
let metadataIndex=null,metadataSource=null;
function metadataFor(model,provider){
 const source=require('./resources.cjs').read('模型资料.json');
 if(!metadataIndex||metadataSource!==source){
  metadataSource=source;metadataIndex=new Map();
  for(const rows of Object.values(source.providers||{}))for(const [id,m] of Object.entries(rows||{})){
   const prior=metadataIndex.get(id);metadataIndex.set(id,prior===undefined?m:require('node:util').isDeepStrictEqual(prior,m)?prior:null);
  }
 }
 const key=String(model||'');return source.providers?.[provider]?.[key]||metadataIndex.get(key)||null;
}
const usd=v=>v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v))?Math.round(Number(v)*10000)/10000:null;
const plain=v=>typeof v==='string'?v.replace(/[\x00-\x1f]/g,' ').trim().slice(0,600):'';
function info(p){
 const catalog=require('./model-catalog.cjs'),id=p.model||p.id,native=catalog.nativeReference(id),legacy=metadataFor(id,p.provider);
 const m=native?{...legacy,...native.reference_metadata,family:native.family||native.reference_metadata?.family,reasoning:native.reasoning,limit:{context:native.context_window,output:native.max_output}}:legacy;
 const c=p.cost||m?.cost,pr=p.pricing,placeholder=p.context_window_source==='conservative_client_budget';
 let price=null;
 if(c&&(usd(c.input)!==null||usd(c.output)!==null))price={currency:'USD',input:usd(c.input),output:usd(c.output),cache_read:usd(c.cache_read)};
 else if(pr&&(usd(pr.prompt)!==null||usd(pr.completion)!==null))price={currency:'USD',input:usd(pr.prompt)===null?null:usd(Number(pr.prompt)*1e6),output:usd(pr.completion)===null?null:usd(Number(pr.completion)*1e6),cache_read:null};
 let summary='';try{const d=require('./model-catalog.cjs').describe({...p,model:p.model||p.id,parameters:{}});if(d?.summary_zh&&d.summary_zh!=='资料未核实，请先检测响应')summary=d.summary_zh;}catch{}
 return {
  family:plain(m?.family||''),summary:plain(summary),description:plain(p.description||m?.description||''),
  price,free:p.free===true,
  context_window:catalog.contextLimit({...p,model:id})||(!placeholder&&Number.isInteger(p.context_window)&&p.context_window>0?p.context_window:Number.isInteger(m?.limit?.context)?m.limit.context:0),
  max_output:catalog.capacityReference({...p,model:id})?.max_output||(!placeholder&&Number.isInteger(p.output_limit)&&p.output_limit>0?p.output_limit:Number.isInteger(m?.limit?.output)?m.limit.output:0),
  reasoning:typeof p.reasoning==='boolean'?p.reasoning:typeof m?.reasoning==='boolean'?m.reasoning:null,
  tool_calls:p.tool_calls===true?true:p.tool_validation==='not_tested'||p.reason==='not_verified'||placeholder?null:typeof p.tool_calls==='boolean'?p.tool_calls:null,
  vision:p.vision===true?true:null,
  source:(native?.verification?.startsWith('official-')?'原厂资料':native?.reference_source?'models.dev 参考':m?'随版本资料':'')+(native&&native.id!==String(id).replace(/:free$/,'')?' · 按 '+native.id+' 对照':''),
  reference_date:native?.reference_source?.date||'',
  reference_tool_calls:typeof m?.tool_call==='boolean'?m.tool_call:null,
  reference_vision:Array.isArray(m?.modalities?.input)?m.modalities.input.includes('image'):null,
  tool_validation:p.tool_validation||'',
 };
}
// 用户 2026-10-18：这里只配置有依据的思考控制与每个模型的上下文窗口。
const THINKING_PARAMS=['reasoning_effort','reasoning_enabled','thinking_type','thinking_mode','reasoning_budget'];
function parameterList(p){
 let specs;try{specs=caps.forProfile(p);}catch{return [];}
 const primary=thinking(p)?.key;
 const always=require('./model-catalog.cjs').rule(p)?.always_thinking;
 return specs.filter(f=>THINKING_PARAMS.includes(f.key)&&f.key!==primary&&!(always&&['reasoning_enabled','thinking_type','thinking_mode'].includes(f.key))&&!(specs.find(x=>x.key==='reasoning_effort')?.values.includes('none')&&['thinking_type','reasoning_enabled'].includes(f.key))&&!(f.type==='enum'&&f.values.length<2)).map(f=>({key:f.key,label:caps.labels[f.key]?.[0]||f.key,type:f.type,values:f.type==='enum'?[...f.values]:f.type==='boolean'?[true,false]:undefined,min:f.min,max:f.max,value:caps.get(p,f.key)??''}));
}
function entry(p){
 const kind=pool.kindOf(p);
 const catalog=require('./model-catalog.cjs');
 const compactLimit=catalog.compactInputLimit(p);
 return {id:p.id,name:String(p.name||p.model),model:p.model,connection_id:p.connection_id,provider:p.provider||'',source:source(p),kind,video_verified:catalog.museKind(p)==='video',enabled:p.enabled!==false,vision:p.vision===true,free:p.free===true,context_window:Number.isInteger(p.context_window)?p.context_window:0,context_limit:catalog.contextLimit(p),context_min:catalog.contextMinimum(p),compact_at_tokens:p.compact_at_tokens,compact_preset:p.compact_preset,compact_limit:catalog.compactTargetLimit(p),compact_effective_tokens:Math.floor(Math.min(p.compact_at_tokens??200000,compactLimit)*.8),compact_recommended:200000,thinking:kind==='chat'?thinking(p):null,thinking_always:catalog.rule(p)?.always_thinking===true,parameters:kind==='chat'?parameterList(p):[],info:info(p)};
}
// Key 中间截断：只露前 3 位和末 4 位；短 Key 全部遮住。
const mask=key=>{const k=String(key||'');return k.length>=16?k.slice(0,3)+'••••••'+k.slice(-4):k?'••••':'';};
function connections(s){
 return (s.provider_connections||[]).map(c=>({id:c.id,provider:c.provider,preset:presetOf(c),group:groupOf(c),name:displayName(c),key_name:typeof c.key_name==='string'?c.key_name:'',token_id:typeof c.token_id==='string'?c.token_id:'',account_id:typeof c.account_id==='string'?c.account_id:'',base_url:c.base_url,key_hint:hint(c.api_key),key_mask:mask(c.api_key),has_key:!!c.api_key,enabled:c.enabled!==false,source:source(c),models:(s.api_profiles||[]).filter(p=>p.connection_id===c.id).length}));
}
function roles(s){const d=spec.defaults();return Object.fromEntries(ROLE_KEYS.map(k=>[k,structuredClone(s[k]??d[k]??null)]));}
function presets(){
 const fixed=fixedProviders();
 // 官方 DeepSeek 与百炼只要 Key；自定义填名称、地址、Key。
 return PRESETS.map(p=>({id:p.id,name:p.name,base_url:p.fixed?fixed.find(f=>f.id===p.id)?.base_url||'':p.base_url||'',editable_base:p.id==='custom'}));
}
function view(s){
 const aieyra=(s.provider_connections||[]).find(c=>c.id===AIEYRA);
 const draft=s.user_connection_drafts?.aieyra;
 return {features:require('./resources.cjs').releaseStage(),connections:connections(s),models:(s.api_profiles||[]).map(entry),roles:roles(s),presets:presets(),
  aieyra:{connection_id:aieyra?AIEYRA:'',key_hint:hint(aieyra?.api_key),pending:!!draft?.api_key&&sameBase(draft.base_url,GATEWAY)&&draft.api_key!==aieyra?.api_key}};
}
function catalogRow(m,s,c){
 const pooled=(s.api_profiles||[]).find(p=>p.connection_id===c.id&&p.model===m.id);
 return {id:m.id,name:String(m.name||m.id),kind:mediaKind(m),available:m.available===true,free:m.free===true,context_window:Number.isInteger(m.context_window)?m.context_window:0,tier:typeof m.tier==='string'?m.tier:'',reference_only:m.reference_only===true,in_pool:!!pooled,pool_id:pooled?.id||'',info:info({...m,model:m.id,base_url:c.base_url,provider:c.provider})};
}
function cleanKey(raw){
 const key=String(raw||'').trim();
 if(!key||key.length>4096||/[\s\x00-\x1f]/.test(key))throw Error('请输入有效的 Key');
 return key;
}
// 选中的 Aieyra 账号 Key 由宿主写在 user_connection_drafts.aieyra；这里把它收成 user-aieyra 连接，渲染层不经手 Key。
function bindAieyra(s){
 const d=s.user_connection_drafts?.aieyra;
 if(!d?.api_key||!sameBase(d.base_url,GATEWAY))throw Error('请先登录 Aieyra 并选择 Key');
 const prior=s.provider_connections.find(c=>c.id===AIEYRA);
 if(prior?.api_key===d.api_key&&prior.base_url===GATEWAY)return false;
 const history=[...new Set([d.api_key,prior?.api_key,...prior?.api_key_history||[]].filter(Boolean))].slice(0,8);
 s.provider_connections=s.provider_connections.filter(c=>c.id!==AIEYRA).concat({...prior,id:AIEYRA,provider:'custom',name:'Aieyra',base_url:GATEWAY,api_key:d.api_key,api_key_history:history,request_timeout_seconds:prior?.request_timeout_seconds||300,user_slot:'aieyra'});
 s.user_connections={...s.user_connections,aieyra:AIEYRA};
 return true;
}
// Aieyra 账号里的每把 Key 各是一条连接 user-aieyra-<编号>；Key 原文由宿主写在 aieyra_key_drafts，渲染层不经手。
const aieyraID=token=>'user-aieyra-'+token;
function bindAieyraKey(s,p){
 const token=String(p.token_id||'');if(!/^[1-9]\d{0,15}$/.test(token))throw Error('Key 编号无效');
 const d=s.aieyra_key_drafts?.[token];
 if(!d?.api_key)throw Error(s.official_account?.user?.id?'请先同步当前账号的 Key':'请先登录 Aieyra');
 if(d.account_id&&d.account_id!==s.official_account?.user?.id)throw Error('账号已变化，请重新同步 Key');
 const id=aieyraID(token),prior=s.provider_connections.find(c=>c.id===id);
 if(prior?.account_id&&d.account_id&&prior.account_id!==d.account_id)throw Error('这把 Key 属于其他账号，请检查账号');
 const name=String(d.name||prior?.key_name||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,80);
 if(prior?.api_key===d.api_key&&prior.key_name===name&&prior.account_id===d.account_id)return false;
 if(!prior&&s.provider_connections.length>=64)throw Error('最多保存 64 把 Key');
 s.provider_connections=s.provider_connections.filter(c=>c.id!==id).concat({...prior,id,provider:'custom',name:'Aieyra',key_name:name,token_id:token,account_id:d.account_id,base_url:GATEWAY,api_key:d.api_key,api_key_history:[...new Set([d.api_key,prior?.api_key].filter(Boolean))].slice(0,8),request_timeout_seconds:prior?.request_timeout_seconds||300,enabled:prior?.enabled!==false});
 return true;
}
// 禁用一把 Key：它加进模型池的模型一并移出（用户 2026-10-16）；获取模型列表跳过禁用的 Key。
function setKeyEnabled(s,p){
 const c=s.provider_connections.find(c=>c.id===p.connection_id);if(!c)throw Error('Key 不存在，请重新读取');
 if(typeof p.enabled!=='boolean')throw Error('启用状态无效');
 c.enabled=p.enabled;
 if(!p.enabled)s.api_profiles=s.api_profiles.filter(x=>x.connection_id!==c.id);
 return prune(s);
}
function addKey(s,p){
 const key=cleanKey(p.api_key),preset=KNOWN.find(x=>x.id===p.preset&&(PRESETS.includes(x)||p.existing===true));if(!preset)throw Error('未知供应商');
 const fixed=fixedProviders().find(x=>x.id===preset.id);
 const base=fixed&&(!fixed.editable_base||!p.base_url)?fixed.base_url:require('./system-settings.cjs').baseURL(p.base_url||preset.base_url||fixed?.base_url);
 if(preset.id==='bailian')require('./bailian.cjs').assertEndpoint(base);
 if(sameBase(base,GATEWAY))throw Error('Aieyra 的 Key 请在 Aieyra API 页选择');
 if(s.provider_connections.some(c=>sameBase(c.base_url,base)&&(c.api_key===key||c.api_key_history?.includes(key))))throw Error('这把 Key 已经添加过');
 if(s.provider_connections.length>=64)throw Error('最多保存 64 把 Key');
 const suffix=()=>crypto.randomBytes(4).toString('hex');
 let id=fixed?(preset.id==='bailian'?pool.connectionID({base_url:base}):fixed.id):'connection-'+suffix();
 while(s.provider_connections.some(c=>c.id===id))id=(fixed?fixed.id:'connection')+'-'+suffix();
 let name=String(p.name||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,40);
 if(!name)name=preset.id==='custom'?new URL(base).host:preset.name;
 s.provider_connections.push({id,provider:fixed?fixed.id:'custom',name,...(fixed?{}:{preset:preset.id}),base_url:base,api_key:key,api_key_history:[key],request_timeout_seconds:300,enabled:true});
 return id;
}
// Edit an existing provider Key through the common connection updater and CAS
// commit below. No catalog/probe/add operation or second configuration writer.
function editKey(s,p){
 const c=s.provider_connections.find(c=>c.id===p.connection_id);
 if(!c||source(c)!=='provider'||c.user_slot==='aieyra'||c.token_id||c.account_id)throw Error('请选择现有的供应商 Key');
 const current=presetOf(c),selected=p.preset??current;
 const preset=KNOWN.find(x=>x.id===selected&&(PRESETS.includes(x)||selected===current));
 if(!preset)throw Error('未知供应商平台');
 const patch=p.patch??{};
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('连接编辑内容无效');
 const fixed=fixedProviders().find(x=>x.id===preset.id);
 const raw=Object.hasOwn(patch,'base_url')?patch.base_url:selected!==current&&fixed?fixed.base_url:c.base_url;
 if(typeof raw!=='string')throw Error('接口地址无效');
 const base=require('./system-settings.cjs').baseURL(raw);
 if(sameBase(base,GATEWAY))throw Error('Aieyra 的 Key 请在 Aieyra API 页选择');
 if(!['custom','bailian'].includes(selected)&&selected===current&&!sameBase(base,c.base_url))throw Error('修改此平台地址前请先选择自定义');
 const next=require('./agent-connections.cjs').edit(s,{connection_id:c.id,provider:fixed?.id||'custom',patch:{...patch,base_url:base},replace_key:p.replace_key});
 const edited=next.provider_connections.find(x=>x.id===c.id);
 if(fixed)delete edited.preset;else edited.preset=preset.id;
 return next;
}
function removeKeys(s,ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>64)throw Error('请选择要移除的 Key');
 for(const id of ids){
  const c=s.provider_connections.find(c=>c.id===id);if(!c)throw Error('Key 不存在，请重新读取');
  const gone=new Set([c.api_key,...c.api_key_history||[]].filter(Boolean));
  s.api_profiles=s.api_profiles.filter(p=>p.connection_id!==id);
  s.provider_connections=s.provider_connections.filter(x=>x.id!==id);
  s.user_connections=Object.fromEntries(Object.entries(s.user_connections||{}).filter(([,v])=>v!==id));
  // 旧连接页缓存的草稿里如果还是这把 Key，一并删除。
  s.user_connection_drafts=Object.fromEntries(Object.entries(s.user_connection_drafts||{}).filter(([,d])=>!gone.has(d?.api_key)));
 }
 prune(s);
}
function prune(s){
 const chat=id=>s.api_profiles.some(p=>p.id===id&&p.enabled!==false&&pool.kindOf(p)==='chat');
 if(!chat(s.matrix_profile))s.matrix_profile='';
 if(!chat(s.active_profile))s.active_profile=s.matrix_profile;
 return pool.clearSubconscious(s);
}
function chatProfile(s,id){
 const p=s.api_profiles.find(x=>x.id===id&&x.enabled!==false);if(!p)throw Error('请先把模型加入模型池');
 if(pool.kindOf(p)!=='chat')throw Error('生图模型不能担任对话角色');return id;
}
function imageProfile(s,id){
 const p=s.api_profiles.find(x=>x.id===id&&x.enabled!==false);if(!p)throw Error('请先把模型加入模型池');
 return id;
}
function setRoles(s,p){
 const list=(value,key,check)=>{if(!Array.isArray(value)||value.length>16||value.some(v=>typeof v!=='string'))throw Error(key+' 需为最多 16 个模型池标识');return [...new Set(value)].map(id=>check(s,id));};
 if(!ROLE_KEYS.some(k=>p[k]!==undefined))throw Error('没有要修改的模型连接');
 if(p.matrix_profile!==undefined){if(!p.matrix_profile)throw Error('Eyra 需要一个主模型');pool.setRole(s,chatProfile(s,p.matrix_profile),'main');}
 if(p.subconscious_profile!==undefined){if(p.subconscious_profile==='')s.subconscious_profile='';else pool.setRole(s,chatProfile(s,p.subconscious_profile),'subconscious');}
 for(const key of ['vision_profile','execution_profile'])if(p[key]!==undefined)s[key]=p[key]===''?'':chatProfile(s,p[key]);
 if(p.collaboration_enabled!==undefined){if(typeof p.collaboration_enabled!=='boolean')throw Error('团队协同开关需为 true 或 false');s.collaboration_enabled=p.collaboration_enabled;}
 for(const key of ['vision_enabled','execution_enabled'])if(p[key]!==undefined){if(typeof p[key]!=='boolean')throw Error(key+' 需为 true 或 false');s[key]=p[key];}
 for(const key of ['vision_tools','execution_tools']){
  if(p[key]===undefined)continue;
  if(p[key]===null){delete s[key];continue;}
  if(!Array.isArray(p[key])||p[key].some(v=>typeof v!=='string'||!ROLE_TOOLS[key].includes(v)))throw Error(key+' 只能从这些工具里选：'+ROLE_TOOLS[key].join('、'));
  let list=[...new Set(p[key])];
  list=list.filter(v=>!SHELL_TOOLS.includes(v));if(list.includes('exec_command'))list.push(...SHELL_TOOLS);
  s[key]=ROLE_TOOLS[key].filter(v=>list.includes(v));
 }
 if(p.matrix_alternates!==undefined)s.matrix_alternates=list(p.matrix_alternates,'matrix_alternates',chatProfile).filter(id=>id!==s.matrix_profile);
 if(p.video_profile!==undefined)s.video_profile=p.video_profile===''?'':imageProfile(s,p.video_profile);
 if(p.image_profiles!==undefined){if(!Array.isArray(p.image_profiles)||p.image_profiles.length>1)throw Error('请选择一个默认生图模型');s.image_profiles=list(p.image_profiles,'image_profiles',imageProfile);}
 // The legacy flag is a derived compatibility field, never a separate switch.
 s.image_generation_enabled=!!s.image_profiles?.length;
 return s;
}
function setThinking(s,p){
 const i=s.api_profiles.findIndex(x=>x.id===p.id);if(i<0)throw Error('模型池中没有此模型');
 const profile=s.api_profiles[i],t=pool.kindOf(profile)==='chat'?thinking(profile):null;
 if(!t||t.key!==p.key)throw Error('此模型没有可调的思考参数');
 const raw=p.value;
 if(t.type==='integer')return setParam(s,p,true);
 if(raw!==''&&raw!==null&&!t.values.some(v=>String(v)===String(raw)))throw Error('思考参数取值无效');
 const value=raw===''||raw===null?null:t.type==='boolean'?String(raw)==='true':raw;
 s.api_profiles[i]=editThinking(profile,t.key,value);
 return s;
}
// 开关、强度和预算不能留下互相冲突的旧值；“自动”恢复该模型的供应商默认。
function editThinking(profile,key,value){
 const defs=caps.forProfile(profile),has=k=>defs.some(f=>f.key===k),patch={[key]:value};
 const clear=k=>{if(has(k))patch[k]=null;};
 if(key==='reasoning_effort'){
  clear('reasoning_budget');
  for(const k of ['reasoning_enabled','thinking_type','thinking_mode'])if(has(k)){
   const f=defs.find(f=>f.key===k);
   patch[k]=value===null?null:k==='reasoning_enabled'?value!=='none':value==='none'?'disabled':f.values?.includes('adaptive')?'adaptive':'enabled';
  }
 }else if(key==='reasoning_budget'){
  clear('reasoning_effort');
  if(value!==null)for(const k of ['reasoning_enabled','thinking_type','thinking_mode'])if(has(k))patch[k]=k==='reasoning_enabled'?true:'enabled';
 }else if(value===false||value==='disabled'){
  clear('reasoning_effort');clear('reasoning_budget');
 }
 return caps.edit(profile,patch);
}
// 智能体自己的思考档位：不改模型池，只算出要叠在该模型参数上的思考键，随智能体保存。
// 选中“跟随模型”时补丁为空；Core 只接受这些键。
const THINK_KEYS=['reasoning_effort','thinking_type','thinking_mode','reasoning_enabled','reasoning_budget'];
function overlayThinking(profile,patch){
 const out=structuredClone(profile),params=out.parameters=out.parameters&&typeof out.parameters==='object'?out.parameters:{};
 const put=(into,k,v)=>{if(!THINK_KEYS.includes(k))return;if(v===null)delete into[k];else into[k]=v;};
 for(const [k,v] of Object.entries(patch||{})){
  if(k==='model_options'&&v&&typeof v==='object'){const mo=params.model_options=params.model_options&&typeof params.model_options==='object'?params.model_options:{};for(const [kk,vv] of Object.entries(v))put(mo,kk,vv);}
  else put(params,k,v);
 }
 return out;
}
function agentThinking(s,p){
 const profile=s.api_profiles.find(x=>x.id===p.id);if(!profile)throw Error('模型池中没有此模型');
 const base=pool.kindOf(profile)==='chat'?thinking(profile):null,always=require('./model-catalog.cjs').rule(profile)?.always_thinking===true;
 let patch=p.patch&&typeof p.patch==='object'&&!Array.isArray(p.patch)?p.patch:{};
 if(Object.hasOwn(p,'value')){
  if(!base||base.key!==p.key)throw Error('此模型没有可调的思考参数');
  const raw=p.value;patch={};
  if(raw!==''&&raw!==null&&raw!==undefined){
   let value=raw;
   if(base.type==='integer'){value=Number(raw);if(!Number.isInteger(value)||value<base.min||value>base.max)throw Error('思考预算超出范围');}
   else if(!base.values.some(v=>String(v)===String(raw)))throw Error('思考参数取值无效');
   else if(base.type==='boolean')value=String(raw)==='true';
   const edited=editThinking(structuredClone(profile),base.key,value),defs=caps.forProfile(profile),e=edited.parameters||{};
   for(const k of THINK_KEYS)if(defs.some(f=>f.key===k)){patch[k]=e[k]??null;(patch.model_options||={})[k]=e.model_options?.[k]??null;}
  }
 }
 const chosen=Object.keys(patch).length>0,shown=base&&chosen?thinking(overlayThinking(profile,patch)):null;
 return {ok:true,patch,always,thinking:base&&{...base,value:chosen?(shown?.value??''):''}};
}
function setParam(s,p,primary=false){
 const i=s.api_profiles.findIndex(x=>x.id===p.id);if(i<0)throw Error('模型池中没有此模型');
 const profile=s.api_profiles[i],f=primary?thinking(profile):parameterList(profile).find(x=>x.key===p.key);if(!f||f.key!==p.key)throw Error('此模型没有这个参数');
 let value=p.value;
 if(value===''||value===null||value===undefined)value=null;
 else if(f.type==='boolean')value=String(value)==='true';
 else if(f.type==='integer'||f.type==='number'){value=Number(value);if(!Number.isFinite(value)||f.type==='integer'&&!Number.isInteger(value))throw Error(f.label+' 取值无效');}
 else if(!f.values.some(v=>String(v)===String(value)))throw Error(f.label+' 取值无效');
 s.api_profiles[i]=editThinking(profile,f.key,value);
 return s;
}
function setContext(s,p){
 const i=s.api_profiles.findIndex(x=>x.id===p.id);if(i<0)throw Error('模型池中没有此模型');
 const profile=s.api_profiles[i],catalog=require('./model-catalog.cjs');if(pool.kindOf(profile)!=='chat')throw Error('生图模型没有对话上下文窗口');
 if(p.key!=='compact_at_tokens')throw Error('上下文容量只读，请调整上下文压缩');
 const modes=['custom','manual','recommended','quick','standard','long','maximum'];
 if(p.mode!==undefined&&!modes.includes(p.mode))throw Error('上下文预设无效');
 const mode=p.mode||'custom',next=['custom','manual'].includes(mode)?catalog.editManualContext(profile,p.value):caps.edit(profile,{compact_at_tokens:p.value});
 caps.validate(next);
 s.api_profiles[i]={...next,compact_preset:mode};
 return s;
}
function imageEntry(c,model,row){
 const id='image-'+crypto.createHash('sha256').update(c.id+'\0'+model).digest('hex').slice(0,20);
 const preset=KNOWN.find(p=>p.id===presetOf(c));
 const protocol=['responses','chat_completions','anthropic_messages','google_generate'].includes(row?.api_protocol)?row.api_protocol:preset?.api_protocol||'responses';
 return {id,connection_id:c.id,provider:c.provider,name:String(row?.name||model).slice(0,200),model,base_url:c.base_url,api_protocol:protocol,adapter:'openai',kind:'image',enabled:true,tool_calls:false,vision:false,context_window:Number.isInteger(row?.context_window)&&row.context_window>=8192?row.context_window:8192,context_window_source:'image_model',output_limit:0,parameter_specs:[],parameters:pool.parameters({...spec.defaults(),max_tokens:0,stream_include_usage:false})};
}
const redactKey=(text,keys)=>{let out=String(text||'');for(const k of keys)if(k)out=out.split(k).join('[redacted]');return out;};
function fallbackProtocol(row,protocol){
 const alternative={responses:'chat_completions',chat_completions:'responses'}[protocol];
 return alternative&&(!row?.supported_protocols?.length||row.supported_protocols.includes(alternative))?alternative:null;
}
function failure(e,keys){
 const message=e?.status?'模型列表获取失败：HTTP '+e.status:e?.message==='fetch failed'?'无法连接供应商，请检查地址或网络':String(e?.message||e);
 return {ok:false,errors:[redactKey(message,keys)]};
}
function createModelSetup({file,providers,connection,save,version,load}){
 const commit=(s,expected)=>{const r=save(pool.synchronize(prune(s)),expected);return r.ok?{ok:true,version:r.version,...view(load())}:r;};
 async function catalog(s,p){
  const id=String(p.connection_id||'');let expected=version(file);
  if(id===AIEYRA&&s.user_connection_drafts?.aieyra?.api_key&&bindAieyra(s)){
   const r=save(pool.synchronize(s),expected);if(!r.ok)return r;expected=r.version;s=load();
  }
  if(p.token_id&&s.aieyra_key_drafts?.[p.token_id]&&bindAieyraKey(s,p)){
   const r=save(pool.synchronize(s),expected);if(!r.ok)return r;expected=r.version;s=load();
  }
  const target=p.token_id?aieyraID(p.token_id):id;
  const c=s.provider_connections.find(c=>c.id===target);if(!c)throw Error(id===AIEYRA||p.token_id?'请先登录 Aieyra':'Key 不存在，请重新读取');
  if(c.enabled===false)return {ok:false,errors:['这把 Key 已禁用，启用后再获取模型列表']};
  try{
   let draft=providers.select(s,s,c.provider,c.id);
   if(p.refresh===true)draft=(await providers.discover(draft,{refresh:true})).settings;
   // 只列这把 Key 实际返回的模型；随版本资料补进来的“参考”型号不代表这把 Key 已开通（用户 2026-10-16：每把 Key 都显示全部模型）。
   const rows=(draft.__models||[]).filter(m=>!m.reference_only);
   return {ok:true,version:version(file),connection_id:c.id,fetched_at:draft.__catalog_updated_at||'',total:rows.length,models:rows.slice(0,2000).map(m=>catalogRow(m,s,c))};
  }catch(e){return failure(e,[c.api_key,...c.api_key_history||[]]);}
 }
 async function add(s,p,session){
  const c=s.provider_connections.find(c=>c.id===p.connection_id);if(!c)throw Error('Key 不存在，请重新读取');
  if(c.enabled===false)throw Error('这把 Key 已禁用');
  const model=String(p.model||'').trim();if(!model||model.length>200||/[\x00-\x1f]/.test(model))throw Error('请选择模型');
  if(s.api_profiles.some(x=>x.connection_id===c.id&&x.model===model))return {ok:true,version:version(file),...view(s)};
  if(s.api_profiles.length>=128)throw Error('模型池最多容纳 128 个模型');
  const keys=[c.api_key,...c.api_key_history||[]];
  try{
   const draft=providers.select(s,s,c.provider,c.id),row=(draft.__models||[]).find(m=>m.id===model);
   const kind=['image','video'].includes(p.kind)?p.kind:mediaKind(row||{id:model});
   if(kind!=='chat'){const entry=imageEntry(c,model,row);entry.kind=kind;entry.context_window_source=kind+'_model';if(kind==='video')entry.id=entry.id.replace(/^image-/,'video-');require('./model-catalog.cjs').upgrade(entry);s.api_profiles.push(entry);return commit(s,p.expected_version);}
   if(row?.available){
    const next=providers.prepare(s,providers.add(s,draft,model));
    const r=save(next,p.expected_version);return r.ok?{ok:true,version:r.version,...view(load())}:r;
   }
   // Adding is a local configuration commit. Catalog declarations can inform
   // defaults, but response/tool capability is never invented or probed here.
   const preset=KNOWN.find(x=>x.id===presetOf(c));
   const protocol=row?.api_protocol&&row.protocol_source!=='inferred'?row.api_protocol:preset?.api_protocol||(c.provider==='bailian'?'chat_completions':'responses');
   const entry=require('../host/connection.cjs').draftProfile({base_url:c.base_url,connection_id:c.id,model,api_protocol:protocol},row);
   s.api_profiles.push(entry);return commit(s,p.expected_version);
  }catch(e){return failure(e,keys);}
 }
 // 单个模型测试：发一句很短的问候，只报告能不能回话和用时，不改配置。
 // 防连点：同时最多 6 个测试，同一模型 2 秒内不重复测。
 let probing=0;const lastProbe=new Map();
 async function probe(s,p,session){
  if(probing>=6)return {ok:false,model:p.model,errors:['测试太频繁，请等前面的测试结束']};
  const mark=String(p.connection_id)+'\0'+String(p.model),now=Date.now();
  if(now-(lastProbe.get(mark)||0)<2000)return {ok:false,model:p.model,errors:['刚测过，请稍候再测']};
  if(lastProbe.size>512)lastProbe.clear();lastProbe.set(mark,now);
  probing++;try{return await probeOnce(s,p,session);}finally{probing--;}
 }
 async function probeOnce(s,p,session){
  const c=s.provider_connections.find(c=>c.id===p.connection_id);if(!c)throw Error('Key 不存在，请重新读取');
  if(c.enabled===false)return {ok:false,errors:['这把 Key 已禁用']};
  const model=String(p.model||'').trim();if(!model||model.length>200||/[\x00-\x1f]/.test(model))throw Error('请选择模型');
  const pooled=s.api_profiles.filter(m=>m.connection_id===c.id&&m.model===model&&(!p.profile_id||m.id===p.profile_id));
  if(p.profile_id&&!pooled.length||pooled.length>1)throw Error('请指定要测试的模型配置');
  const existing=pooled[0];
  const keys=[c.api_key,...c.api_key_history||[]];
  if(['image','video'].includes(p.kind)||mediaKind(existing||{id:model})!=='chat')return {ok:true,skipped:true,model,note:'媒体模型不做文字测试'};
  try{
   const draft=providers.select(s,s,c.provider,c.id),row=(draft.__models||[]).find(m=>m.id===model);
   const preset=KNOWN.find(x=>x.id===presetOf(c));
   const protocol=existing?.api_protocol||(row?.api_protocol&&row.protocol_source!=='inferred'?row.api_protocol:preset?.api_protocol||(['bailian','deepseek'].includes(c.provider)?'chat_completions':'responses'));
   let proof=await connection('response_test',{connection_id:c.id,profile_id:existing?.id,model,api_protocol:protocol,catalog_row:row,receipt:false},session,s);
   const alternative=existing?.adapter_package?null:fallbackProtocol(row,protocol);
   if(alternative&&require('./native-protocols.cjs').endpointMissing(proof))proof=await connection('response_test',{connection_id:c.id,model,api_protocol:alternative,catalog_row:row,receipt:false},session,s);
   if(proof.ok===false)return {ok:false,model,prompt:proof.prompt,elapsed_ms:proof.elapsed_ms||0,errors:(proof.errors?.length?proof.errors:['模型没有回应']).map(e=>redactKey(e,keys))};
   return {ok:true,model,prompt:proof.prompt,elapsed_ms:proof.elapsed_ms||0,reply:redactKey(String(proof.reply||''),keys).slice(0,160)};
  }catch(e){return {...failure(e,keys),model};}
 }
 return async function call(p={},session='',s){
  const op=p.op;
  // Pair the edit baseline with the hash of the exact bytes that were read.
  if(op==='view'){const loaded=require('./config.cjs').load(file);return {ok:true,version:loaded.version,...view(providers.hydrate(loaded.settings))};}
  if(op==='catalog')return catalog(s,p);
  if(op==='test')return probe(s,p,session);
  if(op==='agent_thinking')return agentThinking(s,p);
  if(!p.expected_version||p.expected_version!==version(file))return {ok:false,code:'version_conflict',errors:['配置已变化，请重新读取后修改'],version:version(file)};
  if(op==='add')return add(s,p,session);
  if(op==='clear'){
   if(!['aieyra','provider'].includes(p.source))throw Error('请选择要清空的模型池');
   s.api_profiles=s.api_profiles.filter(x=>source(x)!==p.source);
   return commit(s,p.expected_version);
  }
  if(op==='remove'){if(!s.api_profiles.some(x=>x.id===p.id))throw Error('模型池中没有此模型');s.api_profiles=s.api_profiles.filter(x=>x.id!==p.id);return commit(s,p.expected_version);}
  if(op==='roles')return commit(setRoles(s,p),p.expected_version);
  if(op==='thinking')return commit(setThinking(s,p),p.expected_version);
  if(op==='param')return commit(setParam(s,p),p.expected_version);
  if(op==='context')return commit(setContext(s,p),p.expected_version);
  if(op==='key_add'){addKey(s,p);return commit(s,p.expected_version);}
  if(op==='key_edit')return commit(editKey(s,p),p.expected_version);
  if(op==='key_remove'){removeKeys(s,p.connection_ids||[p.connection_id]);return commit(s,p.expected_version);}
  if(op==='aieyra_bind'){if(!bindAieyra(s))return {ok:true,version:version(file),...view(s)};return commit(s,p.expected_version);}
  if(op==='aieyra_key'){if(!bindAieyraKey(s,p))return {ok:true,version:version(file),...view(s)};return commit(s,p.expected_version);}
  if(op==='key_enabled')return commit(setKeyEnabled(s,p),p.expected_version);
  throw Error('未知模型设置操作');
 };
}
module.exports={GATEWAY,AIEYRA,PRESETS,ROLE_KEYS,isImageModel,hint,mask,view,entry,info,connections,catalogRow,bindAieyra,bindAieyraKey,setKeyEnabled,addKey,removeKeys,setRoles,setThinking,setParam,setContext,imageEntry,createModelSetup};
