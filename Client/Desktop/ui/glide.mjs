// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: hoverGlide
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/glide.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Shared hover plate: one soft plate glides from item to item under the pointer
// (and keyboard focus), so moving across a list reads as one continuous motion.
// The container must be the items' offsetParent; repaints may replace items.
export function hoverGlide(container,selector,{doc=container.ownerDocument,cls=''}={}){
 const plate=doc.createElement('span');plate.className=('glide '+cls).trim();plate.setAttribute('aria-hidden','true');
 let current=null,shown=false,frame=0;
 const attach=()=>{if(plate.parentNode!==container)container.prepend(plate);};
 function place(item){
  attach();if(!item?.isConnected||!container.contains(item))return hide();
  current=item;const jump=!shown||plate.dataset.show!=='true';
  if(jump)plate.dataset.jump='true';
  plate.style.translate=item.offsetLeft+'px '+item.offsetTop+'px';plate.style.width=item.offsetWidth+'px';plate.style.height=item.offsetHeight+'px';
  // A plate that was hidden appears in place; only later moves travel.
  if(jump){plate.getBoundingClientRect();delete plate.dataset.jump;}
  plate.dataset.show='true';shown=true;
 }
 function hide(){current=null;shown=false;plate.dataset.show='false';}
 const itemOf=target=>{const item=target?.closest?.(selector);return item&&container.contains(item)&&!item.matches('[aria-disabled=true]')?item:null;};
 const over=event=>{const item=itemOf(event.target);if(item&&item!==current)place(item);};
 const leave=()=>{const focused=itemOf(doc.activeElement);focused&&doc.activeElement.matches(':focus-visible')?place(focused):hide();};
 const focusin=event=>{const item=itemOf(event.target);if(item&&event.target.matches(':focus-visible'))place(item);};
 const focusout=event=>{if(!container.contains(event.relatedTarget)&&!container.matches(':hover'))hide();};
 container.addEventListener('pointerover',over);container.addEventListener('pointerleave',leave);
 container.addEventListener('focusin',focusin);container.addEventListener('focusout',focusout);
 attach();
 return {
  // After a repaint the hovered node may be new; follow whatever is under the pointer now.
  refresh(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{attach();const hovered=[...container.querySelectorAll(selector)].find(n=>n.matches(':hover'))||(current?.isConnected?current:null);hovered?place(hovered):hide();});},
  hide,
  close(){cancelAnimationFrame(frame);container.removeEventListener('pointerover',over);container.removeEventListener('pointerleave',leave);container.removeEventListener('focusin',focusin);container.removeEventListener('focusout',focusout);plate.remove();},
 };
}
