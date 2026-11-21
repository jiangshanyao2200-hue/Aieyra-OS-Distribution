// CSS and imperative effects share timing and interruption policy. Only owned
// decorative animations are cancelled; application state never waits on motion.
export const MOTION={fast:160,enter:240,move:360,ease:'cubic-bezier(.2,.8,.2,1)'};
const documents=new WeakMap(),owners=new WeakMap();
const documentOf=value=>value?.ownerDocument||value;
export function motionAllowed(value=globalThis.document){
 const doc=documentOf(value),win=doc?.defaultView;
 return !doc?.hidden&&doc?.body?.dataset?.visible!=='false'&&!doc?.body?.classList?.contains?.('reduce-motion')&&!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches&&(!value?.checkVisibility||value.checkVisibility({checkVisibilityCSS:true}));
}
export function motionDuration(value,kind='enter'){
 const doc=documentOf(value),raw=doc?.defaultView?.getComputedStyle?.(doc.body).getPropertyValue('--ui-'+kind)?.trim();
 const n=parseFloat(raw);return Number.isFinite(n)?Math.max(0,n*(raw.endsWith('ms')?1:1000)):(MOTION[kind]??MOTION.enter);
}
export function setupMotion(doc=globalThis.document){
 // 提示框是附加能力：动态加载，取不到也不能拖垮页面。Link 的页面由它自己的服务提供这个文件。
 if(doc?.defaultView)void import('./tooltip.mjs').then(m=>m.setupTooltips(doc)).catch(()=>{});
 if(!doc?.body?.dataset||!doc.addEventListener||documents.has(doc))return documents.get(doc);
 const win=doc.defaultView,active=new Set(),listeners=new Set(),media=win?.matchMedia?.('(prefers-reduced-motion: reduce)');
 let allowed=motionAllowed(doc);
 const update=()=>{
  const hidden=doc.hidden||doc.body.dataset.visible==='false';
  if(doc.body.dataset.uiHidden!==String(hidden))doc.body.dataset.uiHidden=String(hidden);
  const next=motionAllowed(doc);if(next===allowed)return;allowed=next;
  if(!allowed)for(const animation of [...active])animation.cancel();
  for(const listener of listeners)listener(allowed);
 };
 const observer=win?.MutationObserver?new win.MutationObserver(update):null;
 observer?.observe(doc.body,{attributes:true,attributeFilter:['class','data-visible']});
 doc.addEventListener('visibilitychange',update);media?.addEventListener?.('change',update);
 const state={active,listeners,update,close(){observer?.disconnect();doc.removeEventListener('visibilitychange',update);media?.removeEventListener?.('change',update);for(const animation of [...active])animation.cancel();active.clear();listeners.clear();documents.delete(doc);}};
 documents.set(doc,state);win?.addEventListener?.('pagehide',()=>state.close(),{once:true});update();return state;
}
export function observeMotion(doc,listener){const state=setupMotion(doc);state?.listeners.add(listener);return ()=>state?.listeners.delete(listener);}
// WebContentsView can remain document-visible after its native owner is hidden.
// Use the same explicit visibility flag as other surfaces; keep task state intact.
export function bindSurfaceVisibility(api,doc=globalThis.document){
 setupMotion(doc);let closed=false;
 const stop=api.onSurfaceVisibility?.(value=>{if(!closed)doc.body.dataset.visible=String(value?.visible===true);});
 return ()=>{if(closed)return;closed=true;stop?.();};
}
export function cancelMotion(node,key){const owned=owners.get(node);if(key){owned?.get(key)?.cancel();owned?.delete(key);}else{for(const animation of owned?.values()||[])animation.cancel();owned?.clear();}}
export function animateUI(node,keyframes,{kind='enter',key='motion',...options}={}){
 const doc=node?.ownerDocument,state=setupMotion(doc);
 let owned=owners.get(node);if(!owned){owned=new Map();owners.set(node,owned);}
 owned.get(key)?.cancel();owned.delete(key);
 if(!node.animate||!motionAllowed(node))return null;
 const animation=node.animate(keyframes,{duration:motionDuration(node,kind),easing:MOTION.ease,...options});
 owned.set(key,animation);state?.active.add(animation);
 const settle=()=>{state?.active.delete(animation);if(owned.get(key)===animation)owned.delete(key);};
 animation.finished.then(settle,settle);return animation;
}
