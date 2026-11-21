// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: CATEGORIES; SORTS; ICONS; el; button; checked; CATALOGUE_TTL; cachedCatalogue; byline; createThemeSelection; mountThemeLibrary; pickTheme
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/theme-library.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {createRoleRing} from './role-identity.mjs';
import {tabKeyboard,bindDialog} from './interaction.mjs';
import {createCatalogue,pageCapacity,pageNumbers,PAGE_WINDOW} from './theme-library-pagination.mjs';
import {createThemeViewport} from './theme-library-viewer.mjs';

const CATEGORIES=[['background','背景'],['avatar','头像'],['ui','UI'],['halo','光圈']];
const SORTS=[['recommended','推荐'],['hot','热门'],['latest','最新'],['pending','待审核']];
const ICONS={background:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 17 5-5 4 4 3-3 4 4"/><circle cx="15" cy="9" r="1"/>',avatar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M6 19v-1a6 6 0 0 1 12 0v1"/>',ui:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M9 9v11"/>',halo:'<circle cx="12" cy="12" r="5"/><path d="M12 2a10 10 0 0 1 10 10M12 22A10 10 0 0 1 2 12"/>'};
const el=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn,cls='theme-button ui-outline')=>{const n=el('button',cls,text);n.type='button';n.onclick=fn;return n;};
const checked=async promise=>{const r=await promise;if(r?.ok===false)throw Error(r.error||'操作没有完成');return r;};
// Catalogues already read stay reusable for this run (per host call, category, sort and query), so
// re-entering the page or the avatar picker paints the same records and full page numbers at once.
const CATALOGUE_TTL=10*60*1000,catalogueCache=new WeakMap();
function cachedCatalogue(call,key,make,fresh){
 let byCall=catalogueCache.get(call);if(!byCall){byCall=new Map();catalogueCache.set(call,byCall);}
 const hit=byCall.get(key);if(!fresh&&hit&&Date.now()-hit.at<CATALOGUE_TTL)return hit;
 const entry={at:Date.now(),catalogue:make(),changes:new Map()};byCall.set(key,entry);if(byCall.size>16)byCall.delete(byCall.keys().next().value);return entry;
}
const byline=item=>'By '+(item.official?'Aieyra OS':item.author.name);

export function createThemeSelection({select,isCurrent,onBusy,onSuccess,onError}){
 let busy=false;
 return {get busy(){return busy;},async choose(item,context){
  if(busy||!isCurrent(context))return false;
  busy=true;onBusy();
  try{const value=await select(item);if(isCurrent(context))onSuccess(context,value);return true;}
  catch(error){if(isCurrent(context))onError(error,context);return false;}
  finally{busy=false;onBusy();}
 }};
}

// Both the page and the personal-settings picker use this same browser.
export function mountThemeLibrary(host,{call,category:initial='background',locked=false,onSelect=null,onSelected=null,selectLabel='应用',notice=()=>{}}={}){
 let category=initial,sort='recommended',query='',pageIndex=0,generation=0,closed=false,visible=true,searchTimer=0,loading=false;
 let catalogue,items=[],pageState={index:0,offset:0,hasNext:false,knownPages:1,total:null},selected=-1,viewerGeneration=0,viewerBusy=false,pendingCapacity=0;
 let changes=new Map(),numbersReady=false;const observerTargets=new Map();let imageQueue=[],imageRunning=0;
 host.classList.add('theme-library');host.dataset.visible='true';
 const rail=el('nav','theme-rail'),main=el('section','theme-content'),toolbar=el('div','theme-toolbar'),sorts=el('nav','theme-sorts'),search=el('input','theme-search ui-outline'),tools=el('div','theme-toolbar-actions');
 const grid=el('div','theme-grid'),status=el('p','theme-status'),pager=el('nav','theme-pages ui-pages'),numbers=el('span','theme-page-numbers ui-page-numbers'),jump=el('input','theme-page-jump ui-outline');
 let retryIndex=0;const retryList=button('重新载入',()=>void load(retryIndex),'theme-button ui-outline theme-list-retry');retryList.hidden=true;
 const prev=button('上一页',()=>void turn(pageIndex-1)),next=button('下一页',()=>void turn(pageIndex+1));
 rail.setAttribute('aria-label','主题分类');sorts.setAttribute('aria-label','主题排序');pager.setAttribute('aria-label','主题翻页');status.setAttribute('role','status');
 search.type='search';search.placeholder='搜索作品或作者';search.setAttribute('aria-label','搜索主题');
 jump.type='number';jump.min='1';jump.setAttribute('aria-label','跳到第几页');
 const jumpButton=button('跳转',()=>{if(jump.reportValidity()&&jump.value)void turn(Number(jump.value)-1);});
 jump.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();jumpButton.click();}});
 const refresh=button('刷新',()=>reset(true));refresh.setAttribute('aria-label','刷新主题');tools.append(search,refresh);
 toolbar.append(sorts,tools);pager.append(prev,numbers,next,jump,jumpButton);main.append(toolbar,grid,status,retryList,pager);host.replaceChildren(...(locked?[]:[rail]),main);if(locked)host.classList.add('theme-library-picker');
 const viewer=el('dialog','theme-viewer'),viewerTitle=el('h2'),viewerAuthor=el('span','theme-author'),viewerHead=el('header'),viewerCaption=el('div'),picture=el('div','theme-large'),viewerFooter=el('footer'),viewerStatus=el('span','theme-status');
 const closeButton=button('关闭',()=>viewer.close()),left=button('‹',()=>void browse(-1),'theme-arrow theme-arrow-left'),right=button('›',()=>void browse(1),'theme-arrow theme-arrow-right');
 left.setAttribute('aria-label','上一张');right.setAttribute('aria-label','下一张');viewerTitle.id='theme-viewer-'+Math.random().toString(36).slice(2);viewer.setAttribute('aria-labelledby',viewerTitle.id);
 const viewport=createThemeViewport(picture),viewerTools=el('div','theme-viewer-tools');
 const zoomOut=button('−',()=>viewport.zoomOut()),zoomIn=button('+',()=>viewport.zoomIn()),restore=button('还原',()=>viewport.reset());
 zoomOut.setAttribute('aria-label','缩小预览');zoomIn.setAttribute('aria-label','放大预览');restore.setAttribute('aria-label','还原视图');
 viewerTools.append(zoomOut,zoomIn,restore,closeButton);viewerCaption.append(viewerTitle,viewerAuthor);viewerHead.append(viewerCaption,viewerTools);viewer.append(picture,viewerHead,left,right,viewerFooter);host.append(viewer);
 viewer.addEventListener('close',()=>{viewerGeneration++;selected=-1;viewport.close();if(pendingCapacity){const capacity=pendingCapacity;pendingCapacity=0;resizePages(capacity);}});
 viewer.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select'))return;if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();void browse(event.key==='ArrowLeft'?-1:1);}else if(['+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='0')viewport.reset();else if(event.key==='-')viewport.zoomOut();else viewport.zoomIn();}});
 const invoke=p=>checked(call(p));
 const error=message=>{status.textContent=message;status.hidden=false;notice(message,true);};
 const clearError=()=>{status.textContent='';status.hidden=true;retryList.hidden=true;notice('');};
 const current=item=>changes.get(item.id+':'+item.digest)||item;
 const selection=createThemeSelection({
  select:item=>onSelect(item),
  isCurrent:context=>!closed&&(context.viewer?viewer.open&&context.stamp===viewerGeneration:context.stamp===generation),
  onBusy:()=>{if(!closed)for(const b of host.querySelectorAll('.theme-select-avatar,.theme-primary'))b.disabled=selection.busy;},
  onSuccess:(context,value)=>{if(context.viewer)viewer.close();onSelected?.(value);},
  onError:(e,context)=>{if(context.viewer)viewerStatus.textContent=e.message;else error(e.message);},
 });
 function segments(root,values,value,pick){root.replaceChildren(...values.map(([id,label])=>{const b=button(label,()=>pick(id));b.setAttribute('role','tab');b.setAttribute('aria-selected',String(id===value));b.tabIndex=id===value?0:-1;return b;}));}
 tabKeyboard(sorts);
 function paintRail(){rail.replaceChildren(...CATEGORIES.map(([id,label])=>{const b=button('',()=>{if(category!==id){category=id;reset();}},'theme-category ui-rail-button'),icon=el('i','ui-rail-icon');icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS[id]+'</svg>';b.append(icon,el('span','ui-rail-label',label));b.setAttribute('aria-current',category===id?'page':'false');return b;}));}
 function syncPages(){
  prev.disabled=loading||pageIndex===0;next.disabled=loading||!pageState.hasNext;jump.disabled=jumpButton.disabled=loading;
  const count=pageState.total===null?pageState.knownPages:Math.max(1,Math.ceil(pageState.total/catalogue.size));
  numbers.replaceChildren(...pageNumbers(pageIndex+1,count).map(value=>{
   const b=button(String(value),()=>void turn(value-1));b.classList.add('ui-page-number');b.setAttribute('aria-label','第 '+value+' 页');if(value===pageIndex+1)b.setAttribute('aria-current','page');b.disabled=loading;return b;
  }));
  if(pageState.total===null)jump.removeAttribute('max');else jump.max=String(count);jump.placeholder=String(pageIndex+1);
  pager.hidden=!items.length&&!pageIndex&&!loading;pager.dataset.pending=String(!numbersReady);
 }
 async function pictureImage(item,variants,isCurrent,alt=''){
  let failure;
  for(const variant of variants){
   if(!isCurrent())throw Error('预览已关闭');
   try{
    const result=await invoke({action:'image',id:item.id,digest:item.digest,variant});if(!isCurrent())throw Error('预览已关闭');
    const img=el('img');img.alt=alt;img.decoding='async';img.draggable=false;
    await new Promise((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error('图片无法显示'));img.src=result.src;});
    img.onload=img.onerror=null;if(isCurrent())return img;throw Error('预览已关闭');
   }catch(error){failure=error;}
  }
  throw failure;
 }
 function queueImage(job){
  if(job.busy||job.queued||closed||job.stamp!==generation)return;
  job.queued=true;job.node.dataset.state='loading';job.node.replaceChildren(el('span','theme-image-empty','正在加载预览…'));imageQueue.push(job);void drain();
 }
 async function drain(){
  if(closed||!visible)return;
  while(imageQueue.length&&imageRunning<4){const job=imageQueue.shift();if(job.stamp!==generation||!job.node.isConnected)continue;imageRunning++;
   job.queued=false;job.busy=true;delete job.node.dataset.tip;job.open.onclick=job.show;job.open.setAttribute('aria-label','查看 '+job.item.title);
   const isCurrent=()=>!closed&&job.stamp===generation&&job.node.isConnected;
   void pictureImage(job.item,job.item.bundled||job.item.preview?['preview','image']:['image'],isCurrent).then(img=>{if(isCurrent()){job.node.dataset.state='ready';job.node.replaceChildren(img);}}).catch(error=>previewFailed(job,error)).finally(()=>{job.busy=false;imageRunning--;void drain();});
  }
 }
 const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const job=observerTargets.get(entry.target);if(!job)continue;observer.unobserve(entry.target);observerTargets.delete(entry.target);queueImage(job);}},{root:main,rootMargin:'120px'});
 function previewFailed(job,error){
  if(closed||job.stamp!==generation||!job.node.isConnected)return;
  const message=el('span','theme-image-empty');message.append(el('span','','预览暂不可用'),el('span','theme-retry-label','重试'));
  job.node.dataset.state='error';job.node.replaceChildren(message);job.node.dataset.tip=error.message;
  job.open.setAttribute('aria-label','重试 '+job.item.title+' 的预览');job.open.onclick=()=>queueImage(job);
 }
 function watchImage(node,item,open,show){if(!item.bundled&&!item.preview&&!item.image){node.append(el('span','theme-image-empty','尚未提供预览'));return;}node.dataset.state='loading';node.append(el('span','theme-image-empty','正在加载预览…'));observerTargets.set(node,{node,item,open,show,stamp:generation});observer.observe(node);}
 function like(item){
  const b=button('',async()=>{
   if(b.disabled)return;b.disabled=true;const stamp=generation;
   try{const updated=(await invoke({action:'like',id:item.id,digest:item.digest,liked:!current(item).liked})).item;if(closed||stamp!==generation)return;if(updated?.id!==item.id||updated?.digest!==item.digest)throw Error('主题已变化，请重新载入');changes.set(updated.id+':'+updated.digest,updated);syncLikes(updated);clearError();}
   catch(e){if(stamp===generation)error(e.message);}finally{b.disabled=false;}
  },'theme-like');
  b.dataset.id=item.id;b.dataset.digest=item.digest;b.append(el('span','theme-heart','♡'),el('span','theme-like-label','点赞'),el('span','theme-like-count'));updateLike(b,current(item));return b;
 }
 function updateLike(b,item){b.setAttribute('aria-label',(item.liked?'取消点赞 ':'点赞 ')+item.title);b.setAttribute('aria-pressed',String(item.liked));b.querySelector('.theme-heart').textContent=item.liked?'♥':'♡';b.querySelector('.theme-like-count').textContent=String(item.likes);}
 function syncLikes(item){
  for(const b of host.querySelectorAll('.theme-like'))if(b.dataset.id===item.id&&b.dataset.digest===item.digest){
   updateLike(b,item);const card=b.closest('.theme-card'),review=card?.querySelector('.theme-review');
   if(review){if(item.status==='approved')review.remove();else review.textContent=Math.min(3,item.likes)+' / 3 · 公审中';}
   if(card)syncAvatarSelection(card,item);
  }
  syncViewerSelection(item);
 }
 function syncAvatarSelection(card,item){
  if(!locked||!onSelect||category!=='avatar'||item.category!=='avatar'||item.status!=='approved'||card.querySelector('.theme-select-avatar'))return;
 const stamp=generation,select=button('选择头像',()=>void selection.choose(current(item),{stamp,viewer:false}),'theme-button ui-outline theme-select-avatar');
  select.disabled=selection.busy;select.setAttribute('aria-label','选择头像 '+item.title);card.append(select);
 }
 function syncViewerSelection(item){
  if(!viewer.open||viewer.dataset.id!==item.id||viewer.dataset.digest!==item.digest||!onSelect||item.category!=='background'||item.status!=='approved'||viewerFooter.querySelector('.theme-primary'))return;
 const stamp=viewerGeneration,use=button(selectLabel,()=>void selection.choose(current(item),{stamp,viewer:true}),'theme-button ui-outline theme-primary');
  use.disabled=selection.busy;viewerFooter.append(use);
 }
 function builtinVisual(item){
  const visual=el('div','theme-builtin'+(item.category==='ui'?' theme-ui-preview':''));
  const ring=createRoleRing({role:'matrix',name:item.title,avatar:'',glyph:'',ring:item.effect||'pulse'},{state:'thinking'});
  if(item.category==='halo')visual.append(ring);
  else{
   const top=el('div','theme-ui-bar','Aieyra OS'),body=el('div','theme-ui-body');
   body.append(ring,el('span','theme-ui-message','Eyra'),el('div','theme-ui-input','把想法交给 Eyra'));visual.append(top,body);
  }
  return visual;
 }
 function card(raw,index){
  const item=current(raw),card=el('article','theme-card'),open=button('',()=>void show(index),'theme-card-open'),visual=el('span','theme-picture'),caption=el('div','theme-caption'),words=el('div');
  open.setAttribute('aria-label','查看 '+item.title);if(item.local)open.append(builtinVisual(item));else{open.append(visual);watchImage(visual,item,open,()=>void show(index));}
  const author=el('span','theme-author',byline(item));author.title=byline(item);
  const title=button(item.title,()=>void show(index),'theme-title');title.title=item.title;words.append(title,author);
  if(category==='avatar'){
   const by=el('div','theme-byline');by.append(author,like(item));words.append(by);caption.append(words);
  }else caption.append(words,like(item));card.append(open,caption);
  syncAvatarSelection(card,item);
  if(item.status==='pending')card.append(el('span','theme-review',Math.min(3,item.likes)+' / 3 · 公审中'));
  return card;
 }
 function paintGrid(){
  observer.disconnect();observerTargets.clear();imageQueue=[];grid.dataset.category=category;grid.replaceChildren(...items.map(card));
  const placeholder=pageState.stale?'当前显示已保存的主题':category==='ui'&&items.length?'更多 UI 主题正在准备中。':'';
  status.hidden=!!items.length&&!placeholder;status.textContent=placeholder||(items.length?'':query?'没有找到相关作品':'这里暂时没有资源');syncPages();
 }
 async function load(index=0){
  if(index<0)return false;const stamp=generation;
  loading=true;grid.setAttribute('aria-busy','true');syncPages();retryList.hidden=true;status.hidden=!!items.length;if(!items.length)status.textContent='正在读取作品…';
  try{
   const result=await catalogue.seek(index,()=>!closed&&stamp===generation);if(!result||closed||stamp!==generation)return false;
   pageState=result;pageIndex=result.index;items=result.items;clearError();paintGrid();lookAhead(stamp);return true;
  }catch(e){if(!closed&&stamp===generation){error(e.message);retryIndex=index;retryList.hidden=false;}return false;}
  finally{if(stamp===generation){loading=false;grid.setAttribute('aria-busy','false');syncPages();if(pendingCapacity&&!viewer.open){const capacity=pendingCapacity;pendingCapacity=0;resizePages(capacity);}}}
 }
 // Number a full window of real pages: quietly read ahead (cached per cursor) so 1–10 are jumpable.
 function lookAhead(stamp){
  const target=Math.max(PAGE_WINDOW,pageIndex+1+Math.ceil(PAGE_WINDOW/2))-1,owner=catalogue;
  const ready=()=>{if(stamp!==generation||owner!==catalogue)return;numbersReady=true;syncPages();};
  if(pageState.total!==null||pageState.knownPages>target){ready();return;}
  // Page numbers appear once, after the window is known; they never flash a shorter set first.
  owner.prefetch(target,()=>!closed&&stamp===generation&&owner===catalogue).then(done=>{if(!done||closed||stamp!==generation||owner!==catalogue)return;const next=owner.snapshot(pageIndex);pageState={...pageState,hasNext:next.hasNext,knownPages:next.knownPages,total:next.total};}).catch(()=>{}).finally(()=>{if(!closed)ready();});
 }
 async function turn(index){if(loading)return;if(viewer.open)viewer.close();if(await load(index)){main.scrollTop=0;jump.value='';}}
 function reset(fresh=false){
  generation++;clearError();pendingCapacity=0;items=[];pageIndex=0;loading=false;numbersReady=false;observer.disconnect();observerTargets.clear();imageQueue=[];if(viewer.open)viewer.close();grid.replaceChildren();paintRail();
  const selectedCategory=category,selectedSort=sort,selectedQuery=query;
  const capacity=pageCapacity(category,grid.clientWidth),entry=cachedCatalogue(call,JSON.stringify([selectedCategory,selectedSort,selectedQuery]),()=>createCatalogue(cursor=>invoke({action:'list',category:selectedCategory,sort:selectedSort,q:selectedQuery,cursor,...(fresh?{refresh:true}:{})}),capacity),fresh);
  catalogue=entry.catalogue;changes=entry.changes;if(catalogue.size!==capacity)catalogue.resize(capacity);pageState=catalogue.snapshot(0);
  const sorting=sorts.contains(document.activeElement);
  toolbar.hidden=false;segments(sorts,SORTS,sort,id=>{if(sort!==id){sort=id;reset();}});
  if(sorting)sorts.querySelector('[aria-selected=true]')?.focus({preventScroll:true});
  void load();
 }
 async function show(index){
  if(!items[index])return;selected=index;const stamp=++viewerGeneration,item=current(items[index]);viewerTitle.textContent=item.title;viewerAuthor.textContent=byline(item);
  viewer.dataset.id=item.id;viewer.dataset.digest=item.digest;picture.dataset.category=viewer.dataset.category=item.category;picture.setAttribute('aria-busy','true');viewport.replace(el('span','theme-image-empty','正在载入高清预览…'));viewerStatus.textContent='';
  left.disabled=index===0&&pageIndex===0;right.disabled=index===items.length-1&&!pageState.hasNext;
  viewerFooter.replaceChildren(like(item),viewerStatus);if(!viewer.open)viewer.showModal();syncViewerSelection(item);
  const isCurrent=()=>!closed&&stamp===viewerGeneration&&viewer.open;
  try{const content=item.local?builtinVisual(item):await pictureImage(item,['image'],isCurrent,item.title);if(isCurrent())viewport.replace(content);}
  catch(e){if(isCurrent()){const recovery=el('div','theme-image-recovery');recovery.append(el('span','theme-image-empty','高清预览暂不可用'),el('span','theme-image-reason',e.message),button('重新载入',()=>void show(selected)));viewport.replace(recovery);}}
  finally{if(isCurrent())picture.setAttribute('aria-busy','false');}
 }
 async function browse(direction){
  if(viewerBusy||loading||selected<0)return;const index=selected+direction;
  if(index>=0&&index<items.length)return show(index);
  if(direction<0&&pageIndex===0||direction>0&&!pageState.hasNext)return;
  viewerBusy=true;const stamp=viewerGeneration;
  try{if(await load(pageIndex+direction)&&stamp===viewerGeneration&&viewer.open)void show(direction>0?0:items.length-1);}finally{viewerBusy=false;}
 }
 function resizePages(capacity){
  if(closed||!visible||!grid.clientWidth||!catalogue)return;
  pendingCapacity=capacity===catalogue.size?0:capacity;
  if(!pendingCapacity||viewer.open||loading)return;
  pendingCapacity=0;
  const anchor=pageState.offset;catalogue.resize(capacity);void load(Math.floor(anchor/capacity));
 }
 const gridObserver=new ResizeObserver(()=>resizePages(pageCapacity(category,grid.clientWidth)));gridObserver.observe(grid);
 search.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{query=search.value.trim();reset();},250);};reset();
 return {refresh:()=>reset(),accountChanged(){catalogueCache.delete(call);reset(true);},visibility(value){visible=value===true;host.dataset.visible=String(visible);if(!visible&&viewer.open)viewer.close();if(visible){void drain();resizePages(pageCapacity(category,grid.clientWidth));}},close(){closed=true;generation++;viewerGeneration++;pendingCapacity=0;clearTimeout(searchTimer);observer.disconnect();gridObserver.disconnect();imageQueue=[];if(viewer.open)viewer.close();viewport.destroy();viewer.remove();}};
}

export function pickTheme(api,{target='avatar'}={}){return new Promise(resolve=>{
 const category=target==='background'?'background':'avatar',dialog=el('dialog','theme-picker'),head=el('header','theme-picker-head'),body=el('div','theme-picker-body');let browser,settled=false,visibilityObserver;
 let life;const finish=value=>{if(settled)return;settled=true;visibilityObserver?.disconnect();document.removeEventListener('visibilitychange',visibility);browser?.close();life?.destroy();dialog.close();dialog.remove();resolve(value);};
 head.append(el('strong','',category==='background'?'背景':'头像'),button('关闭',()=>finish(null)));dialog.append(head,body);document.body.append(dialog);
 const visibility=()=>{if(document.hidden||document.body.dataset.visible==='false')finish(null);};
 document.addEventListener('visibilitychange',visibility);visibilityObserver=new MutationObserver(visibility);visibilityObserver.observe(document.body,{attributes:true,attributeFilter:['data-visible']});
 life=bindDialog(dialog,{onClose:()=>finish(null)});life.show();
 browser=mountThemeLibrary(body,{category,locked:true,call:p=>api.themeLibrary(p),onSelect:item=>checked(api.themeLibrary({action:'prepare',target,id:item.id,digest:item.digest})),onSelected:finish});
});}
