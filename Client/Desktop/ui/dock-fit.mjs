// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fitDock
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/dock-fit.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Preserve the actual navigation nodes and their drag/click listeners. Entries
// that do not fit remain available through the existing native Apps menu.
export function fitDock(dock,{entries,doc=dock.ownerDocument}={}){
 const win=doc.defaultView,hidden=new Set(),observed=new Set(),sizes=new WeakMap();
 let closed=false,frame=0,pressed=false,invalid=true;
 function schedule(){if(!closed&&!frame)frame=win.requestAnimationFrame(paint);}
 function invalidate(){invalid=true;schedule();}
 function paint(){
  frame=0;if(closed||pressed||!dock.isConnected)return;
  // A font/scale/theme change needs one complete measurement. Ordinary resize
  // callbacks keep hidden widths, avoiding a restore/hide cycle every frame.
  if(invalid){for(const node of hidden)node.removeAttribute('data-dock-overflow');hidden.clear();invalid=false;}
  // A previous browser focus scroll must not leave the leading controls clipped.
  if(dock.scrollLeft)dock.scrollLeft=0;
  const style=win.getComputedStyle(dock),gap=parseFloat(style.columnGap)||0;
  const reserve=Math.max(0,parseFloat(style.getPropertyValue?.('--workspace-menu-reserve'))||0);
  const width=Math.max(0,dock.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0)-reserve),buttons=[...dock.querySelectorAll('button')],optional=new Set(entries());
  const items=[];
  function measure(parent){for(const node of parent.children){
   if(node.hidden||node.hasAttribute('data-unpinned'))continue;
   const css=win.getComputedStyle(node);
   if(css.display==='contents'){measure(node);continue;}
   if(css.position==='absolute'||css.position==='fixed')continue;
   let size;
   if(hidden.has(node))size=sizes.get(node);
   else{const rect=node.getBoundingClientRect();if(!rect.width||css.display==='none')continue;size=rect.width+(parseFloat(css.marginLeft)||0)+(parseFloat(css.marginRight)||0);sizes.set(node,size);}
   if(size)items.push({node,size,order:Number(css.order)||0,index:items.length});
  }}
  measure(dock);items.sort((a,b)=>a.order-b.order||a.index-b.index);
  const protect=node=>node.contains(doc.activeElement)||node.matches(':hover')||node.querySelector(':hover');
  let total=items.reduce((sum,item)=>sum+item.size,0)+Math.max(0,items.length-1)*gap,count=items.length;
  const nextHidden=new Set();
  for(const item of [...items].reverse()){
   if(total<=width+.1)break;
   if(!optional.has(item.node)||protect(item.node))continue;
   total-=item.size+(count>1?gap:0);count--;nextHidden.add(item.node);
  }
  // All layout reads finish before the diff is committed. Never hide an item
  // and synchronously remeasure every following button inside a loop.
  for(const node of hidden)if(!nextHidden.has(node))node.removeAttribute('data-dock-overflow');
  for(const node of nextHidden)if(!hidden.has(node))node.setAttribute('data-dock-overflow','');
  hidden.clear();for(const node of nextHidden)hidden.add(node);
  const next=new Set([dock,...buttons]);
  for(const node of observed)if(!next.has(node)){resize.unobserve(node);observed.delete(node);}
  for(const node of next)if(!observed.has(node)){resize.observe(node);observed.add(node);}
 }
 const resize=new win.ResizeObserver(schedule),changes=new win.MutationObserver(schedule);
 resize.observe(dock);observed.add(dock);
 changes.observe(dock,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','data-unpinned','data-module-state']});
 const down=()=>{pressed=true;},up=()=>{pressed=false;schedule();};
 dock.addEventListener('pointerdown',down);win.addEventListener('pointerup',up);win.addEventListener('pointercancel',up);win.addEventListener('blur',up);
 dock.addEventListener('workspace-dock-change',schedule);dock.addEventListener('pointerleave',schedule);dock.addEventListener('focusout',schedule);doc.addEventListener('workspace-theme-change',invalidate);win.addEventListener('resize',invalidate);doc.fonts?.addEventListener('loadingdone',invalidate);
 schedule();
 return {refresh:invalidate,close(){closed=true;win.cancelAnimationFrame(frame);resize.disconnect();changes.disconnect();dock.removeEventListener('pointerdown',down);win.removeEventListener('pointerup',up);win.removeEventListener('pointercancel',up);win.removeEventListener('blur',up);dock.removeEventListener('workspace-dock-change',schedule);dock.removeEventListener('pointerleave',schedule);dock.removeEventListener('focusout',schedule);doc.removeEventListener('workspace-theme-change',invalidate);win.removeEventListener('resize',invalidate);doc.fonts?.removeEventListener('loadingdone',invalidate);for(const node of hidden)node.removeAttribute('data-dock-overflow');}};
}
