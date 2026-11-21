// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: invoke; listen
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/extension-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
// Settings dialogs share the authenticated native-owner modal protocol used
// by embedded programs. Their DOM top layer must also hide the Agent overlay.
if(process.isMainFrame&&process.argv.includes('--aieyra-extension-kind=settings')){
 let token='',previous=null,observer=null;
 function publish(force=false){if(!token)return;const open=!!document.querySelector('dialog:modal');if(!force&&open===previous)return;previous=open;ipcRenderer.send('workspace:nativeModal',{token,open});}
 function observe(){if(observer||!document.documentElement)return;observer=new MutationObserver(()=>publish());observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});publish();}
 ipcRenderer.on('workspace:modalProbe',(_event,value)=>{if(typeof value?.token!=='string'||!/^[a-f0-9]{32}$/.test(value.token))return;token=value.token;observe();publish(true);});
 window.addEventListener('DOMContentLoaded',observe,{once:true});window.addEventListener('pageshow',observe);
 window.addEventListener('pagehide',()=>{if(token)ipcRenderer.send('workspace:nativeModal',{token,open:false});observer?.disconnect();observer=null;previous=null;});
}
const invoke=(method)=>(args={})=>ipcRenderer.invoke('extension:invoke',{method,args});
const listen=channel=>callback=>{if(typeof callback!=='function')return ()=>{};const handler=(_e,value)=>callback(value);ipcRenderer.on('extension:'+channel,handler);return ()=>ipcRenderer.removeListener('extension:'+channel,handler);};
contextBridge.exposeInMainWorld('aieyraExtension',Object.freeze({...(process.argv.includes('--aieyra-extension-kind=contacts')?{themeLibrary:invoke('themeLibrary')}:{}),...(process.argv.includes('--aieyra-extension-kind=conversation')?{browserWorkSurface:invoke('browserWorkSurface')}:{}),pathsForFiles:files=>Array.from(files).map(file=>webUtils.getPathForFile(file)),...Object.fromEntries(['program','describe','sessionFocus','modalSurface','catalog','open','detach','dock','hide','release','retireFocus','focusMain','frame','minimizeWindow','toggleMaximize','closeWindow','terminals','terminalRead','toolImage','receipt','document','profile','builtinRole','appearance','halo','conversation','attachmentState','chooseAttachments','stageAttachmentPaths','stageAttachmentBytes','stageFileBytes','imageLibrary','attachmentMedia','attachmentReferences','openLink','conversationOpen','conversationMenu','groupDraft','openHome'].map(method=>[method,invoke(method)])),onFoldedAction:listen('foldedAction'),onFrame:listen('frame'),onState:listen('state'),onVisibility:listen('visibility'),onCatalog:listen('catalog'),onSettingsChanged:listen('settingsChanged')}));
if(!process.argv.includes('--aieyra-extension-kind=conversation')){
// Runs only on registered application surfaces. No file API is exposed to pages.
window.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
window.addEventListener('drop',async e=>{
 const input=Array.from(e.dataTransfer?.files||[]);if(!input.length)return;e.preventDefault();e.stopImmediatePropagation();
 try{
  if(input.length>10)throw Error('每次最多拖入 10 个文件');
  const paths=[],files=[];let total=0;
  for(const file of input){const native=webUtils.getPathForFile(file);if(native)paths.push(native);else{if(file.size>32*1024*1024)throw Error('单个文件最多 32 MiB');total+=file.size;if(total>64*1024*1024)throw Error('附件合计最多 64 MiB');files.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}}
  const result=await ipcRenderer.invoke('workspace:dropFiles',{paths,files});if(result?.ok===false)throw Error(result.error);
 }catch(error){const hint=document.createElement('p');hint.textContent=error.message;hint.setAttribute('role','status');hint.style.cssText='position:fixed;top:20px;left:10%;right:10%;z-index:2147483647;padding:16px;background:#171d26;color:#eef4fa;border-radius:14px;text-align:center;pointer-events:none';document.body.append(hint);setTimeout(()=>hint.remove(),5000);}
},true);

}
if(process.argv.includes('--aieyra-extension-kind=shell'))contextBridge.exposeInMainWorld('aieyraTips',Object.freeze({call:p=>ipcRenderer.invoke('ui:tip',p),onAccountChanged:listen('accountChanged')}));
if(process.argv.includes('--aieyra-extension-kind=settings'))contextBridge.exposeInMainWorld('aieyra',Object.freeze({...Object.fromEntries(['extensionPackages','runtimePrompts','context','settingsBootstrap','onboard','account','profile','builtinRole','appearance','halo','saveProfile','chooseAvatar','chooseBackground','themeLibrary','prompts','savePrompt','restorePrompt','restoreAllPrompts','undoPrompt','pickProject','openLink','conversationOpen','conversationMenu','groupDraft','openHome'].map(method=>[method,invoke(method)])),minimizeWindow:invoke('minimizeWindow'),toggleMaximize:invoke('toggleMaximize'),closeWindow:invoke('hide'),onAccountChanged:listen('accountChanged'),onSettingsChanged:listen('settingsChanged')}));
