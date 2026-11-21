// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/matrix-window-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('matrix',{call:p=>ipcRenderer.invoke('matrix:call',p),locale:()=>ipcRenderer.invoke('matrix:locale'),close:()=>ipcRenderer.send('matrix:close'),onPresentation:callback=>{const listener=(_event,mode)=>callback(mode);ipcRenderer.on('matrix:presentation',listener);ipcRenderer.send('matrix:presentation-ready');return ()=>ipcRenderer.removeListener('matrix:presentation',listener);},onVisibility:callback=>{const listener=(_event,visible)=>callback(visible===true);ipcRenderer.on('matrix:visibility',listener);ipcRenderer.send('matrix:visibility-ready');return ()=>ipcRenderer.removeListener('matrix:visibility',listener);}});
