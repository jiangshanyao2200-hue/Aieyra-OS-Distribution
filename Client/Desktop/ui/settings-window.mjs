// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: api; theme; kind; geometry; notice; stop
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/settings-window.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupProgramAgentWindow} from './program-agent-window.mjs';
import {subscribeWindowTheme} from './window-theme.mjs';
import {configureTooltips} from './tooltip.mjs';
import {mountProgramIcon} from './program-icons.mjs';
const api=window.aieyraExtension,$=id=>document.getElementById(id);
const theme=subscribeWindowTheme(api,document.body);
// 顶栏下面是程序视图，提示框画在原生小窗里才不会被压住。
configureTooltips(document,{native:()=>window.aieyraTips?.call||null});
let kind;
const geometry=value=>{kind=value?.kind||kind;if(value?.desk!==undefined)$('module-dock').hidden=kind==='link'||value.desk===true;if(Number.isFinite(value?.barHeight))document.documentElement.style.setProperty('--bar-height',value.barHeight+'px');if(value?.title){document.querySelector('.module-brand strong').textContent=value.title;document.title=value.title+' · Aieyra';}};
const notice=text=>{$('module-notice').textContent=text;$('module-notice').hidden=false;};
const stop=api.onState(geometry);void api.describe().then(async value=>{
 geometry(value);
 if(kind==='link'){
  document.querySelector('.module-mark')?.remove();
  $('session-indicators').hidden=true;
  $('module-dock').hidden=true;
  return;
 }
 mountProgramIcon(document.querySelector('.module-mark'),kind);
 await setupProgramAgentWindow(api,value,notice);
}).catch(error=>notice(error.message));
for(const [id,method] of [['module-dock','dock'],['minimize-window','minimizeWindow'],['maximize-window','toggleMaximize'],['close-window','closeWindow']]){
 $(id).onclick=async()=>{try{const result=await api[method]();if(result?.ok===false)throw Error(result.error);}catch(error){$('module-notice').textContent=error.message;$('module-notice').hidden=false;}};
}
void theme.refresh();window.addEventListener('beforeunload',()=>{theme.close();stop();},{once:true});
