// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ICON; check; DRAWING; el; iconButton; setupImageGallery
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/image-gallery.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupImageViewer} from './image-viewer.mjs';
import {hoverGlide} from './glide.mjs';
import {animateUI,motionAllowed,motionDuration,moveWorkspace} from './motion.mjs';
import {confirmDialog} from './contacts.mjs';
// The drawing album: it appears once image_gen has finished a picture and stays
// until the user leaves drawing. Opening it makes room on the right like the
// session sidebar does on the left. Right-click references images or whole
// folders into the message; folders keep references together.
const ICON={
 image:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="9.5" r="1.6"/><path d="m4 17 5-5 4 4 2.5-2.5 4 4"/></svg>',
 folder:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z"/></svg>',
 folderPlus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z"/><path d="M12 11v5M9.5 13.5h5"/></svg>',
 minimize:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
 ban:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><path d="m6.7 6.7 10.6 10.6"/></svg>',
 back:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
 check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-8.5"/></svg>',
 close:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};
const check=r=>{if(r?.ok===false)throw Error(r.error||'图片操作未完成');return r;};
const DRAWING='aieyra.drawing';
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
function iconButton(cls,label,icon){const b=el('button',cls);b.type='button';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=icon;return b;}

export function setupImageGallery(api,{navigation,attachments,openInput,onError}){
 const call=p=>Promise.resolve(api.imageLibrary(p)).then(check),body=document.body,rail=document.getElementById('status-rail');
 const report=e=>onError(String(e?.message||e));
 // ---------- Orb: shown only while there is drawing to look at ----------
 const orb=el('div','rail-orb image-orb');orb.id='image-orb';orb.hidden=true;
 orb.innerHTML='<button id="image-ball" type="button" class="plan-ball image-ball" aria-label="相册" title="相册" aria-controls="image-album" aria-expanded="false">'+ICON.image+'<b class="image-count" aria-hidden="true"></b></button>';
 (rail||body).append(orb);const ball=orb.querySelector('button');
 const stored=()=>{try{return JSON.parse(localStorage.getItem(DRAWING)||'{}')||{};}catch{return {};}};
 const remember=v=>{try{localStorage.setItem(DRAWING,JSON.stringify(v));}catch{}};

 // ---------- Panel ----------
 const panel=el('aside','image-album');panel.id='image-album';panel.hidden=true;panel.setAttribute('aria-label','相册');
 panel.innerHTML=`<header class="al-head"><button type="button" class="al-icon al-back" aria-label="返回相册" title="返回相册" hidden>${ICON.back}</button><div class="al-title"><b>相册</b><small></small></div>
 <button type="button" class="al-icon al-new" aria-label="新建文件夹" title="新建文件夹">${ICON.folderPlus}</button><button type="button" class="al-icon al-min" aria-label="最小化" title="最小化">${ICON.minimize}</button><button type="button" class="al-icon al-exit" aria-label="退出绘图" title="退出绘图">${ICON.ban}</button></header>
 <div class="al-scroll soft-scroll"><div class="al-grid" role="list" aria-label="图片"></div><p class="al-empty" hidden></p><button type="button" class="al-more" hidden>更多</button></div>
 <footer class="al-select" hidden><span></span><button type="button" class="al-act" data-act="quote">引用</button><button type="button" class="al-act" data-act="move">移到…</button><button type="button" class="al-icon al-clear" aria-label="取消选择" title="取消选择">${ICON.close}</button></footer>`;
 body.append(panel);
 const menu=el('div','al-menu');menu.hidden=true;menu.setAttribute('role','menu');body.append(menu);
 const q=s=>panel.querySelector(s),grid=q('.al-grid'),scroller=q('.al-scroll');
 const gridGlide=hoverGlide(grid,'.al-tile',{doc:document}),menuGlide=hoverGlide(menu,'.al-mi',{doc:document});
 const selected=new Set(),thumbs=new Map();
 let records=[],folders=[],folder='',next=null,request=0,isOpen=false,settle=0,active=false,latest='',signature='',seen=Number(stored().seen)||0,total=0,imageJobs=new Set(),task='';

 const {viewer,show,close:closeViewer}=setupImageViewer({call,attachItems:items=>quote(items),editImage:item=>quote([item],'请按这张图片修改：'),reveal:item=>call({action:'reveal',id:item.id}),beforeOpen:()=>{},onError});
 async function thumbnail(item){const key=item.id||item.sha256;if(thumbs.has(key))return thumbs.get(key);const r=await call(item.asset?{action:'attachment',attachment:item,size:256,thumbnail:true}:{action:'preview',id:item.id,size:320,thumbnail:true});if(thumbs.size>=120)thumbs.delete(thumbs.keys().next().value);thumbs.set(key,r);return r;}
 const observer=new IntersectionObserver(entries=>{for(const e of entries){if(!e.isIntersecting)continue;observer.unobserve(e.target);const node=e.target,id=node.dataset.cover||node.dataset.id;if(!id){node.classList.add('loaded');continue;}
  thumbnail({id}).then(r=>{if(node.isConnected){node.querySelector('img').src=r.data;node.classList.add('loaded');}}).catch(()=>{if(node.isConnected)node.classList.add('unavailable');});}},{root:scroller,rootMargin:'200px'});

 // ---------- Room on the right, like the sidebar on the left ----------
 const width=()=>Math.round(Math.min(440,Math.max(300,innerWidth*.3),innerWidth*.46));
 function setOpen(open){
  if(open===isOpen)return;isOpen=open;clearTimeout(settle);closeMenu();
  if(open&&navigation.current)navigation.home();
  if(open)panel.hidden=false;
  moveWorkspace(document,()=>{
  if(open){
   body.style.setProperty('--al-width',width()+'px');body.classList.add('al-geom');panel.hidden=false;body.style.setProperty('--al-push',width()+'px');
   seen=total;remember({...stored(),seen});paintCount();void refresh();
  }else body.style.setProperty('--al-push','0px');
  body.classList.toggle('album-open',open);
  });ball.setAttribute('aria-expanded',String(open));
  dispatchEvent(new Event('resize'));
  settle=setTimeout(()=>{if(!isOpen){body.classList.remove('al-geom');panel.hidden=true;}dispatchEvent(new Event('resize'));},motionAllowed(body)?motionDuration(body,'move')+40:0);
  if(open)requestAnimationFrame(()=>q('.al-min').focus({preventScroll:true}));
 }
 addEventListener('resize',event=>{if(isOpen&&event.isTrusted){body.style.setProperty('--al-width',width()+'px');body.style.setProperty('--al-push',width()+'px');}});
 ball.onclick=()=>{if(active)setOpen(!isOpen);};
 q('.al-min').onclick=()=>{setOpen(false);ball.focus({preventScroll:true});};
 // Leaving drawing folds everything away; the next finished picture brings it back.
 q('.al-exit').onclick=async()=>{
  const ok=await confirmDialog({doc:document,title:'退出绘图？',body:'相册会收起，图片仍然保留。之后需要让 Agent 再次唤醒才能继续绘图。',action:'退出'});
  if(!ok)return;remember({...stored(),exited:latest||new Date().toISOString(),seen:total});setOpen(false);setActive(false);
 };
 document.addEventListener('workspace-view-change',()=>{if(isOpen&&navigation.current)setOpen(false);});
 panel.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return;event.preventDefault();event.stopPropagation();
  if(!menu.hidden)closeMenu();else if(selected.size){selected.clear();paintSelection();}else if(folder)enter('');else{setOpen(false);ball.focus({preventScroll:true});}
 });

 // ---------- Drawing presence ----------
 function setActive(on){if(active===on)return;active=on;orb.hidden=!on;if(on)animateUI(orb,[{opacity:0,scale:.6},{opacity:1,scale:1}],{kind:'enter',key:'orb',easing:'cubic-bezier(.3,1.3,.5,1)'});}
 function paintCount(){const fresh=Math.max(0,total-seen);orb.querySelector('.image-count').textContent=isOpen||!fresh?'':String(fresh>99?'99+':fresh);ball.setAttribute('aria-label',fresh&&!isOpen?'相册，'+fresh+' 张新图片':'相册');}
 function presence(r){
  total=r.count||0;latest=r.generated_latest||'';const exited=stored().exited||'';
  // Shown once image_gen has produced something newer than the last exit; it never hides by itself.
  if(r.generated>0&&(!exited||latest>exited))setActive(true);
  paintCount();
 }

 // ---------- Grid ----------
 function folderTile(f){
  const n=el('div','al-tile al-folder');n.tabIndex=0;n.setAttribute('role','listitem');n.dataset.folder=f.id;if(f.cover)n.dataset.cover=f.cover;
  const art=el('span','al-art');art.append(el('img'));art.insertAdjacentHTML('beforeend','<span class="al-folder-mark">'+ICON.folder+'</span>');art.querySelector('img').alt='';art.querySelector('img').draggable=false;
  const label=el('span','al-label');label.append(el('b','',f.name),el('small','',f.count+' 张'));n.append(art,label);
  n.onclick=()=>enter(f.id);n.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();enter(f.id);}else if(e.key==='F2'){e.preventDefault();rename(n,f);}else walk(e);};
  n.oncontextmenu=e=>{e.preventDefault();openMenu(e.clientX,e.clientY,[['引用整个文件夹',()=>quoteFolder(f)],['打开',()=>enter(f.id)],['重命名',()=>rename(n,f)],['删除文件夹',()=>removeFolder(f),'danger']]);};
  // Images dropped on a folder move into it.
  n.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-aieyra-images')){e.preventDefault();n.dataset.drop='true';}};
  n.ondragleave=()=>{delete n.dataset.drop;};
  n.ondrop=e=>{e.preventDefault();delete n.dataset.drop;const ids=JSON.parse(e.dataTransfer.getData('application/x-aieyra-images')||'[]');if(ids.length)void moveTo(ids,f.id);};
  if(!f.cover)n.classList.add('loaded');else observer.observe(n);return n;
 }
 function imageTile(item){
  const n=el('div','al-tile al-image');n.tabIndex=0;n.setAttribute('role','listitem');n.dataset.id=item.id;n.draggable=true;n.title=item.name||'图片';
  const art=el('span','al-art'),img=el('img');img.alt='';img.draggable=false;art.append(img);
  const mark=iconButton('al-check','选择',ICON.check);mark.tabIndex=-1;mark.onclick=e=>{e.stopPropagation();toggle(item.id);};
  n.append(art,mark);
  n.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||selected.size){toggle(item.id);return;}void show(records,records.findIndex(x=>x.id===item.id));};
  n.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void show(records,records.findIndex(x=>x.id===item.id));}else if(e.key===' '){e.preventDefault();toggle(item.id);}else walk(e);};
  n.oncontextmenu=e=>{e.preventDefault();
   const group=selected.has(item.id)&&selected.size>1?records.filter(x=>selected.has(x.id)):[item],many=group.length>1;
   const into=folders.filter(f=>f.id!==item.folder).map(f=>['移到「'+f.name+'」',()=>moveTo(group.map(x=>x.id),f.id),'sub']);
   openMenu(e.clientX,e.clientY,[[many?'引用 '+group.length+' 张':'引用',()=>quote(group)],...(many?[]:[['查看',()=>show(records,records.findIndex(x=>x.id===item.id))]]),
    ...into,['新建文件夹并移入',()=>newFolder(group.map(x=>x.id)),'sub'],...(item.folder?[['移出文件夹',()=>moveTo(group.map(x=>x.id),''),'sub']]:[]),
    ...(many?[]:[['在资源管理器中显示',()=>call({action:'reveal',id:item.id})]]),['从相册移除',()=>hide(group),'danger']]);
  };
  n.ondragstart=e=>{const ids=selected.has(item.id)?[...selected]:[item.id];e.dataTransfer.setData('application/x-aieyra-images',JSON.stringify(ids));e.dataTransfer.effectAllowed='copyMove';n.classList.add('dragging');};
  n.ondragend=()=>n.classList.remove('dragging');
  observer.observe(n);return n;
 }
 function walk(e){
  const tiles=[...grid.querySelectorAll('.al-tile')],i=tiles.indexOf(e.currentTarget),cols=Math.max(1,Math.round(grid.clientWidth/(tiles[0]?.offsetWidth||1)));
  const d={ArrowRight:1,ArrowLeft:-1,ArrowDown:cols,ArrowUp:-cols}[e.key];if(!d)return;e.preventDefault();tiles[Math.max(0,Math.min(tiles.length-1,i+d))]?.focus();
 }
 function paintSelection(){
  for(const n of grid.querySelectorAll('.al-image'))n.setAttribute('aria-selected',String(selected.has(n.dataset.id)));
  const bar=q('.al-select');bar.hidden=!selected.size;bar.querySelector('span').textContent='已选 '+selected.size+' 张';panel.classList.toggle('selecting',selected.size>0);
 }
 function toggle(id){if(selected.has(id))selected.delete(id);else selected.add(id);paintSelection();}
 function paintHead(r){
  const f=folders.find(f=>f.id===folder);q('.al-back').hidden=!folder;q('.al-title b').textContent=f?f.name:'相册';q('.al-title small').textContent=((folder?r?.total:r?.count)??0)+' 张';q('.al-new').hidden=!!folder;
 }
 // keep: a background reload keeps every page already scrolled to, the selection and the scroll position.
 async function refresh({append=false,keep=false}={}){
  const own=++request;
  try{
   let r;
   if(keep&&records.length>60){
    const items=[];let offset=0;
    do{r=await call({action:'list',limit:100,offset,folder});if(own!==request)return;items.push(...r.items);offset=r.next_offset;}while(offset!=null&&items.length<records.length);
    r={...r,items};
   }else r=await call({action:'list',limit:60,offset:append?next||0:0,folder});
   if(own!==request)return;presence(r);folders=r.folders||[];next=r.next_offset;
   if(folder&&!folders.some(f=>f.id===folder)){folder='';return refresh();}
   const sig=JSON.stringify([folder,r.total,r.items.map(x=>[x.id,x.folder]),folder?'':folders]);
   if(append){records.push(...r.items);grid.append(...r.items.map(imageTile));}
   else if(sig!==signature){
    const focused=document.activeElement?.closest?.('.al-tile'),key=focused?.dataset.id||focused?.dataset.folder;
    const top=scroller.scrollTop;
    observer.disconnect();records=r.items.slice();for(const id of [...selected])if(!records.some(x=>x.id===id))selected.delete(id);
    grid.replaceChildren(...(folder?[]:folders.map(folderTile)),...records.map(imageTile));if(keep)scroller.scrollTop=top;
    if(key)grid.querySelector(`[data-id="${CSS.escape(key)}"],[data-folder="${CSS.escape(key)}"]`)?.focus({preventScroll:true});
    gridGlide.refresh();
   }
   signature=append?'':sig;paintHead(r);paintSelection();
   q('.al-empty').hidden=!!(r.total||(!folder&&folders.length));q('.al-empty').textContent=folder?'把图片拖到这里，或右键图片移入':'还没有图片';q('.al-more').hidden=next===null;
  }catch(e){if(own===request)report(e);}
 }
 function enter(id){folder=id;signature='';selected.clear();closeMenu();void refresh().then(()=>{scroller.scrollTop=0;grid.querySelector('.al-tile')?.focus({preventScroll:true});});
  animateUI(grid,[{opacity:0,translate:(id?18:-18)+'px 0'},{opacity:1,translate:'0 0'}],{kind:'enter',key:'enter'});}
 q('.al-back').onclick=()=>enter('');q('.al-more').onclick=()=>refresh({append:true});
 q('.al-back').ondragover=e=>{if(e.dataTransfer.types.includes('application/x-aieyra-images'))e.preventDefault();};
 q('.al-back').ondrop=e=>{e.preventDefault();const ids=JSON.parse(e.dataTransfer.getData('application/x-aieyra-images')||'[]');if(ids.length)void moveTo(ids,'');};

 // ---------- Actions ----------
 // Referenced images become attachments of the next message; the input takes focus.
 async function quote(items,lead=''){
  if(items.length>10)return report(Error('一条消息最多引用 10 张图片'));
  // Quoted from the viewer: only the picture still on screen when the answer comes is closed.
  const token=viewer.open?viewer.dataset.viewToken:'';
  const result=items.some(x=>x.asset)?await attachments.addResult(()=>({attachments:items})):await attachments.addResult(()=>call({action:'attach',ids:items.map(x=>x.id)}));
  if(!result?.accepted)return;if(viewer.open&&viewer.dataset.viewToken===token)closeViewer();selected.clear();paintSelection();if(!viewer.open)openInput(lead);
 }
 async function quoteFolder(f){const result=await attachments.addResult(()=>call({action:'attach',folder:f.id}));if(result?.accepted)openInput('');}
 async function moveTo(ids,target){try{await call({action:'move',ids,folder:target});selected.clear();signature='';await refresh();}catch(e){report(e);}}
 async function hide(items){try{await call({action:'hide',ids:items.map(x=>x.id)});selected.clear();signature='';await refresh();}catch(e){report(e);}}
 async function removeFolder(f){
  if(!await confirmDialog({doc:document,title:'删除「'+f.name+'」？',body:'只删除文件夹，里面的图片回到相册。',action:'删除'}))return;
  try{await call({action:'folder_delete',id:f.id});if(folder===f.id)folder='';signature='';await refresh();}catch(e){report(e);}
 }
 // Names are typed in place: Enter keeps, Esc drops.
 function nameInPlace(tile,value,commit){
  const label=tile.querySelector('.al-label b'),input=el('input','al-name');input.value=value;input.maxLength=60;input.spellcheck=false;input.setAttribute('aria-label','文件夹名字');
  label.replaceWith(input);input.focus();input.select();let done=false;
  const finish=async keep=>{if(done)return;done=true;const name=input.value.trim();if(keep&&name&&name!==value){try{await commit(name);}catch(e){report(e);}}signature='';await refresh();};
  input.onkeydown=e=>{if(e.isComposing)return;e.stopPropagation();if(e.key==='Enter'){e.preventDefault();void finish(true);}else if(e.key==='Escape'){e.preventDefault();void finish(false);}};
  input.onblur=()=>void finish(true);input.onclick=e=>e.stopPropagation();
 }
 function rename(tile,f){nameInPlace(tile,f.name,name=>call({action:'folder_rename',id:f.id,name}));}
 async function newFolder(moveIds=[]){
  try{const {folder:f}=await call({action:'folder_create',name:'新建文件夹'});if(moveIds.length)await call({action:'move',ids:moveIds,folder:f.id});
   if(folder)folder='';signature='';selected.clear();await refresh();const tile=grid.querySelector(`[data-folder="${CSS.escape(f.id)}"]`);if(tile){tile.scrollIntoView({block:'nearest'});rename(tile,f);}}catch(e){report(e);}
 }
 q('.al-new').onclick=()=>void newFolder();
 q('.al-clear').onclick=()=>{selected.clear();paintSelection();};
 panel.querySelector('[data-act=quote]').onclick=()=>void quote(records.filter(x=>selected.has(x.id)));
 panel.querySelector('[data-act=move]').onclick=e=>{const ids=[...selected],r=e.currentTarget.getBoundingClientRect();
  openMenu(r.left,r.top,[...folders.filter(f=>f.id!==folder).map(f=>['「'+f.name+'」',()=>moveTo(ids,f.id)]),...(folder?[['移出文件夹',()=>moveTo(ids,'')]]:[]),['新建文件夹',()=>newFolder(ids)]],{above:true});};

 // ---------- Context menu ----------
 function closeMenu(){if(!menu.hidden){menu.hidden=true;menuGlide.refresh();}}
 function openMenu(x,y,items,{above=false}={}){
  menu.replaceChildren(...items.map(([label,fn,kind])=>{const b=el('button','al-mi'+(kind?' al-mi-'+kind:''),label);b.type='button';b.setAttribute('role','menuitem');b.onclick=()=>{closeMenu();void Promise.resolve().then(fn).catch(report);};return b;}));
  menu.hidden=false;const w=menu.offsetWidth,h=menu.offsetHeight;
  menu.style.left=Math.max(8,Math.min(x,innerWidth-w-8))+'px';menu.style.top=Math.max(8,Math.min(above?y-h-6:y,innerHeight-h-8))+'px';
  menuGlide.refresh();animateUI(menu,[{opacity:0,scale:.97},{opacity:1,scale:1}],{kind:'fast',key:'pop'});menu.querySelector('.al-mi')?.focus({preventScroll:true});
 }
 menu.addEventListener('keydown',e=>{const all=[...menu.querySelectorAll('.al-mi')],i=all.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();all[(i+(e.key==='ArrowDown'?1:-1)+all.length)%all.length]?.focus();}
  else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeMenu();}});
 document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target))closeMenu();},true);
 addEventListener('blur',closeMenu);

 // Images dragged from the album onto the input become references too.
 const composer=document.getElementById('composer');
 composer?.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('application/x-aieyra-images')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
 composer?.addEventListener('drop',e=>{const raw=e.dataTransfer?.getData('application/x-aieyra-images');if(!raw)return;e.preventDefault();e.stopPropagation();const ids=JSON.parse(raw);void quote(ids.map(id=>records.find(x=>x.id===id)||{id}));},true);

 // ---------- Polling ----------
 // A one-item look each time; the album reloads only when something in it changed.
 let timer=0,pulse='';
 const poll=async()=>{clearTimeout(timer);try{
   const r=await call({action:'list',limit:1,folder});presence(r);
   const now=JSON.stringify([folder,r.total,r.count,r.items[0]?.id,r.folders]);
   if(isOpen&&now!==pulse&&!viewer.open&&menu.hidden&&!panel.querySelector('.al-name')){pulse=now;await refresh({keep:true});}
  }catch{}timer=setTimeout(poll,document.hidden?15000:5000);};
 void poll();
 document.addEventListener('eyra-attachment',e=>{const all=(e.detail.attachments||[e.detail.attachment]).filter(x=>x.kind==='image');void show(all,Math.max(0,all.findIndex(x=>x.sha256===e.detail.attachment.sha256))).catch(report);});
 addEventListener('beforeunload',()=>{clearTimeout(timer);observer.disconnect();thumbs.clear();},{once:true});
 return {
  open:()=>{setActive(true);setOpen(true);},thumbnail,
  previewAttachment:(a,all)=>show(all.filter(x=>x.kind==='image'),Math.max(0,all.filter(x=>x.kind==='image').findIndex(x=>x.sha256===a.sha256))),
  showArtifact:(image,name)=>show([{image,name}]),
  // A finished image_gen call is what wakes the album; running calls spin the orb.
  paint(snapshot){
   const role=snapshot?.roles?.find(x=>x.role==='matrix'),state=role?.state||'',id=snapshot?.session_id||'';if(task!==id){task=id;imageJobs.clear();}
   let finished=false;for(const x of role?.activity?.items||[])if(x.tool==='image_gen'){if(['running','queued'].includes(x.state))imageJobs.add(x.id);else if(imageJobs.delete(x.id))finished=true;}
   if(!['running','queued'].includes(state))imageJobs.clear();orb.classList.toggle('generating',imageJobs.size>0);
   if(finished)void poll();
  },
 };
}
