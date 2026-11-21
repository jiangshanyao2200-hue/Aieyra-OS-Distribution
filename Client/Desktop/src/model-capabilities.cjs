// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: bundled; catalog; labels; canonical; samplingKeys; isSampling; stripSampling; specs; forProfile; baseForProfile; get; checkValue; validate; edit; fields; apply; applyBasic
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/model-capabilities.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 参数名称来自官方目录；具体档位由模型元数据收窄。缺少依据时不展示猜测项。
const bundled=()=>require('./resources.cjs').read('模型资料.json');
const catalog=require('./model-catalog.cjs');
const labels={
 max_tokens:['最大输出令牌','Maximum output tokens'],stream:['流式传输','Streaming'],
 temperature:['温度','Temperature'],top_p:['采样范围','Top P'],top_k:['候选词数量','Top K'],min_p:['最低相对概率','Min P'],
 frequency_penalty:['重复频率惩罚','Frequency penalty'],presence_penalty:['已出现词惩罚','Presence penalty'],repetition_penalty:['重复惩罚','Repetition penalty'],
 seed:['随机种子','Random seed'],stop:['停止词（每行一个）','Stop sequences (one per line)'],
 reasoning_effort:['思考强度','Reasoning effort'],reasoning_enabled:['思考开关','Reasoning enabled'],reasoning_budget:['思考令牌预算','Reasoning token budget'],
 reasoning_summary:['可见思考摘要','Visible reasoning summary'],response_format:['输出格式','Output format'],
 thinking_type:['思考模式','Thinking mode'],thinking_mode:['思考模式','Thinking mode'],tool_stream:['工具调用流式输出','Stream tool calls'],user_id:['用户标识','User identifier'],
 context_window:['上下文窗口','Context window'],compact_at_tokens:['上下文压缩（0 关闭）','Compaction trigger (0 disables)'],
 service_tier:['Fast 模式','Fast mode'],
};
const canonical=new Set(['max_tokens','stream','response_format','thinking_type','user_id']);
// 旧配置可读回，但采样与惩罚参数不再成为可编辑项或请求字段。
const samplingKeys=new Set(['temperature','top_p','top_k','min_p','frequency_penalty','presence_penalty','repetition_penalty','seed','stop','stop_sequences','logprobs','top_logprobs']);
const isSampling=key=>samplingKeys.has(key);
function stripSampling(body){
 for(const key of samplingKeys)delete body[key];
 if(body.generationConfig)for(const key of ['temperature','topP','topK','seed','stopSequences','presencePenalty','frequencyPenalty'])delete body.generationConfig[key];
 return body;
}
function specs(provider,m,meta=bundled().providers[provider]?.[m.id]||{}) {
 if(provider==='bailian')return require('./bailian.cjs').specs(m);
 const official=require('./known-models.cjs').lookup(m.id);
 if(official?.source==='official_model_reference')meta=official;
 if(!Object.keys(meta).length)meta=require('./known-models.cjs').lookup(m.id)||{};
 const out=[];const add=(key,type,more={})=>out.push({key,type,...more});
 add('stream','boolean');add('max_tokens','integer',{min:1,max:m.output_limit||393216});
 if(provider==='deepseek'){
  add('thinking_type','enum',{values:['enabled','disabled']});add('reasoning_effort','enum',{values:['none','low','high','max']});
  add('response_format','enum',{values:['text','json_object']});
  return out;
 }
 const supported=new Set(m.supported_parameters||[]),router=provider==='openrouter';
 if(['responses','chat_completions'].includes(m.api_protocol)&&/^gpt-(6-(astra|sol|luna)|5\.6-(sol|luna|terra))$/.test(String(m.id).replace(/^openai\//,'')))add('service_tier','enum',{values:['default','fast']});
 if(router){
  if(!supported.has('max_tokens')&&!supported.has('max_completion_tokens'))out.splice(out.findIndex(x=>x.key==='max_tokens'),1);
 }
 const options=meta.reasoning_options||[];
 const reasoningAllowed=!router||supported.has('reasoning')||supported.has('reasoning_effort');
 if(reasoningAllowed){
  const effort=options.find(x=>x.type==='effort');
  if(effort?.values?.length)add('reasoning_effort','enum',{values:effort.values});
  // OpenCode 的两项 Chat 开关经真实开/关对照；其它厂商不推断相同语义。
  const testedToggle=provider.startsWith('opencode')&&['deepseek-v4-flash-vision-exp','longcat-2.0'].includes(m.id);
  if(options.some(x=>x.type==='toggle')&&(router||m.api_protocol==='anthropic_messages'||testedToggle))add('reasoning_enabled','boolean');
  const budget=options.find(x=>x.type==='budget_tokens');
  if(budget&&(router||['anthropic_messages','google_generate'].includes(m.api_protocol))){
   const min=budget.min??1024,max=Math.min(budget.max||128000,(m.output_limit||128000)-1);
   if(max>=min)add('reasoning_budget','integer',{min,max});
  }
 }
 if(m.api_protocol==='responses'&&meta.reasoning===true)add('reasoning_summary','enum',{values:['auto','concise','detailed']});
 if(router&&supported.has('response_format')||!router&&meta.structured_output===true&&['responses','chat_completions','google_generate'].includes(m.api_protocol))add('response_format','enum',{values:['text','json_object']});
 return out;
}
function forProfile(p){
 return catalog.definitions(p,baseForProfile(p)).filter(f=>!isSampling(f.key));
}
function baseForProfile(p){
 if(Array.isArray(p.parameter_specs)){
  const known=require('./known-models.cjs').lookup(p.model);
  if(!known)return p.parameter_specs;
  const extra=specs(p.provider||'custom',{id:p.model,output_limit:p.output_limit,api_protocol:p.api_protocol,supported_parameters:p.supported_parameters},known);
  return [...p.parameter_specs.map(f=>f.key==='max_tokens'&&!f.wire_path&&['bundled_model_reference','official_model_reference'].includes(p.context_window_source)?{...f,max:p.output_limit}:f),...extra.filter(f=>!p.parameter_specs.some(x=>x.key===f.key))];
 }
 return specs(p.provider||'custom',{id:p.model,output_limit:p.output_limit,api_protocol:p.api_protocol,supported_parameters:p.supported_parameters});
}
function get(p,key){
 if(['context_window','compact_at_tokens'].includes(key))return p[key];
 if(forProfile(p).find(f=>f.key===key)?.wire_path)return p.parameters?.model_options?.[key];
 if(p.adapter==='deepseek'||canonical.has(key))return p.parameters?.[key];
 return p.parameters?.model_options?.[key];
}
function checkValue(f,value){
 if(f.type==='boolean')return typeof value==='boolean';
 if(f.type==='enum')return f.values.includes(value);
 if(f.type==='strings')return Array.isArray(value)&&value.length<=4&&value.every(x=>typeof x==='string'&&x.length>0&&x.length<=256);
 return typeof value==='number'&&Number.isFinite(value)&&(f.type!=='integer'||Number.isSafeInteger(value))&&value>=f.min&&value<=f.max;
}
function validate(p){
 if(p.context_window!==undefined)catalog.validateContext(p);
 catalog.validateThinking(p);
 const definitions=forProfile(p),byKey=new Map(definitions.map(f=>[f.key,f]));
 if(byKey.size!==definitions.length)throw Error('参数规格重复');
 const paths=[];for(const f of definitions)if(f.wire_path){require('./parameter-descriptors.cjs').validate(f,p);const path=f.wire_path.join('.');if(paths.some(p=>p===path||p.startsWith(path+'.')||path.startsWith(p+'.')))throw Error('参数映射重复');paths.push(path);}
 if(p.adapter==='deepseek'){
  const canonicalSpec=require('./spec.cjs');
  for(const f of definitions){const value=p.parameters?.[f.key];if(value===undefined||f.key==='max_tokens'&&value===0)continue;
   if(f.key==='reasoning_effort'? !canonicalSpec.EFFORTS.includes(value):!checkValue(f,value))throw Error(`${p.name||p.model}: ${f.key} 参数不受支持或超出范围`);
  }
 }
 for(const [key,value] of Object.entries(p.parameters?.model_options||{})){
  if(isSampling(key))continue;
  if(key==='reasoning_budget'&&catalog.rule(p)?.ignore_budget)continue;
  const f=byKey.get(key);if(!f||!checkValue(f,value))throw Error(`${p.name||p.model}: ${key} 参数不受支持或超出范围`);
 }
 const max=p.parameters?.max_tokens||0;if(max&&(!byKey.has('max_tokens')||!checkValue(byKey.get('max_tokens'),max)))throw Error(`${p.name||p.model}: 最大输出超出模型范围`);
 if(p.parameters?.response_format==='json_object'&&!byKey.has('response_format'))throw Error(`${p.name||p.model}: 不支持 JSON 输出格式`);
 if(p.parameters?.stream!==undefined&&typeof p.parameters.stream!=='boolean')throw Error('流式传输必须为开关');
 const opts=p.parameters?.model_options||{};
 const reviewed=catalog.rule(p);
 if(opts.reasoning_budget!==undefined&&opts.reasoning_effort!==undefined&&!reviewed?.ignore_budget)throw Error('思考预算和思考强度请只设置一种，另一项保留供应商默认');
 if(opts.reasoning_enabled===false&&(opts.reasoning_budget!==undefined||opts.reasoning_effort&&opts.reasoning_effort!=='none'))throw Error('关闭思考时请清除思考预算和强度');
 if(!reviewed&&opts.reasoning_budget!==undefined&&max&&opts.reasoning_budget>=max)throw Error('思考预算必须小于最大输出令牌');
}
function edit(p,values){
 const keys=new Set([...forProfile(p).map(f=>f.key),'context_window','compact_at_tokens']);for(const k of Object.keys(values))if(!keys.has(k))throw Error('此模型不支持参数：'+k);
 const next=structuredClone(p);next.parameters||={};next.parameters.model_options||={};
 for(const f of forProfile(p)){
  if(!Object.hasOwn(values,f.key))continue;
  let value=values[f.key];
  const standard=!f.wire_path&&(p.adapter==='deepseek'||canonical.has(f.key));
  const target=standard?next.parameters:next.parameters.model_options;
  if(value===null||value===''){
   if(standard){const defaults=require('./spec.cjs').defaults();target[f.key]=defaults[f.key];}
   else delete target[f.key];
   continue;
  }
  if(f.type==='number'||f.type==='integer')value=Number(value);
  if(f.type==='strings'&&typeof value==='string')value=value.split('\n').map(x=>x.trim()).filter(Boolean);
  if(!(standard&&f.key==='max_tokens'&&value===0)&&!checkValue(f,value))throw Error((labels[f.key]?.[0]||f.key)+' 取值无效');
  target[f.key]=value;
 }
 const configured=catalog.editContext(next,values);validate(configured);return configured;
}
function fields(p,language){
 const en=language==='en-US',tr=(zh,enText)=>en?enText:zh;
 return [...forProfile(p),...catalog.contextFields(p)].filter(f=>!f.read_only&&['reasoning_effort','reasoning_enabled','reasoning_budget','thinking_type','thinking_mode','compact_at_tokens'].includes(f.key)).map(f=>{
  let options=[];
  const translate=v=>({enabled:tr('开启','Enabled'),disabled:tr('关闭','Disabled'),none:tr('关闭','None'),minimal:tr('极低','Minimal'),low:tr('低','Low'),medium:tr('中','Medium'),high:tr('高','High'),xhigh:tr('极高','Extra high'),max:tr('最高','Maximum'),auto:tr('自动','Auto'),concise:tr('简要','Concise'),detailed:tr('详细','Detailed'),text:tr('文本','Text'),json_object:'JSON'})[v]||v;
  if(f.type==='boolean')options=[{value:true,label:tr('开启','Enabled')},{value:false,label:tr('关闭','Disabled')}];
  if(f.type==='enum')options=f.values.map(value=>({value,label:translate(value)}));
  if(options.length&&f.key!=='stream'&&p.adapter!=='deepseek')options.unshift({value:'',label:tr('供应商默认','Provider default')});
  const rule=p.adapter==='deepseek'&&f.key==='temperature'?{whenEquals:{key:'__param_thinking_type',value:'enabled'}}:p.adapter==='deepseek'&&['top_p','reasoning_effort'].includes(f.key)?{whenEquals:{key:'__param_thinking_type',value:'disabled'}}:{};
  return {key:'__param_'+f.key,label:labels[f.key]?.[en?1:0]||f.key,type:f.type,min:f.min,max:f.max,local:f.local===true,options,secret:false,inactiveRule:rule,multiline:f.type==='strings',placeholder:f.min!==undefined?`${f.min}–${f.max} · ${tr('留空使用默认','blank = default')}`:'',section:'matrix'};
 });
}
// 通用参数的请求映射与 Core/model_options.go 配对验证；不覆盖模型/工具/路由身份。
function apply(s,body){
 const muse=catalog.museKind(s);
 if(muse){
  if(muse!=='chat'||s.api_protocol!=='chat_completions')throw Error('Muse 文本请使用 Chat Completions；媒体需要对应生成入口');
  const messages=(body.messages||[]).map(m=>{let role=m.role,content=typeof m.content==='string'?m.content:(m.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');if(role==='tool'){role='user';content='[Historical tool result '+(m.tool_call_id||'')+']\n'+content;}if(m.tool_calls?.length)content+='\n[Historical tool calls]\n'+JSON.stringify(m.tool_calls);return {role,content};});
  return {model:s.model,messages,stream:!!body.stream,...(body.stream?{stream_options:{include_usage:true}}:{})};
 }
 const mapped=catalog.apply(s,body)?body:applyBasic(s,body);return stripSampling(require('./parameter-descriptors.cjs').apply(s,mapped));
}
function applyBasic(s,body){
 if(s.adapter!=='openai')return body;
 const o=s.model_options||{},protocol=s.api_protocol,router=new URL(s.base_url).hostname==='openrouter.ai';
 const reasoning={};if(o.reasoning_effort!==undefined)reasoning.effort=o.reasoning_effort;if(o.reasoning_enabled!==undefined)reasoning.enabled=o.reasoning_enabled;if(o.reasoning_budget!==undefined)reasoning.max_tokens=o.reasoning_budget;
 if(protocol==='google_generate'){
  const g=body.generationConfig||{};
  if(s.response_format==='json_object')g.responseMimeType='application/json';
  const thinking={includeThoughts:true};if(o.reasoning_effort)thinking.thinkingLevel=o.reasoning_effort.toUpperCase();if(o.reasoning_budget!==undefined)thinking.thinkingBudget=o.reasoning_budget;
  if(s.api_profiles?.find(p=>p.id===s.active_profile)?.reasoning===true||o.reasoning_effort||o.reasoning_budget!==undefined)g.thinkingConfig=thinking;
  if(Object.keys(g).length)body.generationConfig=g;return body;
 }
 if(protocol==='anthropic_messages'){
  if(o.reasoning_budget)body.thinking={type:'enabled',budget_tokens:o.reasoning_budget};
  else if(o.reasoning_effort||o.reasoning_enabled===true)body.thinking={type:'adaptive'};
  else if(o.reasoning_enabled===false)body.thinking={type:'disabled'};
  if(o.reasoning_effort)body.output_config={effort:o.reasoning_effort};return body;
 }
 if(o.service_tier!==undefined)body.service_tier=o.service_tier;
 if(protocol==='responses'){
  // 与 Go 的旧配置兼容范围一致；v1 留空仍使用供应商默认，公开摘要取决于上游。
  if((s.model_pool_version||0)===0&&new URL(s.base_url).hostname==='opencode.ai'&&o.reasoning_summary==null)reasoning.summary='auto';
  if(o.reasoning_summary!==undefined)reasoning.summary=o.reasoning_summary;
  if(Object.keys(reasoning).length)body.reasoning=reasoning;return body;
 }
 if(!router&&catalog.nativeReference(s.model)?.provider==='deepseek'&&o.reasoning_effort!==undefined){
  body.thinking={type:o.reasoning_effort==='none'?'disabled':'enabled'};
  if(o.reasoning_effort!=='none')body.reasoning_effort=o.reasoning_effort;
  return body;
 }
 if(router&&Object.keys(reasoning).length)body.reasoning=reasoning;
 else if(o.reasoning_effort)body.reasoning_effort=o.reasoning_effort;
 if(new URL(s.base_url).hostname==='opencode.ai'&&typeof o.reasoning_enabled==='boolean')body.thinking={type:o.reasoning_enabled?'enabled':'disabled'};
 return body;
}
module.exports={specs,forProfile,get,edit,validate,fields,apply,checkValue,labels,get bundled(){return bundled();},isSampling,stripSampling};
