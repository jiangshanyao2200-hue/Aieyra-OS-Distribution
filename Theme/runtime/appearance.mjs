// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: chat
// Regions: TEXT_LIMITS; THINKING_STYLE; effectColor; fontWeightRange; fontWeight; regionStyle; applyResourceTheme; applyTextOverrides; applyAppearance; statusObservers; bindStatusMotion; appearanceFrames; applyAppearanceFrame
// Impact: python -B scripts/code-atlas.py show Theme/runtime/appearance.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {applyLayoutTheme} from './layout.mjs';
import {catalog} from '../contract/definition.mjs';
// 外观配置落成 CSS 变量（外观页本身在 look.mjs）。
// CSS variables are generated only from the host's constrained public schema.
// 自定义有上限：描边不超过字号的 4%，阴影不超过 12px，再大文字就糊了。存的值不动，只限制显示。
export const TEXT_LIMITS={strokeRatio:.04,stroke:.8,shadow:12,strokeOpacity:.85,shadowOpacity:.38};
export const THINKING_STYLE={font_latin:'system',font_cjk:'system',size:14,weight:400,line_height:1.6,letter_spacing:.2,paragraph_spacing:8,color:'#e8edf5',stroke_width:0,stroke_color:'#000000',shadow_blur:0,shadow_color:'#000000'};
// Keep black and white selectable. Bound the effect's opacity, rather than
// replacing the chosen colour with a pale preset or obscuring the glyph fill.
const effectColor=(hex,opacity)=>/^#[0-9a-f]{6}$/i.test(hex)?hex+Math.round(opacity*255).toString(16).padStart(2,'0'):hex;
// These are the actual wght axes of the bundled fonts. System/fallback faces
// only promise regular and bold; intermediate numbers would be fake controls.
export function fontWeightRange(value,{min=100,max=900}={}){
 const axes={inter:[100,900],sora:[100,800],noto_sans:[100,900],noto_serif:[200,900]},latin=axes[value.font_latin],cjk=axes[value.font_cjk];
 if(!latin||!cjk){const values=[400,700].filter(n=>n>=min&&n<=max);return {values:values.length?values:[max<400?400:700]};}
 return {min:Math.max(min,latin[0],cjk[0]),max:Math.min(max,latin[1],cjk[1]),step:.01};
}
export function fontWeight(value,limits){const range=fontWeightRange(value,limits),weight=Number(value.weight)||400;return range.values?range.values.reduce((a,b)=>Math.abs(b-weight)<Math.abs(a-weight)?b:a):Math.min(range.max,Math.max(range.min,weight));}
export function regionStyle(value,fields){
 const strokeWidth=Math.max(0,Math.min(Number(value.stroke_width)||0,TEXT_LIMITS.stroke,Math.floor(Number(value.size)*TEXT_LIMITS.strokeRatio*10)/10)),shadowBlur=Math.max(0,Math.min(Number(value.shadow_blur)||0,TEXT_LIMITS.shadow));
 const latin=fields.font_latin.options.find(x=>x.id===value.font_latin).css.split(',').map(x=>x.trim());
 const cjk=fields.font_cjk.options.find(x=>x.id===value.font_cjk).css.split(',').map(x=>x.trim());
 const generic=/^(sans-serif|serif|monospace)$/;
 const font=[...new Set([...latin,...cjk].filter(x=>!generic.test(x))),latin.find(x=>generic.test(x))||'sans-serif'].join(', ');
 return {font,size:value.size+'px',weight:fontWeight(value),line:value.line_height,color:value.color||'#c9ced8',letter:value.letter_spacing+'px',paragraph:value.paragraph_spacing+'px',stroke:strokeWidth+'px',strokeColor:effectColor('#000000',TEXT_LIMITS.strokeOpacity),shadow:shadowBlur?`0 0 ${shadowBlur}px ${effectColor('#000000',TEXT_LIMITS.shadowOpacity)}`:'none'};
}
export function applyResourceTheme(doc,css){
 // 设置页始终用原样式：主题出问题时“移除主题”一定看得见、点得到。
 if(/[?&]extension=settings(?:&|$)/.test(doc.defaultView?.location?.search||''))css='';
 let theme=doc.getElementById('aieyra-resource-theme');const before=theme?.textContent||'';if(css){if(!theme){theme=doc.createElement('style');theme.id='aieyra-resource-theme';doc.head.append(theme);}if(theme.textContent!==css)theme.textContent=css;}else theme?.remove();
 if(before!==(css||''))doc.dispatchEvent?.(new Event('workspace-theme-change'));
}
export function applyTextOverrides(doc,settings){
 let node=doc.getElementById('aieyra-user-text');
 const mapping={font_latin:['font-family','font'],font_cjk:['font-family','font'],size:['font-size','size'],weight:['font-weight','weight'],color:['color','color'],line_height:['line-height','line'],letter_spacing:['letter-spacing','letter'],stroke_width:['-webkit-text-stroke-width','stroke'],stroke_color:['-webkit-text-stroke-color','strokeColor'],shadow_blur:['text-shadow','shadow'],shadow_color:['text-shadow','shadow']},rules=[];
 for(const [region,names]of Object.entries(settings.region_overrides||{})){
  if(region==='thinking')continue;
  const selectors=catalog.text_regions[region];if(!selectors)continue;
  const declarations=new Map();for(const name of names){if(region==='status'&&name==='line_height')continue;const pair=mapping[name];if(pair)declarations.set(pair[0],name==='stroke_width'?`calc(var(--os-${region}-${pair[1]}) * 2)`:`var(--os-${region}-${pair[1]})`);}
  if(declarations.size)rules.push(selectors.join(',')+'{'+[...declarations].map(([k,v])=>k+':'+v+'!important').join(';')+'}');
  // User spacing separates blocks, not a blank tail after the final block.
  // An important override on the last paragraph defeats the shared reader's
  // boundary reset and can scroll its last whole line out of a compact view.
  if(names.includes('paragraph_spacing'))rules.push(selectors.map(s=>s+' p:not(:last-child)').join(',')+`{margin-block-end:var(--os-${region}-paragraph)!important}`);
 }
 if(!node){node=doc.createElement('style');node.id='aieyra-user-text';doc.head.append(node);}
 node.textContent='@layer aieyra-user, aieyra-theme;@layer aieyra-user{'+rules.join('\n')+'}';
}
export function applyAppearance(root,settings,fields){
 applyResourceTheme(root.ownerDocument,settings.theme_css);
 applyLayoutTheme(root.ownerDocument,settings.layout_theme);
 for(const [region,value] of Object.entries(settings.regions))for(const [key,v] of Object.entries(regionStyle(region==='thinking'?THINKING_STYLE:region==='status'?{...value,line_height:1.5}:value,fields)))root.style.setProperty(`--os-${region}-${key}`,v);
 root.style.setProperty('--os-first-indent',settings.first_line_indent+'em');
 applyTextOverrides(root.ownerDocument,settings);
 root.dataset.osAppearance='true';
 root.dataset.thoughtAnimation=settings.thinking_animation||'flow';
 root.dataset.statusAnimation=settings.status_animation||'fade';
 root.dataset.nameAnimation=settings.name_animation||'trace';
 root.dataset.workAnimation=settings.work_animation||'signal';
 root.dataset.spreadAnimation=settings.spread_animation||'ripple';
 root.dataset.innerAnimation=settings.inner_animation==='profile'?'pulse':settings.inner_animation||'pulse';
 bindStatusMotion(root);
}

const statusObservers=new WeakMap();
function bindStatusMotion(root){
 if(statusObservers.has(root))return;
 const doc=root.ownerDocument,win=doc.defaultView,Observer=win?.MutationObserver||globalThis.MutationObserver;
 if(!Observer)return;
 const selector='.presence-work-status,.chat-work-status,.chat-layer-status,.presence-summary-state',seen=new WeakMap(),active=new Map();
 const preference=win?.matchMedia?.('(prefers-reduced-motion: reduce)');
 const allowed=()=>!doc.hidden&&root.dataset.visible!=='false'&&!root.classList.contains('reduce-motion')&&!preference?.matches;
 const cancel=node=>{active.get(node)?.cancel();active.delete(node);};
 const refresh=()=>{if(!allowed())for(const node of active.keys())cancel(node);};
 const paint=(node,replay=false)=>{
  const mode=node.closest('[data-status-animation]')?.dataset.statusAnimation||root.dataset.statusAnimation;
  const text=node.textContent,prior=seen.get(node);
  if(prior?.text===text&&(!replay||prior.mode===mode))return;
  seen.set(node,{text,mode});cancel(node);
  if(!prior||!text||!node.animate||!allowed()||node.checkVisibility?.({checkVisibilityCSS:true})===false||mode==='none')return;
  // Keep the chosen status colour fully readable throughout a change. The
  // legacy "fade" setting now uses a small horizontal handover, with no dimming.
  const frames={fade:[{transform:'translateX(3px)'}],slide:[{transform:'translateY(5px)'}],settle:[{transform:'translateX(-4px)'},{transform:'translateX(1px)',offset:.65}],reveal:[{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0 0 0)'}],pivot:[{transform:'perspective(120px) rotateX(-28deg)'}]};
  const animation=node.animate([...(frames[mode]||frames.fade),{transform:'none',clipPath:'inset(0)'}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});
  active.set(node,animation);
  const settle=()=>{if(active.get(node)===animation)active.delete(node);};
  animation.finished.then(settle,settle);
 };
 const observer=new Observer(records=>{const dirty=new Map();for(const row of records){
  const target=row.target.nodeType===1?row.target:row.target.parentElement;
  if(row.type==='attributes'){
   if(row.attributeName!=='data-status-animation'){refresh();continue;}
   for(const node of target.querySelectorAll(selector)){
    if(node.closest('[data-status-animation]')===target)dirty.set(node,true);
   }
   continue;
  }
  const mark=node=>{if(!dirty.has(node))dirty.set(node,false);};
  const status=target?.closest?.(selector);if(status)mark(status);
  for(const added of row.addedNodes||[])if(added.nodeType===1){if(added.matches?.(selector))mark(added);for(const node of added.querySelectorAll?.(selector)||[])mark(node);}
 }
 for(const [node,replay] of dirty)if(root.contains(node))paint(node,replay);
 });
 for(const node of root.querySelectorAll?.(selector)||[])paint(node);
 observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-status-animation','data-visible']});statusObservers.set(root,observer);
 const rootObserver=new Observer(refresh);rootObserver.observe(root,{attributes:true,attributeFilter:['class']});
 doc.addEventListener?.('visibilitychange',refresh);preference?.addEventListener?.('change',refresh);
 win?.addEventListener?.('pagehide',()=>{observer.disconnect();rootObserver.disconnect();doc.removeEventListener?.('visibilitychange',refresh);preference?.removeEventListener?.('change',refresh);for(const node of active.keys())cancel(node);statusObservers.delete(root);},{once:true});
}

// Native surfaces receive the same public configuration, without profile data.
// Skip repeated content frames; a changed version still updates already open UI.
const appearanceFrames=new WeakMap();
export function applyAppearanceFrame(root,value){
 if(!value?.settings||!value.fields)return;
 const key=value.version||JSON.stringify(value.settings);
 if(appearanceFrames.get(root)===key)return;
 applyAppearance(root,value.settings,value.fields);appearanceFrames.set(root,key);
}
