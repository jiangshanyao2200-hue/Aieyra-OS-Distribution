// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createExtensionSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/extension-settings.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Settings owns the user gesture; the existing registry owns all mutations.
function createExtensionSettings({core,packages,resources,dialog,changed,exportAgent,selectTask,appearance}){
 const actions=new Set(['mod_list','mod_inspect','mod_install','mod_enable','mod_disable','mod_rollback','mod_remove','mod_open','mod_close','mod_describe','mod_apply','mod_adapter_targets','mod_adapter_reset','mod_adapter_test','mod_context_view','mod_context_reset']);
 const mutations=new Set(['mod_install','mod_enable','mod_disable','mod_rollback','mod_remove']);
 return {async call(p,{parent,sender}={}){
  const action=String(p?.action||'');
  if(['center_local','center_migrate','center_open','center_remove'].includes(action)){
   if(!resources)throw Error('本地旧包服务不可用');
   const result=await resources.call({...p,confirmed:true});
   if(['center_migrate','center_remove'].includes(action)&&result?.ok!==false)await changed();
   return result;
  }
  if(action==='mod_workflow')return core('workspace.workflows',p.request);
  if(action==='mod_agent')return core('workspace.agents',p.request);
  if(action==='mod_agent_export')return exportAgent({parent,id:String(p.id||'')});
  if(action==='mod_agent_task'){const id=String(p.id||''),result=await core('workspace.agents',{action:'status',id});if(result?.ok===false)return result;selectTask(id);return {ok:true};}
  if(action==='mod_pick_directory'||action==='mod_pick_archive'){
   const archive=action==='mod_pick_archive';
   const picked=await dialog.showOpenDialog(parent,{title:'导入扩展',properties:[archive?'openFile':'openDirectory'],...(archive?{filters:[{name:'扩展包',extensions:['zip','aieyra']}]}:{})});
   if(picked.canceled||!picked.filePaths?.[0])return {ok:true,cancelled:true};
   const source=picked.filePaths[0];return {...await packages.call({action:'mod_inspect',source}),source};
  }
  if(actions.has(action)){const result=await packages.call({...p,confirmed:true});if(mutations.has(action)&&result?.ok!==false)await changed();return result;}
  if(action==='mod_theme_preview'||action==='mod_theme_preview_close')return packages.call(p,sender);
  if(action==='mod_theme_showcase_config'){const value=appearance();if(!value.ok)return value;return {ok:true,...require('../../../Theme/runtime/projection.cjs').publicAppearance(value),defaults:value.defaults};}
  throw Error('未知扩展操作');
 }};
}
module.exports={createExtensionSettings};
