// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: GATEWAY; snapshot; clone; thinkingKey; provider; indexedSource; indexes; reference; museKind; find; rule; nativeReference; canonicalID; capacityReference; contextLimit; contextMinimum; compactTargetLimit; definitions; trustedSpec; outputReservation; compactInputLimit; recommendedCompact; upgrade; initialize; validateContext; editContext; editManualContext; contextFields; describe; rows; validateThinking; migrateThinking; apply
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/model-catalog.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const GATEWAY=new URL(require('../../../Contracts/official-services.json').gateway);
/* models.dev MIT license
MIT License

Copyright (c) 2025 models.dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
// Reviewed, offline provider/model/protocol rules. Bundled data is private to
// this module; public metadata is detached so callers cannot alter trust rules.
const {isDeepStrictEqual}=require('node:util');
const snapshot=new Proxy({}, {get:(_target,key)=>require('./resources.cjs').read('模型目录.json')[key]});
const clone=structuredClone;
const thinkingKey=k=>k.startsWith('reasoning_')||k==='thinking_mode'||k==='tool_stream';
function provider(p){
 if(p.provider==='bailian'&&require('./bailian.cjs').matches(p.base_url))return 'bailian';
 try{const u=new URL(p.base_url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash){if(u.hostname===GATEWAY.hostname&&u.pathname.replace(/\/+$/,'')===GATEWAY.pathname.replace(/\/+$/,''))return 'aieyra-gateway';}}catch{}
 return '';
}
let indexedSource,indexed;
function indexes(){
 const data=require('./resources.cjs').read('模型目录.json');
 if(data!==indexedSource){indexedSource=data;indexed={native:new Map((data.native_models||[]).map(m=>[m.id,m])),channel:new Map(data.models.map(m=>[m.provider+'\0'+m.id,m]))};}
 return indexed;
}
const reference=p=>indexes().channel.get(provider(p)+'\0'+p.model);
const museKind=p=>provider(p)==='aieyra-gateway'?({'muse-spark':'chat','muse-image':'image','muse-video':'video'}[p.model]||''):'';
const find=p=>{const m=reference(p);return m?.protocols.includes(p.api_protocol)?m:undefined;};
const rule=p=>(find(p)||(p.provider!=='bailian'?nativeReference(p.model):undefined))?.rules.find(r=>r.protocol===p.api_protocol);
// 原厂资料只补精确型号的容量与标准思考档位，不把原厂工具能力赋给第三方入口。
function nativeReference(id){
 const name=String(id||'').replace(/:free$/,''),rows=indexes().native,exact=rows.get(name);
 if(exact)return exact;
 const slash=name.indexOf('/'),publisher={openai:'openai',google:'google','x-ai':'xai',xai:'xai',anthropic:'anthropic',deepseek:'deepseek'}[name.slice(0,slash)];
 if(slash>=0&&publisher){const row=rows.get(name.slice(slash+1));if(row?.provider===publisher)return row;}
 const grok=/^(grok-\d[\d.]*)-build(?:-fast)?$/.exec(name);
 if(grok){const row=rows.get(grok[1]);if(row?.provider==='xai')return row;}
 const alias=canonicalID(name),row=alias!==name?rows.get(alias):undefined;
 return row?.provider==='anthropic'?row:undefined;
}
// 中转站常给 Claude 加标签或后缀（[max]claude-opus-5-5、claude-opus-4.6-kiro、claude-sonnet-5-c）；
// 只用于对上原厂容量、思考档位和价格参考。其他家族的网关变体仍按已审核的精确资料处理。
function canonicalID(id){
 const raw=String(id||'').trim().replace(/:free$/,'');
 const name=raw.replace(/^(?:\[[^\]]{1,32}\]\s*)+/,'').replace(/^anthropic\//i,'');
 if(!/^claude-/i.test(name))return raw;
 return name.toLowerCase().replace(/(\d)\.(\d)/g,'$1-$2').replace(/(?:-thinking)?(?:-kiro|-c)$/,'').replace(/-thinking$/,'');
}
function capacityReference(p){
 const channel=reference(p),native=p.provider!=='bailian'?nativeReference(p.model):undefined;
 if(!channel)return native;
 if(!native)return channel;
 // Missing channel limits may use exact native facts; channel restrictions win.
 if(['context_window','max_input','max_output'].every(k=>channel[k]>0||!(native[k]>0)))return channel;
 return {...channel,...Object.fromEntries(['context_window','max_input','max_output'].map(k=>[k,channel[k]>0?channel[k]:native[k]]))};
}
function contextLimit(p){
 const limits=[capacityReference(p)?.context_window,p.context_window_limit];
 if(['provider_catalog','official_model_reference','bundled_model_reference'].includes(p.context_window_source))limits.push(p.context_window);
 const known=limits.filter(v=>Number.isSafeInteger(v)&&v>0);return known.length?Math.min(...known):null;
}
const contextMinimum=p=>Math.min(8192,contextLimit(p)||8192);
const compactTargetLimit=p=>contextLimit(p)?Math.min(2000000,Math.floor(contextLimit(p)*.8/1000)*1000):2000000;
function definitions(p,base){
	if(find(p)?.text_only)return [{key:'stream',type:'boolean'}];
 const r=rule(p);if(!r)return clone(base);
 return [...clone(base).filter(f=>!thinkingKey(f.key)&&!r.parameter_specs.some(x=>x.key===f.key)),...clone(r.parameter_specs)];
}
function trustedSpec(p,f){return !!rule(p)?.parameter_specs.some(x=>isDeepStrictEqual(x,f));}
function outputReservation(p,explicit=p.parameters?.max_tokens){
 if(explicit>0)return explicit;
 return Math.min(p.api_protocol==='anthropic_messages'?8192:4096,p.output_limit>0?p.output_limit:Infinity,Math.max(1,Math.floor(p.context_window/4)));
}
// 与 Core ContextBudget.InputLimit 一致；只使用该供应商/精确型号的已核资料。
function compactInputLimit(p){
 const input=capacityReference(p)?.max_input;
 if(!contextLimit(p)&&p.context_window_source==='conservative_client_budget'&&p.compact_at_tokens>0)return Math.max(200000,p.compact_at_tokens,p.context_window-outputReservation(p)-2048);
 return Math.max(0,Math.min(p.context_window-outputReservation(p)-2048,input>0?input-2048:Infinity));
}
function recommendedCompact(window,output){
 let n=Math.floor(Math.max(0,Math.min(Math.floor(window*3/4),window-output))/1000);
 while(n>0&&n%2!==0&&n%5!==0)n--;
 return n*1000;
}
function upgrade(p){
	if(reference(p)?.text_only){p.tool_calls=false;p.vision=false;p.reasoning=false;if(p.parameters)p.parameters={...p.parameters,max_tokens:0,response_format:'text',model_options:{}};}
 const placeholder=p.context_window_source==='conservative_client_budget',m=capacityReference(p),limit=contextLimit(p);
 if(limit&&['','user','user_config','conservative_client_budget'].includes(p.context_window_source||'')){
  p.context_window=limit;
  if(['','user','user_config','conservative_client_budget'].includes(p.context_window_source||''))p.context_window_source=m?.context_window===limit?'bundled_model_reference':'provider_catalog';
 }
 // Catalog metadata can use a different capacity convention (1 Mi vs 1 M).
 // Resolve defaults on creation/load; explicit parameter edits still validate.
 if(limit&&p.context_window>limit){
  p.context_window=limit;
  p.context_window_source=capacityReference(p)?.context_window===limit?'bundled_model_reference':'provider_catalog';
 }
 if(!placeholder)return p;
 const channel=find(p);if(channel&&typeof channel.tool_calls==='boolean')p.tool_calls=channel.tool_calls;
 p.context_window=Math.max(contextMinimum(p),p.context_window||0);
 const ceiling=Math.max(1,Math.floor(p.context_window/4));
 if(m?.max_output>0)p.output_limit=m.max_output;
 else if(!p.output_limit||p.output_limit>ceiling)p.output_limit=ceiling;
 for(const f of p.parameter_specs||[])if(f.key==='max_tokens'&&!f.wire_path)f.max=p.output_limit;
 if(p.parameters?.max_tokens>p.output_limit)p.parameters.max_tokens=p.output_limit;
 return p;
}
function initialize(p,legacy){
 upgrade(p);
 if(p.compact_at_tokens!==undefined&&p.compact_at_tokens!==null)return p;
 // Per-model selections are preserved above; only absent defaults become 200K.
 // Keep an explicit legacy disable or a non-default legacy working budget.
 let compact=Math.min(200000,compactTargetLimit(p));
 if(legacy?.compact_percent===0)compact=0;
 else if(legacy?.context_working_tokens>0&&legacy.context_working_tokens!==200000&&Number.isInteger(legacy.compact_percent)&&legacy.compact_percent>0&&legacy.compact_percent<=100){
  const input=Math.max(0,p.context_window-outputReservation(p)-2048);
  compact=Math.floor(Math.min(legacy.context_working_tokens,input)*legacy.compact_percent/100);
 }
 p.compact_at_tokens=compact;return p;
}
function validateContext(p){
 if(!Number.isSafeInteger(p.context_window)||p.context_window<contextMinimum(p)||p.context_window>10000000)throw Error('上下文窗口需在 '+contextMinimum(p)+'–10000000');
 const limit=contextLimit(p);if(limit&&p.context_window>limit)throw Error('上下文窗口超过此型号的已知上限 '+limit);
 if(p.compact_at_tokens!==undefined&&p.compact_at_tokens!==null&&(!Number.isSafeInteger(p.compact_at_tokens)||p.compact_at_tokens<0||p.compact_at_tokens>2000000))throw Error('compact_at_tokens 需在 0～2000000 之间');
}
function editContext(p,values={}){
 const next=clone(p);
 if(Object.hasOwn(values,'context_window')&&(values.context_window===null||values.context_window===''||Number(values.context_window)!==p.context_window))throw Error('上下文容量只读，请调整上下文压缩');
 if(Object.hasOwn(values,'compact_at_tokens')){
  next.compact_at_tokens=values.compact_at_tokens===null||values.compact_at_tokens===''?Math.min(200000,compactTargetLimit(p)):Number(values.compact_at_tokens);
  if(!Number.isSafeInteger(next.compact_at_tokens)||next.compact_at_tokens<0||next.compact_at_tokens>2000000)throw Error('compact_at_tokens 需在 0～2000000 之间');
  if(next.compact_at_tokens>compactTargetLimit(p))throw Error('上下文压缩目标不能超过已知容量的 80%（'+compactTargetLimit(p)+'）');
 }
 if(next.context_window!==undefined||['context_window','compact_at_tokens'].some(k=>Object.hasOwn(values,k)))validateContext(next);
 return next;
}
// A user working target is independent of provider presets. Runtime input and
// output reservations still cap actual requests; existing persisted values stay.
function editManualContext(p,value){
 const next=clone(p),reset=value===null||value==='';
 next.compact_at_tokens=reset?Math.min(200000,compactTargetLimit(p)):Number(value);
 if(!Number.isSafeInteger(next.compact_at_tokens)||next.compact_at_tokens!==0&&!reset&&(next.compact_at_tokens<10000||next.compact_at_tokens>1000000))throw Error('compact_at_tokens 自定义需在 10000～1000000 之间');
 validateContext(next);
 return next;
}
function contextFields(p){
 if(p.context_window===undefined)return [];
 return [{key:'context_window',type:'integer',value:contextLimit(p),local:true,read_only:true},{key:'compact_at_tokens',type:'integer',min:0,max:compactTargetLimit(p),value:p.compact_at_tokens,local:true,zero_disables:true}];
}
function describe(p){
 const m=capacityReference(p),fallbackWindow=m?.context_window||8192;
 return {kind:m?.kind||'chat',text_only:m?.text_only===true,tier:m?.tier||'冷门',rank:m?.rank||100000,summary_zh:m?.summary_zh||'资料未核实，请先检测响应',protocols:clone(m?.protocols||[p.api_protocol]),catalog_provider:m?.provider||null,context_limit:contextLimit(p),catalog_context_window:m?.context_window??null,catalog_max_output:m?.max_output??null,catalog_vision:m?.vision??null,catalog_tool_calls:m?.tool_calls??null,availability:clone(m?.availability??null),activation:clone(m?.activation??null),recommended_context_window:fallbackWindow,recommended_output_tokens:m?.recommended_output_tokens||Math.min(4096,Math.floor(fallbackWindow/4)),recommended_compact_at_tokens:200000,thinking_rule:clone(rule(p)||null),context_fields:contextFields(p)};
}
function rows(s,input=[]){
 const id=provider({provider:s.provider||s.__provider,base_url:s.base_url});if(!id)return clone(input);
 const byID=new Map(input.map(m=>[m.id,clone(m)]));
 for(const m of snapshot.models.filter(m=>m.provider===id))if(!byID.has(m.id))byID.set(m.id,{id:m.id,name:m.id,api_protocol:m.protocols[0],context_window:m.context_window||8192,context_window_source:'conservative_client_budget',output_limit:m.max_output||2048,tool_calls:m.tool_calls===true,free:null,reference_only:true});
 return [...byID.values()].map(row=>{
  const reviewed=indexes().channel.get(id+'\0'+row.id);
  if(reviewed?.text_only||reviewed?.kind==='image'||reviewed?.kind==='video')row={...row,api_protocol:reviewed.protocols[0],tool_calls:false};
  const p={...row,model:row.id,provider:id,base_url:s.base_url,parameters:{}};
  upgrade(p);const m=reference(p);if(!m){
   const details=describe(p);
   return {...row,...details,
    summary_zh:typeof row.summary_zh==='string'&&row.summary_zh.trim()?row.summary_zh:details.summary_zh,
    availability:row.availability!==undefined&&row.availability!==null?clone(row.availability):details.availability,
    activation:row.activation!==undefined&&row.activation!==null?clone(row.activation):details.activation};
  }
  const compatible=!!find(p),specs=compatible?require('./model-capabilities.cjs').forProfile(p):[],details=describe(p);
  // A live/provider catalog can carry a current status that the offline
  // reference cannot know. Preserve explicit status and explanatory text so
  // the UI can show it in the details pane while still leaving the option
  // selectable for a fresh test.
  const summary=typeof row.summary_zh==='string'&&row.summary_zh.trim()?row.summary_zh:details.summary_zh;
  const availability=row.availability!==undefined&&row.availability!==null?clone(row.availability):details.availability;
  const activation=row.activation!==undefined&&row.activation!==null?clone(row.activation):details.activation;
  const special=m.text_only||m.kind==='image'||m.kind==='video';
  const reason=special?(m.kind==='video'?'video_transport_pending':''):typeof row.reason==='string'&&row.reason.trim()?row.reason:!compatible?'protocol':p.tool_calls?'':'tools';
  const available=special?compatible&&m.kind!=='video':row.available===false?false:compatible&&p.tool_calls===true&&p.context_window>=8192;
  return {...row,...details,summary_zh:summary,availability,activation,context_window:p.context_window,context_window_source:p.context_window_source,output_limit:p.output_limit,tool_calls:p.tool_calls,parameter_specs:specs,available,execution_available:available&&p.tool_calls===true,reason};
 }).sort((a,b)=>(a.rank||100000)-(b.rank||100000)||a.id.localeCompare(b.id));
}
function validateThinking(p){
 const r=rule(p);if(!r)return;
 const opts=p.parameters?.model_options||{};
 for(const [key,v]of Object.entries(opts)){
  if(key==='reasoning_budget'&&r.ignore_budget)continue;
  if(thinkingKey(key)&&!r.parameter_specs.some(f=>f.key===key))throw Error('当前供应商和协议不支持思考参数：'+key);
  if(r.always_thinking&&(key==='reasoning_enabled'&&v===false||key==='thinking_mode'&&v==='disabled'))throw Error('此模型始终思考');
 }
}
// On load, obsolete thinking selections return to this exact model's default.
// Explicit edits still go through validateThinking and are never silently accepted.
function migrateThinking(p){
 const r=rule(p),opts=p.parameters?.model_options;if(!r||!opts)return p;
 const check=require('./model-capabilities.cjs').checkValue;
 for(const [key,value] of Object.entries(opts))if(thinkingKey(key)){
  const f=r.parameter_specs.find(f=>f.key===key);
  if(!f||!check(f,value)||r.always_thinking&&(key==='reasoning_enabled'&&value===false||key==='thinking_mode'&&value==='disabled'))delete opts[key];
 }
 if(opts.reasoning_enabled===false||opts.thinking_mode==='disabled'){delete opts.reasoning_effort;delete opts.reasoning_budget;}
 return p;
}
function apply(s,body){
 const p=s.api_profiles?.find(p=>p.id===s.active_profile),r=p&&rule(p);if(!r)return false;
 for(const k of ['reasoning','thinking','output_config','reasoning_effort','thinking_budget','enable_thinking','tool_stream'])delete body[k];
 const opts=clone(r.defaults||{}),check=require('./model-capabilities.cjs').checkValue;
 for(const f of r.parameter_specs){
  if(Object.hasOwn(s.model_options||{},f.key)&&check(f,s.model_options[f.key]))opts[f.key]=s.model_options[f.key];
  else if(p.adapter==='deepseek'){
   if(f.key==='reasoning_enabled')opts[f.key]=s.thinking_type!=='disabled';
   else if(f.key==='reasoning_effort'&&check(f,s.reasoning_effort))opts[f.key]=s.reasoning_effort;
   else if(f.key==='thinking_mode')opts[f.key]=s.thinking_type==='disabled'?'disabled':'enabled';
  }
 }
 if(r.always_thinking){opts.reasoning_enabled=true;if(Object.hasOwn(opts,'thinking_mode'))opts.thinking_mode='enabled';}
 if(r.stream_only&&body.stream!==true){opts.reasoning_enabled=false;opts.thinking_mode='disabled';}
 if(Object.hasOwn(s.model_options||{},'reasoning_budget')&&!r.ignore_budget)delete opts.reasoning_effort;
 if(r.ignore_budget)delete opts.reasoning_budget;
 if(opts.reasoning_enabled===false||opts.thinking_mode==='disabled'){delete opts.reasoning_effort;delete opts.reasoning_budget;}
 for(const f of r.parameter_specs)if(Object.hasOwn(opts,f.key)&&check(f,opts[f.key])){
  let target=body;for(const part of f.wire_path.slice(0,-1))target=target[part]??={};target[f.wire_path.at(-1)]=clone(opts[f.key]);
 }
 return true;
}
module.exports={museKind,provider,find,rule,nativeReference,canonicalID,capacityReference,contextLimit,contextMinimum,compactTargetLimit,definitions,trustedSpec,outputReservation,compactInputLimit,recommendedCompact,upgrade,initialize,validateContext,editContext,editManualContext,contextFields,describe,rows,validateThinking,migrateThinking,apply,info:()=>({schema_version:snapshot.schema_version,reviewed_at:snapshot.reviewed_at,analysis_sha256:snapshot.analysis_sha256,models_dev:clone(snapshot.models_dev)})};
