// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: caps; fields
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/native-config.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const caps=require('./model-capabilities.cjs');
function fields(s={}){
 const en=s.language==='en-US',tr=(zh,english)=>en?english:zh,providers=require('./provider-settings.cjs');
 const field=(key,label,options=[],more={})=>({key,label,options:options.map(([value,label])=>({value,label})),secret:false,inactiveRule:{},section:'api',...more});
 const options=providers.PROVIDERS.map(p=>[p.id,p.name]);if(s.provider_connections?.some(c=>c.provider==='custom'))options.push(['custom',tr('自定义接口','Custom endpoint')]);
 const query=String(s.__catalog_search||'').toLowerCase();
 const models=(s.__models||[]).filter(m=>!query||(m.id+' '+m.name).toLowerCase().includes(query));
 const choices=[];
 for(const m of models){const inPool=s.api_profiles?.some(p=>p.connection_id===s.__connection_id&&p.model===m.id);choices.push({value:m.id,label:(m.free===true?tr('免费 · ','FREE · '):'')+m.name+(inPool?tr(' · 已加入',' · Added'):'')+(!m.available?tr(' · 暂不支持',' · Unsupported'):''),disabled:!m.available||inPool});}
 const out=[
  field('language',tr('界面语言','Interface language'),[['zh-CN','中文'],['en-US','ENGLISH']],{section:'display'}),
  field('__provider',tr('供应商','Provider'),options),
  field('base_url',tr('接口地址','API endpoint'),[],{readonly:s.__provider!=='bailian'}),
  field('api_key',tr('接口密钥','API key'),[],{secret:true}),
  field('request_timeout_seconds',tr('请求超时','Request timeout'),[[60,tr('1 分钟','1 minute')],[300,tr('5 分钟','5 minutes')],[600,tr('10 分钟','10 minutes')]]),
  field('__catalog_search',tr('搜索模型','Search models'),[],{action:'provider:filter'}),
  field('__catalog_selected','',[],{options:choices,type:'model_grid'}),
  field('show_reasoning',tr('显示思考片段','Show thought excerpts'),[[true,tr('开启','Enabled')],[false,tr('关闭','Disabled')]]),
  field('compact_percent',tr('自动压缩阈值','Automatic compaction threshold'),[[50,'50%'],[65,'65%'],[75,'75%'],[85,'85%'],[90,'90%'],[0,tr('关闭','Disabled')]]),
  field('context_working_tokens',tr('工作上下文目标（默认 200K）','Working context target (default 200K)'),[8192,16000,25000,32000,64000,128000,200000,256000,1000000].map(n=>[n,String(n)]),{section:'matrix'}),
  field('memory_enabled',tr('永久记忆','Permanent memory'),[[true,tr('开启','Enabled')],[false,tr('关闭','Disabled')]],{section:'matrix'}),
  field('memory_surface_tokens',tr('表层记忆上限','Surface memory limit'),[[750,'750 tokens'],[1500,'1500 tokens'],[3000,'3000 tokens']],{section:'matrix'}),
  field('dreams_enabled',tr('启动时分享梦境','Share dreams at startup'),[[true,tr('开启','Enabled')],[false,tr('关闭','Disabled')]],{section:'matrix'}),
  field('compact_keep_turns',tr('保留原文轮次','Recent turns to retain'),[2,4,8,12].map(n=>[n,en?`${n} turns`:`${n} 轮`])),
 ];
 const matrixModels=(s.api_profiles||[]).map(p=>({value:p.id,label:p.name+(p.enabled===false?tr(' · 已禁用',' · Disabled'):''),disabled:p.enabled===false}));
 if(!s.__matrix_model)matrixModels.unshift({value:'',label:tr('请选择模型','Select a model'),disabled:true});
 out.push(field('__matrix_model',tr('选择模型池中的模型','Select a model from the pool'),[],{section:'matrix',options:matrixModels}));
 const p=s.api_profiles?.find(p=>p.id===s.__pool_edit);if(p)out.push(...caps.fields(p,s.language));
 return out;
}
module.exports={fields};
