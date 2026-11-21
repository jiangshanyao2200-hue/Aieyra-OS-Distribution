// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: crypto; channel; createNativeModal
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/native-modal.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const crypto=require('node:crypto');
const channel='workspace:nativeModal',probe='workspace:modalProbe';
// Embedded renderers have separate DOM top layers. Hold their native owner,
// independently of the presence/working projection handover.
function createNativeModal({ipcMain,onChange=()=>{}}){
 const sources=new Map(),windows=new Map();let closed=false,targets=new Set();
 const alive=wc=>wc&&!wc.isDestroyed();
 function windowOf(source){try{const win=source.window();return win&&!win.isDestroyed()?win:null;}catch{return null;}}
 function active(source){try{return source.open&&alive(source.wc)&&source.visible();}catch{return false;}}
 function unbind(source){const win=source.bound,entry=windows.get(win);source.bound=null;if(!entry)return;entry.sources.delete(source);if(!entry.sources.size){for(const event of entry.events)win.removeListener(event,refresh);windows.delete(win);}}
 function bind(source,win){
  if(source.bound===win)return;unbind(source);if(!win)return;source.bound=win;
  let entry=windows.get(win);if(!entry){entry={sources:new Set(),events:['show','hide','minimize','restore','closed']};windows.set(win,entry);for(const event of entry.events)win.on(event,refresh);}entry.sources.add(source);
 }
 function refresh(){
  if(closed)return;const next=new Set();
  for(const source of sources.values()){const win=windowOf(source);bind(source,win);if(win&&active(source))next.add(win);}
  if(next.size===targets.size&&[...next].every(win=>targets.has(win)))return;
  targets=next;onChange();
 }
 function blocked(win){if(closed||!win)return false;for(const source of sources.values())if(active(source)&&windowOf(source)===win)return true;return false;}
 function register(wc,{window:windowOf,visible=()=>true,allowed=()=>false,receive=false,onState=()=>{}}){
  if(closed||!alive(wc)||sources.has(wc))throw Error('原生弹窗来源不可用');
  const source={wc,window:windowOf,visible,allowed,receive,open:false,frame:null,token:'',bound:null};sources.set(wc,source);
  const set=open=>{const changed=source.open!==open;source.open=open;refresh();if(changed)onState(open);};source.set=set;
  const reset=()=>{source.frame=null;source.token='';set(false);};
  const navigating=(_event,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace)reset();};
  function documentReady(){
   if(!receive||closed||sources.get(wc)!==source||!alive(wc))return;
   const frame=wc.mainFrame;let valid=false;try{valid=!!frame&&allowed(frame.url);}catch{}
   if(!valid){reset();return;}
   if(source.frame!==frame||!source.token){source.frame=frame;source.token=crypto.randomBytes(16).toString('hex');}
   wc.send(probe,{token:source.token});
  }
  function release(){
   if(sources.get(wc)!==source)return;sources.delete(wc);unbind(source);
   for(const [name,fn] of listeners)wc.removeListener(name,fn);reset();
  }
  const listeners=[['destroyed',release],['render-process-gone',reset],['did-start-navigation',navigating],['dom-ready',documentReady],['did-finish-load',documentReady]];
  for(const [name,fn] of listeners)wc.on(name,fn);source.release=release;refresh();
  return {set(open){if(closed||sources.get(wc)!==source||!alive(wc))return;set(open===true);},refresh,release};
 }
 function reported(event,value){
  const source=sources.get(event.sender);if(closed||!source?.receive||!alive(source.wc)||typeof value?.open!=='boolean'||!source.token||value.token!==source.token)return;
  if(event.senderFrame!==source.frame||event.senderFrame!==source.wc.mainFrame)return;
  try{if(!source.allowed(event.senderFrame.url))return;}catch{return;}
  source.set(value.open);
 }
 ipcMain.on(channel,reported);
 return {register,refresh,blocked,close(){if(closed)return;closed=true;ipcMain.removeListener(channel,reported);for(const source of [...sources.values()])source.release();targets.clear();}};
}
module.exports={createNativeModal};
