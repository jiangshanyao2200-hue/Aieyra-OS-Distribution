// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/file-drop-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {ipcRenderer,webUtils}=require('electron');
// Only the registered host accepts this one-way modal fact. The document token
// prevents a late close from a previous renderer from releasing a new dialog.
if(process.isMainFrame){
 let token='',previous=null,observer=null;
 function publish(force=false){if(!token)return;const open=!!document.querySelector('dialog:modal');if(!force&&open===previous)return;previous=open;ipcRenderer.send('workspace:nativeModal',{token,open});}
 function observe(){if(observer||!document.documentElement)return;observer=new MutationObserver(()=>publish());observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});publish();}
 ipcRenderer.on('workspace:modalProbe',(_event,value)=>{if(typeof value?.token!=='string'||!/^[a-f0-9]{32}$/.test(value.token))return;token=value.token;observe();publish(true);});
 window.addEventListener('DOMContentLoaded',observe,{once:true});window.addEventListener('pageshow',observe);
 window.addEventListener('pagehide',()=>{if(token)ipcRenderer.send('workspace:nativeModal',{token,open:false});observer?.disconnect();observer=null;previous=null;});
}
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
