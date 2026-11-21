// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: api; paintTheme; stopTheme
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/window-shell.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {applyAppearanceFrame} from './appearance.mjs';
import {setupMotion} from './motion.mjs';
setupMotion();
const api=window.aieyraShell,$=id=>document.getElementById(id);
for(const name of ['minimize','maximize','close'])$(name).onclick=()=>void api.action({action:name});
void api.action({action:'describe'}).then(value=>{$('title').textContent=value.title||'';document.title=value.title||'Aieyra';$('maximize').hidden=!value.resizable;});

const paintTheme=value=>applyAppearanceFrame(document.body,value);
const stopTheme=api.onTheme(paintTheme);void api.action({action:'theme'}).then(paintTheme);
window.addEventListener('pagehide',stopTheme,{once:true});
