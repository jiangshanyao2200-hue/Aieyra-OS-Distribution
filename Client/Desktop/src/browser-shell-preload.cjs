// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/browser-shell-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('aieyraBrowser',{tip:value=>ipcRenderer.invoke('ui:tip',value),onReferenceNotice:fn=>ipcRenderer.on('agent-browser:referenceNotice',(_event,value)=>fn(value)),command:value=>ipcRenderer.send('agent-browser:command',value),onAccess:fn=>ipcRenderer.on('agent-browser:access',(_event,value)=>fn(value)),layout:value=>ipcRenderer.send('agent-browser:layout',value),onBackdrop:fn=>ipcRenderer.on('agent-browser:backdrop',(_event,value)=>fn(value)),onState:fn=>ipcRenderer.on('agent-browser:state',(_event,value)=>fn(value)),onShortcut:fn=>ipcRenderer.on('agent-browser:shortcut',(_event,value)=>fn(value))});
