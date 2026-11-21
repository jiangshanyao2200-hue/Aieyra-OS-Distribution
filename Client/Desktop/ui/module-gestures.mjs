// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupModuleGestures
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/module-gestures.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Pointer capture keeps a press attached to its entry during hover expansion.
// Movement starts a drag immediately; release is the sole commit point.
export function setupModuleGestures({entries,detach,save,preview,onError=()=>{},doc=document,delay=320}){
 const win=doc.defaultView,ids=entries.map(([id])=>id),tabs=new Map(entries),hosts=new Map(entries.map(([id,tab])=>[id,['browser','settings'].includes(id)?tab.parentElement||tab:tab]));
 const raf=fn=>win.requestAnimationFrame?win.requestAnimationFrame(fn):setTimeout(fn,16),caf=id=>win.cancelAnimationFrame?win.cancelAnimationFrame(id):clearTimeout(id);
 let order=[...ids],gesture=null,timer=null,frame=0,suppressUntil=0,closed=false,serial=0;const animations=new Map();
 function paint(animate=false){
  const before=animate?new Map([...hosts].map(([id,n])=>[id,n.getBoundingClientRect?.().left])):null;
  // Preserve the current visual origin, then measure the new layout without
  // composing a previous FLIP translation into the next animation.
  if(before){for(const a of animations.values())a.cancel();animations.clear();}
  for(const [id,host]of hosts)if(host?.style)host.style.order=String(order.indexOf(id)+1);
  if(!before||win.matchMedia?.('(prefers-reduced-motion: reduce)').matches||doc.body.classList.contains('reduce-motion'))return;
  for(const [id,host]of hosts){const dx=before.get(id)-host.getBoundingClientRect?.().left;if(!Number.isFinite(dx)||Math.abs(dx)<1||!host.animate)continue;animations.get(id)?.cancel();const a=host.animate([{transform:`translateX(${dx}px)`},{transform:'translateX(0)'}],{duration:160,easing:'cubic-bezier(.2,.8,.2,1)'});animations.set(id,a);a.onfinish=()=>{if(animations.get(id)===a)animations.delete(id);};}
 }
 function layoutRect(id){
  const rect=tabs.get(id).getBoundingClientRect(),host=hosts.get(id);
  if(!animations.has(id)||!win.DOMMatrixReadOnly||!win.getComputedStyle)return rect;
  const matrix=new win.DOMMatrixReadOnly(win.getComputedStyle(host).transform);
  return {left:rect.left-matrix.m41,right:(rect.right??rect.left+rect.width)-matrix.m41,top:rect.top-matrix.m42,bottom:rect.bottom-matrix.m42,width:rect.width,height:rect.height};
 }
 function accept(value){if(gesture||!Array.isArray(value))return;order=['home',...new Set([...value,...ids].filter(id=>id!=='home'&&ids.includes(id)))].filter(id=>ids.includes(id));paint();}
 function feedback(g,action){if(typeof preview==='function')void Promise.resolve(preview({action,id:g.token,module:g.id,x:g.screenX,y:g.screenY,out:g.out})).catch(()=>{});}
 function start(g){if(g.armed||g.id==='home')return;g.armed=true;clearTimeout(timer);g.tab.classList.add('module-dragging');doc.body.classList.add('module-dragging');g.tab.setAttribute('aria-grabbed','true');feedback(g,'begin');}
 function cleanup(commit=false){
  clearTimeout(timer);timer=null;if(frame)caf(frame);frame=0;const g=gesture;gesture=null;if(!g)return;
  if(g.armed){feedback(g,'end');suppressUntil=Date.now()+500;}
  g.tab.classList.remove('module-dragging','module-drag-out');doc.body.classList.remove('module-dragging');
  // The common tooltip absorbs title. A click must leave its current label
  // alone; only restore feedback actually written by this drag.
  if(g.feedback&&g.tab.dataset.tip===g.feedback){if(g.tip)g.tab.dataset.tip=g.tip;else delete g.tab.dataset.tip;}
  g.tab.removeAttribute?.('aria-grabbed');
  try{g.tab.releasePointerCapture(g.pointer);}catch{}
  if(!commit){order=g.original;paint(true);}
 }
 function update(g){
  // Animation is feedback, not a moving hit boundary. During a reorder its
  // visual union can briefly shrink enough to misclassify a return as detach.
  const shown=tab=>!tab.hidden&&!tab.hasAttribute?.('data-unpinned');
  const rects=entries.filter(([,tab])=>shown(tab)).map(([id])=>layoutRect(id));
  const left=Math.min(...rects.map(r=>r.left)),right=Math.max(...rects.map(r=>r.right??r.left+r.width)),top=Math.min(...rects.map(r=>r.top)),bottom=Math.max(...rects.map(r=>r.bottom));
  g.out=g.y<top-24||g.y>bottom+32||g.x<left-24||g.x>right+48;
  g.tab.classList.toggle('module-drag-out',g.out);g.feedback=g.out?'松开以独立打开；Esc 取消':'松开落位；拖离顶栏可独立打开';g.tab.dataset.tip=g.feedback;
  if(!g.out){
   const candidates=order.filter(id=>id!=='home'&&id!==g.id&&tabs.get(id)&&shown(tabs.get(id))),at=candidates.find(id=>{const r=layoutRect(id);return g.x<r.left+r.width/2;});
   const next=order.filter(id=>id!==g.id);const index=at?next.indexOf(at):candidates.length?next.indexOf(candidates.at(-1))+1:next.length;next.splice(index,0,g.id);
   if(next.join()!==order.join()){order=next;paint(true);}
  }
  feedback(g,'move');
 }
 function move(e){const g=gesture;if(!g||g.pointer!==e.pointerId||e.type==='pointermove'&&e.buttons!==undefined&&(e.buttons&1)===0)return;
  Object.assign(g,{x:e.clientX,y:e.clientY,screenX:e.screenX,screenY:e.screenY});
  if(Math.hypot(g.x-g.startX,g.y-g.startY)>6){g.moved=true;if(!g.armed)start(g);}
  if(!g.armed)return;e.preventDefault();if(!frame)frame=raf(()=>{frame=0;if(gesture===g)update(g);});
 }
 function up(e){const g=gesture;if(!g||g.pointer!==e.pointerId)return;
  if(!g.armed||!g.moved&&Math.hypot(e.clientX-g.startX,e.clientY-g.startY)<=6){g.armed&&feedback(g,'end');g.armed=false;cleanup();return;}
  Object.assign(g,{x:e.clientX,y:e.clientY,screenX:e.screenX,screenY:e.screenY});update(g);const out=g.out,next=[...order];cleanup(true);e.preventDefault();e.stopPropagation();
  if(out){order=g.original;paint(true);void Promise.resolve(detach(g.id,{x:e.screenX,y:e.screenY})).catch(error=>onError(error.message));}
  else if(next.join()!==g.original.join())void Promise.resolve(save(next)).then(value=>accept(value?.order||next)).catch(error=>{order=g.original;paint(true);onError(error.message);});
 }
 const cancel=()=>cleanup(),key=e=>{if(e.key==='Escape'&&gesture){e.preventDefault();e.stopPropagation();cancel();}},unbind=[];
 for(const [id,tab]of entries){tab.style?.setProperty('touch-action','none');
  const down=e=>{if(closed||tab.hidden||e.button!==0||e.isPrimary===false||gesture)return;suppressUntil=0;const g=gesture={id,tab,token:++serial,pointer:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,screenX:e.screenX,screenY:e.screenY,original:[...order],tip:tab.dataset.tip||tab.title,armed:false,out:false};try{tab.setPointerCapture(e.pointerId);}catch{}if(id!=='home')timer=setTimeout(()=>{if(gesture===g)start(g);},delay);};
  const click=e=>{if(Date.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}};
  for(const [name,fn,capture]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['lostpointercapture',cancel],['click',click,true]]){tab.addEventListener(name,fn,capture);unbind.push(()=>tab.removeEventListener(name,fn,capture));}
 }
 doc.addEventListener('keydown',key,true);win.addEventListener?.('blur',cancel);paint();
 return {accept,close(){closed=true;cancel();for(const a of animations.values())a.cancel();animations.clear();unbind.forEach(fn=>fn());doc.removeEventListener('keydown',key,true);win.removeEventListener?.('blur',cancel);}};
}
