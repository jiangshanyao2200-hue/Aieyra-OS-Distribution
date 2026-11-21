// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/tip-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('aieyraTip',Object.freeze({
 size:payload=>ipcRenderer.invoke('tip:size',payload),
 onFrame:callback=>ipcRenderer.on('tip:frame',(_event,value)=>callback(value)),
}));
