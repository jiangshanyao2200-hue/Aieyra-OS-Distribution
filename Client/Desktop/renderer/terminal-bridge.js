// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/renderer/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/renderer/terminal-bridge.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Electron 使用 preload；内嵌 Terminal 使用同一套白名单 RPC。
if(!window.aieyra&&location.protocol==='http:'&&location.hostname==='127.0.0.1'){
 document.documentElement.classList.add('terminal-embedded');
 const endpoint=new URL('../rpc',location.href);
 let knownMtime=0,writing=0;
 const listeners=new Set();
 let watcher=null,polling=false;
 async function call(method,payload){
  const updates=method==='config:save'||method==='config:bootstrap';
  if(updates)writing++;
  try{
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,payload})});
  if(!response.ok)throw new Error('配置服务不可用');
  const data=await response.json();
  if(updates&&typeof data.mtime==='number')knownMtime=data.mtime;
  return data;
  }finally{if(updates)writing--;}
 }
 window.aieyra={
  bootstrap:()=>call('config:bootstrap'),save:(settings,expected_version)=>call('config:save',{settings,expected_version}),
  draftState:(settings,baseline)=>call('config:draft-state',{settings,baseline}),
  confirmDiscard:language=>new Promise(resolve=>{
   const en=language==='en-US',dialog=document.createElement('dialog');dialog.className='aieyra-confirm';
   const title=document.createElement('h2'),message=document.createElement('p'),actions=document.createElement('div');actions.className='dialog-actions';
   title.textContent=en?'Unsaved changes':'未保存的修改';message.textContent=en?'You have unsaved changes. Leave and discard them?':'有未保存的修改，确认离开吗？';
   for(const [label,value] of [[en?'Keep editing':'继续编辑',false],[en?'Discard and leave':'放弃修改并离开',true]]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>{dialog.close();dialog.remove();resolve(value);};actions.append(button);}
   dialog.oncancel=()=>{dialog.remove();resolve(false);};dialog.append(title,message,actions);document.body.append(dialog);dialog.showModal();
  }),
  providerAction:(action,settings,id)=>call('provider:'+action,{settings,id}),
  poolAction:(action,settings,id)=>call('pool:'+action,{settings,id}),
  draftProfile:(settings,id)=>call('config:draft-profile',{settings,id}),
  ping:settings=>call('api:ping',settings),reset:settings=>call('config:reset',settings),win:()=>false,
  onExternalChange:cb=>{
   listeners.add(cb);
   if(!watcher)watcher=setInterval(async()=>{
    if(writing||polling)return;
    polling=true;
    try{
     const {mtime}=await call('config:stamp');
     if(writing)return;
     if(knownMtime!==mtime){knownMtime=mtime;for(const listener of listeners)listener();}
    }catch{}finally{polling=false;}
   },2000);
   return()=>{listeners.delete(cb);if(!listeners.size){clearInterval(watcher);watcher=null;}};
  },
 };
}
