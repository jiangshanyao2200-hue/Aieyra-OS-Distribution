// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: install
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/preview-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 产物预览只多一项能力：alert/confirm/prompt 由 OS 自己画（同步返回，取消为 null）。
// 不暴露 Node、文件或其他宿主接口。
const {contextBridge,ipcRenderer,webFrame,webUtils}=require('electron');

contextBridge.exposeInMainWorld('__aieyraPageDialog',(kind,message,value)=>ipcRenderer.sendSync('aieyra-page-dialog',kind,message==null?'':String(message),value==null?'':String(value)));
const install=()=>{
  const ask=window.__aieyraPageDialog;
  Object.defineProperties(window,{
    prompt:{configurable:true,writable:true,value:(message,value)=>{const r=ask('prompt',message,value);return typeof r==='string'?r:null;}},
    confirm:{configurable:true,writable:true,value:message=>typeof ask('confirm',message)==='string'},
    alert:{configurable:true,writable:true,value:message=>{ask('alert',message);}},
  });
};
if(typeof contextBridge.executeInMainWorld==='function')contextBridge.executeInMainWorld({func:install});
else void webFrame.executeJavaScript('('+install+')()');

// Runs only on registered application surfaces. No file API is exposed to pages.
window.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
window.addEventListener('drop',async e=>{
 const input=Array.from(e.dataTransfer?.files||[]);if(!input.length)return;e.preventDefault();e.stopImmediatePropagation();
 try{
  if(input.length>10)throw Error('每次最多拖入 10 个文件');
  const paths=[],files=[];let total=0;
  for(const file of input){const native=webUtils.getPathForFile(file);if(native)paths.push(native);else{if(file.size>32*1024*1024)throw Error('单个文件最多 32 MiB');total+=file.size;if(total>64*1024*1024)throw Error('附件合计最多 64 MiB');files.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}}
  const result=await ipcRenderer.invoke('workspace:dropFiles',{paths,files});if(result?.ok===false)throw Error(result.error);
 }catch(error){const hint=document.createElement('p');hint.textContent=error.message;hint.setAttribute('role','status');hint.style.cssText='position:fixed;top:20px;left:10%;right:10%;z-index:2147483647;padding:16px;background:#171d26;color:#eef4fa;border-radius:14px;text-align:center;pointer-events:none';document.body.append(hint);setTimeout(()=>hint.remove(),5000);}
},true);
