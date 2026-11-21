// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: api; current; opacity; present; measure
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/tooltip-window.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {applyAppearanceFrame} from './appearance.mjs';
import {renderModelCard} from './model-card.mjs';
import {renderPreviewCard} from './preview-card.mjs';
import {renderTooltipRows} from './tooltip-content.mjs';
import {animateUI,cancelMotion} from './motion.mjs';
const api=window.aieyraTip,tip=document.getElementById('tip');
let current=0,revision=0,epoch=0,measuring=false,sizeKey='',visible=false;
const opacity=()=>Number(getComputedStyle(tip).opacity);
function present(){const from=opacity();tip.style.opacity='1';visible=true;if(from<1)animateUI(tip,[{opacity:from},{opacity:1}],{kind:'fast',key:'tip-presence'});}
function measure(){
 if(measuring)return;measuring=true;queueMicrotask(()=>{measuring=false;if(!current||!revision)return;
  const r=tip.getBoundingClientRect(),width=Math.ceil(r.width),height=Math.ceil(r.height),key=[current,visible?'':revision,width,height].join(':');
  if(key===sizeKey)return;sizeKey=key;void api.size({id:current,revision,width,height}).catch(()=>{});
 });
}
new ResizeObserver(measure).observe(tip);
api.onFrame(frame=>{
 if(frame.phase==='prepare'){
  const mine=epoch;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(mine===epoch&&frame.id===current&&frame.revision===revision)void api.size({id:current,revision,painted:true}).catch(()=>{});}));return;
 }
 if(frame.phase==='present'){if(frame.id===current&&frame.revision===revision)present();return;}
 if(frame.phase==='clear'){epoch++;current=revision=0;visible=false;sizeKey='';cancelMotion(tip,'tip-presence');tip.style.opacity='0';return;}
 if(frame.phase==='hide'){
  const mine=++epoch,from=opacity();current=frame.id;revision=0;visible=false;tip.style.opacity='0';
  const animation=animateUI(tip,[{opacity:from},{opacity:0}],{kind:'fast',key:'tip-presence'});
  void Promise.resolve(animation?.finished).catch(()=>{}).then(()=>{if(mine===epoch)void api.size({id:frame.id,hidden:true}).catch(()=>{});});return;
 }
 const {id,text,model,preview,rows,appearanceTheme}=frame,fresh=id!==current;
 if(fresh){const from=frame.visible?opacity():0;epoch++;cancelMotion(tip,'tip-presence');tip.style.opacity=String(from);}
 current=id;revision=frame.revision;visible=frame.visible===true;
 applyAppearanceFrame(document.body,appearanceTheme);tip.className=preview?'ui-tip ui-tip-native program-preview':model?'ui-tip ui-tip-native model-hover':'ui-tip ui-tip-native';
 if(preview)renderPreviewCard(tip,preview);else if(model)renderModelCard(tip,model);else if(rows)renderTooltipRows(tip,rows);else tip.textContent=text;
 if(fresh&&visible)present();measure();
});
document.fonts.ready.then(measure);
