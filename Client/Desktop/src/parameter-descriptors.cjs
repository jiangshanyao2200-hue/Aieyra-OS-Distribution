// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: reserved; nested; validate; apply
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/parameter-descriptors.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 新参数只能是有界的声明式数据映射，不能改写请求身份、消息、工具或凭据。
const reserved=new Set(['system','contents','systemInstruction','include','provider','metadata','model','messages','input','instructions','tools','tool_choice','stream','stream_options','store','previous_response_id','api_key','authorization','headers','url','base_url','__proto__','prototype','constructor','max_tokens','max_output_tokens','temperature','top_p','response_format']);
const nested=new Set(['reasoning','thinking','generationConfig','output_config','text']);
function validate(f,profile){
 if(f&&require('./model-capabilities.cjs').isSampling(f.key))throw Error('采样参数不再支持配置');
 if(profile&&require('./model-catalog.cjs').trustedSpec(profile,f))return structuredClone(f);
 if(!f||typeof f!=='object'||!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(f.key)||reserved.has(f.key))throw Error('新参数名称无效');
 if(!['boolean','enum','number','integer','strings'].includes(f.type))throw Error('新参数必须有明确类型');
 if(['number','integer'].includes(f.type)&&(!Number.isFinite(f.min)||!Number.isFinite(f.max)||f.min>f.max||Math.abs(f.min)>1e9||Math.abs(f.max)>1e9))throw Error('新参数范围无效');
 if(f.type==='enum'&&(!Array.isArray(f.values)||!f.values.length||f.values.length>32||f.values.some(v=>typeof v!=='string'||v.length>100)))throw Error('新参数枚举无效');
 const p=f.wire_path;
 if(!Array.isArray(p)||!p.length||p.length>3||p.some(k=>typeof k!=='string'||!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)||reserved.has(k))||p.length>1&&!nested.has(p[0])||p.length===1&&nested.has(p[0])||p[0]==='text'&&p[1]==='format'||['reasoning.effort','reasoning.enabled','reasoning.max_tokens','reasoning.summary','thinking.type','thinking.reasoning_effort','thinking.budget_tokens','generationConfig.maxOutputTokens','generationConfig.temperature','generationConfig.topP','generationConfig.topK','generationConfig.seed','generationConfig.stopSequences','generationConfig.responseMimeType','generationConfig.thinkingConfig','output_config.effort'].some(k=>p.join('.')===k||p.join('.').startsWith(k+'.')))throw Error('新参数映射不可覆盖请求结构');
 if(typeof f.source!=='string'||f.source.length<3||f.source.length>500)throw Error('请记录新参数的资料来源');
 return {key:f.key,type:f.type,...(f.values?{values:[...f.values]}:{}),...(f.min!==undefined?{min:f.min,max:f.max}:{}),wire_path:[...p],source:f.source};
}
function apply(s,body){
 const p=s.api_profiles?.find(p=>p.id===s.active_profile);
 for(const raw of p?require('./model-capabilities.cjs').forProfile(p):[]){
  if(require('./model-catalog.cjs').trustedSpec(p,raw))continue;
  if(!raw.wire_path||!Object.hasOwn(s.model_options||{},raw.key))continue;
  const f=validate(raw);let target=body;
  for(const part of f.wire_path.slice(0,-1)){if(target[part]===undefined)target[part]={};if(!target[part]||typeof target[part]!=='object'||Array.isArray(target[part]))throw Error('参数映射冲突');target=target[part];}
  const key=f.wire_path.at(-1);if(Object.hasOwn(target,key))throw Error('参数映射重复');target[key]=structuredClone(s.model_options[f.key]);
 }
 return require('./model-capabilities.cjs').stripSampling(body);
}
module.exports={validate,apply};
