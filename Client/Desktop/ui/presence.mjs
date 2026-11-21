// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TerminalContinuity; setupPresence; planFrame
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/presence.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {animateUI} from './motion.mjs';
// A single visual rhythm follows real state. It never queues work or delays stop.
export class TerminalContinuity {
 constructor(){this.rows=[];this.turn='';this.until=0;this.closing=false;}
 project(rows,turn,active,immediate,now){
  if(this.turn!==turn||immediate){this.rows=[];this.until=0;this.closing=false;this.turn=turn;}
  if(rows.length){this.rows=rows;this.closing=false;this.until=0;}
  else if(this.rows.length&&!active&&!this.closing){this.closing=true;this.until=now+260;}
  if(immediate||this.closing&&now>=this.until){this.rows=[];this.closing=false;}
  return this.rows;
 }
}
// 光圈中间那串字符的节拍：Eyra、Vaya、Cota 用同一个。
import {presenceCode,presenceLabels,PresenceWait,signalText} from '../../../Halo/official/effects.mjs';
import {paintHaloState} from '../../../Halo/official/instrument.mjs';
export {presenceCode,presenceLabels,PresenceWait,signalText};
export function setupPresence({presence,signal,brand,status,voice,thought,work}){
 let labelKey='',labelSince=0;
 return {
  paint(state,effect,{reduced=false,closing=false,recent=null,content=false}={}){
   const now=performance.now(),visual=paintHaloState(presence,state,effect,{now,reduced,recent}),title=visual.title;
   document.body.dataset.presenting=state;
   const label=document.getElementById('presence-label');
   if(label.textContent!==title){label.textContent=title||'';if(!reduced)animateUI(label,[{opacity:0},{opacity:1}],{kind:'fast'});}
   const nextLabelKey=state+':'+effect+':'+visual.longWait;
   if(nextLabelKey!==labelKey){labelKey=nextLabelKey;labelSince=now;}
   const absorbed=content||now-labelSince>=1350;
   label.classList.toggle('absorbed',absorbed);
   label.setAttribute('aria-hidden',String(absorbed));
   status.textContent='';status.hidden=true;
   brand.dataset.state=state;brand.dataset.working=String(['thinking','tool','preparing','body','waiting','connecting','compacting','cancelling'].includes(state));
   brand.dataset.recent=presence.dataset.recent;
   presence.setAttribute('aria-label',(presence.dataset.name||'Eyra')+' '+(title||'在这里'));
   signal.hidden=true;work.classList.toggle('retiring',closing);
  },
 };
}

// 只扰动少量装饰字符，真实完整文字始终保留在可访问名称中。
export function planFrame(text,now,reduced=false){
 if(reduced)return text;
 const phase=now%3600;
 if(phase>=600)return text;
 const chars=Array.from(text),progress=phase/600;
 return chars.map((c,i)=>i/Math.max(1,chars.length)<progress||/\s/.test(c)?c:'·░▒'[Math.floor(now/90+i)%3]).join('');
}
