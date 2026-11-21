// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: visualReadability
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/visual-readability.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

// Fixed, read-only browser probe for AI inspection. Return layout/paint facts,
// never chat text, input values, URLs, images or caller-supplied JavaScript.
function visualReadability(){
 const visible=n=>{const r=n.getBoundingClientRect();return n.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;};
 const key=n=>n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+[...n.classList].slice(0,5).map(c=>'.'+c).join('');
 // Home keeps its current answer/identity in semantic slots until the next
 // turn moves them into history. Include and prioritize those real nodes;
 // scanning only .chat-text/.chat-name silently missed the active reply.
 const current=[...document.querySelectorAll('#voice,#eyra-name,#presence,.presence-work-status,#message,.chat-layer-name,.chat-layer-status,.chat-layer-avatar>.role-ring')];
 const all=[...new Set([...current,...document.querySelectorAll('.chat-name,.chat-text,.chat-avatar,.role-ring,.eyra-text')])].filter(visible);
 const foreground=all.slice(0,80).map(n=>{
  const ancestors=[];let opacity=1;
  for(let p=n;p&&ancestors.length<24;p=p.parentElement){const s=getComputedStyle(p);opacity*=Number(s.opacity);ancestors.push({node:key(p),opacity:Number(s.opacity),filter:s.filter,mask:s.maskImage,z:s.zIndex,isolation:s.isolation});}
  const s=getComputedStyle(n),r=n.getBoundingClientRect(),x=Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.top+r.height/2));
  return {node:key(n),rect:r.toJSON(),opacity,color:s.color,filter:s.filter,ancestors,hitStack:document.elementsFromPoint(x,y).slice(0,12).map(key)};
 });
 const veils=[...document.querySelectorAll('.chat-layer-veil')].map(n=>{const s=getComputedStyle(n);return {node:key(n),visible:visible(n),rect:n.getBoundingClientRect().toJSON(),color:s.backgroundColor,opacity:Number(s.opacity),blur:s.backdropFilter,z:s.zIndex,ancestors:[]};});
 const bar=[...document.querySelectorAll('.os-program-toolbar,#chrome,.settings-tabs,.cp-bar,#center-update-toggle')].find(visible);
 let toolbar;
 if(bar){
  const row=bar.querySelector('[data-program-row],.browser-navigation')||bar;
  const control=[...row.querySelectorAll('button')].find(visible)||row.closest('button');
  const title=row.querySelector('[data-program-title]'),style=control&&getComputedStyle(control);
  toolbar={rowHeight:row.offsetHeight,visibleBottom:Math.round(bar.getBoundingClientRect().bottom),
   titleSize:title&&getComputedStyle(title).fontSize,controlHeight:control?.offsetHeight,controlRadius:style?.borderRadius,
   background:getComputedStyle(bar).backgroundColor,overflow:row.scrollWidth-row.clientWidth,
   transform:getComputedStyle(bar).transform,foldControl:bar.hasAttribute('data-folded')};
 }
 const shell=document.querySelector('#status-anchor.topbar');
 const shellStyle=shell&&visible(shell)&&getComputedStyle(shell);
 const titlebar=shellStyle?{background:shellStyle.backgroundColor,filter:shellStyle.backdropFilter}:undefined;
 const root=getComputedStyle(document.body);
 return {view:document.body.dataset.view||'',program:document.body.dataset.programAgent||'',expanded:document.body.dataset.chatExpanded||'',transition:document.body.dataset.chatTransition||'',hidden:document.hidden,toolbar,titlebar,foreground,truncated:all.length>80,veils,settings:{chat:root.getPropertyValue('--chat-veil').trim(),program:root.getPropertyValue('--space-veil').trim(),chatBlur:root.getPropertyValue('--chat-blur').trim(),programBlur:root.getPropertyValue('--space-blur').trim()}};
}
module.exports={visualReadability};
