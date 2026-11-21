// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupThemeEditor
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/theme-editor.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {el} from './views.mjs';

// The editor retains its own observed revision. Background reads may refresh
// the live appearance, but must never overwrite an unsaved theme document.
export function setupThemeEditor(api,{accept}){
 const $=id=>document.getElementById(id),panel=$('look-theme-editor'),documentField=$('look-theme-definition');
 const save=$('look-theme-save'),reset=$('look-theme-reset'),undo=$('look-theme-undo'),reload=$('look-theme-reload');
 const presetSelect=$('look-theme-preset'),parentSelect=$('look-theme-preset-parent'),presetName=$('look-theme-preset-name');
 let latest=null,revision='',saved='',themeId='',dirty=false,busy=false;
 const report=text=>$('look-theme-status').textContent=text;
 const version=base=>base?.version||base?.digest?.slice(0,12)||'未知版本';
 const showValue=value=>value.exists?JSON.stringify(value.value,null,2):'未设置';
 function controls(){
  const profile=latest?.settings.theme_profiles?.[themeId],stale=dirty&&revision!==latest?.version;
  save.disabled=busy||!themeId||!dirty||stale;reset.disabled=busy||!themeId||dirty;undo.disabled=busy||!profile?.previous||dirty;reload.disabled=busy;
  documentField.disabled=busy||!themeId;
  for(const button of $('look-theme-conflicts').querySelectorAll('button'))button.disabled=busy||dirty;
  for(const input of $('look-theme-tokens').querySelectorAll('input'))input.disabled=busy||!themeId;
  const selected=presetSelect.value,local=selected.startsWith('saved:');
  $('look-theme-preset-apply').disabled=busy||dirty||!themeId||!selected;
  $('look-theme-preset-export').disabled=busy||dirty||!local;
  $('look-theme-preset-delete').disabled=busy||dirty||!local;
  $('look-theme-preset-import').disabled=busy||dirty;
  $('look-theme-preset-save').disabled=busy||dirty||!themeId||!presetName.value.trim()||!!latest?.theme_status?.suspended||!!latest?.theme_status?.conflicts.length;
  presetSelect.disabled=busy||dirty;parentSelect.disabled=busy||dirty;presetName.disabled=busy;
 }
 function changed(){dirty=documentField.value!==saved;report(dirty?(revision!==latest?.version?'已保存版本发生变化；草稿仍保留。载入已保存版本后再编辑。':'主题修改尚未保存。'):'');controls();}
 documentField.addEventListener('input',changed);
 function paint(result,force=false){
  latest=result;
  if(dirty&&!force){if(revision!==result.version)report('已保存版本发生变化；草稿仍保留。载入已保存版本后再编辑。');controls();return;}
  themeId=result.settings.layout_theme?.id||'';revision=result.version;dirty=false;
  const profile=result.settings.theme_profiles?.[themeId],status=result.theme_status;
  panel.hidden=false;
  $('look-theme-version').textContent=profile?`${themeId} · 当前 ${version(profile.base)} · 原始 ${version(profile.origin===profile.base.digest?profile.base:profile.history[profile.origin])}${profile.prior?' · 上一版 '+version(profile.prior===profile.base.digest?profile.base:profile.history[profile.prior]):''}`:'主题已移除。重新应用同一主题后可继续修改，已有修改仍保留。';
  saved=profile?JSON.stringify(status?.proposed||result.settings.layout_theme.definition,null,2):'';documentField.value=saved;
  const chosen=presetSelect.value,parent=parentSelect.value;
  presetSelect.replaceChildren(new Option('选择预设',''));parentSelect.replaceChildren(new Option('当前主题默认值',''));
  for(const [id,item]of Object.entries(profile?.base.definition.presets||{}))presetSelect.append(new Option('主题 · '+item.name,'author:'+id));
  for(const [id,item]of Object.entries(result.settings.theme_presets||{})){
   presetSelect.append(new Option('我的 · '+item.name+' · '+item.theme.id+' '+version(item.theme),'saved:'+id));
   if(item.theme.id===themeId)parentSelect.append(new Option(item.name+' · '+version(item.theme),id));
  }
  presetSelect.value=chosen;parentSelect.value=parent;
  const tokens=$('look-theme-tokens');tokens.replaceChildren();
  for(const [name,value]of Object.entries((status?.proposed||result.settings.layout_theme?.definition)?.tokens||{})){
   const label=el('label',undefined,'theme-token-field'),input=el('input');input.type='text';input.value=value;input.setAttribute('aria-label',name);input.dataset.token=name;
   input.oninput=()=>{try{const definition=JSON.parse(documentField.value);definition.tokens??={};definition.tokens[name]=input.value;documentField.value=JSON.stringify(definition,null,2);changed();}catch{report('请先修正高级定义中的 JSON，再修改此值。');}};
   label.append(el('span',name),input);tokens.append(label);
  }
  const conflicts=$('look-theme-conflicts');conflicts.replaceChildren();
  for(const entry of status?.conflicts||[]){
   const card=el('article',undefined,'theme-conflict'),source=entry.source===profile.base.digest?profile.base:profile.history[entry.source];
   card.append(el('h4',entry.path.join(' / ')),el('p',`原版 ${version(source)} → 当前 ${version(profile.base)}`));
   const values=el('div',undefined,'theme-conflict-values');
   for(const [title,value]of [['原默认值',entry.before],['我的修改',entry.after],['当前默认值',entry.current]]){const column=el('div');column.append(el('strong',title),el('pre',showValue(value)));values.append(column);}card.append(values);
   const actions=el('div',undefined,'theme-editor-actions');
   for(const [choice,label]of [['mine','保留我的修改'],['default','使用当前默认值']]){const button=el('button',label,'secondary');button.type='button';button.dataset.choice=choice;button.onclick=()=>commit({action:'resolve',path:entry.path,choice});actions.append(button);}
   card.append(actions);conflicts.append(card);
  }
  // A removed asset can suspend a previously valid edit even when its own
  // property did not change. Offer recovery for every retained override.
  if(status?.suspended){
   const conflictPaths=new Set(status.conflicts.map(e=>JSON.stringify(e.path)));
   for(const entry of profile.overrides.filter(e=>!conflictPaths.has(JSON.stringify(e.path)))){
    const card=el('article',undefined,'theme-conflict'),button=el('button','恢复此项默认值','secondary');button.type='button';
    button.onclick=()=>commit({action:'resolve',path:entry.path,choice:'default'});card.append(el('h4',entry.path.join(' / ')),el('pre',showValue(entry.after)),button);conflicts.append(card);
   }
  }
  report(status?.suspended?'修改暂未应用，正在使用当前默认主题；修改记录已保留。'+status.error:status?.conflicts.length?`有 ${status.conflicts.length} 项版本冲突，当前保留我的修改。`:'');controls();
 }
 async function commit(command,key='theme_edit'){
  if(busy||key==='theme_edit'&&!themeId)return;busy=true;controls();report('正在保存主题…');
  try{
   const result=await api.appearance({action:'os_appearance_update',expected_version:revision,patch:{[key]:command}});
   if(result?.ok===false){report(result.error);return;}
   dirty=false;accept(result);paint(result,true);
   if(!result.theme_status?.suspended&&!result.theme_status?.conflicts.length)report('主题已保存。');
  }catch(e){report(e.message);}finally{busy=false;controls();}
 }
 save.onclick=()=>{try{if(!save.disabled)return commit({action:'edit',definition:JSON.parse(documentField.value)});}catch(e){report('定义无法保存：'+e.message);}};
 reset.onclick=()=>commit({action:'reset'});undo.onclick=()=>commit({action:'undo'});
 presetSelect.onchange=controls;presetName.oninput=controls;
 $('look-theme-preset-apply').onclick=()=>{const value=presetSelect.value;return commit({action:value.startsWith('author:')?'author':'apply',id:value.slice(value.indexOf(':')+1)},'theme_preset');};
 $('look-theme-preset-delete').onclick=()=>commit({action:'delete',id:presetSelect.value.slice(6)},'theme_preset');
 $('look-theme-preset-save').onclick=()=>commit({action:'save',id:'preset-'+crypto.randomUUID(),name:presetName.value.trim(),...(parentSelect.value?{parent:parentSelect.value}:{})},'theme_preset');
 async function file(action){
  if(busy||dirty)return;busy=true;controls();
  try{
   const result=await api.appearance({action,expected_version:revision,id:action==='os_theme_preset_import'?'preset-'+crypto.randomUUID():presetSelect.value.slice(6)});
   if(result?.ok===false){report(result.error);return;}if(result.cancelled){report('已取消。');return;}
   if(result.settings){accept(result);paint(result,true);report('预设已导入；选择后可应用。');}else report('已导出：'+result.filename);
  }catch(e){report(e.message);}finally{busy=false;controls();}
 }
 $('look-theme-preset-import').onclick=()=>file('os_theme_preset_import');$('look-theme-preset-export').onclick=()=>file('os_theme_preset_export');
 reload.onclick=async()=>{
  if(busy)return;busy=true;controls();
  try{const result=await api.appearance({action:'os_appearance_read'});if(result?.ok===false){report(result.error);return;}dirty=false;accept(result);paint(result,true);}catch(e){report(e.message);}finally{busy=false;controls();}
 };
 return {accept:paint,get dirty(){return dirty;}};
}
