// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/shell-window-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('aieyraShell',Object.freeze({action:payload=>ipcRenderer.invoke('shell-window:action',payload),onTheme:callback=>{const fn=(_event,value)=>callback(value);ipcRenderer.on('shell-window:theme',fn);return ()=>ipcRenderer.removeListener('shell-window:theme',fn);}}));
