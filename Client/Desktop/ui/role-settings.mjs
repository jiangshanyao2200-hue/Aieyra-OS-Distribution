// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupRoleSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/role-settings.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {mountHaloInstrument,paintHaloState} from '../../../Halo/official/instrument.mjs';

export function setupRoleSettings(api,{doc=document}={}){
 const preview=doc.getElementById('avatar-eyra');
 let roles={};
 if(preview){
  preview.classList.add('role-ring');
  mountHaloInstrument(preview);
  doc.getElementById('avatar-eyra-img').classList.add('role-face');
 }
 function load(profile){
  roles=structuredClone(profile.roles||{});
  if(!preview)return;
  preview.dataset.role='matrix';
  preview.dataset.ringEffect=roles.matrix?.ring||'pulse';
  preview.dataset.haloLive='true';
  paintHaloState(preview,'idle');
 }
 return {load,rebase:(_previous,next)=>load(next),value:()=>structuredClone(roles)};
}
