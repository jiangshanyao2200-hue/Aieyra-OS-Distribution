// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: relocateHalo
// Impact: python -B scripts/code-atlas.py show Halo/runtime/transition.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {pulsarBurst} from '../official/pulsar-burst.mjs';

// The host supplies settled geometry and its shared motion/cancellation policy.
// Classic particles belong only to the classic drawing; custom packages keep
// their own state animation and enter at the destination without a legacy burst.
export function relocateHalo(surface,from,to,{motion,obstructed=false,quiet=false,duration:requestedDuration,ringDuration}={}){
 const doc=surface.ownerDocument;
 if(!from?.width||!to?.width||!motion.motionAllowed(surface))return Object.assign(()=>{},{finished:Promise.resolve()});
 const {animateUI,motionDuration}=motion;
 const simple=quiet||obstructed||!!surface.querySelector('[data-halo-custom]');
 const at=`${from.left+from.width/2-to.left-to.width/2}px ${from.top+from.height/2-to.top-to.height/2}px`,duration=requestedDuration??motionDuration(surface,'move')*2,scale=from.width/to.width;
 const animation=simple?
  animateUI(surface,[{opacity:0},{opacity:1}],{kind:'enter',key:'ring-relocation'}):
  animateUI(surface,[{translate:at,opacity:1,scale,easing:'ease-in'},{translate:at,opacity:0,scale:scale*.7,offset:.3},{translate:'0 0',opacity:0,scale:.7,offset:.7,easing:'cubic-bezier(.3,1.4,.5,1)'},{translate:'0 0',opacity:1,scale:1}],{duration,key:'ring-relocation'});
 const stop=simple?null:pulsarBurst(doc,from,to,{...motion,duration,ringDuration});
 return Object.assign(()=>{animation?.cancel();stop?.();},{finished:Promise.allSettled([animation?.finished,stop?.finished])});
}
