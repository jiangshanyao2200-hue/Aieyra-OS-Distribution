// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: install
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/page-dialog-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 中心程序的页面只多这一项能力：alert / confirm / prompt 由 OS 自己画，不弹系统框。
const {contextBridge,ipcRenderer,webFrame}=require('electron');
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
