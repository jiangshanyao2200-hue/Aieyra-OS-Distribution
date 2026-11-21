// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: own; canonical; equal; keys; identity; digestValid; pathValid; valueAt; setAt; entries; validateBase; validateProfiles; materialize; difference; remember; prune; selected; selectTheme; editTheme; themeValues
// Impact: python -B scripts/code-atlas.py show Theme/runtime/overrides.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Theme customization belongs to the shared configuration store. A package's
// immutable defaults and the user's edits remain separately recoverable.
const {validateTheme,catalog}=require('../contract/definition.mjs');
const own=(o,k)=>Object.hasOwn(o,k),clone=structuredClone;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function keys(v,names,label){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!names.includes(k)))throw Error('无效主题个性设置：'+label);}
const identity=id=>typeof id==='string'&&/^[a-z][a-z0-9_.-]{1,127}$/.test(id);
const digestValid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function pathValid(p){return Array.isArray(p)&&p.every(k=>typeof k==='string')&&(p.length===1&&p[0]==='styles'||p.length===2&&(p[0]==='tokens'&&/^--ui-[a-z0-9-]{1,64}$/.test(p[1])||p[0]==='layouts'&&own(catalog.surfaces,p[1])||p[0]==='renderers'&&own(catalog.renderers,p[1])));}
function valueAt(def,path){const o=path.length===1?def:def[path[0]],key=path.at(-1);return o&&own(o,key)?{exists:true,value:clone(o[key])}:{exists:false};}
function setAt(def,path,value){const key=path.at(-1);if(path.length===2)def[path[0]]??={};const o=path.length===1?def:def[path[0]];if(value.exists)o[key]=clone(value.value);else delete o[key];}
function entries(value){
 if(!Array.isArray(value)||value.length>512)throw Error('主题覆盖条目过多');
 const seen=new Set();
 for(const v of value){keys(v,['path','before','after','source'],'覆盖');if(!pathValid(v.path)||seen.has(JSON.stringify(v.path))||!digestValid(v.source))throw Error('无效或重复的主题覆盖位置');seen.add(JSON.stringify(v.path));for(const side of ['before','after']){keys(v[side],['exists','value'],side);if(typeof v[side].exists!=='boolean'||v[side].exists!==own(v[side],'value'))throw Error('主题覆盖缺少原值或新值');}}
 return clone(value);
}
function validateBase(base){
 keys(base,['digest','version','definition'],'默认版本');
 if(!digestValid(base.digest)||base.version!==undefined&&(typeof base.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(base.version)||base.version.length>64))throw Error('无效主题默认版本');
 validateTheme(base.definition);
}
function validateProfiles(profiles={}){
 if(!profiles||typeof profiles!=='object'||Array.isArray(profiles)||Object.keys(profiles).length>16)throw Error('最多保留16个主题的个性设置');
 if(Buffer.byteLength(JSON.stringify(profiles))>1536*1024)throw Error('主题个性设置已超过保存上限');
 for(const [id,p]of Object.entries(profiles)){
  if(!identity(id))throw Error('无效主题身份');keys(p,['schema','base','origin','prior','history','overrides','previous'],'主题记录');if(p.schema!==1)throw Error('不支持的主题个性设置版本');validateBase(p.base);entries(p.overrides);
  if(!p.history||typeof p.history!=='object'||Array.isArray(p.history))throw Error('无效主题版本记录');
  for(const [digest,base]of Object.entries(p.history)){validateBase(base);if(base.digest!==digest||digest===p.base.digest)throw Error('重复或不符的主题版本');}
  const baseline=digest=>digestValid(digest)?digest===p.base.digest?p.base:own(p.history,digest)?p.history[digest]:null:null;
  if(!baseline(p.origin)||p.prior!==undefined&&!baseline(p.prior))throw Error('主题原始版本缺失');
  if(p.previous!==undefined){keys(p.previous,['digest','overrides'],'撤销记录');if(!baseline(p.previous.digest))throw Error('撤销版本缺失');entries(p.previous.overrides);}
  for(const entry of [...p.overrides,...(p.previous?.overrides||[])]){
   const source=baseline(entry.source);if(!source||!equal(valueAt(source.definition,entry.path),entry.before))throw Error('主题覆盖原始版本不符');
  }
 }
 return clone(profiles);
}
function materialize(profile){
 const definition=clone(profile.base.definition),conflicts=[];
 for(const entry of profile.overrides){const current=valueAt(profile.base.definition,entry.path);if(equal(entry.after,current))continue;if(!equal(entry.before,current))conflicts.push({...clone(entry),current});setAt(definition,entry.path,entry.after);}
 let error='';try{validateTheme(definition);}catch(e){error=e.message;}
 return {definition:error?clone(profile.base.definition):definition,proposed:definition,conflicts,error,suspended:!!error};
}
function difference(profile,edited){
 const base=profile.base.definition;
 validateTheme(edited);
 for(const key of ['schema','elements','assets','presets','sounds'])if(!equal(base[key],edited[key]))throw Error('主题身份与资源声明由原始包提供，不能在个性设置里修改');
 const paths=[['styles']];for(const group of ['tokens','layouts','renderers'])for(const key of new Set([...Object.keys(base[group]||{}),...Object.keys(edited[group]||{}),...profile.overrides.filter(e=>e.path[0]===group).map(e=>e.path[1])]))paths.push([group,key]);
 return paths.map(path=>{
  const previous=profile.overrides.find(e=>equal(e.path,path)),after=valueAt(edited,path),before=valueAt(base,path);
  // Editing a different field cannot silently acknowledge an update conflict.
  if(previous&&equal(previous.after,after))return clone(previous);
  if(equal(before,after))return null;
  return {path,before:previous?clone(previous.before):before,after,source:previous?.source||profile.base.digest};
 }).filter(Boolean);
}
function remember(profile){profile.previous={digest:profile.base.digest,overrides:clone(profile.overrides)};}
function prune(profile){
 const keep=new Set([profile.origin,profile.prior,profile.previous?.digest,...profile.overrides.map(e=>e.source),...(profile.previous?.overrides||[]).map(e=>e.source)]);
 for(const digest of Object.keys(profile.history))if(digest===profile.base.digest||!keep.has(digest))delete profile.history[digest];
}
function selected(id,profile){return {id,digest:profile.base.digest,...(profile.base.version?{version:profile.base.version}:{}),definition:materialize(profile).definition};}
function selectTheme(profiles,selection){
 const next=validateProfiles(profiles);keys(selection,['id','digest','version','definition'],'主题选择');if(!identity(selection.id))throw Error('无效主题身份');
 const {id,...base}=selection;validateBase(base);let p=own(next,id)?next[id]:null;
 if(!p)p={schema:1,base:clone(base),origin:base.digest,history:{},overrides:[]};
 else if(p.base.digest!==base.digest){p.history[p.base.digest]=clone(p.base);p.prior=p.base.digest;p.base=clone(base);}
 else if(!equal(base.definition,p.base.definition)&&!equal(base.definition,materialize(p).definition)){const edits=difference(p,base.definition);remember(p);p.overrides=edits;}
 // Reapplying a saved effective definition is not a replacement of defaults.
 prune(p);next[id]=p;validateProfiles(next);return {profiles:next,selection:selected(id,p)};
}
function editTheme(profiles,id,command){
 const next=validateProfiles(profiles),p=own(next,id)?next[id]:null;if(!p)throw Error('请先应用一个主题');
 keys(command,['action','definition','path','choice','base'],'修改命令');const prior={digest:p.base.digest,overrides:clone(p.overrides)};
 if(command.action!=='inherit'&&own(command,'base'))throw Error('无效主题编辑参数');
 if(command.action==='edit'){if(command.path!==undefined||command.choice!==undefined)throw Error('无效主题编辑参数');p.overrides=difference(p,command.definition);}
 else if(command.action==='inherit'){
  if(command.path!==undefined||command.choice!==undefined)throw Error('无效主题继承参数');validateBase(command.base);
  const known=command.base.digest===p.base.digest?p.base:p.history[command.base.digest];
  if(known&&!equal(known.definition,command.base.definition))throw Error('预设声明的原始主题与已有版本不一致');
  p.overrides=difference({base:command.base,overrides:[]},command.definition);
  if(command.base.digest!==p.base.digest)p.history[command.base.digest]=clone(command.base);
 }
 else if(command.action==='reset'){if(Object.keys(command).length!==1)throw Error('无效主题重置参数');p.overrides=[];}
 else if(command.action==='undo'){if(Object.keys(command).length!==1||!p.previous)throw Error('没有可撤销的主题修改');p.overrides=clone(p.previous.overrides);}
 else if(command.action==='resolve'){
  if(command.definition!==undefined||!pathValid(command.path)||!['mine','default'].includes(command.choice))throw Error('无效主题冲突处理');
  const index=p.overrides.findIndex(e=>equal(e.path,command.path));if(index<0)throw Error('该主题覆盖已变化，请刷新');
  if(command.choice==='default')p.overrides.splice(index,1);else {p.overrides[index].before=valueAt(p.base.definition,command.path);p.overrides[index].source=p.base.digest;}
 }else throw Error('未知主题修改操作');
 if(command.action!=='undo'&&equal(p.overrides,prior.overrides))return {profiles:next,selection:selected(id,p),...materialize(p)};
 p.previous=prior;prune(p);validateProfiles(next);const result=materialize(p);
 // Edits must be usable now; updates may retain suspended old overrides so
 // the user can inspect and resolve them without losing the original values.
 if((command.action==='edit'||command.action==='resolve'&&command.choice==='mine')&&result.error)throw Error(result.error);
 return {profiles:next,selection:selected(id,p),...result};
}
function themeValues(base,edited){
 const values={};for(const entry of difference({base:{digest:'0'.repeat(64),definition:base},overrides:[]},edited)){
  const value=entry.after.exists?entry.after.value:null;
  if(entry.path.length===1)values.styles=value;else {values[entry.path[0]]??={};values[entry.path[0]][entry.path[1]]=value;}
 }
 return values;
}
module.exports={validateProfiles,materialize,selectTheme,editTheme,themeValues};
