// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupSettingsPage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/settings-page.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {workspaceBounds} from './workspace-slide.mjs';
// Main-window page and its native editor share one navigation lifecycle. The
// editor may move to another window; page changes only show or hide its view.
export function setupSettingsPage(api,navigation,{doc=document,onError=()=>{}}={}){
 const host=doc.getElementById('settings-surface'),entry=doc.getElementById('api-bubble');
 let closed=false,frame=0,signature='',descriptor=null,latest=null,sending=false,overlay=null;
 // Bounds change every frame while a side panel slides: only the newest is sent.
 async function send(payload){
  latest=payload;if(sending)return;sending=true;
  try{while(latest&&!closed){const next=latest;latest=null;try{const r=await api.extensionSurface(next);if(r?.ok===false)throw Error(r.error);}catch(error){signature='';if(!closed)onError(error.message);}}}
  finally{sending=false;latest=null;}
 }
 function surface(){
  frame=0;if(closed)return;
  const visible=!doc.querySelector('dialog:modal')&&navigation.is('settings-view');
  // Keep one stable native viewport. The editor reserves its scrolling area
  // using the real overlay geometry, without a second native resize.
  if(host.style.height!=='100%')host.style.height='100%';
  const r=workspaceBounds(host);
  const floating=overlay?.visible&&overlay.bounds;
  const overlayClearance={bottom:floating?Math.max(0,r.y+r.height-floating.y+12):0,wide:!!floating&&floating.width>176};
  const payload={visible:visible&&r.width>0&&r.height>0,bounds:{x:r.x,y:r.y,width:r.width,height:r.height},overlayClearance};
  const key=JSON.stringify(payload);if(key===signature)return;signature=key;
  void send(payload);
 }
 const schedule=()=>{if(!frame&&!closed)frame=requestAnimationFrame(surface);};
 const onOverlay=event=>{overlay=event.detail;schedule();};
 async function open({toggle=false}={}){
  const result=await api.extensionOpen({key:'settings'});if(result?.ok===false)throw Error(result.error);
  descriptor=result;
  if(result.placement==='detached'){if(navigation.is('settings-view'))navigation.resume();return;}
  navigation.open('settings-view','设置',{viewKey:'settings',toggle});signature='';schedule();
 }
 const stop=api.onExtensionState?.(value=>{
  if(value.key!=='settings')return;descriptor=value;
  entry.setAttribute('aria-expanded',String(value.visible===true));
  entry.hidden=false;
  if(value.placement==='detached'&&navigation.is('settings-view'))navigation.resume();
 });
 const resize=new ResizeObserver(schedule);resize.observe(host);
 doc.addEventListener('workspace-view-change',schedule);doc.addEventListener('workspace-modal-change',schedule);doc.addEventListener('workspace-overlay-bounds',onOverlay);doc.defaultView.addEventListener('resize',schedule);
 return {open,get state(){return descriptor;},close(){closed=true;stop?.();resize.disconnect();cancelAnimationFrame(frame);doc.removeEventListener('workspace-view-change',schedule);doc.removeEventListener('workspace-modal-change',schedule);doc.removeEventListener('workspace-overlay-bounds',onOverlay);doc.defaultView.removeEventListener('resize',schedule);}};
}
