// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: own; idValid; assertPresetID; keys; nameValid; checkBase; validatePreset; resolve; parsePreset; validatePresets; savePreset; applyPreset; applyAuthorPreset; exportPreset
// Impact: python -B scripts/code-atlas.py show Theme/runtime/presets.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {validateTheme,applyThemeValues,resolveThemePreset}=require('../contract/definition.mjs');
const {themeValues,materialize,editTheme,validateProfiles}=require('./overrides.cjs');
const own=(o,k)=>Object.hasOwn(o,k),clone=structuredClone,MAX=512*1024;
const idValid=id=>typeof id==='string'&&/^[a-z][a-z0-9_.-]{1,127}$/.test(id);
function assertPresetID(id){if(!idValid(id))throw Error('预设标识无效');}
function keys(value,names){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!names.includes(k)))throw Error('预设包含未知字段');}
function nameValid(name){if(typeof name!=='string'||!name.trim()||Buffer.byteLength(name)>160||/[\x00-\x1f]/.test(name))throw Error('预设名称无效');}
function checkBase(theme){
 keys(theme,['id','digest','version','definition']);if(!idValid(theme.id))throw Error('预设主题身份无效');
 const {id,...base}=theme;validateProfiles({[id]:{schema:1,base,origin:base.digest,history:{},overrides:[]}});
}
function validatePreset(preset,depth=0,themeID){
 if(depth>=8)throw Error('预设继承最多8层');
 keys(preset,['schema','name','theme','parent','values']);if(preset.schema!=='aieyra.theme-preset/1')throw Error('不支持的主题预设版本');nameValid(preset.name);checkBase(preset.theme);
 if(themeID&&themeID!==preset.theme.id)throw Error('预设不能继承不同主题');
 if(own(preset,'parent'))validatePreset(preset.parent,depth+1,preset.theme.id);
 const definition=resolve(preset,preset.theme.definition);validateTheme(definition);return definition;
}
// Parents are immutable snapshots. Resolve their values onto the child's
// recorded defaults; deleting or renaming another local preset cannot orphan it.
function resolve(preset,defaults){
 const base=preset.parent?resolve(preset.parent,defaults):clone(defaults);
 return applyThemeValues(base,preset.values);
}
function parsePreset(value){
 const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(JSON.stringify(value));if(bytes.length>MAX)throw Error('主题预设超过512 KiB');
 const preset=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));validatePreset(preset);return preset;
}
function validatePresets(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>32||Buffer.byteLength(JSON.stringify(value))>MAX)throw Error('最多保存32个预设，合计不超过512 KiB');
 for(const [id,preset]of Object.entries(value)){if(!idValid(id))throw Error('预设标识无效');validatePreset(preset);}return clone(value);
}
function savePreset({profiles,selection,presets},command){
 keys(command,['action','id','name','parent','preset']);const next=validatePresets(presets);
 assertPresetID(command.id);
 if(command.action==='delete'){
  if(Object.keys(command).length!==2||!own(next,command.id))throw Error('预设不存在');delete next[command.id];return next;
 }
 if(own(next,command.id))throw Error('预设标识已存在，请另存新预设');
 if(command.action==='import'){
  if(Object.keys(command).length!==3)throw Error('预设导入参数无效');next[command.id]=parsePreset(command.preset);
 }else if(command.action==='save'){
  if(command.preset!==undefined)throw Error('预设保存参数无效');nameValid(command.name);
  const profile=profiles?.[selection?.id];if(!profile)throw Error('请先应用一个主题');
  const view=materialize(profile);if(view.suspended||view.conflicts.length)throw Error('请先处理主题冲突，再保存预设');
  let parent;if(command.parent!==undefined){if(!idValid(command.parent)||!own(next,command.parent))throw Error('父预设不存在');parent=next[command.parent];if(parent.theme.id!==selection.id)throw Error('预设不能继承不同主题');}
  const baseline=parent?resolve(parent,profile.base.definition):profile.base.definition;
  next[command.id]={schema:'aieyra.theme-preset/1',name:command.name,theme:{id:selection.id,...clone(profile.base)},...(parent?{parent:clone(parent)}:{}),values:themeValues(baseline,view.definition)};
 }else throw Error('未知预设操作');
 return validatePresets(next);
}
function applyPreset(profiles,selection,presets,command){
 keys(command,['action','id']);if(command.action!=='apply'||!selection)throw Error('请先应用预设所属主题');
 assertPresetID(command.id);
 const entries=validatePresets(presets);if(!own(entries,command.id))throw Error('预设不存在');const preset=entries[command.id];
 if(selection.id!==preset.theme.id)throw Error('请先应用预设所属主题：'+preset.theme.id);
 const {id,...base}=preset.theme;return editTheme(profiles,id,{action:'inherit',base,definition:validatePreset(preset)});
}
function applyAuthorPreset(profiles,selection,command){
 keys(command,['action','id']);if(command.action!=='author'||!selection)throw Error('请先应用一个主题');
 const profile=profiles[selection.id],definition=resolveThemePreset(profile.base.definition,command.id);
 return editTheme(profiles,selection.id,{action:'inherit',base:profile.base,definition});
}
function exportPreset(presets,id){assertPresetID(id);const entries=validatePresets(presets);if(!own(entries,id))throw Error('预设不存在');return JSON.stringify(entries[id])+'\n';}
module.exports={parsePreset,validatePresets,savePreset,applyPreset,applyAuthorPreset,exportPreset,assertPresetID,MAX};
