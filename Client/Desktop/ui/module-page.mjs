// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupModulePage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/module-page.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {workspaceBounds} from './workspace-slide.mjs';
// A native page follows the same navigation rectangle as other OS pages.
export function setupModulePage(api,navigation,{key,title,doc=document,onError=()=>{}}){
 const host=doc.createElement('section');host.id=key+'-module-view';host.className='workspace-page module-content';doc.getElementById('view-content').append(host);navigation.register(host.id);
 let frame=0,signature='',closed=false,latest=null,sending=false,opening=0;
 async function submit(payload){
  latest=payload;if(sending)return;sending=true;
  try{while(latest){const next=latest;latest=null;try{const r=await api.extensionSurface(next);if(r?.ok===false)throw Error(r.error);}catch(e){signature='';if(!closed)onError(e.message);}}}
  finally{sending=false;}
 }
 function layout(){frame=0;if(closed)return;const r=workspaceBounds(host),payload={key,visible:!doc.querySelector('dialog:modal')&&navigation.is(host.id),bounds:{x:r.x,y:r.y,width:r.width,height:r.height}},next=JSON.stringify(payload);if(next===signature)return;signature=next;void submit(payload);}
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(layout);};
 // Hiding is immediate, including when the renderer is background-throttled.
 const changed=()=>{opening++;cancelAnimationFrame(frame);layout();};
 const resize=new ResizeObserver(schedule);resize.observe(host);doc.addEventListener('workspace-view-request',changed);doc.addEventListener('workspace-view-change',changed);doc.addEventListener('workspace-modal-change',changed);
 return {async open(){navigation.request();const ticket=++opening;const r=await api.extensionOpen({key,deferSurface:true});if(r?.ok===false)throw Error(r.error);if(closed||ticket!==opening){if(!navigation.is(host.id))void submit({key,visible:false});return;}if(r.placement!=='detached')navigation.open(host.id,title);schedule();},close(){closed=true;opening++;resize.disconnect();doc.removeEventListener('workspace-view-request',changed);doc.removeEventListener('workspace-view-change',changed);doc.removeEventListener('workspace-modal-change',changed);cancelAnimationFrame(frame);void submit({key,visible:false});}};
}
