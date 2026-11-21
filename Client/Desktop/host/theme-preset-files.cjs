// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; ordinary; themePresetFile
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/theme-preset-files.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parsePreset,exportPreset,assertPresetID,MAX}=require('../../../Theme/runtime/presets.cjs');
function ordinary(file){
 for(let current=path.resolve(file);;current=path.dirname(current)){
  let stat;try{stat=fs.lstatSync(current);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(stat&&(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1))throw Error('预设文件路径不能经过链接');
  if(path.dirname(current)===current)break;
 }
}
async function themePresetFile({core,dialog,parent},command){
 if(!command||typeof command!=='object'||Object.keys(command).some(k=>!['action','id','expected_version'].includes(k))||!['os_theme_preset_export','os_theme_preset_import'].includes(command.action))throw Error('无效预设文件操作');
 assertPresetID(command.id);
 const before=await core('settings',{action:'os_appearance_read'});if(before?.ok===false)throw Error(before.error);
 if(!command.expected_version||command.expected_version!==before.version)return {ok:false,code:'version_conflict',error:'外观已变化，请重新读取'};
 if(command.action==='os_theme_preset_export'){
  const text=exportPreset(before.settings.theme_presets,command.id),bytes=Buffer.from(text);if(bytes.length>MAX)throw Error('主题预设超过512 KiB');
  const picked=await dialog.showSaveDialog(parent,{title:'导出主题预设',defaultPath:'theme-preset.json',filters:[{name:'主题预设',extensions:['json']}],properties:['showOverwriteConfirmation']});
  if(picked.canceled||!picked.filePath)return {ok:true,cancelled:true};
  const current=await core('settings',{action:'os_appearance_read'});if(current?.ok===false||current.version!==before.version)return {ok:false,code:'version_conflict',error:'预设已变化，导出已取消，请重新读取'};
  const target=path.resolve(picked.filePath);ordinary(target);const temp=path.join(path.dirname(target),'.theme-preset-'+crypto.randomUUID()+'.tmp');let handle;
  try{handle=await fs.promises.open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;ordinary(target);await fs.promises.rename(temp,target);}
  finally{if(handle)await handle.close();await fs.promises.rm(temp,{force:true});}
  return {ok:true,filename:path.basename(target),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
 }
 const picked=await dialog.showOpenDialog(parent,{title:'导入主题预设',filters:[{name:'主题预设',extensions:['json']}],properties:['openFile']});
 if(picked.canceled||!picked.filePaths?.length)return {ok:true,cancelled:true};
 if(picked.filePaths.length!==1)throw Error('每次只能导入一个预设');
 const target=path.resolve(picked.filePaths[0]);ordinary(target);const handle=await fs.promises.open(target,'r');let text;
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX)throw Error('预设文件无效或超过512 KiB');const bytes=Buffer.alloc(MAX+1);let total=0;while(total<bytes.length){const read=await handle.read(bytes,total,bytes.length-total,null);if(!read.bytesRead)break;total+=read.bytesRead;}if(total>MAX)throw Error('主题预设超过512 KiB');text=bytes.subarray(0,total).toString('utf8');}finally{await handle.close();}
 const preset=parsePreset(text);
 return core('settings',{action:'os_appearance_update',expected_version:before.version,patch:{theme_preset:{action:'import',id:command.id,preset}}});
}
module.exports={themePresetFile};
