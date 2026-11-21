// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: limit; coverImageSize; clampView; zoomView; createThemeViewport
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/theme-library-viewer.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const limit=(value,min,max)=>Math.min(max,Math.max(min,value));
export function coverImageSize(width,height,naturalWidth,naturalHeight){
 if(!(width>0&&height>0&&naturalWidth>0&&naturalHeight>0))return {width:Math.max(0,width),height:Math.max(0,height)};
 const ratio=Math.max(width/naturalWidth,height/naturalHeight);
 return {width:naturalWidth*ratio,height:naturalHeight*ratio};
}
export function clampView(view,width,height,contentWidth=width,contentHeight=height){
 const scale=limit(view.scale,1,8),x=Math.max(0,contentWidth*scale-width)/2,y=Math.max(0,contentHeight*scale-height)/2;
 return {scale,x:limit(view.x,-x,x),y:limit(view.y,-y,y)};
}
export function zoomView(view,scale,x,y,width,height,contentWidth=width,contentHeight=height){
 scale=limit(scale,1,8);const ratio=scale/view.scale;
 return clampView({scale,x:x-(x-view.x)*ratio,y:y-(y-view.y)*ratio},width,height,contentWidth,contentHeight);
}

export function createThemeViewport(viewport){
 const doc=viewport.ownerDocument,content=doc.createElement('div');content.className='theme-pan-content';viewport.replaceChildren(content);
 let state={scale:1,x:0,y:0},drag=null,image=null;
 // Cover is the initial framing, not a crop of the source. The complete image
 // stays in the pan layer so even its initially offscreen edges remain reachable.
 function geometry(){
  const width=viewport.clientWidth,height=viewport.clientHeight;
  if(image&&viewport.dataset.category!=='avatar'){
   const size=coverImageSize(width,height,image.naturalWidth,image.naturalHeight);
   image.style.width=size.width+'px';image.style.height=size.height+'px';
   return {width,height,contentWidth:size.width,contentHeight:size.height};
  }
  return {width,height,contentWidth:image?.offsetWidth||width,contentHeight:image?.offsetHeight||height};
 }
 const pannable=g=>g.contentWidth*state.scale>g.width+.5||g.contentHeight*state.scale>g.height+.5;
 const paint=g=>{content.style.transform=`translate(${state.x}px,${state.y}px) scale(${state.scale})`;viewport.dataset.zoomed=String(state.scale>1);viewport.dataset.pannable=String(pannable(g));};
 const release=()=>{if(drag&&viewport.hasPointerCapture?.(drag.id))viewport.releasePointerCapture(drag.id);drag=null;delete viewport.dataset.dragging;};
 const refresh=()=>{const g=geometry();state=clampView(state,g.width,g.height,g.contentWidth,g.contentHeight);paint(g);};
 const reset=()=>{release();state={scale:1,x:0,y:0};refresh();};
 function zoom(scale,event){
  const r=viewport.getBoundingClientRect(),g=geometry();
  state=zoomView(state,scale,event?event.clientX-r.left-r.width/2:0,event?event.clientY-r.top-r.height/2:0,g.width,g.height,g.contentWidth,g.contentHeight);paint(g);
 }
 const wheel=event=>{event.preventDefault();const factor=event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1;zoom(state.scale*Math.exp(-limit(event.deltaY*factor,-400,400)*.002),event);};
 const down=event=>{if(event.button!==0||drag||event.target.closest?.('button,input,a')||!pannable(geometry()))return;event.preventDefault();drag={id:event.pointerId,x:event.clientX,y:event.clientY,view:{...state}};viewport.setPointerCapture(event.pointerId);viewport.dataset.dragging='true';};
 const move=event=>{if(!drag||event.pointerId!==drag.id)return;const g=geometry();state=clampView({...state,x:drag.view.x+event.clientX-drag.x,y:drag.view.y+event.clientY-drag.y},g.width,g.height,g.contentWidth,g.contentHeight);paint(g);};
 const up=event=>{if(drag?.id===event.pointerId)release();};
 const double=event=>{if(event.target.closest?.('button,input,a'))return;event.preventDefault();if(state.scale>1)reset();else zoom(2,event);};
 const lost=()=>{drag=null;delete viewport.dataset.dragging;};
 viewport.addEventListener('wheel',wheel,{passive:false});viewport.addEventListener('pointerdown',down);viewport.addEventListener('pointermove',move);
 viewport.addEventListener('pointerup',up);viewport.addEventListener('pointercancel',up);viewport.addEventListener('lostpointercapture',lost);viewport.addEventListener('dblclick',double);
 const observer=new ResizeObserver(refresh);observer.observe(viewport);refresh();
 function replace(node){
  release();image?.removeEventListener('load',refresh);content.replaceChildren(...(node?[node]:[]));
  image=node?.tagName==='IMG'?node:null;image?.addEventListener('load',refresh);state={scale:1,x:0,y:0};refresh();
 }
 return {
  replace,reset,
  zoomIn(){zoom(state.scale*1.5);},zoomOut(){zoom(state.scale/1.5);},
  close(){replace(null);},
  destroy(){release();image?.removeEventListener('load',refresh);observer.disconnect();viewport.removeEventListener('wheel',wheel);viewport.removeEventListener('pointerdown',down);viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',up);viewport.removeEventListener('pointercancel',up);viewport.removeEventListener('lostpointercapture',lost);viewport.removeEventListener('dblclick',double);content.remove();},
 };
}
