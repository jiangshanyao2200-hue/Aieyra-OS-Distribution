// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: listen; programFrame
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/folded-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
const listen=channel=>fn=>{const listener=(_e,p)=>fn(p);ipcRenderer.on(channel,listener);return ()=>ipcRenderer.removeListener(channel,listener);};
contextBridge.exposeInMainWorld('aieyraTips',Object.freeze({call:p=>ipcRenderer.invoke('ui:tip',p)}));
contextBridge.exposeInMainWorld('foldedEyra',Object.freeze({action:p=>ipcRenderer.invoke('folded:action',p),painted:(revision,options)=>ipcRenderer.invoke('folded:painted',{revision,work_hidden:options?.work_hidden===true}),prepared:token=>ipcRenderer.invoke('folded:prepared',{token}),read:p=>ipcRenderer.invoke('folded:read',p),onPrepare:listen('folded:prepare'),onFrame:listen('folded:frame'),onVisibility:listen('folded:visibility')}));

let programFrame=null;ipcRenderer.on('folded:frame',(_e,p)=>{programFrame=p.program?{task_id:p.task_id,core_epoch:p.core_epoch}:null;});
// Runs only on registered application surfaces. No file API is exposed to pages.
window.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
window.addEventListener('drop',async e=>{
 const own=programFrame;const input=Array.from(e.dataTransfer?.files||[]);if(!input.length)return;e.preventDefault();e.stopImmediatePropagation();
 try{
  if(input.length>10)throw Error('每次最多拖入 10 个文件');
  const paths=[],files=[];let total=0;
  for(const file of input){const native=webUtils.getPathForFile(file);if(native)paths.push(native);else{if(file.size>32*1024*1024)throw Error('单个文件最多 32 MiB');total+=file.size;if(total>64*1024*1024)throw Error('附件合计最多 64 MiB');files.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}}
  const result=own?await ipcRenderer.invoke('folded:read',{...own,action:'files',paths,files}):await ipcRenderer.invoke('workspace:dropFiles',{paths,files});if(result?.ok===false)throw Error(result.error);
 }catch(error){const hint=document.createElement('p');hint.textContent=error.message;hint.setAttribute('role','status');hint.style.cssText='position:fixed;top:20px;left:10%;right:10%;z-index:2147483647;padding:16px;background:#171d26;color:#eef4fa;border-radius:14px;text-align:center;pointer-events:none';document.body.append(hint);setTimeout(()=>hint.remove(),5000);}
},true);
