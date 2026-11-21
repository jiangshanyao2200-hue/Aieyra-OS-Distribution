// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: runtimes; namespace; motionCSS; drawing; haloRuntime; connectHalo
// Impact: python -B scripts/code-atlas.py show Halo/runtime/desktop.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {mountHaloInstrument,paintHaloState} from '../official/instrument.mjs';
import {validateSelection} from '../contract/definition.mjs';

const runtimes=new WeakMap(),surfaces='#presence,.role-instrument,.role-ring,#avatar-eyra';
const namespace='http://www.w3.org/2000/svg';
function motionCSS(definition){
 const rules=[];
 for(const [i,layer]of definition.layers.entries()){
  const target=`[data-halo-custom] > .halo-custom > [data-layer="${i}"]`;
  rules.push(`${target}{opacity:${layer.opacity??1};transform-origin:50px 50px;display:${layer.states?'none':'inline'}}`);
  if(layer.states)rules.push(`${layer.states.map(s=>`[data-halo-custom][data-state="${s}"] > .halo-custom > [data-layer="${i}"]`).join(',')}{display:inline}`);
  if(layer.motion){
   const m=layer.motion;
   rules.push(`@keyframes halo-mod-${i}{${m.frames.map(f=>`${f.offset*100}%{transform:translate(${f.x??0}px,${f.y??0}px) rotate(${f.rotate??0}deg) scale(${f.scale??1});opacity:${f.opacity??layer.opacity??1}}`).join('')}}`);
   rules.push(`${target}{animation:halo-mod-${i} ${m.duration}ms ${m.easing} infinite}`);
  }
 }
 return rules.join('\n');
}
function drawing(doc,definition){
 const svg=doc.createElementNS(namespace,'svg');svg.setAttribute('class','halo-custom');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('aria-hidden','true');
 for(const [i,layer]of definition.layers.entries()){
  const shape=doc.createElementNS(namespace,layer.shape);shape.dataset.layer=String(i);
  if(layer.shape==='ellipse')for(const key of ['cx','cy','rx','ry'])shape.setAttribute(key,layer[key]);
  else shape.setAttribute('points',layer.points.map(p=>p.join(',')).join(' '));
  shape.setAttribute('fill',layer.fill??'none');shape.setAttribute('stroke',layer.stroke??'currentColor');shape.setAttribute('stroke-width',layer.width??1.5);
  svg.append(shape);
 }
 return svg;
}
// One observer/style sheet per document; removed surfaces are released. Identity,
// state and avatar nodes belong to the caller and are never replaced.
export function haloRuntime(doc=document){
 if(runtimes.has(doc))return runtimes.get(doc);
 const win=doc.defaultView,instances=new Map();let selected=null,signature='',closed=false,timer=0;
 const style=doc.createElement('style');style.dataset.haloStyle='mod';doc.head.append(style);
 const link=doc.createElement('link');link.rel='stylesheet';link.href=new URL('./desktop.css',import.meta.url).href;link.dataset.haloStyle='runtime';doc.head.append(link);
 const observer=win.IntersectionObserver?new win.IntersectionObserver(entries=>{for(const entry of entries)entry.target.dataset.haloPaused=String(!entry.isIntersecting);schedule();}):null;
 function restore(node,item){item.custom?.remove();item.custom=null;if(item.original&&!node.contains(item.original))node.prepend(item.original);delete node.dataset.haloCustom;}
 function mount(node){
  if(closed)return;
  const original=mountHaloInstrument(node);
  if(!node.dataset.state)node.dataset.state='idle';
  let item=instances.get(node);if(!item){item={original:node.querySelector(':scope > .halo'),custom:null};instances.set(node,item);observer?.observe(node);}
  if(original&&item.original!==original)item.original=original;
  schedule();
  const definition=selected?.definition;
  if(!definition?.layers){restore(node,item);return;}
  if(item.custom?.parentNode===node)return;
  item.original??=node.querySelector(':scope > .halo');item.original?.remove();
  item.custom=drawing(doc,definition);node.prepend(item.custom);node.dataset.haloCustom=selected.id;
 }
 function visit(root,work=mount){if(root.nodeType!==1)return;if(root.matches(surfaces))work(root);for(const node of root.querySelectorAll(surfaces))work(node);}
 function release(node){const item=instances.get(node);if(item&&!node.isConnected){restore(node,item);observer?.unobserve(node);instances.delete(node);}}
 const mutations=win.MutationObserver?new win.MutationObserver(records=>{
  for(const record of records){if(record.type==='attributes'){schedule();continue;}if(record.target.isConnected&&record.target.matches?.(surfaces))mount(record.target);for(const node of record.addedNodes)if(node.isConnected)visit(node);for(const node of record.removedNodes)visit(node,release);}
 }):null;
 mutations?.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-state','data-effect','data-visible','class']});visit(doc.body);
 function schedule(){if(!closed&&!timer&&!doc.hidden)timer=win.setTimeout(tick,180);}
 function tick(){
  timer=0;if(closed||doc.hidden)return;let active=false;
  const reduced=doc.body.classList.contains('reduce-motion')||win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  for(const node of instances.keys())if(node.isConnected&&node.dataset.haloPaused!=='true'&&doc.body.dataset.visible!=='false'&&['tool','thinking','waiting','connecting','compacting'].includes(node.dataset.state)){
   paintHaloState(node,node.dataset.state,node.dataset.effect,{reduced});active=true;
  }
  if(active)schedule();
 }
 function visibility(){doc.body.dataset.haloHidden=String(doc.hidden);if(doc.hidden){win.clearTimeout(timer);timer=0;}else schedule();}
 doc.addEventListener('visibilitychange',visibility);visibility();
 const runtime={
  apply(value){
   let next=null;try{next=validateSelection(value??null);}catch{next=null;}
   const key=JSON.stringify(next);if(signature===key)return;signature=key;selected=next;
   style.textContent=next?.definition.layers?motionCSS(next.definition):'';
   for(const [node,item]of instances){restore(node,item);mount(node);}
  },
  mount,
  read:()=>structuredClone(selected),
  close(){if(closed)return;closed=true;win.clearTimeout(timer);mutations?.disconnect();observer?.disconnect();doc.removeEventListener('visibilitychange',visibility);for(const [node,item]of instances){restore(node,item);delete node.dataset.haloPaused;}instances.clear();style.remove();link.remove();delete doc.body.dataset.haloHidden;runtimes.delete(doc);},
 };
 runtimes.set(doc,runtime);return runtime;
}
// Host APIs are injected. Native projections call apply directly with the same
// verified public selection; no renderer reads private configuration or files.
export function connectHalo(api,{doc=document}={}){
 const runtime=haloRuntime(doc);let closed=false,revision=0;
 const refresh=async()=>{const ticket=++revision;try{const value=await api.halo?.({action:'read'});if(!closed&&ticket===revision)runtime.apply(value?.selection);}catch{if(!closed&&ticket===revision)runtime.apply(null);}};
 const stop=api.onSettingsChanged?.(value=>{if(value.method==='halo')void refresh();});
 void refresh();
 const close=()=>{if(closed)return;closed=true;stop?.();runtime.close();doc.defaultView.removeEventListener('pagehide',close);};
 doc.defaultView.addEventListener('pagehide',close,{once:true});return close;
}
