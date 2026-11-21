// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: modalToken; publishModal
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/plugin-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// OS 内程序的唯一桥。主进程按发送页面判定权限，页面只能调用自己那个程序的动作。
const {contextBridge,ipcRenderer,webUtils}=require('electron');
// Same document token as native dialogs; queued reports from an old program
// document cannot change the new document's native overlay visibility.
let modalToken='',modalOpen=false;
const publishModal=()=>{if(modalToken)ipcRenderer.send('workspace:nativeModal',{token:modalToken,open:modalOpen});};
if(process.isMainFrame){
 ipcRenderer.on('workspace:modalProbe',(_event,value)=>{if(typeof value?.token!=='string'||!/^[a-f0-9]{32}$/.test(value.token))return;modalToken=value.token;publishModal();});
 window.addEventListener('pagehide',()=>{modalOpen=false;publishModal();modalToken='';});
}
contextBridge.exposeInMainWorld('aieyraApp',Object.freeze({
 invoke:payload=>ipcRenderer.invoke('plugin:invoke',payload),
 modalSurface:open=>{modalOpen=open===true;publishModal();return Promise.resolve({ok:true});},
 pathForFile:file=>webUtils.getPathForFile(file),
 projectDrop:files=>ipcRenderer.invoke('plugin:project-drop',Array.from(files).map(file=>webUtils.getPathForFile(file))),
 onVisibility:callback=>{if(typeof callback!=='function')return ()=>{};const listener=(_event,value)=>callback(value);ipcRenderer.on('extension:visibility',listener);return ()=>ipcRenderer.removeListener('extension:visibility',listener);},
 onAccountChanged:callback=>{if(typeof callback!=='function')return ()=>{};const listener=()=>callback();ipcRenderer.on('extension:accountChanged',listener);return ()=>ipcRenderer.removeListener('extension:accountChanged',listener);},
 // 后台规则：页面有不能中断的工作（如终端会话）时声明保持唤醒，结束后取消。
 keepAwake:value=>ipcRenderer.send('plugin:awake',value===true),
 on:callback=>{if(typeof callback!=='function')return ()=>{};const listener=(_event,value)=>callback(value);ipcRenderer.on('plugin:event',listener);return ()=>ipcRenderer.removeListener('plugin:event',listener);},
}));
