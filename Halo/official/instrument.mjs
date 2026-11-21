// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: halo; mountHaloInstrument; clocks; paintHaloState
// Impact: python -B scripts/code-atlas.py show Halo/official/instrument.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {PresenceWait,haloState,presenceCode} from './effects.mjs';
// Official classic geometry, shared by all host adapters.
export const halo = `<svg class="halo" viewBox="0 0 40 40" aria-hidden="true"><circle class="halo-edge" cx="20" cy="20" r="15.4"/><circle class="halo-flow" cx="20" cy="20" r="15.4" pathLength="100"/><circle class="halo-wave" cx="20" cy="20" r="10"/><circle class="halo-orbit" cx="20" cy="20" r="10"/><path class="halo-cursor" d="M13 15h13M13 20h10M13 25h12M27 22v5"/><g class="halo-reader"><path d="M14 11h13v18H14zM17 15h7M17 19h6M17 23h7"/><path class="halo-scan" d="M12 19h17"/></g><g class="halo-wait"><circle cx="20" cy="9" r="1.15"/><circle cx="31" cy="20" r=".9"/><circle cx="20" cy="31" r=".75"/></g><g class="halo-long"><circle cx="20" cy="20" r="9"/><circle cx="20" cy="20" r="5"/></g><text class="halo-code" x="20" y="23" text-anchor="middle">&gt;_01</text></svg>`;

// Keep the complete instrument stable when an identity changes or a Mod is selected.
export function mountHaloInstrument(node){
 node.classList.add('halo-surface');
 if(!node.querySelector(':scope > .halo')&&!node.dataset.haloCustom)node.insertAdjacentHTML('afterbegin',halo);
 return node.querySelector(':scope > .halo');
}
const clocks=new WeakMap();
export function paintHaloState(node,state='idle',effect='generic',{now=performance.now(),reduced=false,recent=null}={}){
 state=haloState(state);
 let clock=clocks.get(node);if(!clock){clock={wait:new PresenceWait(),until:0,held:'generic',prior:null};clocks.set(node,clock);}
 const visual=clock.wait.project(state,effect,now);
 if(state==='tool'||recent&&recent!==clock.prior){clock.held=recent||effect;clock.until=now+3000;}clock.prior=recent;
 if(!['tool','thinking','body','waiting','connecting','compacting'].includes(state))clock.until=0;
 const fields={state,effect:visual.effect,carry:String(visual.carry),recent:now<clock.until?clock.held:'',longWait:String(visual.longWait)};
 for(const [key,value] of Object.entries(fields))if(node.dataset[key]!==value)node.dataset[key]=value;
 const code=node.querySelector('.halo-code'),text=presenceCode(now,reduced);
 if(code&&state==='tool'&&effect==='terminal'&&code.textContent!==text)code.textContent=text;
 return visual;
} 

