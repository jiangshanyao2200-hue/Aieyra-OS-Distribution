// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: crypto; bundled; bailian; reviewed; PROVIDERS; tr; identity; provider; profileID; catalogID; endpointProtocols; declaredProtocols; inferProtocol; normalizeCustomCatalog; textRequest; jsonRequest; convertMetadata; normalizeName; applyZenPublic; popularity; normalizeCatalog; createProviderSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/provider-settings.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const crypto=require('node:crypto'),spec=require('./spec.cjs'),pool=require('./model-pool.cjs'),caps=require('./model-capabilities.cjs');
const bundled=()=>require('./resources.cjs').read('OpenCode模型.json'),metadataBundle=()=>caps.bundled;
const bailian=require('./bailian.cjs');
const reviewed=require('./model-catalog.cjs');
const PROVIDERS=[{id:'deepseek',name:'DeepSeek',base_url:spec.DEFAULT_BASE_URL},{id:'openrouter',name:'OpenRouter',base_url:'https://openrouter.ai/api/v1'},{id:'opencode',name:'OpenCode Zen',base_url:'https://opencode.ai/zen/v1'},{id:'opencode-go',name:'OpenCode Go',base_url:'https://opencode.ai/zen/go/v1'},{id:'bailian',name:'阿里云百炼',base_url:bailian.DEFAULT_BASE_URL,editable_base:true,api_protocol:'chat_completions'}];
const tr=(s,zh,en)=>s.language==='en-US'?en:zh;
function identity(s){const url=String(s.base_url||'').replace(/\/+$/,'');return bailian.matches(url)?'bailian':PROVIDERS.find(p=>p.base_url===url||p.id==='deepseek'&&url===p.base_url+'/v1')?.id||'custom';}
const provider=s=>s.__provider||s.selected_provider||identity(s);
const profileID=(id,model)=>id+'-'+crypto.createHash('sha256').update(model).digest('hex').slice(0,20);
// An API key may be reused at multiple relays. Never mix their catalogs.
const catalogID=s=>identity(s)+':'+crypto.createHash('sha256').update(String(s.base_url||'').replace(/\/+$/,'')+'\0'+String(s.api_key||'')).digest('hex');
const endpointProtocols={'openai-response':'responses',openai:'chat_completions',anthropic:'anthropic_messages',gemini:'google_generate'};
function declaredProtocols(model){
 const endpoints=Array.isArray(model.supported_endpoint_types)?model.supported_endpoint_types:[];
 return [...new Set(endpoints.filter(v=>typeof v==='string'&&Object.hasOwn(endpointProtocols,v)).map(v=>endpointProtocols[v]))];
}
// New API 只给已标价型号返回 supported_endpoint_types；同一目录里未声明的型号按它自己的默认路由走 chat，
// 仅 responses 专用型号除外。普通 OpenAI 兼容目录沿用原推断，Anthropic 原生目录的 Claude 走 messages。
function inferProtocol(m,known,gateway){
 const base=require('./model-catalog.cjs').canonicalID(m.id);
 if(gateway)return /(?:^|[-/])(?:o3-pro|o3-deep-research|o4-mini-deep-research)/.test(base)?'responses':'chat_completions';
 if(/^claude-/.test(base))return m.type==='model'&&!m.object?'anthropic_messages':'chat_completions';
 return 'responses';
}
function normalizeCustomCatalog(data){
 const rows=data?.data||data?.models;if(!Array.isArray(rows)||rows.length>5000)throw Error('Invalid model catalog');const seen=new Set();
 const gateway=rows.some(m=>declaredProtocols(m||{}).length);
 return rows.filter(m=>typeof (m?.id||m?.name)==='string').map(m=>({...m,id:String(m.id||m.name).replace(/^models\//,'')})).filter(m=>m.id.length<=200&&!/[\x00-\x1f]/.test(m.id)&&!seen.has(m.id)&&seen.add(m.id)).map(m=>{
  const known=require('./known-models.cjs').lookup(m.id),supported=declaredProtocols(m),explicit=['responses','chat_completions','anthropic_messages','google_generate'].includes(m.api_protocol);
  const protocol=explicit?m.api_protocol:['responses','chat_completions','anthropic_messages','google_generate'].find(p=>supported.includes(p))||inferProtocol(m,known,gateway&&!m.supported_endpoint_types?.length);
  const declared=m.context_length||m.context_window||m.inputTokenLimit;
  const context=declared||known?.limit?.context||null,output=m.output_limit||m.outputTokenLimit||known?.limit?.output||0;
  const row={id:m.id,name:String(m.name||m.display_name||m.id).slice(0,200),...(['image','video'].includes(m.kind)?{kind:m.kind}:{}),...(Array.isArray(m.output_modalities)?{output_modalities:m.output_modalities.filter(x=>['text','image','video','audio'].includes(x))}:{}),api_protocol:protocol,protocol_source:explicit||supported.length?'provider_catalog':gateway&&!m.supported_endpoint_types?.length?'gateway_default':'inferred',supported_protocols:supported,context_window:Number.isInteger(context)&&context>=8192&&context<=10000000?context:null,output_limit:Number.isInteger(output)&&output>0?output:0,tool_calls:m.tool_calls===true||Array.isArray(m.supported_parameters)&&m.supported_parameters.includes('tools'),reasoning:known?.reasoning===true,free:null};
  row.context_window_source=row.context_window?(declared?'provider_catalog':'bundled_model_reference'):'conservative_client_budget';
  row.available=row.tool_calls&&!!row.context_window;row.reason=row.available?'':'not_verified';row.parameter_specs=caps.specs('custom',row);return row;
 });
}
async function textRequest(url,key,fetcher=fetch,limit=8*1024*1024){
 // Anthropic 官方目录只认 x-api-key（供应商页「官方 Anthropic」）；其余接口用 Bearer。
 const anthropic=(()=>{try{return new URL(url).hostname==='api.anthropic.com';}catch{return false;}})();
 const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{'User-Agent':'AieyraOS/0.1.24',...(key?{Authorization:`Bearer ${key}`}:{}),...(key&&anthropic?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{})}});
 if(!r.ok){const e=Error('HTTP '+r.status);e.status=r.status;throw e;}
 let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>limit)throw Error('Model catalog exceeds size limit');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
}
async function jsonRequest(url,key,fetcher=fetch,limit){const text=await textRequest(url,key,fetcher,limit);try{return JSON.parse(text);}catch{throw Error('Invalid model catalog');}}
function convertMetadata(data){
 const result=structuredClone(bundled().providers);result.openrouter={};
 for(const id of ['openrouter','opencode','opencode-go']){
  result[id]||={};const source=Object.keys(data[id]?.models||{}).length?data[id].models:metadataBundle().providers[id];
  for(const m of Object.values(source||{})){
   const npm=m.provider?.npm||data[id]?.npm;
   const protocol=id==='openrouter'?'chat_completions':{'@ai-sdk/openai':'responses','@ai-sdk/openai-compatible':'chat_completions','@ai-sdk/anthropic':'anthropic_messages','@ai-sdk/google':'google_generate'}[npm]||metadataBundle().providers[id]?.[m.id]?.api_protocol||bundled().providers[id]?.[m.id]?.api_protocol;
   result[id][m.id]={id:m.id,name:m.name,context_window:m.limit?.context,output_limit:m.limit?.output||0,tool_calls:m.tool_call===true,api_protocol:protocol,reasoning_field:m.interleaved?.field||'',reasoning:m.reasoning===true,meta:m};
  }
 }
 return result;
}
const normalizeName=s=>String(s).toLowerCase().replace(/\bfree\b/g,'').replace(/[^a-z0-9]/g,'');
function applyZenPublic(metadata,html,id='opencode'){
 const tables=[...html.matchAll(/<table\b[^>]*>(.*?)<\/table>/gs)].map(t=>[...t[1].matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)].map(r=>[...r[1].matchAll(/<t[dh]\b[^>]*>(.*?)<\/t[dh]>/gs)].map(c=>c[1].replace(/<[^>]+>/g,'').trim())));
 const names=new Map();if(id==='opencode')metadata.zen_free={};
 for(const rows of tables)for(const r of rows){
  if(r.length>=3&&r[2].includes(id==='opencode-go'?'/zen/go/v1/':'/zen/v1/')){
   names.set(r[0],r[1]);const endpoint=r[2];const protocol=endpoint.endsWith('/responses')?'responses':endpoint.endsWith('/messages')?'anthropic_messages':endpoint.endsWith('/chat/completions')?'chat_completions':/:(streamGenerateContent|generateContent)/.test(endpoint)?'google_generate':endpoint.endsWith('/systemone')?'systemone':'';
   if(protocol&&metadata[id]?.[r[1]])metadata[id][r[1]].api_protocol=protocol;
  }
 }
 if(id==='opencode')for(const rows of tables)for(const r of rows)if(r[1]==='Free'&&r[2]==='Free'&&names.has(r[0]))metadata.zen_free[names.get(r[0])]=true;
 if(!names.size)throw Error('Official OpenCode protocol table unavailable');
 return metadata;
}
function popularity(m,ranks){
 const exact=ranks.find(r=>r.id===m.id||r.id.replace(/:free$/,'')===m.id.replace(/:free$/,''));
 return (exact||ranks.find(r=>normalizeName(r.name)===normalizeName(m.name)||normalizeName(r.id.split('/').pop())===normalizeName(m.id)))?.rank||0;
}
function normalizeCatalog(id,data,metadata=convertMetadata({}),ranks=metadataBundle().rankings){
 if(!Array.isArray(data?.data))throw Error('Invalid model catalog');const seen=new Set();
 return data.data.filter(m=>typeof m?.id==='string'&&m.id.length<=200&&!/[\x00-\x1f]/.test(m.id)&&!seen.has(m.id)&&seen.add(m.id)).map(m=>{
  let model,meta=metadata[id]?.[m.id]?.meta||metadataBundle().providers[id]?.[m.id]||{};
  if(id==='openrouter')model={id:m.id,name:m.name||m.id,context_window:m.context_length,output_limit:m.top_provider?.max_completion_tokens||meta.limit?.output||0,tool_calls:m.supported_parameters?.includes('tools')===true&&m.architecture?.output_modalities?.includes('text')===true,api_protocol:'chat_completions',reasoning_field:'reasoning_details',supported_parameters:m.supported_parameters||[],reasoning:meta.reasoning===true};
  else if(id==='deepseek')model={id:m.id,name:spec.lookupModel(m.id)?.name||m.id,context_window:1000000,output_limit:spec.MAX_TOKENS_LIMIT,tool_calls:!!spec.lookupModel(m.id),api_protocol:'responses',reasoning:true};
  else if(id==='bailian')model={id:m.id,name:m.name||m.id,...bailian.contextMetadata(m.id),output_limit:0,tool_calls:m.tool_calls===true,api_protocol:'chat_completions'};
  else {model={id:m.id,name:m.id,...metadata[id]?.[m.id]};delete model.meta;}
  // A catalog containing only IDs does not verify the bundled capacity.
  const declaredContext=m.context_window||m.context_length;
  const validContext=Number.isInteger(declaredContext)&&declaredContext>=8192&&declaredContext<=10000000;
  if(validContext)model.context_window=declaredContext;
  model.context_window_source=validContext?'provider_catalog':model.context_window_source||(model.context_window?'bundled_model_reference':'conservative_client_budget');
  if(validContext)delete model.context_window_reference;
  const declaredProtocol=['responses','chat_completions','anthropic_messages','google_generate'].includes(m.api_protocol);
  if(declaredProtocol&&id!=='bailian')model.api_protocol=m.api_protocol;
  model.protocol_source=id==='bailian'?'provider_contract':declaredProtocol?'provider_catalog':id==='openrouter'?'provider_contract':'bundled_model_reference';
  model.available=model.tool_calls===true&&Number.isInteger(model.context_window)&&model.context_window>=8192&&model.context_window<=10000000&&['responses','chat_completions','anthropic_messages','google_generate'].includes(model.api_protocol);
  model.reason=!model.tool_calls?'tools':!model.context_window?'metadata':'protocol';
  model.free=null;model.free_source='';
  const knownPrice=v=>v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0;
  if(id==='openrouter'&&knownPrice(m.pricing?.prompt)&&knownPrice(m.pricing?.completion)){model.free=Number(m.pricing.prompt)===0&&Number(m.pricing.completion)===0&&!(Number(m.pricing.request)>0);model.pricing=m.pricing;model.free_source='https://openrouter.ai/api/v1/models';}
  else if(id.startsWith('opencode')&&(m.id.endsWith('-free')||id==='opencode'&&(metadata.zen_free||metadataBundle().zen_free)[m.id])){model.free=true;model.free_source=id==='opencode'?metadataBundle().free_source:'https://opencode.ai/zen/go/v1/models';}
  model.popularity_rank=popularity(model,ranks);model.popularity_source=model.popularity_rank?metadataBundle().ranking_source:'';
  model.parameter_specs=caps.specs(id,model,meta);return model;
 }).sort((a,b)=>Number(b.free===true)-Number(a.free===true)||(a.popularity_rank||100000)-(b.popularity_rank||100000)||a.name.localeCompare(b.name));
}
function createProviderSettings(fetcher=fetch,configFile){
 const store=require('./catalog-store.cjs').createStore(configFile),pending=new Map(),added=new Map();
 const publicSaved=store.get('public')||{};let publicMeta=publicSaved.meta,publicRanks=publicSaved.ranks,publicExpires=publicSaved.expires||0,publicFallback=!!publicSaved.fallback;
 const cacheID=catalogID;
 const cachedCatalog=s=>store.get('catalog:'+cacheID(s))||(!['custom','bailian'].includes(identity(s))?store.get('catalog:'+identity(s)+':'+crypto.createHash('sha256').update(String(s.api_key||'')).digest('hex')):null);
 const legacyCapabilityID=p=>'capability:'+p.base_url+':'+p.model;
 const capabilityID=p=>legacyCapabilityID(p)+':'+p.api_protocol+(p.adapter_package?':adapter:'+p.adapter_package.id+'@'+p.adapter_package.digest:'');
 const savedCapability=p=>{const current=store.get(capabilityID(p)),saved=current||(!p.adapter_package&&store.get(legacyCapabilityID(p)));return saved?.api_protocol===p.api_protocol?saved:null;};
 function hydrate(input){
  const s=pool.migrate(input);s.api_profiles=s.api_profiles.map(p=>{
   const identity=capabilityID(p);
   if(p.capability_identity!==identity&&(p.adapter_package||p.capability_identity)){
    // Keep user values and editable declarations. Acceptance evidence belongs
    // only to the connection, protocol and exact adapter that was probed.
    for(const key of ['parameter_probe','capability_updated_at','capability_source','capability_notice'])delete p[key];
    p.parameter_specs=caps.forProfile(p).map(({evidence,...definition})=>definition);
   }
   if(p.adapter_package||p.capability_identity)p.capability_identity=identity;
   const learned=savedCapability(p);if(!learned||learned.api_protocol!==p.api_protocol)return p;
   // 只合并已知规格，不覆盖用户参数；已保存值所需的旧规格继续可编辑。
   const merged=new Map(caps.forProfile(p).map(f=>[f.key,f]));
   for(const f of learned.specs||[])merged.set(f.key,f);
   const next={...p,parameter_specs:[...merged.values()],capability_identity:identity,capability_updated_at:learned.at,capability_source:learned.source,parameter_probe:learned.probe};
   try{caps.validate(next);return next;}catch{return {...p,capability_notice:'已保存参数与新资料冲突，请先调整或清空对应参数后更新'};}
  });return s;
 }
 const catalog=s=>{const c=cachedCatalog(s);const rows=Array.isArray(c?.models)?c.models:provider(s)==='deepseek'?normalizeCatalog('deepseek',{data:spec.MODELS}):[];return reviewed.rows(s,rows);};
 function capture(input){
  const s=pool.migrate(input);if(!s.__provider)return s;
  const id=provider(s),fixed=PROVIDERS.find(x=>x.id===id),connectionID=id==='bailian'&&(!s.__connection_id||s.__connection_id===id)?pool.connectionID({...s,connection_id:undefined}):s.__connection_id||id;
  s.selected_provider=id;
  if(!connectionID)throw Error('自定义连接标识不存在');
  const index=s.provider_connections.findIndex(x=>x.id===connectionID);
  const existing=s.provider_connections[index];const base=fixed?.editable_base?require('./system-settings.cjs').baseURL(s.base_url):fixed?.base_url||existing?.base_url;
  if(id==='bailian')bailian.assertEndpoint(base);
  if(existing&&existing.base_url!==base)throw Error('此连接地址已保存；请新建连接并填写对应密钥');
  if(!base||s.base_url!==base)throw Error('供应商地址已改变，请重新载入');
  const key=String(s.api_key||'').trim();
  const c={...existing,id:connectionID,provider:id,base_url:base,api_key:key,api_key_history:[...new Set([key,...s.api_key_history||[]].filter(Boolean))].slice(0,8),request_timeout_seconds:Number(s.request_timeout_seconds)};
  if(index<0)s.provider_connections.push(c);else s.provider_connections[index]=c;s.__connection_id=connectionID;
  return s;
 }
 function decorate(input){
  const s=input.__pool_edit?pool.migrate(input):hydrate(input),id=provider(s);let c=s.provider_connections.find(x=>x.id===(s.__connection_id||(id==='custom'?pool.connectionID(s):id)));
  c||={id,api_key:'',api_key_history:[],base_url:PROVIDERS.find(x=>x.id===id)?.base_url||s.base_url,request_timeout_seconds:300};
  // 草稿控件的连接值与已选择的活动模型分开；保存时重新物化请求快照。
  if(!s.__provider){s.api_key=c.api_key;s.api_key_history=structuredClone(c.api_key_history);s.base_url=c.base_url;s.request_timeout_seconds=c.request_timeout_seconds;}
  s.__provider=id;s.__connection_id=c.id;s.__models=catalog(s).map(m=>structuredClone(m));
  const cached=cachedCatalog(s);s.__catalog_updated_at=cached?.fetched_at||'';
  s.__catalog_notice=cached?tr(s,`已缓存 ${cached.models.length} 个模型 · ${cached.fetched_at}；点击获取模型列表才刷新。`,`Cached ${cached.models.length} models · ${cached.fetched_at}; Fetch models refreshes the list.`):tr(s,'尚未获取此连接的目录。','No fetched catalog for this connection.');
  s.__catalog_model||='';s.__catalog_search||='';s.__catalog_selected=Array.isArray(s.__catalog_selected)?s.__catalog_selected:[];
  s.__sort_notice=tr(s,'免费优先；热度参考 OpenRouter 周榜，未上榜按名称排列。','Free first; popularity from OpenRouter weekly rankings, then name.');
  if(id.startsWith('opencode'))s.__sort_notice+=tr(s,'OpenCode 免费层可能仅限其官方客户端；请在模型池测试实际调用权限。','OpenCode’s free tier may be limited to its official client. Test access in the model pool.');
  const selected=s.__matrix_model||s.matrix_profile||s.active_profile;
  s.__matrix_model||='';
  if(!s.__pool_edit&&s.api_profiles.some(p=>p.id===selected))pool.openEditor(s,selected);
  const editing=s.api_profiles.find(p=>p.id===s.__pool_edit);
  s.__capability_notice=editing?.capability_notice||tr(s,`参数资料：${editing?.capability_updated_at||'随版本资料'}。${editing?.parameter_probe?'探测仅确认请求被接受，不保证参数效果。':'新模型可更新资料或探测参数。'}`,`Capabilities: ${editing?.capability_updated_at||'bundled metadata'}. ${editing?.parameter_probe?'Probes confirm request acceptance, not semantic support.':'Refresh or probe parameters for new models.'}`);
  return s;
 }
 function select(current,input,id,connectionID){
  if(!PROVIDERS.some(p=>p.id===id)&&!['custom','aieyra-gateway'].includes(id))throw Error('Unknown provider');
  const s=capture(input);const c=s.provider_connections.find(c=>connectionID?c.id===connectionID:c.id===id||['custom','bailian'].includes(id)&&c.provider===id);
  if(connectionID&&(!c||c.provider!==id))throw Error('供应商连接身份不匹配');
  return decorate({...s,__provider:id,__connection_id:c?.id||id,api_key:c?.api_key||'',api_key_history:structuredClone(c?.api_key_history||[]),base_url:c?.base_url||PROVIDERS.find(p=>p.id===id)?.base_url||'',request_timeout_seconds:c?.request_timeout_seconds||300,__catalog_model:'',__catalog_search:'',__catalog_selected:[]});
 }
 async function discover(input,options={refresh:true}){
  const id=cacheID(input),cached=store.get('catalog:'+id);
  if(!options.refresh)return {settings:decorate(capture(input)),cached:!!cached,notice:cached?tr(input,'使用已保存的模型目录。','Using saved model catalog.'):tr(input,'尚未获取目录，请明确刷新。','No catalog yet. Request an explicit refresh.')};
  if(pending.has(id)){await pending.get(id);return {settings:decorate(capture(input)),cached:true,notice:tr(input,'模型目录已更新。','Model catalog updated.')};}
  const task=fetchCatalog(input);pending.set(id,task);
  try{return await task;}finally{pending.delete(id);}
 }
 async function fetchCatalog(input){
  const s=capture(input),p=PROVIDERS.find(p=>p.id===provider(s))||{id:'custom',base_url:s.base_url};
  const key=String(s.api_key||'').trim();if(!key||key.length>4096||/[\r\n]/.test(key))throw Error(tr(s,'请先输入此供应商的接口密钥','Enter this provider’s API key first'));
  const data=await jsonRequest(s.base_url+(p.id==='openrouter'?'/models/user':'/models'),key,fetcher);let fallback=p.id==='bailian'?false:publicFallback;
  if(!['deepseek','custom','bailian'].includes(p.id)&&publicExpires<Date.now()){
   // Model capabilities come from the reviewed bundle. Explicit discovery may
   // refresh provider lists, rankings and protocol tables, never models.dev.
   publicMeta=convertMetadata({});fallback=false;
   const results=await Promise.allSettled([textRequest('https://openrouter.ai/rankings','',fetcher,4*1024*1024),textRequest('https://opencode.ai/docs/zen/','',fetcher),textRequest('https://opencode.ai/docs/go/','',fetcher)]);
   try{if(results[1].status!=='fulfilled')throw Error('Unavailable');applyZenPublic(publicMeta,results[1].value);}catch{fallback=true;}
   try{if(results[2].status!=='fulfilled')throw Error('Unavailable');applyZenPublic(publicMeta,results[2].value,'opencode-go');}catch{fallback=true;}
   publicRanks=metadataBundle().rankings;
   if(results[0].status==='fulfilled'){
    let found=false;
    try{for(const m of results[0].value.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)){const d=JSON.parse(m[1]);if(d['@type']==='ItemList'&&d.name?.includes('weekly')&&Array.isArray(d.itemListElement)&&d.itemListElement.length){const ranks=d.itemListElement.map(x=>({id:new URL(x.item).pathname.slice(1),name:x.name,rank:x.position}));if(ranks.every(r=>r.id&&typeof r.name==='string'&&Number.isInteger(r.rank)&&r.rank>0)){publicRanks=ranks;found=true;break;}}}}catch{fallback=true;}
    if(!found)fallback=true;
   }else fallback=true;
   publicFallback=fallback;publicExpires=Date.now()+30*60*1000;
   store.put('public',{meta:publicMeta,ranks:publicRanks,expires:publicExpires,fallback:publicFallback});
  }
  const models=p.id==='custom'?normalizeCustomCatalog(data):normalizeCatalog(p.id,data,publicMeta||convertMetadata({}),publicRanks||metadataBundle().rankings);if(models.length>5000)throw Error('Model catalog too large');
  store.put('catalog:'+cacheID(s),{models,fetched_at:new Date().toISOString()});
  // 已加入模型的能力与参数作为同一份快照保存；刷新目录不让旧参数突然失去编辑入口。
  s.api_profiles=s.api_profiles.map(p=>{const m=models.find(m=>p.connection_id===s.__connection_id&&m.id===p.model);return m?.available?{...p,free:m.free,free_source:m.free_source,popularity_rank:m.popularity_rank}:p;});
  return {settings:decorate(s),notice:tr(s,`已获取 ${models.length} 个模型，${models.filter(m=>m.available).length} 个支持编程工具。请选择后加入模型池。${fallback?'部分公开资料不可用，使用随版本快照。':''}`,`Fetched ${models.length} models; ${models.filter(m=>m.available).length} support coding tools. Select models to add to the pool.${fallback?' Some public metadata uses the bundled snapshot.':''}`)};
 }
 function choose(current,input,id){const s=capture(input);if(!catalog(s).some(m=>m.id===id))throw Error('请先获取模型列表');return decorate({...s,__catalog_model:id});}
 function add(current,input,id){
  if(!id&&Array.isArray(input.__catalog_selected)){
   const ids=[...new Set(input.__catalog_selected)];if(!ids.length)throw Error('请先选择模型');
   const s=capture(input),models=catalog(s);
   if(ids.some(id=>!models.some(m=>m.id===id&&m.available)))throw Error('所选模型已不可用，请重新选择');
   const count=ids.filter(id=>!s.api_profiles.some(p=>p.connection_id===s.__connection_id&&p.model===id)).length;
   if(s.api_profiles.length+count>128)throw Error('模型池最多容纳128个模型');
   let next=s;for(const model of ids)next=add(current,next,model);next.__catalog_selected=[];return decorate(next);
  }
  const s=capture(input),model=id||s.__catalog_model,m=catalog(s).find(m=>m.id===model);if(!m?.available)throw Error('请获取列表并选择已有适配的模型');
  const pid=provider(s),existing=s.api_profiles.find(p=>p.connection_id===s.__connection_id&&p.model===model);if(existing)return decorate(s);
  if(s.api_profiles.length>=128)throw Error('模型池最多容纳 128 个模型');
  const p={id:profileID(s.__connection_id,model),connection_id:s.__connection_id,provider:pid,name:m.name,model:m.id,base_url:s.base_url,api_protocol:m.api_protocol,adapter:pid==='deepseek'?'deepseek':'openai',context_window:m.context_window,context_window_source:m.context_window_source||'provider_catalog',output_limit:m.output_limit,reasoning_field:m.reasoning_field,reasoning:m.reasoning,tool_calls:true,vision:pid==='deepseek'&&spec.lookupModel(m.id)?.vision===true,enabled:true,free:m.free,free_source:m.free_source,popularity_rank:m.popularity_rank,parameter_specs:m.parameter_specs,supported_parameters:m.supported_parameters||[],parameters:pool.parameters({...spec.defaults(),stream_include_usage:pid==='deepseek'})};
  p.vision=require('./image-capabilities.cjs').supportsImages(p);
  p.tool_calls=m.tool_calls===true;p.kind=m.kind||'chat';
  reviewed.initialize(p);p.parameter_specs=caps.forProfile(p);
  if(p.api_protocol==='responses'&&p.adapter==='openai'&&p.reasoning&&!reviewed.rule(p))p.parameters.model_options.reasoning_summary='auto';
  s.api_profiles.push(p);added.set(p.id,structuredClone(p));return decorate(s);
 }
 function prepare(current,input){
  let s=pool.editDraft(capture(input));const old=pool.migrate(current);
  if(input.model!==old.model&&input.model!==s.api_profiles.find(p=>p.id===s.active_profile)?.model)throw Error('请通过模型池切换模型，不能直接改写模型身份');
  for(const p of s.api_profiles){
   const trusted=old.api_profiles.find(x=>x.id===p.id)||added.get(p.id);if(!trusted)throw Error('新增模型须通过“加入模型池”操作');
   for(const key of ['model','base_url','connection_id','provider','api_protocol','adapter','output_limit'])if(p[key]!==trusted[key])throw Error('模型连接身份发生变化，请重新载入');
   if(JSON.stringify(p.adapter_package||null)!==JSON.stringify(trusted.adapter_package||null))throw Error('请通过资源中心应用或恢复API适配器');
   if(p.context_window!==trusted.context_window)p.context_window_source='user_config';
  }
  s=pool.synchronize(s);for(const k of Object.keys(s))if(k.startsWith('__'))delete s[k];pool.validate(s);return s;
 }
 function poolAction(input,action,id){return decorate(pool.action(capture(input),action,id));}
 async function learn(input,id,mode,keys,descriptors){
  let s=pool.editDraft(capture(input));const p=s.api_profiles.find(p=>p.id===id);if(!p)throw Error('模型池中没有此模型');
  let record=savedCapability(p)||{api_protocol:p.api_protocol,specs:[],source:'probe'};
  if(mode==='refresh'){
   if(p.provider==='custom')throw Error('自定义接口没有官方目录，请使用参数探测');
   publicExpires=0;
   const draft=select(s,s,p.provider),r=await discover(draft,{refresh:true}),m=r.settings.__models.find(m=>m.id===p.model);
   if(!m)throw Error('官方目录未返回此模型；原参数已保留');
   if(m.api_protocol!==p.api_protocol)throw Error('官方协议已变化，当前模型身份保持不变，请重新添加并验证');
   record={...record,at:new Date().toISOString(),source:'official_catalog_and_bundled_metadata',specs:m.parameter_specs};
  }else{
   const result=await require('./capability-probe.cjs').probe(s,p,keys,undefined,descriptors);
   if(!result.ok)return {ok:false,errors:[result.notice],result};
   const merged=new Map((record.specs||[]).map(f=>[f.key,f]));for(const f of result.accepted)if(!merged.has(f.key))merged.set(f.key,f);
   record={...record,at:result.at,specs:[...merged.values()],probe:result};
  }
  store.put(capabilityID(p),record);
  delete s.__pool_edit;s=select(s,s,p.provider,p.connection_id);pool.openEditor(s,id);
  return {ok:true,settings:decorate(s),result:record.probe,notice:tr(s,'参数资料已缓存，保存后应用模型配置。','Capabilities cached. Save to apply model settings.')};
 }
 return {decorate,capture,select,discover,choose,add,prepare,poolAction,catalog,hydrate,learn};
}
module.exports={PROVIDERS,identity,provider,catalogID,normalizeCustomCatalog,normalizeCatalog,convertMetadata,applyZenPublic,createProviderSettings,jsonRequest,textRequest};
