// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/interface-zoom-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {ipcRenderer}=require('electron');
// A session preload can also run in unrelated pages. The host grants this
// behavior only to the main frame of a registered Aieyra interface.
ipcRenderer.invoke('aieyra-ui-zoom:enabled').then(enabled=>{
 if(!enabled)return;
 window.addEventListener('wheel',event=>{
  if(!event.isTrusted||!event.ctrlKey||!Number.isFinite(event.deltaY)||event.deltaY===0)return;
  // Surfaces with their own Ctrl+wheel zoom (the Workspace canvas) opt out.
  if(event.target?.closest?.('[data-local-zoom]'))return;
  event.preventDefault();event.stopImmediatePropagation();
  ipcRenderer.send('aieyra-ui-zoom:change',event.deltaY<0?'in':'out');
 },{capture:true,passive:false});
 window.addEventListener('keydown',event=>{
  if(!event.isTrusted||event.altKey||!(event.ctrlKey||event.metaKey))return;
  const direction=event.key==='0'?'reset':['+','='].includes(event.key)?'in':event.key==='-'?'out':null;
  if(direction){event.preventDefault();event.stopImmediatePropagation();ipcRenderer.send('aieyra-ui-zoom:change',direction);}
 },{capture:true});
}).catch(()=>{});
