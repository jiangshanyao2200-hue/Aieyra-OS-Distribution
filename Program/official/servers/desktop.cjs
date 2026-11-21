'use strict';
// The host injects SSH, credential storage and native file selection. The
// program owns its UI/agent action policy and both actors use the same service.
const fs=require('node:fs');
const {createServers}=require('./service.cjs');
function createServersProgram({pickImage,randomAvatar,changed=()=>{},...options}){
 const service=createServers(options);let closed=false,lifecycle=0;const imageEpoch=new Map();
 const invalidate=id=>{const value=(imageEpoch.get(id)||0)+1;imageEpoch.set(id,value);return value;};
 const suspend=()=>{lifecycle++;imageEpoch.clear();service.suspend();};
 return {...service,suspend,close(){if(closed)return;closed=true;suspend();service.close();},async user(p={},owner){
  if(closed)throw Error('服务器页面已关闭');
  const own=lifecycle;
  if(['image_pick','image_data','image_clear','remove'].includes(p.action))invalidate(p.id);
  if(p.action==='image_random'){
   if(!randomAvatar)throw Error('头像库暂不可用');
   const ticket=invalidate(p.id);await service.call({action:'list'}).then(r=>{if(!r.servers.some(s=>s.id===p.id))throw Error('服务器已移除');});
   const data=await randomAvatar();if(closed||lifecycle!==own||imageEpoch.get(p.id)!==ticket)throw Error('头像选择已变化，请重新操作');
   return service.call({action:'image_data',id:p.id,data},owner);
  }
  if(p.action==='image_pick'){
   const picked=await pickImage();
   if(closed||lifecycle!==own)throw Error('服务器页面已关闭');
   if(picked.canceled||!picked.filePaths?.[0])return {ok:true,cancelled:true};
   const file=picked.filePaths[0],size=fs.statSync(file).size;
   if(size>16*1024*1024)throw Error('图片太大，最多 16 MB');
   const bytes=fs.readFileSync(file),kind=bytes[0]===0x89&&bytes[1]===0x50?'png':bytes[0]===0xff&&bytes[1]===0xd8?'jpeg':bytes.subarray(8,12).toString('latin1')==='WEBP'?'webp':'';
   if(!kind)throw Error('只支持 PNG、JPG 和 WebP');
   return {ok:true,source:'data:image/'+kind+';base64,'+bytes.toString('base64')};
  }
  // The user's existing workflow adds servers through Eyra, not a second form.
  if(['image_set','add','importable'].includes(p.action))throw Error('未知的 server 操作');
  return service.call(p,owner);
 },async agentCall(p={}){
  if(closed)throw Error('服务器页面已关闭');
  if(['add','probe','remove','vault_remove'].includes(p.action)&&p.confirmed!==true)throw Error('修改服务器或列表需要用户同意，再带 confirmed=true 调用');
  const out=await service.agentCall(p),action=String(p.action||'');
  if(out?.ok!==false&&['add','remove','rename','probe','vault_save','vault_remove'].includes(action))changed({catalog:['add','remove','rename'].includes(action),type:'servers_changed'});
  return out;
 }};
}
module.exports={createServersProgram};
