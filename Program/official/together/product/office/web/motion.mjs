/* @file-map:start
文件: link/office/web/motion.mjs
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: link/office/web/tooltip.mjs
上游: link/desktop/ui/surfaces.mjs, link/desktop/ui/workspace.mjs, link/office/web/office-home.js, link/office/web/tooltip.mjs, link/office/web/ui-ticker.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  documentOf | function
  motionAllowed | function
  motionDuration | function
  setupMotion | function
  setupMotion.update | function
  setupMotion.close | method
  observeMotion | function
  bindSurfaceVisibility | function
  cancelMotion | function
  animateUI | function
  animateUI.settle | function
  enterSurface | function
  moveWorkspace | function
  moveWorkspace.resize | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// CSS and imperative effects share timing and interruption policy. Only owned
// decorative animations are cancelled; application state never waits on motion.
export const MOTION={fast:160,enter:240,move:360,ease:'cubic-bezier(.2,.8,.2,1)'};
const documents=new WeakMap(),owners=new WeakMap();
const /* @chain-region documentOf */ documentOf=value=>value?.ownerDocument||value;
export /* @chain-region motionAllowed | calls: documentOf, doc.body.classList.contains, win.matchMedia, value.checkVisibility */ function motionAllowed(value=globalThis.document){
 const doc=documentOf(value),win=doc?.defaultView;
 return !doc?.hidden&&doc?.body?.dataset?.visible!=='false'&&doc?.documentElement?.dataset.motion!=='reduced'&&!doc?.body?.classList?.contains?.('reduce-motion')&&!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches&&(!value?.checkVisibility||value.checkVisibility({checkVisibilityCSS:true}));
}
export /* @chain-region motionDuration | calls: documentOf, trim, getPropertyValue, doc.defaultView.getComputedStyle, parseFloat, Number.isFinite, Math.max, raw.endsWith */ function motionDuration(value,kind='enter'){
 const doc=documentOf(value),raw=doc?.defaultView?.getComputedStyle?.(doc.body).getPropertyValue('--ui-'+kind)?.trim();
 const n=parseFloat(raw);return Number.isFinite(n)?Math.max(0,n*(raw.endsWith('ms')?1:1000)):(MOTION[kind]??MOTION.enter);
}
export /* @chain-region setupMotion | calls: documents.has, documents.get, catch, then, m.setupTooltips, Set, win.matchMedia, motionAllowed … */ function setupMotion(doc=globalThis.document,{tooltips=true}={}){
 if(!doc?.body?.dataset||!doc.addEventListener||documents.has(doc))return documents.get(doc);
 // 提示框是附加能力：动态加载，取不到也不能拖垮页面。Link 的页面由它自己的服务提供这个文件。
 if(tooltips&&doc.defaultView)void import('./tooltip.mjs').then(m=>m.setupTooltips(doc)).catch(()=>{});
 const win=doc.defaultView,active=new Set(),listeners=new Set(),media=win?.matchMedia?.('(prefers-reduced-motion: reduce)');
 let allowed=motionAllowed(doc);
 const /* @chain-region setupMotion.update | calls: String, motionAllowed, animation.cancel, listener */ update=()=>{
  const hidden=doc.hidden||doc.body.dataset.visible==='false';
  if(doc.body.dataset.uiHidden!==String(hidden))doc.body.dataset.uiHidden=String(hidden);
  const next=motionAllowed(doc);if(next===allowed)return;allowed=next;
  if(!allowed)for(const animation of [...active])animation.cancel();
  for(const listener of listeners)listener(allowed);
 };
 const observer=win?.MutationObserver?new win.MutationObserver(update):null;
 observer?.observe(doc.body,{attributes:true,attributeFilter:['class','data-visible']});
 observer?.observe(doc.documentElement,{attributes:true,attributeFilter:['data-motion']});
 doc.addEventListener('visibilitychange',update);media?.addEventListener?.('change',update);
 const state={active,listeners,update,/* @chain-region setupMotion.close | calls: observer.disconnect, doc.removeEventListener, media.removeEventListener, animation.cancel, active.clear, listeners.clear, documents.delete */ close(){observer?.disconnect();doc.removeEventListener('visibilitychange',update);media?.removeEventListener?.('change',update);for(const animation of [...active])animation.cancel();active.clear();listeners.clear();documents.delete(doc);}};
 documents.set(doc,state);win?.addEventListener?.('pagehide',()=>state.close(),{once:true});update();return state;
}
export /* @chain-region observeMotion | calls: setupMotion, state.listeners.add, state.listeners.delete */ function observeMotion(doc,listener){const state=setupMotion(doc);state?.listeners.add(listener);return ()=>state?.listeners.delete(listener);}
// WebContentsView can remain document-visible after its native owner is hidden.
// Use the same explicit visibility flag as other surfaces; keep task state intact.
export /* @chain-region bindSurfaceVisibility | calls: setupMotion, api.onSurfaceVisibility, String, stop */ function bindSurfaceVisibility(api,doc=globalThis.document){
 setupMotion(doc);let closed=false;
 const stop=api.onSurfaceVisibility?.(value=>{if(!closed)doc.body.dataset.visible=String(value?.visible===true);});
 return ()=>{if(closed)return;closed=true;stop?.();};
}
export /* @chain-region cancelMotion | calls: owners.get, cancel, owned.get, owned.delete, owned.values, animation.cancel, owned.clear */ function cancelMotion(node,key){const owned=owners.get(node);if(key){owned?.get(key)?.cancel();owned?.delete(key);}else{for(const animation of owned?.values()||[])animation.cancel();owned?.clear();}}
export /* @chain-region animateUI | calls: setupMotion, owners.get, Map, owners.set, cancel, owned.get, owned.delete, motionAllowed … */ function animateUI(node,keyframes,{kind='enter',key='motion',...options}={}){
 if(!node?.animate)return null;
 const doc=node?.ownerDocument,state=setupMotion(doc);
 let owned=owners.get(node);if(!owned){owned=new Map();owners.set(node,owned);}
 owned.get(key)?.cancel();owned.delete(key);
 if(!motionAllowed(node))return null;
 const animation=node.animate(keyframes,{duration:motionDuration(node,kind),easing:MOTION.ease,...options});
 owned.set(key,animation);state?.active.add(animation);
 const /* @chain-region animateUI.settle | calls: state.active.delete, owned.get, owned.delete */ settle=()=>{state?.active.delete(animation);if(owned.get(key)===animation)owned.delete(key);};
 animation.finished.then(settle,settle);return animation;
}

export /* @chain-region enterSurface | calls: animateUI */ function enterSurface(node,direction=0){
 const offset=node?.ownerDocument.defaultView.innerWidth<680?8:16;
 return animateUI(node,[
  {opacity:.58,translate:direction?`${direction*offset}px 0`:'0 10px'},
  {opacity:1,translate:'0 0'},
 ],{key:'navigation',duration:250,easing:'cubic-bezier(.2,.7,.24,1)'});
}

// Commit layout once, then translate surfaces on the compositor. Never scale
// the workspace: nonuniform scaling stretches avatars, text and hit targets.
// Native child surfaces take their final rectangle once; never sample a moving
// DOM proxy and repeatedly resize an Electron WebContentsView during the tween.
export /* @chain-region moveWorkspace | calls: filter, doc.querySelectorAll, n.getClientRects, n.getBoundingClientRect, map, nodes.filter, nodes.some, parent.contains … */ function moveWorkspace(doc,mutate){
 const selectors='#screen,#os-home,#bottom-bar,#desktop-dock > button,#status-rail';
 const nodes=[...doc.querySelectorAll(selectors)].filter(n=>n.getClientRects().length&&n.getBoundingClientRect().width>0);
 const rows=nodes.filter(n=>!nodes.some(parent=>parent!==n&&parent.contains(n))).map(node=>({node,before:node.getBoundingClientRect()}));
 for(const {node}of rows)cancelMotion(node,'workspace-layout');
 mutate();
 if(!motionAllowed(doc))return;
 const after=rows.map(row=>({...row,after:row.node.getBoundingClientRect(),style:doc.defaultView.getComputedStyle(row.node)})),moving=[];
 for(const {node,before,after:r,style}of after){
  if(!r.width||!r.height)continue;
  const dx=before.x-r.x,dy=before.y-r.y;
  if(Math.abs(dx)+Math.abs(dy)<.5)continue;
  const base=style.transform==='none'?'':style.transform;
  const animation=animateUI(node,[{transformOrigin:'0 0',transform:`${base} translate(${dx}px,${dy}px)`},{transformOrigin:'0 0',transform:base||'none'}],{kind:'move',key:'workspace-layout'});
  if(animation)moving.push(animation);
 }
 // A native viewport resize invalidates these offsets. Synthetic layout notices
 // do not: contacts publishes one immediately after committing its insets.
 if(moving.length){const win=doc.defaultView,/* @chain-region moveWorkspace.resize | calls: a.cancel */ resize=event=>{if(event.isTrusted)for(const a of moving)a.cancel();};win.addEventListener('resize',resize);void Promise.allSettled(moving.map(a=>a.finished)).then(()=>win.removeEventListener('resize',resize));}
}
