// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: library; managerReady; openManager; stop; hiddenAt; stopVisibility
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/app-market.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {$,call,say,setupShell} from './app-shell.mjs';
import {mountThemeLibrary} from './theme-library.mjs';
setupShell();
const library=mountThemeLibrary($('theme-root'),{call:p=>call({...p,action:'theme_'+p.action}),notice:say,onSelect:async item=>{
 const status=await call({action:'theme_status'});
 await call({action:'theme_apply',target:item.category==='background'?'background':'avatar',id:item.id,digest:item.digest,expected_version:status.profile.version});
 say(item.category==='background'?'背景已应用':'头像已应用');
}});
let managerReady=null;
async function openManager(){
 const dialog=$('package-manager');if(!dialog.open)dialog.showModal();
 managerReady||=import('./package-manager.mjs');
 try{await managerReady;}catch(error){managerReady=null;say(error.message,true);}
}
$('package-manager-close').onclick=()=>$('package-manager').close();
const stop=window.aieyraApp.on(event=>{if(event?.type==='theme-manager')void openManager();if(event?.type==='theme-account')library.accountChanged();});
void call({action:'theme_manager_state'}).then(r=>{if(r.open)void openManager();}).catch(e=>say(e.message,true));
let hiddenAt=0;
const stopVisibility=window.aieyraApp.onVisibility?.(value=>{const visible=value?.visible===true;library.visibility(visible);if(visible){if(hiddenAt&&Date.now()-hiddenAt>300000)library.refresh();hiddenAt=0;}else hiddenAt=Date.now();});
window.addEventListener('beforeunload',()=>{library.close();stop?.();stopVisibility?.();},{once:true});
