// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: states; baseRects; workspaceBounds; setupWorkspaceSlide
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/workspace-slide.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {motionAllowed,motionDuration,observeMotion} from './motion.mjs';

const states=new WeakMap();
const baseRects=new WeakMap();
// The host receives one unshifted base rectangle. A separate position channel moves their
// containers; measuring the DOM proxy must not feed that offset back as layout.
export function workspaceBounds(node){
 const r=node.getBoundingClientRect(),state=states.get(node.ownerDocument),x=state?.x||0,inset=state?.inset||0;
 // Chromium reports transformed bounds with float32 rounding. Remove that
 // noise before the host rounds to native pixels, or a tiny positive residual
 // becomes a one-pixel inset and momentarily resizes the embedded browser.
 // Native hosts apply the animated inset themselves. Restore the proxy's base
 // width here so adapting the shared DOM surface never subtracts it twice.
 // Layout truncates fractional CSS widths to a layout unit and the compositor
 // translates as floats. Keep an unchanged base edge when the two disagree by
 // a fraction of a pixel. Otherwise native ceil/floor can alternate by a DIP.
 const previous=baseRects.get(node);
 function base(value,last){
  if(Number.isFinite(last)&&Math.abs(last-value)<1/32)return last;
  const pixel=Math.round(value);
  return Math.abs(pixel-value)<1/32?pixel:value;
 }
 const bounds={x:base(r.x-x,previous?.x),y:r.y,width:base(r.width+inset,previous?.width),height:r.height};
 baseRects.set(node,bounds);
 return bounds;
}
export function setupWorkspaceSlide(doc,api,onError=()=>{}){
 const win=doc.defaultView,state={x:0,inset:0,target:0},body=doc.body;states.set(doc,state);
 let frame=0,closed=false,pending=null,sending=false,nodes=[];
 async function publish(x,settled){
  pending={x,settled};if(sending||!api.workspaceShift)return;sending=true;
  try{while(pending!==null&&!closed){const next=pending;pending=null;const result=await api.workspaceShift(next);if(result?.ok===false)throw Error(result.error||'工作区位移失败');}}
  finally{sending=false;}
 }
 const collect=()=>{nodes=[...doc.querySelectorAll('#screen,#emergence,#view-surface,#bottom-bar,#status-rail,#activity-orbits,#desktop-dock > :not(#sd-new),#dock-pinned-apps > button,#session-drawer')];};
 function paint(x,settled=false){
  state.x=Number(x.toFixed(3));const value=state.x+'px';
  // Keep the right edge fixed during travel, including interrupted reversals.
  // Setting only the final width made every attached page wrap on the last frame.
  state.inset=state.x;
  for(const node of nodes){node.style.setProperty('--workspace-x',value);node.style.setProperty('--workspace-inset',value);}
  body.style?.setProperty('--workspace-inset',value);
  if(settled&&typeof win.Event==='function')doc.dispatchEvent(new win.Event('workspace-inset-change'));
  void publish(state.x,settled).catch(onError);
 }
 function finish(){win.cancelAnimationFrame(frame);frame=0;collect();paint(state.target,true);body.classList.remove('workspace-sliding');}
 function to(x,{instant=false}={}){
  state.target=Math.max(0,Number(x)||0);win.cancelAnimationFrame(frame);collect();
  if(instant||!motionAllowed(doc)||Math.abs(state.target-state.x)<.01){finish();return;}
  const from=state.x,started=win.performance.now(),duration=motionDuration(body,'move');body.classList.add('workspace-sliding');
  const step=now=>{const t=duration?Math.max(0,Math.min(1,(now-started)/duration)):1;
   // Monotone easing starts at the actually displayed position on reversal.
   paint(from+(state.target-from)*(1-Math.pow(1-t,3)));
   if(t<1)frame=win.requestAnimationFrame(step);else finish();
  };frame=win.requestAnimationFrame(step);
 }
 const stop=observeMotion(doc,allowed=>{if(!allowed)finish();});
 // Only the current native owner may move embedded pages. When Home docks or
 // detaches, republish that document's retained, settled sidebar geometry.
 let detached;
 const stopOwnership=api.onModuleState?.(value=>{const next=value.modules?.home?.detached===true;if(next===detached)return;detached=next;finish();});
 // Newly revealed page roots inherit the current position without recreating
 // their document, selection, scroll or draft.
 const changed=()=>{collect();paint(state.x);};doc.addEventListener('workspace-view-change',changed);
 collect();paint(0,true);
 return {to,get x(){return state.x;},close(){closed=true;win.cancelAnimationFrame(frame);stop();stopOwnership?.();doc.removeEventListener('workspace-view-change',changed);states.delete(doc);}};
}
