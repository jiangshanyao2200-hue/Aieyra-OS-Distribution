// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; fields; validateType; merge; createRuntimeStore
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/settings-runtime.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cfg=require('./config.cjs'),resources=require('./resources.cjs');
const fields={
 schema_version:{type:'integer',enum:[1],effect:'restart'},product_name:{type:'string',maxLength:80,effect:'restart'},
 release_stage:{type:'object',properties:Object.fromEntries(['team_collaboration','toolbox','link_situation','cli','os_first_ring'].map(k=>[k,{type:'boolean'}])),effect:'restart'},
 toolbox_capabilities:{type:'array',items:{type:'string',enum:['image_gen','video_gen','computer','settings','tool_factory','software_api','cloud_report','community','link','server','compact','browser','human']},effect:'next_request'},
 official_updates_enabled:{type:'boolean',effect:'restart'},identity_palette:{type:'array',effect:'reopen_settings'},
 control_port:{type:'integer',minimum:1024,maximum:65535,effect:'restart'},prompt_layout_version:{type:'integer',enum:[1],effect:'restart'},
 settings_reload:{type:'string',enum:['request_boundary'],effect:'next_request'},prompt_reload:{type:'string',enum:['request_boundary'],effect:'next_request'},
 startup_reopen:{type:'object',properties:{window_seconds:{type:'integer',minimum:0,maximum:86400},message:{type:'string',maxLength:4000}},effect:'next_open'},
 desktop_extensions:{type:'object',properties:Object.fromEntries(['width','height','min_width','min_height','titlebar_height','orb_size','tool_orb_size','orb_gap'].map(k=>[k,{type:'integer',minimum:k==='orb_gap'?0:16,maximum:['width','height','min_width','min_height'].includes(k)?8192:256}])),effect:'next_open'},
};
function validateType(value,schema,label){
 if(schema.type==='integer'?!Number.isSafeInteger(value):schema.type==='array'?!Array.isArray(value):schema.type==='object'?(!value||typeof value!=='object'||Array.isArray(value)):typeof value!==schema.type)throw Error(label+' 类型应为 '+schema.type);
 if(schema.enum&&!schema.enum.includes(value))throw Error(label+' 可选值：'+schema.enum.join(', '));
 if(schema.minimum!=null&&value<schema.minimum||schema.maximum!=null&&value>schema.maximum)throw Error(label+' 超出范围');
 if(schema.maxLength!=null&&value.length>schema.maxLength)throw Error(label+' 过长');
 if(schema.type==='string'&&value.includes('\0'))throw Error(label+' 含无效字符');
 if(schema.type==='number'&&!Number.isFinite(value))throw Error(label+' 必须为有限数值');
 if(schema.type==='array'&&schema.items)for(const item of value)validateType(item,schema.items,label+'[]');
 if(schema.type==='object'&&schema.properties)for(const [k,v]of Object.entries(value)){if(!Object.hasOwn(schema.properties,k))throw Error('未知字段：'+label+'.'+k);validateType(v,schema.properties[k],label+'.'+k);}
}
function merge(base,patch){
 validateType(patch,{type:'object'},'patch');const out=structuredClone(base);
 for(const [k,v]of Object.entries(patch)){
  if(!Object.hasOwn(fields,k))throw Error('未知运行参数：'+k);validateType(v,fields[k],k);
  out[k]=fields[k].type==='object'?{...out[k],...v}:v;
 }
 if(!out.product_name.trim())throw Error('产品名称不能为空');
 if(new Set(out.toolbox_capabilities).size!==out.toolbox_capabilities.length)throw Error('工具目录不能重复');
 if(!Array.isArray(out.identity_palette)||out.identity_palette.length<1||out.identity_palette.length>24)throw Error('光圈配色需有 1–24 项');
 for(const row of out.identity_palette)if(!row||typeof row.name!=='string'||row.name.length>40||!/^#[\da-f]{6}$/i.test(row.color)||Object.keys(row).some(k=>!['name','color'].includes(k)))throw Error('光圈配色须包含 name 和 #RRGGBB color');
 const d=out.desktop_extensions;if(d.width<d.min_width||d.height<d.min_height)throw Error('扩展窗口初始尺寸不能小于最小尺寸');
 return out;
}
function createRuntimeStore(){
 const file=path.join(resources.root(),'Config','运行参数.json');
 const read=()=>({version:cfg.version(file),settings:structuredClone(resources.read('运行参数.json'))});
 return {file,read,merge,fields,update(patch,expected){return cfg.withWriteLock(file,expected,()=>{const value=merge(read().settings,patch),tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}return {ok:true,...read()};});}};
}
module.exports={createRuntimeStore,fields,validateType,merge};
