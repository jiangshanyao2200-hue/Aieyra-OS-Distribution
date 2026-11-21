// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: button; setupImageViewer
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/image-viewer.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {bindThemeRenderer} from '../../../Theme/runtime/layout.mjs';
const button=(text,action,className='quiet')=>{const b=document.createElement('button');b.type='button';b.className=className;b.textContent=text;b.onclick=action;return b;};
export function setupImageViewer({call,attachItems,editImage,reveal,beforeOpen,onError}){
 const $=id=>document.getElementById(id);let actionBusy=false,releaseTheme=null;
 const controls=()=>{const focused=document.activeElement;for(const id of ['image-viewer-edit','image-viewer-add','image-viewer-reveal'])$(id).disabled=actionBusy||!dimensions;viewer.setAttribute('aria-busy',String(actionBusy));if(viewer.open&&viewer.contains(focused)&&focused.disabled)viewport.focus({preventScroll:true});};
 const action=fn=>async()=>{if(actionBusy||!dimensions||!viewer.open)return;const item=viewed[position];actionBusy=true;controls();try{await fn(item);}catch(e){onError(e.message);}finally{actionBusy=false;controls();}};
 const viewer=document.createElement('dialog');viewer.id='image-viewer';viewer.className='image-viewer';
 viewer.innerHTML='<header class="image-viewer-head"><div><strong id="image-viewer-title"></strong><small id="image-viewer-meta"></small></div><button type="button" id="image-viewer-edit" class="quiet">编辑图片</button><button type="button" id="image-viewer-add" class="quiet">引用</button><button type="button" id="image-viewer-reveal" class="quiet" title="在文件夹中显示">定位</button><button type="button" id="image-viewer-close" class="quiet ui-icon-button" aria-label="关闭图片查看器"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></header><div id="image-viewport" class="image-viewport" tabindex="0" aria-label="图片，滚轮缩放，拖动平移"><img id="image-full" alt="" draggable="false"><p id="image-viewer-status" role="status"></p></div><footer class="image-viewer-foot"><button type="button" id="image-previous" class="quiet" aria-label="上一张图片">←</button><span id="image-position"></span><button type="button" id="image-next" class="quiet" aria-label="下一张图片">→</button><span class="image-viewer-spacer"></span><button type="button" id="image-zoom-out" class="quiet" aria-label="缩小">−</button><span id="image-zoom" aria-live="polite">适应</span><button type="button" id="image-zoom-in" class="quiet" aria-label="放大">+</button><button type="button" id="image-fit" class="quiet">适应</button><button type="button" id="image-original" class="quiet">原始比例</button></footer>';
 viewer.dataset.contentSchema='aieyra.content.image/1';document.body.append(viewer);const viewport=$('image-viewport'),full=$('image-full');
 let viewed=[],position=0,viewRequest=0,scale=1,dx=0,dy=0,drag=null,dimensions=null,returnFocus=null;
 function transform(){full.style.transform=`translate(${dx}px,${dy}px) scale(${scale})`;$('image-zoom').textContent=Math.round(scale*100)+'%';}
 function fit(){scale=1;dx=dy=0;transform();$('image-zoom').textContent='适应';}
 function zoom(factor){if(!dimensions)return;scale=Math.max(.15,Math.min(12,scale*factor));transform();}
 function closeViewer(){releaseTheme?.();releaseTheme=null;viewer.dataset.viewToken=String(++viewRequest);viewer.close();full.removeAttribute('src');full.style.transform='';dimensions=null;viewed=[];drag=null;viewport.classList.remove('dragging');if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
 async function show(items,index=0){if(!items.length)return;viewed=items.slice();position=Math.max(0,Math.min(index,viewed.length-1));returnFocus=document.activeElement;beforeOpen?.();if(!viewer.open){releaseTheme=bindThemeRenderer(viewer,'aieyra.content.image/1',{heading:viewer.querySelector('.image-viewer-head'),content:viewport,controls:viewer.querySelector('.image-viewer-foot')});viewer.showModal();}viewport.focus({preventScroll:true});await loadView();}
 async function loadView(){const own=++viewRequest,item=viewed[position];viewer.dataset.viewToken=String(own);dimensions=null;controls();full.removeAttribute('src');full.alt=item.name||'图片';fit();$('image-viewer-title').textContent=item.name||'图片';$('image-viewer-meta').textContent='';$('image-viewer-status').textContent='正在打开…';$('image-position').textContent=(position+1)+' / '+viewed.length;$('image-previous').disabled=position===0;$('image-next').disabled=position===viewed.length-1;$('image-viewer-add').hidden=!attachItems||!!item.image&&!item.id&&!item.asset;$('image-viewer-reveal').hidden=!item.id;$('image-viewer-edit').hidden=!editImage||$('image-viewer-add').hidden;
  const focused=document.activeElement;if(viewer.open&&(!viewer.contains(focused)||focused.disabled||focused.hidden))viewport.focus({preventScroll:true});
  try{const r=item.image||await call(item.asset?{action:'attachment',attachment:item,size:8192}:{action:'preview',id:item.id,size:8192});if(own!==viewRequest||!viewer.open)return;full.src=r.data;await full.decode();if(own!==viewRequest||!viewer.open)return;dimensions=r;controls();$('image-viewer-meta').textContent=r.width+' × '+r.height+(item.model?' · '+item.model:'');$('image-viewer-status').textContent='';}
  catch(e){if(own===viewRequest&&viewer.open){$('image-viewer-status').textContent=e.message;const retry=button('重试',()=>loadView(),'quiet');$('image-viewer-status').append(' ',retry);}}
 }
 $('image-viewer-close').onclick=closeViewer;viewer.addEventListener('cancel',e=>{e.preventDefault();e.stopPropagation();closeViewer();});
 const next=delta=>{const p=position+delta;if(p<0||p>=viewed.length)return;position=p;void loadView();};
 $('image-previous').onclick=()=>next(-1);$('image-next').onclick=()=>next(1);$('image-zoom-in').onclick=()=>zoom(1.25);$('image-zoom-out').onclick=()=>zoom(.8);$('image-fit').onclick=fit;
 $('image-original').onclick=()=>{if(!dimensions)return;const rect=full.getBoundingClientRect();scale=dimensions.width/(rect.width/scale||dimensions.width);dx=dy=0;transform();};
 $('image-viewer-edit').onclick=action(item=>editImage?.(item));
 $('image-viewer-add').onclick=action(item=>attachItems([item]));$('image-viewer-reveal').onclick=action(item=>reveal?.(item));
 viewer.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229)return;if(['ArrowLeft','ArrowRight','+','=','-','0'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='ArrowLeft')next(-1);else if(e.key==='ArrowRight')next(1);else if(e.key==='0')fit();else zoom(e.key==='-'?.8:1.25);}});
 viewport.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.12:1/1.12);},{passive:false});viewport.ondblclick=fit;
 viewport.onpointerdown=e=>{if(e.button!==0||!dimensions)return;drag={x:e.clientX,y:e.clientY,dx,dy};viewport.setPointerCapture(e.pointerId);viewport.classList.add('dragging');};
 viewport.onpointermove=e=>{if(!drag)return;dx=drag.dx+e.clientX-drag.x;dy=drag.dy+e.clientY-drag.y;transform();};
 const endDrag=()=>{drag=null;viewport.classList.remove('dragging');};viewport.onpointerup=endDrag;viewport.onpointercancel=endDrag;viewport.onlostpointercapture=endDrag;
 return {viewer,show,close:closeViewer};
}
