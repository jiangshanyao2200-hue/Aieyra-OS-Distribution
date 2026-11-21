// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/surface-menu-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('aieyraSurfaceMenu',Object.freeze({
 action:payload=>ipcRenderer.invoke('surface-menu:action',payload),
 onFrame:callback=>ipcRenderer.on('surface-menu:frame',(_event,value)=>callback(value)),
}));
