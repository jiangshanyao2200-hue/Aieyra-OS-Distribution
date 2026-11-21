// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/module-background-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('aieyraModuleBackground',Object.freeze({onTheme(fn){const listener=(_event,value)=>fn(value);ipcRenderer.on('module:theme',listener);return ()=>ipcRenderer.removeListener('module:theme',listener);}}));
