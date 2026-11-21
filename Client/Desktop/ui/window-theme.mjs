// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: applyBackground; applyWindowTheme; subscribeWindowTheme
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/window-theme.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupMotion} from './motion.mjs';
setupMotion();
import {applyAppearance} from './appearance.mjs';
import {applyChatLayout} from './chat-layout.mjs';
export function applyBackground(body,profile={}){
 body.style.setProperty('--user-ring-color',profile.userRingColor||'#e6e9f0');
 const bg=profile.background||'';body.classList.toggle('has-space-background',!!bg);
 if(bg)body.style.setProperty('--space-background','url("'+bg+'")');else body.style.removeProperty('--space-background');
 body.style.setProperty('--space-blur',(profile.backgroundBlur??0)+'px');body.style.setProperty('--space-veil',String(profile.backgroundOpacity??0));
 body.style.setProperty('--chat-blur',(profile.chatBlur??12)+'px');body.style.setProperty('--chat-veil',String(profile.chatOpacity??.18));
}
export function applyWindowTheme(body,value){
 if(!value||value.ok===false)return;applyBackground(body,value);
 if(value.settings&&value.fields)applyAppearance(body,value.settings,value.fields);
}
export function subscribeWindowTheme(api,body,{chat=false,onProfile=()=>{}}={}){
 let closed=false,running=false,pending=false,profile={};
 const win=body.ownerDocument?.defaultView;
 const layout=()=>{if(chat)applyChatLayout(body.style,profile.chatLayout);};
 win?.addEventListener('os-scale',layout);
 async function refresh(){
  pending=true;if(running)return;running=true;
  try{while(pending&&!closed){pending=false;const [p,a]=await Promise.all([api.profile(),api.appearance({action:'os_appearance_read'})]);if(!closed){profile=p.profile||{};applyWindowTheme(body,{...profile,...a});layout();onProfile(profile);}}}
  finally{running=false;}
 }
 const stop=api.onSettingsChanged?.(event=>{if(['saveProfile','appearance'].includes(event.method))void refresh().catch(()=>{});});
 return {refresh,close(){closed=true;pending=false;stop?.();win?.removeEventListener('os-scale',layout);}};
}
