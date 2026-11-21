// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: STEPS; COMPACT_MIN; compactPosition; compactValue; contextPresets; formatTokens; snapNice; officialWindow; modelNote; modelFacts; catalogSummary; known; number; money; date; priceKeys; priceLine; reasoningNames; modelCapabilities; detailSummary; detailOutput; detailTools; hasDetails; modelDetails; snapCompact
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/model-context.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 模型资料展示与压缩阈值吸附。总容量由共享目录/供应商决定，只读显示。
const STEPS=1000,MAGNET=8;

export const COMPACT_MIN=10000,COMPACT_MAX=1000000;
// The manual track is identical for every model; presets use declared capacity.
export const compactPosition=value=>{const n=Number(value);return Math.log(Math.min(COMPACT_MAX,Math.max(COMPACT_MIN,Number.isFinite(n)?n:200000))/COMPACT_MIN)/Math.log(COMPACT_MAX/COMPACT_MIN)*STEPS;};
export const compactValue=position=>Math.min(COMPACT_MAX,Math.max(COMPACT_MIN,Math.round(COMPACT_MIN*(COMPACT_MAX/COMPACT_MIN)**(Math.min(STEPS,Math.max(0,position))/STEPS)/1000)*1000));

// Presets use a declared capacity. The highest target leaves 20% for the
// reply and maintenance; unknown models retain the manual track.
export function contextPresets(model){
 const capacity=officialWindow(model);if(!capacity)return [];
 const maximum=Math.min(2000000,Math.floor(capacity*.8/1000)*1000);
 if(maximum<1000)return [];
 const target=n=>Math.max(1000,Math.min(maximum,n));
 return [['recommended','推荐',200000],['quick','快速',32000],['standard','标准',128000],['long','长上下文',256000],['maximum','超长上下文',maximum]].map(([id,label,value])=>({id,label,value:target(value)}));
}

// 8192→8K、131072→128K、1048576→1M、600000→600K；不整的数取整到 K（868576→869K），M 最多两位小数。
export function formatTokens(v){
 if(!(v>0))return '0';
 if(v>=1048576&&v%1048576===0)return v/1048576+'M';
 if(v>=1e6)return String(Number((v/1e6).toFixed(2)))+'M';
 if(v%1024===0)return v/1024+'K';
 return Math.max(1,Math.round(v/1000))+'K';
}

export function snapNice(v){
 if(!(v>=500))return 0;
 const unit=10**Math.max(3,Math.floor(Math.log10(v))-1),n=Math.floor(v/unit);let best=0;
 for(const c of [n-1,n,n+1,n+2])if(c>=1&&(c%2===0||c%5===0)&&Math.abs(c*unit-v)<Math.abs(best-v))best=c*unit;
 return best;
}

// 已确认的上下文上限：目录资料，或供应商自己声明的值；“未识别型号的保守值”不算。
export function officialWindow(row){
 if(!row)return null;
 if(Object.hasOwn(row,'context_limit'))return row.context_limit>0?row.context_limit:null;
 if(row.catalog_context_window>0)return row.catalog_context_window;
 if(row.context_window>0&&row.context_window_source!=='conservative_client_budget')return row.context_window;
 return null;
}

// 详情里的短注：只写确认过的事；未知的不写，免得把“没资料”说成“不支持”。
export function modelNote(row){
 if(Array.isArray(row.type_labels)||row.catalog_group){
  return [...new Set([...(row.type_labels||[]),row.free===true?'免费':'',row.recommended?'★推荐':'',row.reference_only?'参考':'',row.available===false?'不可用':''].filter(Boolean))].join(' · ');
 }
 const parts=[],window=officialWindow(row);
 if(window)parts.push(formatTokens(window));
 if(row.catalog_tool_calls===true||row.catalog_tool_calls===undefined&&row.tool_calls===true)parts.push('工具');
 if(row.catalog_vision===true)parts.push('看图');
 if(row.free===true)parts.push('免费');
 if(row.reference_only)parts.push('参考');
 return parts.join(' · ');
}

// 选中模型下面的一行说明。
export function modelFacts(row){
 if(!row)return '';
 if(Array.isArray(row.type_labels)||row.catalog_group)return [catalogSummary(row),row.reference_only?'参考资料':row.available===false?'当前连接不可用':''].filter(Boolean).join(' · ');
 const parts=[],window=officialWindow(row),output=row.catalog_max_output>0?row.catalog_max_output:!row.tier&&row.output_limit>0?row.output_limit:0;
 if(row.summary_zh)parts.push(row.summary_zh);
 if(window)parts.push('上下文上限 '+formatTokens(window));
 if(output)parts.push('最多输出 '+formatTokens(output));
 if(row.catalog_tool_calls===true||row.catalog_tool_calls===undefined&&row.tool_calls===true)parts.push('能调用工具');
 if(row.catalog_vision===true)parts.push('能看图');
 if(row.reference_only)parts.push('离线参考资料，不代表这把 Key 已开通');
 return parts.join(' · ');
}

export const catalogSummary=row=>[...String(row?.summary_zh||'')].slice(0,20).join('');
const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const number=value=>known(value)?value.toLocaleString('zh-CN',{maximumSignificantDigits:8}):'资料未知';
const money=(value,currency='CNY')=>known(value)?({CNY:'¥',USD:'$',EUR:'€'}[currency]||currency+' ')+number(value):'资料未知';
const date=value=>{
 if(!value)return '资料未知';
 const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 北京时间';
};
const priceKeys=[['input','输入'],['output','输出'],['cache_read','缓存命中'],['cache_write','缓存写入']];
const priceLine=(p,currency='CNY')=>priceKeys.map(([key,label])=>label+' '+money(p?.[key],currency)).join(' · ');
const reasoningNames={none:'关闭',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'极致',enabled:'开启',disabled:'关闭',auto:'自动'};
// 能力只来自目录字段，不从模型名字猜测。明确的 null 不采用客户端的保守默认值。
export function modelCapabilities(row){
 if(!row)return [];
 const list=value=>Array.isArray(value)?value:[],labels=new Set(list(row.type_labels)),input=list(row.modalities?.input||row.input_modalities),output=list(row.modalities?.output||row.output_modalities);
 const image=values=>values.some(value=>['image','image_url'].includes(String(value).toLowerCase()));
 const enabled=value=>typeof value==='string'&&!['none','disabled','off'].includes(value.toLowerCase());
 const reasoning=row.reasoning===true||list(row.reasoning_options).some(option=>typeof option==='string'?enabled(option):option&&list(option.values||option.options||[option.value]).some(enabled))||list(row.parameter_specs).some(spec=>spec&&['thinking_type','thinking_mode','reasoning_effort','reasoning_enabled'].includes(spec.key)&&(spec.type==='boolean'||list(spec.values).some(enabled)));
 const tool=row.catalog_tool_calls!==undefined?row.catalog_tool_calls:row.tool_calls;
 return [
  (row.catalog_vision===true||row.vision===true||image(input)||labels.has('看图'))&&{id:'vision',label:'看图（视觉输入）'},
  (row.image_generation===true||image(output)||labels.has('生图'))&&{id:'image',label:'生图'},
  reasoning&&{id:'reasoning',label:'深度推理'},
  tool===true&&{id:'tools',label:'工具调用'},
  (row.web_search===true||row.catalog_web_search===true||labels.has('联网搜索'))&&{id:'search',label:'联网搜索'},
 ].filter(Boolean);
}
// 目录占位说明、客户端预算与本地滑条参数不属于供应商资料。
const detailSummary=row=>String(row.summary_zh&&row.summary_zh!=='资料未核实，请先检测响应'?row.summary_zh:row.description||'');
const detailOutput=row=>row.catalog_max_output>0?row.catalog_max_output:row.context_window_source!=='conservative_client_budget'&&row.output_limit>0?row.output_limit:null;
const detailTools=row=>row.catalog_tool_calls!==undefined?row.catalog_tool_calls:row.context_window_source==='conservative_client_budget'&&row.tool_calls===false?null:row.tool_calls;
function hasDetails(row){
 return !!(detailSummary(row)||row.price||row.round_estimate||row.agent_score||row.popularity||row.catalog_updated_at||row.catalog_sources?.length||Object.keys(row.field_sources||{}).length||officialWindow(row)||detailOutput(row)||typeof row.reasoning==='boolean'||row.reasoning_options?.length||row.parameter_specs?.some(spec=>spec&&!spec.local)||typeof detailTools(row)==='boolean'||row.reference_only||row.available===false||row.reason||row.unused_reason||modelCapabilities(row).length);
}
// 只生成展示数据。目录的思考/看图资料不增加可执行参数，也不触发任何接口。
export function modelDetails(row){
 if(!row||!hasDetails(row))return null;
 const sections=[],section=(title,rows,note)=>sections.push({title,rows:rows.filter(Boolean),note:note||''});
 const p=row.price,e=row.round_estimate,estimate=known(e?.cny)&&(row.free===true||known(p?.input)&&known(p?.output));
 section('价格 · ¥ / 百万 token',priceKeys.map(([key,label])=>({label,value:money(p?.currency==='CNY'?p[key]:null)})),row.free===true?'免费':p?.source?'来源 '+p.source:'');
 section('一轮约 '+(estimate?money(e.cny):'资料未知'),[],e?[
  '输入 '+(known(e.input_tokens)?number(e.input_tokens):'资料未知')+' token',
  '缓存命中 '+(known(e.cache_ratio)?number(e.cache_ratio*100)+'%':'资料未知'),
  '输出 '+(known(e.output_tokens)?number(e.output_tokens):'资料未知')+' token',
  estimate&&e.cache_known===false?'缓存价未知，按输入全价估算':'',
 ].filter(Boolean).join(' · '):'');
 if(p?.original)section('原价 · '+(p.original.currency||'未知币种')+' / 百万 token',[],priceLine(p.original,p.original.currency||'未知币种'));
 if(p?.fx)section('折算',[],(known(p.fx.usd_cny)?'1 USD ≈ '+money(p.fx.usd_cny):'汇率未知')+' · '+(p.fx.date||'日期未知')+(p.fx.source?' · '+p.fx.source:''));
 if(p?.tiers?.length)section('分档价',p.tiers.map(t=>({
  label:known(t.min_input_tokens)&&known(t.max_input_tokens)?formatTokens(t.min_input_tokens)+'–'+formatTokens(t.max_input_tokens):known(t.max_input_tokens)?formatTokens(t.max_input_tokens)+' 以内':known(t.min_input_tokens)?formatTokens(t.min_input_tokens)+' 以上':'范围未知',
  value:priceLine(t),
 })));
 if(p?.periods?.length){const active=typeof p.active_period==='object'?p.active_period?.name:p.active_period;
  section('时段价'+(active?' · 当前 '+active:''),p.periods.map(t=>({label:[t.name,t.start&&t.end?t.start+'–'+t.end:'',t.timezone==='Asia/Shanghai'?'北京时间':t.timezone].filter(Boolean).join(' · ')||'时段未知',value:priceLine(t)})));
 }
 const window=officialWindow(row),output=detailOutput(row),reasoning=[];
 for(const item of row.reasoning_options||[]){
  if(typeof item==='string')reasoning.push(reasoningNames[item]||item);
  else if(item&&typeof item==='object'){const values=item.values||item.options;if(Array.isArray(values))reasoning.push(values.map(v=>reasoningNames[String(v)]||String(v)).join(' / '));else if(item.label||item.name||item.value)reasoning.push(String(item.label||item.name||item.value));}
 }
 if(!reasoning.length)for(const spec of row.parameter_specs||[])if(['thinking_type','reasoning_effort','reasoning_enabled'].includes(spec.key))reasoning.push(spec.type==='boolean'?'开启 / 关闭':(spec.values||[]).map(v=>reasoningNames[String(v)]||String(v)).join(' / '));
 const tool=detailTools(row);
 section('能力',[
  {label:'上下文上限',value:window?formatTokens(window):'资料未知'},
  {label:'最大输出',value:known(output)?formatTokens(output):'资料未知'},
  {label:'思考',value:reasoning.filter(Boolean).join(' · ')||(row.reasoning===true?'支持':row.reasoning===false?'不支持':'资料未知')},
  {label:'工具',value:tool===true?'支持':tool===false?'不支持':'资料未知'},
 ],row.unused_reason||'');
 if(row.response_verified===true)section('当前连接验证',[
  {label:'文字回复',value:'已验证'},
  {label:'工具调用',value:row.tool_calls===true?'已验证':'未验证成功'},
 ],row.tool_calls===false?'当前连接已能回复文字，工具调用尚未通过验证。需要执行任务时请选择已验证工具调用的连接。':'');
 section('评分与热度',[
  {label:'Agent 评分',value:number(row.agent_score?.value)+(row.agent_score?.source?' · '+row.agent_score.source:'')},
  {label:'热度',value:(known(row.popularity?.rank)?'第 '+number(row.popularity.rank)+' 名':'资料未知')+(row.popularity?.source?' · '+row.popularity.source:'')},
 ]);
 section('资料',[
  {label:'采集',value:date(row.catalog_updated_at)},
  ...(row.reference_only?[{label:'参考',value:'当前连接未返回此型号'}]:[]),
  ...(row.available===false?[{label:'连接',value:'不可用'}]:[]),
  ...(row.reason?[{label:'说明',value:({protocol:'当前客户端协议尚未核实',tools:'目录未确认工具调用能力'}[row.reason]||row.reason)}]:[]),
 ]);
 const sources=[];
 for(const source of row.catalog_sources||[])sources.push({label:source.name||source.source||'来源',value:[source.fetched_at?date(source.fetched_at):'',source.license,source.url].filter(Boolean).join(' · ')});
 for(const [field,source]of Object.entries(row.field_sources||{}))if(source&&typeof source==='object')sources.push({label:({price:'价格',agent_score:'Agent 评分',popularity:'热度',context_window:'上下文',reasoning:'思考'}[field]||field)+' · '+(source.source||'来源'),value:[source.fetched_at?date(source.fetched_at):'',source.reference_only?'参考':'',source.url].filter(Boolean).join(' · ')});
 if(sources.length)section('来源与许可',sources);
 return {name:row.name||row.id,id:row.id,summary:detailSummary(row),note:modelNote(row),sections};
}

export function snapCompact(pos,{max,magnets=[]}){
 const raw=max*pos/STEPS;
 for(const m of [0,max,...magnets])if(m>=0&&m<=max&&Math.abs(m/max*STEPS-pos)<=MAGNET)return m;
 return Math.min(max,Math.max(0,snapNice(raw)));
}
