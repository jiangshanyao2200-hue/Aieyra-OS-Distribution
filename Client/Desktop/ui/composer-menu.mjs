// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ITEMS; bindComposerMenu
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/composer-menu.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 输入框的加号菜单：点加号在上方展开一列图标（添加文件、添加媒体、压缩上下文），
// 再点加号、按 Esc、点别处或选中一项后收起。主窗口和原生上层共用这一个组件。
const ITEMS=[
 ['file','添加文件','M7 3h7l5 5v13H7zM14 3v5h5'],
 ['media','添加图片或视频','M4 6h16v12H4zM8 13l3-3 3 3 2-2 4 4M8.5 9.5h.01'],
 ['compact','压缩上下文','M5 9h14M7 5h10M9 13l3 3 3-3M12 16V9M6 20h12'],
];

export function bindComposerMenu(doc,actions,{onToggle}={}){
 const add=doc.getElementById('add-attachment'),actionsRow=add?.parentElement;
 if(!add||!actionsRow)return null;
 let menu=doc.getElementById('composer-menu');
 const lift=()=>{const input=doc.getElementById('message'),gap=input&&add?Math.max(0,add.getBoundingClientRect().top-input.getBoundingClientRect().top):0;menu?.style.setProperty('--menu-lift',Math.round(gap)+'px');};
 doc.defaultView?.addEventListener('resize',()=>{if(menu&&!menu.hidden)lift();});
 if(!menu){
  menu=doc.createElement('div');menu.id='composer-menu';menu.className='composer-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','更多操作');menu.hidden=true;
  ITEMS.forEach(([key,label,path],index)=>{
   const item=doc.createElement('button');item.type='button';item.className='composer-menu-item';item.dataset.action=key;item.setAttribute('role','menuitem');item.setAttribute('aria-label',label);item.style.setProperty('--i',String(index));
   item.innerHTML=`<span class="composer-menu-label">${label}</span><span class="composer-menu-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></span>`;
   menu.append(item);
  });
  const wrap=doc.createElement('span');wrap.className='composer-plus';add.replaceWith(wrap);wrap.append(menu,add);
 }
 add.setAttribute('aria-haspopup','menu');add.setAttribute('aria-expanded','false');add.setAttribute('aria-controls','composer-menu');
 add.setAttribute('aria-label','更多操作');
 const items=()=>[...menu.querySelectorAll('.composer-menu-item')].filter(item=>!item.hidden);
 for(const item of menu.querySelectorAll('.composer-menu-item')){item.hidden=typeof actions[item.dataset.action]!=='function';item.removeAttribute('title');delete item.dataset.tip;}
 const updateTitle=()=>{
  if(menu.hidden)add.title=items().map(item=>item.getAttribute('aria-label')).join('、');
  else{add.removeAttribute('title');delete add.dataset.tip;}
 };
 updateTitle();
 let closeTimer=0;
 function open(){
  if(add.disabled)return;
  // 多行草稿时加号在输入框底部；菜单抬到整段输入框上缘之上，标签不压正文（R46 B038）。
  lift();
  clearTimeout(closeTimer);menu.hidden=false;updateTitle();menu.dataset.state='opening';add.setAttribute('aria-expanded','true');add.classList.add('menu-open');onToggle?.(true);
  // Two frames: the closed geometry is committed before the open state animates from it.
  doc.defaultView.requestAnimationFrame(()=>doc.defaultView.requestAnimationFrame(()=>{if(menu.dataset.state==='opening')menu.dataset.state='open';}));
  items()[0]?.focus({preventScroll:true});
 }
 function close(focus=false){
  if(menu.hidden||menu.dataset.state==='closing')return;
  menu.dataset.state='closing';add.setAttribute('aria-expanded','false');add.classList.remove('menu-open');
  const reduced=doc.body.classList.contains('reduce-motion')||doc.defaultView.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  closeTimer=setTimeout(()=>{if(menu.dataset.state==='closing'){menu.hidden=true;delete menu.dataset.state;updateTitle();onToggle?.(false);}},reduced?0:200);
  if(focus)add.focus({preventScroll:true});
 }
 add.onclick=event=>{event.preventDefault();menu.hidden||menu.dataset.state==='closing'?open():close();};
 menu.addEventListener('click',event=>{
  const item=event.target.closest('.composer-menu-item');if(!item)return;
  close();doc.getElementById('message')?.focus({preventScroll:true});
  actions[item.dataset.action]?.();
 });
 menu.addEventListener('keydown',event=>{
  const list=items(),index=list.indexOf(doc.activeElement);
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
  else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();const step=event.key==='ArrowUp'?1:-1;list[(index+step+list.length)%list.length]?.focus();}
  else if(event.key==='Tab')close();
 });
 // Esc 先收起菜单，不连带收起输入框。
 doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden&&menu.dataset.state!=='closing'&&!menu.contains(event.target)){event.preventDefault();event.stopPropagation();close(true);}},true);
 doc.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!add.contains(event.target))close();},true);
 return {open,close,setAvailable(key,available){
  const item=[...menu.querySelectorAll('.composer-menu-item')].find(candidate=>candidate.dataset.action===key);
  const hidden=!available||typeof actions[key]!=='function';
  if(item&&item.hidden!==hidden){item.hidden=hidden;updateTitle();if(hidden&&doc.activeElement===item)items()[0]?.focus({preventScroll:true});}
 },get isOpen(){return !menu.hidden&&menu.dataset.state!=="closing";}};
}
