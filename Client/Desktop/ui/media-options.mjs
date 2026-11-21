// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ROTATION_PRESETS; el; period; mediaMenu; rotationControl
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/media-options.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupChoicePopover,positionMenu} from './interaction.mjs';
export const ROTATION_PRESETS=Object.freeze([[300,'5 分钟'],[600,'10 分钟'],[1800,'30 分钟'],[3600,'1 小时'],[10800,'3 小时'],[18000,'5 小时'],[36000,'10 小时'],[86400,'1 天'],[259200,'3 天'],[604800,'7 天']]);
const el=(doc,tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const period=seconds=>ROTATION_PRESETS.find(([s])=>s===seconds)?.[1]||Math.round(seconds/60)+' 分钟';
export function mediaMenu(anchor,{theme,random,custom,remove,value=()=>({}),error=()=>{}}){
 const doc=anchor.ownerDocument,menu=el(doc,'div','ui-menu media-choice');let level='source',closed=false;
 menu.id='media-choice-'+Math.random().toString(36).slice(2);menu.popover='auto';menu.setAttribute('role','listbox');menu.setAttribute('aria-label','图像来源');anchor.setAttribute('aria-haspopup','listbox');doc.body.append(menu);
 const choose=fn=>{menu.hidePopover();Promise.resolve().then(fn).catch(e=>{if(!closed)error(e.message);});};
 function option(label,fn,selected=false){const b=el(doc,'button','',label);b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(selected));b.onclick=fn;return b;}
 function paint(){
  const pref=value()||{},mode=pref.mode||'off';
  anchor.textContent=mode==='random'?'随机 · '+period(pref.intervalSeconds||900):({theme:'来自主题',custom:'自定义头像',off:'默认头像'}[mode]||'默认头像');
  if(level==='random')menu.replaceChildren(option('‹ 返回',()=>{level='source';paint();positionMenu(menu,anchor);menu.querySelector('button')?.focus();}),...ROTATION_PRESETS.map(([seconds,label])=>option(label,()=>choose(()=>random(seconds)),mode==='random'&&pref.intervalSeconds===seconds)));
  else menu.replaceChildren(option('更换图片',()=>choose(custom),mode==='custom'),option('随机 ›',()=>{level='random';paint();positionMenu(menu,anchor);menu.querySelector('[aria-selected=true],button')?.focus();},mode==='random'),option('从主题应用',()=>choose(theme),mode==='theme'),option('移除',()=>choose(remove),mode==='off'));
 }
 const stop=setupChoicePopover(anchor,menu);
 anchor.onclick=()=>{if(menu.matches(':popover-open')){menu.hidePopover();return;}level='source';paint();menu.showPopover();positionMenu(menu,anchor);};
 menu.addEventListener('keydown',event=>{if(level==='random'&&event.key==='ArrowLeft'){event.preventDefault();level='source';paint();positionMenu(menu,anchor);menu.querySelector('button')?.focus();}});
 paint();return {paint,close(){closed=true;stop();anchor.onclick=null;menu.remove();}};
}
export function rotationControl(host,{value,change}){
 const doc=host.ownerDocument,box=el(doc,'label','media-rotation select-field'),select=el(doc,'select');select.setAttribute('aria-label','随机时间');box.append(el(doc,'span','','随机时间'),select);host.append(box);
 for(const [seconds,label]of ROTATION_PRESETS){const option=el(doc,'option','',label);option.value=String(seconds);select.append(option);}
 select.onchange=()=>{change(Number(select.value));paint();};
 function paint(){const pref=value()||{},seconds=pref.intervalSeconds||900;box.hidden=pref.mode!=='random';let legacy=select.querySelector('[data-legacy]');legacy?.remove();if(!ROTATION_PRESETS.some(([s])=>s===seconds)){legacy=el(doc,'option','',period(seconds));legacy.value=String(seconds);legacy.dataset.legacy='true';select.append(legacy);}select.value=String(seconds);}
 paint();return {paint,close(){box.remove();}};
}
