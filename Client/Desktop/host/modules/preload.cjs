// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: invoke; listen; onEvent; onNamed
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/modules/preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 独立模块窗口的唯一桥：aieyraModule 供外壳使用；aieyra 为 Link 页面提供与 OS 相同的方法名。
const {contextBridge,ipcRenderer,webUtils}=require('electron');
const invoke=name=>payload=>ipcRenderer.invoke('module:'+name,payload);
const listen=channel=>callback=>{
 if(typeof callback!=='function')return ()=>{};
 const listener=(_event,value)=>callback(value);
 ipcRenderer.on(channel,listener);
 return ()=>ipcRenderer.removeListener(channel,listener);
};
const onEvent=listen('module:event');
const onNamed=name=>callback=>onEvent(event=>{if(event?.name===name)callback(event.payload);});
contextBridge.exposeInMainWorld('aieyraModule',Object.freeze({
 invoke:(name,payload)=>/^[A-Za-z]{1,40}$/.test(String(name))?ipcRenderer.invoke('module:'+name,payload):Promise.reject(Error('无效的模块操作')),
 on:onEvent,
}));
contextBridge.exposeInMainWorld('aieyra',Object.freeze({
 pathsForFiles:files=>Array.from(files).map(file=>webUtils.getPathForFile(file)),
 onNavigate:onNamed('navigate'),
  onRemoteLinkChanged:onNamed('remoteLinkChanged'),
 onLinkRequest:onNamed('linkRequest'),
 ...Object.fromEntries(['remoteLink','openLink','linkStatus','linkDeviceCode','controlStatus','controlOpen','controlSurface'].map(name=>[name,invoke(name)])),
}));
