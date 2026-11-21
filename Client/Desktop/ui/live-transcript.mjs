// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createLiveTranscript
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/live-transcript.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {motionAllowed,observeMotion} from './motion.mjs';

// Presentation only: full receipts remain in the model and history. New text
// takes at most one move-duration to arrive; user input immediately settles it.
export function createLiveTranscript(node,scroll,{doc=node.ownerDocument}={}){
 const win=doc.defaultView;let target='',frame=0,closed=false,following=true;
 const bottom=()=>Math.max(0,(scroll.scrollHeight||0)-(scroll.clientHeight||0));
 const nearBottom=()=>bottom()-(scroll.scrollTop||0)<24;
 const cancel=()=>{if(frame){win.cancelAnimationFrame?.(frame);frame=0;}};
 function settle(){cancel();node.textContent=target;node.dataset.streaming='false';}
 function input(event){if(event.type==='keydown'&&!['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(event.key))return;following=false;settle();}
 function moved(){if(!frame)following=nearBottom();}
 for(const type of ['wheel','pointerdown','keydown'])scroll.addEventListener(type,input,{passive:true});
 scroll.addEventListener('scroll',moved,{passive:true});
 const stopMotion=observeMotion(doc,allowed=>{if(!allowed)settle();});
 return {
  update(text){
   text=String(text||'');if(closed||text===target)return;
   cancel();const old=node.textContent||'',append=text.startsWith(old),start=append?old.length:0;
   following=following&&nearBottom();target=text;
   if(!following||!motionAllowed(node)||!node.isConnected){settle();return;}
   const chars=Array.from(text.slice(start)),prefix=text.slice(0,start),begin=win.performance?.now()??performance.now();
   node.textContent=prefix;node.dataset.streaming='true';
   const tick=now=>{
    frame=0;if(closed)return;if(!node.isConnected||!motionAllowed(node)){settle();return;}
    const progress=Math.min(1,Math.max(0,(now-begin)/360));
    node.textContent=prefix+chars.slice(0,Math.ceil(chars.length*progress)).join('');
    if(following)scroll.scrollTop=bottom();
    if(progress<1)frame=win.requestAnimationFrame(tick);else node.dataset.streaming='false';
   };
   frame=win.requestAnimationFrame(tick);
  },
  suspend(){settle();},
  close(){if(closed)return;settle();closed=true;stopMotion?.();for(const type of ['wheel','pointerdown','keydown'])scroll.removeEventListener(type,input);scroll.removeEventListener('scroll',moved);},
 };
}
