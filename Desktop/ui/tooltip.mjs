// 全局提示框。系统的 title 提示长什么样我们管不了，所以任何元素一写 title 就收成 data-tip，
// 由这里统一画。motion.mjs 在每个页面启动时装上它，页面不用各自处理。
const DELAY=450,GAP=8,EDGE=8;
const CSS=`.ui-tip{position:fixed;inset:auto;margin:0;width:max-content;height:auto;padding:6px 11px;border:0;border-radius:10px;max-width:min(340px,calc(100vw - 16px));overflow:hidden;background:rgba(14,16,22,.94);box-shadow:inset 0 0 0 1px #ffffff1c,0 10px 30px #0008;color:#e6e9f0;font:400 12px/1.55 var(--os-interface-font,"Aieyra Inter","Aieyra Noto Sans SC",sans-serif);letter-spacing:.01em;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;z-index:2147483600;animation:ui-tip-in 120ms cubic-bezier(.2,.8,.2,1)}@keyframes ui-tip-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.ui-tip{animation:none}}`;
const installed=new WeakMap();
export function tipPlacement(anchor,size,view,gap=GAP,edge=EDGE){
 const below=anchor.bottom+gap,fits=below+size.height+edge<=view.height,top=fits?below:Math.max(edge,anchor.top-gap-size.height);
 const left=Math.max(edge,Math.min(view.width-size.width-edge,anchor.left+anchor.width/2-size.width/2));
 return {left:Math.round(left),top:Math.round(top)};
}
export function setupTooltips(doc=globalThis.document){
 const win=doc?.defaultView;
 if(!win?.MutationObserver||!doc.documentElement||installed.has(doc))return installed.get(doc)||null;
 const state={skip:()=>false,native:()=>null};
 installed.set(doc,state);
 try{const sheet=new win.CSSStyleSheet();sheet.replaceSync(CSS);doc.adoptedStyleSheets=[...doc.adoptedStyleSheets,sheet];}catch{}
 function absorb(node){
  const text=node.getAttribute('title');node.removeAttribute('title');
  if(text){node.dataset.tip=text;if(!node.getAttribute('aria-label')&&!node.textContent?.trim())node.setAttribute('aria-label',text);}
  else if(text==='')delete node.dataset.tip;
 }
 const sweep=root=>{if(root.nodeType!==1)return;if(root.hasAttribute('title'))absorb(root);for(const node of root.querySelectorAll('[title]'))absorb(node);for(const node of root.querySelectorAll('svg title'))node.remove();};
 new win.MutationObserver(records=>{for(const r of records){if(r.type==='attributes'){if(r.target.hasAttribute('title'))absorb(r.target);}else for(const node of r.addedNodes)sweep(node);}}).observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['title']});
 sweep(doc.documentElement);
 let timer=0,anchor=null,bubble=null,remote=null;
 function hide(){
  clearTimeout(timer);timer=0;anchor=null;
  if(remote){void Promise.resolve(remote({action:'hide'})).catch(()=>{});remote=null;}
  if(bubble){try{bubble.hidePopover?.();}catch{}bubble.remove();bubble=null;}
 }
 function show(node){
  const text=node.dataset.tip;if(!text||!node.isConnected)return;
  const native=state.native(node),rect=node.getBoundingClientRect();
  if(native){remote=native;void Promise.resolve(native({action:'show',text,x:rect.left,y:rect.top,width:rect.width,height:rect.height})).catch(()=>{});return;}
  bubble=doc.createElement('div');bubble.className='ui-tip';bubble.setAttribute('role','tooltip');bubble.textContent=text;
  // 弹层在顶层，模态对话框里的提示框才不会被压住。
  if(bubble.showPopover)bubble.setAttribute('popover','manual');
  doc.body.append(bubble);try{bubble.showPopover?.();}catch{}
  const place=tipPlacement(rect,bubble.getBoundingClientRect(),{width:win.innerWidth,height:win.innerHeight});
  bubble.style.left=place.left+'px';bubble.style.top=place.top+'px';
 }
 const target=event=>{const node=event.target?.closest?.('[data-tip]');return node&&!state.skip(node)?node:null;};
 function enter(event,delay=DELAY){
  const node=target(event);if(node===anchor)return;hide();if(!node)return;
  anchor=node;timer=setTimeout(()=>{timer=0;if(anchor===node)show(node);},delay);
 }
 doc.addEventListener('pointerover',event=>enter(event),true);
 doc.addEventListener('focusin',event=>{if(event.target?.matches?.(':focus-visible'))enter(event);},true);
 doc.addEventListener('focusout',hide,true);
 for(const name of ['pointerdown','keydown','wheel'])doc.addEventListener(name,hide,true);
 doc.documentElement.addEventListener('pointerleave',hide);
 win.addEventListener('blur',hide);win.addEventListener('scroll',hide,true);
 return state;
}
export function configureTooltips(doc,options){const state=setupTooltips(doc);if(state)Object.assign(state,options);}
