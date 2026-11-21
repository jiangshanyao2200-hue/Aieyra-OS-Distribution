// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: DELAY; installed; toolVisuals; setTooltipRows; setPreviewTooltip; setModelTooltip; showModelTooltip; hideModelTooltip; tipPlacement; setupTooltips; configureTooltips
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/tooltip.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// One tooltip lifetime for DOM and native surfaces. Visuals belong to Theme.
import {modelCardData,modelCardText,renderModelCard} from './model-card.mjs';
import {previewCardData,renderPreviewCard} from './preview-card.mjs';
import {tooltipRows,tooltipRowsText,renderTooltipRows} from './tooltip-content.mjs';
import {animateUI,cancelMotion} from './motion.mjs';
const DELAY=180,PREVIEW_DELAY=450,GAP=8,EDGE=8;
const installed=new WeakMap(),models=new WeakMap(),previews=new WeakMap(),previewCache=new WeakMap(),details=new WeakMap();let serial=0;
// Tool visualizations are read directly or expanded by click. Their nested
// labels must never open a page/native tooltip or start a hover preview.
const toolVisuals='.stage-pane,.tool-digest,.tool-receipt,.desktop-terminal-view,.hx-receipt,.plan-card,[data-tool-visualization]';
export function setTooltipRows(anchor,value){
 const rows=tooltipRows(value);if(rows)details.set(anchor,rows);else details.delete(anchor);anchor.dataset.tip=tooltipRowsText(rows);setupTooltips(anchor.ownerDocument)?.refresh(false,anchor);
}
export function setPreviewTooltip(anchor,read,initial=null){
 previews.set(anchor,{read,initial});anchor.dataset.previewTooltip='true';anchor.dataset.tip=anchor.getAttribute('aria-label')||'程序预览';setupTooltips(anchor.ownerDocument);
 return ()=>{previews.delete(anchor);delete anchor.dataset.previewTooltip;installed.get(anchor.ownerDocument)?.hide();};
}
export function setModelTooltip(anchor,model){
 models.set(anchor,typeof model==='function'?model:()=>model);const text=modelCardText(typeof model==='function'?model():model);if(anchor.dataset.tip!==text)anchor.dataset.tip=text;
 const state=setupTooltips(anchor.ownerDocument);state?.refresh(false,anchor);return anchor;
}
export function showModelTooltip(anchor,model){setModelTooltip(anchor,model);setupTooltips(anchor.ownerDocument)?.showNow(anchor);}
export function hideModelTooltip(doc=globalThis.document){installed.get(doc)?.hide();}
export function tipPlacement(anchor,size,view,gap=GAP,edge=EDGE){
 const below=anchor.bottom+gap,fits=below+size.height+edge<=view.height,top=fits?below:Math.max(edge,anchor.top-gap-size.height);
 const left=Math.max(edge,Math.min(view.width-size.width-edge,anchor.left+anchor.width/2-size.width/2));
 return {left:Math.round(left),top:Math.round(top)};
}
export function setupTooltips(doc=globalThis.document){
 const win=doc?.defaultView;
 if(!win?.MutationObserver||!doc.documentElement||installed.has(doc))return installed.get(doc)||null;
 const state={skip:()=>false,native:()=>null,close,refresh,hide,showNow(node){if(anchor===node&&bubble){refresh();return;}hide();anchor=node;show(node);}};installed.set(doc,state);
 const skipped=node=>!!node?.closest?.(toolVisuals)||state.skip(node);
 let timer=0,anchor=null,bubble=null,remote=null,shownText='',closed=false,preview=null,poll=0,generation=0;
 const listeners=[];
 const listen=(node,event,fn,capture=false)=>{node.addEventListener(event,fn,capture);listeners.push(()=>node.removeEventListener(event,fn,capture));};
 function absorb(node){
  const text=node.getAttribute('title');node.removeAttribute('title');
  if(text){node.dataset.tip=text;if(!node.getAttribute('aria-label')&&!node.textContent?.trim())node.setAttribute('aria-label',text);}
  else if(text==='')delete node.dataset.tip;
 }
 const sweep=root=>{if(root.nodeType!==1)return;if(root.hasAttribute('title'))absorb(root);for(const node of root.querySelectorAll('[title]'))absorb(node);for(const node of root.querySelectorAll('svg title'))node.remove();};
 const visible=node=>node?.isConnected&&!doc.hidden&&doc.body.dataset.visible!=='false'&&(!node.checkVisibility||node.checkVisibility({checkVisibilityCSS:true}));
 function describe(add){
  if(!anchor||!bubble)return;
  const ids=new Set((anchor.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));
  if(add)ids.add(bubble.id);else ids.delete(bubble.id);
  if(ids.size)anchor.setAttribute('aria-describedby',[...ids].join(' '));else anchor.removeAttribute('aria-describedby');
 }
 function hide(immediate=false){
  win.clearTimeout(timer);win.clearTimeout(poll);generation++;preview=null;timer=0;describe(false);anchor=null;shownText='';
  if(remote){void Promise.resolve(remote({action:'hide',...(immediate?{immediate:true}:{})})).catch(()=>{});remote=null;}
  if(bubble){const old=bubble;bubble=null;const remove=()=>{try{old.hidePopover?.();}catch{}old.remove();};
   if(immediate||old.className==='ui-tip-accessible'){cancelMotion(old);remove();}
   else{const from=Number(win.getComputedStyle(old).opacity);const animation=animateUI(old,[{opacity:from},{opacity:0}],{kind:'fast',key:'tip-presence'});if(animation)void animation.finished.then(remove,remove);else remove();}
  }
 }
 function refresh(reposition=false,source=null){
  // A live metric/model publication only owns its own tooltip. Visibility
  // mutations still retire other anchors through the shared observer.
  if(source&&source!==anchor)return;
  // Before the hover delay expires there is nothing to repaint. The show
  // boundary checks visibility once, rather than on every streaming mutation.
  if(!anchor||!bubble)return;
  if(!anchor.isConnected||anchor.hidden||doc.hidden||doc.body.dataset.visible==='false'||!anchor.dataset.tip||skipped(anchor)){hide();return;}
  const model=modelCardData(models.get(anchor)?.()),rows=details.get(anchor),text=anchor.dataset.tip,signature=JSON.stringify([text,model,preview,rows]),changed=signature!==shownText;if(!changed&&!reposition)return;
  // Live session revisions often publish the same model. Check layout only
  // when content, position or the anchor's own visibility has been invalidated.
  if(!visible(anchor)){hide();return;}shownText=signature;
  bubble.className=remote?'ui-tip-accessible':preview?'ui-tip program-preview':model?'ui-tip model-hover':'ui-tip';
  if(changed){if(preview&&!remote)renderPreviewCard(bubble,preview);else if(model&&!remote)renderModelCard(bubble,model);else if(rows&&!remote)renderTooltipRows(bubble,rows);else bubble.textContent=preview?[preview.title,preview.state].join(" · "):text;}
  const rect=anchor.getBoundingClientRect();
  if(remote){void Promise.resolve(remote({action:'show',text,...(model?{model}:{}),...(preview?{preview}:{}),...(rows?{rows}:{}),x:rect.left,y:rect.top,width:rect.width,height:rect.height})).catch(()=>{});return;}
  const place=tipPlacement(rect,bubble.getBoundingClientRect(),{width:win.innerWidth,height:win.innerHeight});
  bubble.style.left=place.left+'px';bubble.style.top=place.top+'px';
 }
 function show(node){
  if(!visible(node)||!node.dataset.tip||skipped(node))return;
  remote=state.native(node);
  bubble=doc.createElement('div');bubble.id='ui-tip-'+ ++serial;bubble.className=remote?'ui-tip-accessible':'ui-tip';bubble.setAttribute('role','tooltip');
  // Popover keeps tips above modal dialogs; native tips retain a local a11y node.
  if(!remote&&bubble.showPopover)bubble.setAttribute('popover','manual');
  doc.body.append(bubble);if(!remote)try{bubble.showPopover?.();}catch{}
  const source=previews.get(node),read=source?.read,mine=generation;
  if(read)preview=previewCache.get(node)||previewCardData({module:node.dataset.viewKey||'',title:node.dataset.tip,state:'',url:'',...(typeof source.initial==='function'?source.initial():source.initial)});
  describe(true);refresh();
  if(read){const update=async()=>{
   let next;try{next=await read();}catch{next={title:node.dataset.tip,state:'预览暂不可用'};}
   if(mine!==generation||anchor!==node||closed)return;
   if(!visible(node)){hide();return;}preview=previewCardData(next);if(preview)previewCache.set(node,preview);refresh();poll=win.setTimeout(update,1500);
  };void update();}

 }
 const observer=new win.MutationObserver(records=>{
  let affected=false,hidden=false,moved=false,visibilityChanged=false;
  for(const r of records){
   // Class/style churn in another chat is unrelated. Only the active anchor
   // and its ancestors can invalidate its CSS visibility or retained position.
   if(r.type==='attributes'&&(r.attributeName==='class'||r.attributeName==='style')){
    if(anchor&&(r.target===anchor||r.target.contains(anchor))){affected=true;visibilityChanged=true;}
    continue;
   }
   if(r.type==='attributes'){if(r.target.hasAttribute('title'))absorb(r.target);}
   else for(const node of r.addedNodes)sweep(node);
   if(!anchor)continue;
   if(r.type==='attributes'){
    if(r.target===anchor||anchor.contains(r.target))affected=true;
    if((r.attributeName==='hidden'||r.attributeName==='data-visible')&&r.target.contains(anchor)){
     affected=true;hidden||=r.target.hidden||r.target.dataset.visible==='false';
    }
   }else{
    if(anchor.contains(r.target))affected=true;
    if([...r.addedNodes,...r.removedNodes].some(node=>node===anchor||node.contains?.(anchor))){affected=true;moved=true;}
   }
  }
  if(!anchor||!affected)return;
  if(hidden||!anchor.isConnected||!anchor.dataset.tip||doc.hidden||doc.body.dataset.visible==='false'){hide();return;}
  // Mutations in a separate chat/tree cannot change this tooltip's content.
  // A pending hover keeps its original deadline without measuring geometry.
  if(bubble)refresh(moved||visibilityChanged);
 });
 observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['title','data-tip','hidden','data-visible','class','style']});sweep(doc.documentElement);
 const target=event=>{if(event.target?.closest?.(toolVisuals))return null;const node=event.target?.closest?.('[data-tip]');return node&&!skipped(node)?node:null;};
 const delay=node=>previews.has(node)?PREVIEW_DELAY:DELAY;
 function enter(event){
  const node=target(event);if(node===anchor)return;hide();if(!node)return;
  anchor=node;timer=win.setTimeout(()=>{timer=0;if(anchor===node)show(node);},delay(node));
 }
 listen(doc,'pointerover',enter,true);
 listen(doc,'focusin',event=>{if(!event.target?.closest?.('[data-menu-input=pointer]')&&event.target?.matches?.(':focus-visible'))enter(event);},true);
 listen(doc,'focusout',event=>{if(anchor?.contains(event.target)&&!anchor.contains(event.relatedTarget)&&!anchor.matches(':hover'))hide();},true);
 for(const name of ['pointerdown','keydown','wheel'])listen(doc,name,()=>hide(),true);
 listen(doc.documentElement,'pointerleave',()=>hide());listen(doc,'visibilitychange',()=>hide(true));
 function scrolled(event){
  if(!anchor||event.target!==doc&&!event.target.contains?.(anchor))return;
  const node=anchor,stillAddressed=node.matches(':hover')||node.matches(':focus-visible');
  // A focused titlebar may scroll by a pixel while fitting its text. Reposition
  // the same bubble rather than tearing it down and restarting the hover delay.
  if(stillAddressed&&visible(node)&&!skipped(node)){if(bubble)refresh(true);}else hide();
 }
 listen(win,'blur',()=>hide(true));listen(win,'scroll',scrolled,true);listen(win,'resize',()=>hide(true));listen(win,'pagehide',close);
 function close(){if(closed)return;closed=true;hide(true);observer.disconnect();for(const stop of listeners)stop();installed.delete(doc);}
 return state;
}
export function configureTooltips(doc,options){const state=setupTooltips(doc);if(state)Object.assign(state,options);}
