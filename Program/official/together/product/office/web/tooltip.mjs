/* @file-map:start
文件: link/office/web/tooltip.mjs
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: link/office/web/model-card.mjs, link/office/web/motion.mjs, link/office/web/preview-card.mjs, link/office/web/tooltip-content.mjs
上游: link/office/web/motion.mjs, link/office/web/office-home.js
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  setTooltipRows | function
  setPreviewTooltip | function
  setModelTooltip | function
  showModelTooltip | function
  hideModelTooltip | function
  tipPlacement | function
  tipPlacement.clamp | function
  tipPlacement.snap | function
  setupTooltips | function
  setupTooltips.skip | method
  setupTooltips.native | method
  setupTooltips.showNow | method
  setupTooltips.skipped | function
  setupTooltips.schedulePlacement | function
  setupTooltips.listen | function
  setupTooltips.absorb | function
  setupTooltips.sweep | function
  setupTooltips.visible | function
  setupTooltips.describe | function
  setupTooltips.hide | function
  setupTooltips.hide.remove | function
  setupTooltips.refresh | function
  setupTooltips.show | function
  setupTooltips.show.update | function
  setupTooltips.target | function
  setupTooltips.delay | function
  setupTooltips.enter | function
  setupTooltips.scrolled | function
  setupTooltips.close | function
  configureTooltips | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
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
export /* @chain-region setTooltipRows | calls: tooltipRows, details.set, details.delete, tooltipRowsText, refresh, setupTooltips */ function setTooltipRows(anchor,value){
 const rows=tooltipRows(value);if(rows)details.set(anchor,rows);else details.delete(anchor);anchor.dataset.tip=tooltipRowsText(rows);setupTooltips(anchor.ownerDocument)?.refresh();
}
export /* @chain-region setPreviewTooltip | calls: previews.set, anchor.getAttribute, setupTooltips, previews.delete, hide, installed.get */ function setPreviewTooltip(anchor,read,initial=null){
 previews.set(anchor,{read,initial});anchor.dataset.previewTooltip='true';anchor.dataset.tip=anchor.getAttribute('aria-label')||'程序预览';setupTooltips(anchor.ownerDocument);
 return ()=>{previews.delete(anchor);delete anchor.dataset.previewTooltip;installed.get(anchor.ownerDocument)?.hide();};
}
export /* @chain-region setModelTooltip | calls: models.set, modelCardText, model, setupTooltips, state.refresh */ function setModelTooltip(anchor,model){
 models.set(anchor,typeof model==='function'?model:()=>model);anchor.dataset.tip=modelCardText(typeof model==='function'?model():model);
 const state=setupTooltips(anchor.ownerDocument);state?.refresh();return anchor;
}
export /* @chain-region showModelTooltip | calls: setModelTooltip, showNow, setupTooltips */ function showModelTooltip(anchor,model){setModelTooltip(anchor,model);setupTooltips(anchor.ownerDocument)?.showNow(anchor);}
export /* @chain-region hideModelTooltip | calls: hide, installed.get */ function hideModelTooltip(doc=globalThis.document){installed.get(doc)?.hide();}
export /* @chain-region tipPlacement | calls: snap, clamp */ function tipPlacement(anchor,size,view,gap=GAP,edge=EDGE){
 const below=anchor.bottom+gap,fits=below+size.height+edge<=view.height;
 const scale=view.scale||1,/* @chain-region tipPlacement.clamp | calls: Math.max, Math.min */ clamp=(value,limit)=>Math.max(edge,Math.min(Math.max(edge,limit),value));
 const /* @chain-region tipPlacement.snap | calls: Math.round */ snap=value=>Math.round(value*scale)/scale;
 return {left:snap(clamp(anchor.left+anchor.width/2-size.width/2,view.width-size.width-edge)),top:snap(clamp(fits?below:anchor.top-gap-size.height,view.height-size.height-edge))};
}
export /* @chain-region setupTooltips | calls: installed.has, installed.get, installed.set, win.ResizeObserver, schedulePlacement, win.MutationObserver, r.target.hasAttribute, absorb … */ function setupTooltips(doc=globalThis.document){
 const win=doc?.defaultView;
 if(!win?.MutationObserver||!doc.documentElement||installed.has(doc))return installed.get(doc)||null;
 const state={/* @chain-region setupTooltips.skip */ skip:()=>false,/* @chain-region setupTooltips.native */ native:()=>null,close,refresh,hide,/* @chain-region setupTooltips.showNow | calls: refresh, hide, show */ showNow(node){if(anchor===node&&bubble){refresh();return;}hide();anchor=node;show(node);}};installed.set(doc,state);
 const /* @chain-region setupTooltips.skipped | calls: node.closest, state.skip */ skipped=node=>!!node?.closest?.(toolVisuals)||state.skip(node);
 let timer=0,anchor=null,bubble=null,remote=null,shownText='',closed=false,preview=null,poll=0,generation=0,placeFrame=0;
 const resized=win.ResizeObserver?new win.ResizeObserver(()=>schedulePlacement()):null;
 /* @chain-region setupTooltips.schedulePlacement | calls: win.requestAnimationFrame, refresh */ function schedulePlacement(){if(!placeFrame&&anchor&&bubble&&!closed)placeFrame=win.requestAnimationFrame(()=>{placeFrame=0;refresh(true);});}
 const listeners=[];
 const /* @chain-region setupTooltips.listen | calls: node.addEventListener, listeners.push, node.removeEventListener */ listen=(node,event,fn,capture=false)=>{node.addEventListener(event,fn,capture);listeners.push(()=>node.removeEventListener(event,fn,capture));};
 /* @chain-region setupTooltips.absorb | calls: node.getAttribute, node.removeAttribute, node.textContent.trim, node.setAttribute */ function absorb(node){
  const text=node.getAttribute('title');node.removeAttribute('title');
  if(text){node.dataset.tip=text;if(!node.getAttribute('aria-label')&&!node.textContent?.trim())node.setAttribute('aria-label',text);}
  else if(text==='')delete node.dataset.tip;
 }
 const /* @chain-region setupTooltips.sweep | calls: root.hasAttribute, absorb, root.querySelectorAll, node.remove */ sweep=root=>{if(root.nodeType!==1)return;if(root.hasAttribute('title'))absorb(root);for(const node of root.querySelectorAll('[title]'))absorb(node);for(const node of root.querySelectorAll('svg title'))node.remove();};
 const /* @chain-region setupTooltips.visible | calls: node.checkVisibility */ visible=node=>node?.isConnected&&!doc.hidden&&doc.body.dataset.visible!=='false'&&(!node.checkVisibility||node.checkVisibility({checkVisibilityCSS:true}));
 /* @chain-region setupTooltips.describe | calls: Set, filter, split, anchor.getAttribute, ids.add, ids.delete, anchor.setAttribute, join … */ function describe(add){
  if(!anchor||!bubble)return;
  const ids=new Set((anchor.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));
  if(add)ids.add(bubble.id);else ids.delete(bubble.id);
  if(ids.size)anchor.setAttribute('aria-describedby',[...ids].join(' '));else anchor.removeAttribute('aria-describedby');
 }
 /* @chain-region setupTooltips.hide | calls: resized.disconnect, win.cancelAnimationFrame, win.clearTimeout, describe, catch, Promise.resolve, remote, cancelMotion … */ function hide(immediate=false){
  resized?.disconnect();win.cancelAnimationFrame(placeFrame);placeFrame=0;
  win.clearTimeout(timer);win.clearTimeout(poll);generation++;preview=null;timer=0;describe(false);anchor=null;shownText='';
  if(remote){void Promise.resolve(remote({action:'hide',...(immediate?{immediate:true}:{})})).catch(()=>{});remote=null;}
  if(bubble){const old=bubble;bubble=null;const /* @chain-region setupTooltips.hide.remove | calls: old.hidePopover, old.remove */ remove=()=>{try{old.hidePopover?.();}catch{}old.remove();};
   if(immediate||old.className==='ui-tip-accessible'){cancelMotion(old);remove();}
   else{const from=Number(win.getComputedStyle(old).opacity);const animation=animateUI(old,[{opacity:from},{opacity:0}],{kind:'fast',key:'tip-presence'});if(animation)void animation.finished.then(remove,remove);else remove();}
  }
 }
 /* @chain-region setupTooltips.refresh | calls: visible, skipped, hide, modelCardData, models.get, details.get, JSON.stringify, renderPreviewCard … */ function refresh(reposition=false){
  if(!anchor)return;
  if(!visible(anchor)||!anchor.dataset.tip||skipped(anchor)){hide();return;}
  if(!bubble)return;
  const model=modelCardData(models.get(anchor)?.()),rows=details.get(anchor),text=anchor.dataset.tip,signature=JSON.stringify([text,model,preview,rows]),changed=signature!==shownText;if(!changed&&!reposition)return;shownText=signature;
  bubble.className=remote?'ui-tip-accessible':preview?'ui-tip program-preview':model?'ui-tip model-hover':'ui-tip';
  if(changed){if(preview&&!remote)renderPreviewCard(bubble,preview);else if(model&&!remote)renderModelCard(bubble,model);else if(rows&&!remote)renderTooltipRows(bubble,rows);else bubble.textContent=preview?[preview.title,preview.state].join(" · "):text;}
  const rect=anchor.getBoundingClientRect();
  if(remote){void Promise.resolve(remote({action:'show',text,...(model?{model}:{}),...(preview?{preview}:{}),...(rows?{rows}:{}),x:rect.left,y:rect.top,width:rect.width,height:rect.height})).catch(()=>{});return;}
  const place=tipPlacement(rect,bubble.getBoundingClientRect(),{width:win.innerWidth,height:win.innerHeight,scale:win.devicePixelRatio});
  bubble.style.left=place.left+'px';bubble.style.top=place.top+'px';
 }
 /* @chain-region setupTooltips.show | calls: visible, skipped, state.native, doc.createElement, bubble.setAttribute, doc.body.append, bubble.showPopover, previews.get … */ function show(node){
  if(!visible(node)||!node.dataset.tip||skipped(node))return;
  remote=state.native(node);
  bubble=doc.createElement('div');bubble.id='ui-tip-'+ ++serial;bubble.className=remote?'ui-tip-accessible':'ui-tip';bubble.setAttribute('role','tooltip');
  // Popover keeps tips above modal dialogs; native tips retain a local a11y node.
  if(!remote&&bubble.showPopover)bubble.setAttribute('popover','manual');
  doc.body.append(bubble);if(!remote)try{bubble.showPopover?.();}catch{}
  const source=previews.get(node),read=source?.read,mine=generation;
  if(read)preview=previewCache.get(node)||previewCardData({module:node.dataset.viewKey||'',title:node.dataset.tip,state:'',url:'',...(typeof source.initial==='function'?source.initial():source.initial)});
  describe(true);refresh();
  resized?.observe(node);if(node.parentElement)resized?.observe(node.parentElement);if(!remote)resized?.observe(bubble);
  if(read){const /* @chain-region setupTooltips.show.update | calls: read, visible, hide, previewCardData, previewCache.set, refresh, win.setTimeout */ update=async()=>{
   let next;try{next=await read();}catch{next={title:node.dataset.tip,state:'预览暂不可用'};}
   if(mine!==generation||anchor!==node||closed)return;
   if(!visible(node)){hide();return;}preview=previewCardData(next);if(preview)previewCache.set(node,preview);refresh();poll=win.setTimeout(update,1500);
  };void update();}

 }
 const observer=new win.MutationObserver(records=>{
  for(const r of records){if(r.type==='attributes'){if(r.target.hasAttribute('title'))absorb(r.target);}else for(const node of r.addedNodes)sweep(node);}
  refresh();
  if(anchor&&records.some(r=>r.type==='childList'&&r.target.contains?.(anchor)))schedulePlacement();
 });
 observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['title','data-tip','hidden','data-visible']});sweep(doc.documentElement);
 const /* @chain-region setupTooltips.target | calls: event.target.closest, skipped */ target=event=>{if(event.target?.closest?.(toolVisuals))return null;const node=event.target?.closest?.('[data-tip]');return node&&!skipped(node)?node:null;};
 const /* @chain-region setupTooltips.delay | calls: previews.has */ delay=node=>previews.has(node)?PREVIEW_DELAY:DELAY;
 /* @chain-region setupTooltips.enter | calls: target, hide, win.setTimeout, show, delay */ function enter(event){
  const node=target(event);if(node===anchor)return;hide();if(!node)return;
  anchor=node;timer=win.setTimeout(()=>{timer=0;if(anchor===node)show(node);},delay(node));
 }
 listen(doc,'pointerover',enter,true);
 listen(doc,'focusin',event=>{if(event.target?.matches?.(':focus-visible'))enter(event);},true);
 listen(doc,'focusout',event=>{if(anchor?.contains(event.target)&&!anchor.contains(event.relatedTarget)&&!anchor.matches(':hover'))hide();},true);
 for(const name of ['pointerdown','keydown','wheel'])listen(doc,name,()=>hide(),true);
 listen(doc.documentElement,'pointerleave',()=>hide());listen(doc,'visibilitychange',()=>hide(true));
 /* @chain-region setupTooltips.scrolled | calls: event.target.contains, node.matches, visible, skipped, refresh, hide */ function scrolled(event){
  if(!anchor||event.target!==doc&&!event.target.contains?.(anchor))return;
  const node=anchor,stillAddressed=node.matches(':hover')||node.matches(':focus-visible');
  // A focused titlebar may scroll by a pixel while fitting its text. Reposition
  // the same bubble rather than tearing it down and restarting the hover delay.
  if(stillAddressed&&visible(node)&&!skipped(node)){if(bubble)refresh(true);}else hide();
 }
 listen(win,'blur',()=>hide(true));listen(win,'scroll',scrolled,true);listen(win,'resize',()=>hide(true));listen(win,'pagehide',close);
 /* @chain-region setupTooltips.close | calls: hide, observer.disconnect, stop, installed.delete */ function close(){if(closed)return;closed=true;hide(true);observer.disconnect();for(const stop of listeners)stop();installed.delete(doc);}
 return state;
}
export /* @chain-region configureTooltips | calls: setupTooltips, Object.assign */ function configureTooltips(doc,options){const state=setupTooltips(doc);if(state)Object.assign(state,options);}
