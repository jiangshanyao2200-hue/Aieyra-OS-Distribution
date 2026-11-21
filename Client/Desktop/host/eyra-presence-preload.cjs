// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: listen
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/eyra-presence-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const listen=channel=>callback=>{const listener=(_event,p)=>callback(p);ipcRenderer.on(channel,listener);return ()=>ipcRenderer.removeListener(channel,listener);};
contextBridge.exposeInMainWorld('aieyraTips',Object.freeze({call:p=>ipcRenderer.invoke('ui:tip',p)}));
contextBridge.exposeInMainWorld('eyraPresence',Object.freeze({onFrame:listen('eyra:frame'),onVisibility:listen('eyra:visibility'),painted:revision=>ipcRenderer.invoke('eyra:painted',{revision}),home:()=>ipcRenderer.invoke('eyra:home'),input:()=>ipcRenderer.invoke('eyra:input')}));
