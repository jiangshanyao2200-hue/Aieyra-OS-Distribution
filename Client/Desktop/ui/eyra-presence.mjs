// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: api; acknowledge; stopFrame; stopVisibility
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/eyra-presence.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {haloRuntime} from '../../../Halo/runtime/desktop.mjs';
import {setupMotion} from './motion.mjs';
import {configureTooltips} from './tooltip.mjs';
import {applyResourceTheme,applyAppearanceFrame} from './appearance.mjs';
import {mountEyraInstrument,paintInstrument} from './eyra-instrument.mjs';
setupMotion();mountEyraInstrument();const halo=haloRuntime(document);
// 小窗只有头像那么大，提示框画在原生小窗里才不会被裁掉。
configureTooltips(document,{native:()=>window.aieyraTips?.call||null});
const api=window.eyraPresence;let frame=null,timer=0,closed=false,readyRevision=0;
function acknowledge(){clearTimeout(timer);if(closed||!frame)return;if(innerWidth<=0||innerHeight<=0||Math.abs(innerWidth-frame.width)>1.5||Math.abs(innerHeight-frame.height)>1.5){timer=setTimeout(acknowledge,32);return;}readyRevision=frame.revision;void api.painted(frame.revision);}
const stopFrame=api.onFrame(value=>{frame=value;halo.apply(value.haloSelection);if(value?.appearanceTheme)applyAppearanceFrame(document.body,value.appearanceTheme);else applyResourceTheme(document,value?.themeCss);document.body.style.setProperty('--fold-ring',value.ringSize+'px');document.body.dataset.ringEffect=value.effect;document.body.classList.toggle('reduce-motion',value.reduced);paintInstrument(value.instrument);const summary=value.summary;document.body.dataset.working=!!summary?.label&&value.instrument?.data?.state!=='idle'?'true':'false';document.getElementById('presence-summary').hidden=!summary;document.getElementById('summary-name').textContent=summary?.name||'';document.getElementById('summary-status').textContent=summary?.label||'';document.getElementById('summary-body').textContent=summary?.body||'';acknowledge();});
const stopVisibility=api.onVisibility(({visible})=>{document.body.dataset.visible=String(visible);if(!visible){clearTimeout(timer);readyRevision=0;}});
document.getElementById('eyra-trigger').onclick=()=>{if(readyRevision)void api.home();};
document.getElementById('eyra-trigger').oncontextmenu=event=>{event.preventDefault();if(readyRevision)void api.input();};
window.addEventListener('pagehide',()=>{closed=true;halo.close();clearTimeout(timer);stopFrame();stopVisibility();},{once:true});
