// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: api; opacity; present; accountCard; APP_ICON; appRows; resize; notice
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/surface-menu.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {menuKey,bindMenuPointerFocus} from './interaction.mjs';
import {renderMarkdown} from './markdown.mjs';
import {setupMotion,animateUI,cancelMotion} from './motion.mjs';
setupMotion();
import {applyAppearanceFrame} from './appearance.mjs';
import {configureTooltips,setModelTooltip,hideModelTooltip} from './tooltip.mjs';
const api=window.aieyraSurfaceMenu,menu=document.querySelector('[role=menu]'),rows=new Map();let current=0,revision=0,epoch=0,visible=false,passive=false,measuring=false,sizeKey='',accountFields=null,itemsKey='',appsKey='';
menu.classList.add('ui-menu','ui-menu-native');
bindMenuPointerFocus(menu);
configureTooltips(document,{native:()=>payload=>api.action({id:current,action:'tip',payload})});
const opacity=()=>Number(getComputedStyle(menu).opacity);
function present(){const from=opacity();menu.style.opacity='1';visible=true;if(from<1)animateUI(menu,[{opacity:from},{opacity:1}],{kind:'fast',key:'menu-presence'});if(!passive)menu.querySelector('summary,button')?.focus({preventScroll:true});}
function accountCard(account,items,id,fresh){
 if(fresh){
  menu.replaceChildren();const header=document.createElement('header'),avatar=document.createElement('span'),name=document.createElement('strong'),meta=document.createElement('p'),stats=document.createElement('dl'),updated=document.createElement('p'),actions=document.createElement('footer');
  avatar.className='account-avatar';header.append(avatar,name);meta.className='account-meta';updated.className='account-updated';
  const values=['余额','已使用','请求'].map(label=>{const cell=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;cell.append(dt,dd);stats.append(cell);return dd;});
  actions.append(...items.map(item=>{const b=document.createElement('button');b.textContent=item.label;b.type='button';b.onclick=()=>api.action({id,action:'choose',value:item.id});return b;}));menu.append(header,meta,stats,updated,actions);accountFields={avatar,name,meta,values,updated};
 }
 const {avatar,name,meta,values,updated}=accountFields;name.textContent=account.name;meta.textContent=account.meta;
 if(avatar.dataset.image!==account.avatar){avatar.replaceChildren();avatar.dataset.image=account.avatar||'';if(account.avatar?.startsWith('data:image/png;base64,')){const img=document.createElement('img');img.src=account.avatar;img.alt='';avatar.append(img);}}
 if(!avatar.firstElementChild)avatar.textContent=[...account.name][0]||'A';
 [account.balance,account.used,account.requests].forEach((v,i)=>values[i].textContent=v);updated.textContent=account.updated;
}
const APP_ICON={
 center:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8m0-5v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16m5 0H3v5"/>',
 servers:'<rect x="4" y="4" width="16" height="6.5" rx="2"/><rect x="4" y="13.5" width="16" height="6.5" rx="2"/><path d="M8 7.2h.01M8 16.8h.01"/>',
 notes:'<path d="M5 4.5h14v9.5l-5.5 5.5H5z"/><path d="M13.5 19.5V14H19"/><path d="M8.5 8.5h7M8.5 11.5h4"/>',
 market:'<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5a3 3 0 0 0 5.3 1.9 3.5 3.5 0 0 0 5.4 0A3 3 0 0 0 20 9.5M5.5 13v7h13v-7"/>',
 program:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m9 10 2.5 2L9 14M13 15h3"/>',
 browser:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
 contacts:'<circle cx="9" cy="8.5" r="3.5"/><path d="M3 20c.8-3.6 3-5.5 6-5.5s5.2 1.9 6 5.5M16 5.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.6.8 2.6 2.5 3 5.2"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
 link:'<path d="m9 15 6-6M10 7l2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2"/>',
};
// 顶栏“应用”：每行打开一个程序，右边的开关决定它在不在顶栏。开关只改显示，菜单不关。
function appRows(apps,id){
 menu.replaceChildren(...apps.map(row=>{
  const item=document.createElement('div'),open=document.createElement('button'),icon=document.createElement('span'),copy=document.createElement('span'),name=document.createElement('strong'),about=document.createElement('small'),pin=document.createElement('button');
  item.className='apps-row';open.type='button';open.className='apps-open';open.role='menuitem';icon.className='apps-icon';icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+(APP_ICON[row.icon]||APP_ICON.program)+'</svg>';
  open.id='apps-open-'+row.id.replaceAll(':','-');
  copy.className='apps-text';name.textContent=row.title;about.textContent=row.summary;copy.append(name,about);open.append(icon,copy);open.onclick=()=>api.action({id,action:'choose',value:row.id});
  pin.type='button';pin.className='apps-pin';pin.role='switch';pin.setAttribute('aria-checked',String(!!row.pinned));pin.setAttribute('aria-label',(row.pinned?'从顶栏移除 ':'显示到顶栏 ')+row.title);pin.dataset.tip=row.pinned?'从顶栏移除':'显示到顶栏';pin.onclick=()=>api.action({id,action:'toggle',value:row.id});
  item.append(open,pin);return item;
 }));
}
function resize(){
 if(measuring)return;measuring=true;queueMicrotask(()=>{measuring=false;if(!current||!revision)return;
  const b=document.body.getBoundingClientRect(),key=[current,visible?'':revision,Math.ceil(b.width),Math.ceil(b.height)].join(':');if(key===sizeKey)return;sizeKey=key;
  void api.action({id:current,revision,action:'size',width:Math.ceil(b.width),height:Math.ceil(b.height)}).catch(()=>{});
 });
}
new ResizeObserver(resize).observe(menu);
function notice(row,index,id){
 let entry=rows.get(row.id);
 if(!entry){
  const details=document.createElement('details'),summary=document.createElement('summary'),title=document.createElement('span'),time=document.createElement('time'),body=document.createElement('article'),read=document.createElement('button');
  details.dataset.noticeId=row.id;details.open=index===0&&!row.read;title.className='notice-title';summary.append(title,time);read.textContent='标为已读';
  read.onclick=()=>api.action({id,action:'choose',value:'read:'+row.id});
  details.append(summary,body,read);menu.querySelector('.notice-list').append(details);
  entry={details,title,time,body,read,text:undefined,row:null};rows.set(row.id,entry);
  const paint=()=>{if(!details.open)return;const content=entry.row?.content;if(content===entry.text)return;entry.text=content;
   if(content==null){body.textContent='正在读取…';body.classList.add('loading');}else{body.classList.remove('loading');renderMarkdown(body,content);}
  };
  details.addEventListener('toggle',paint);body.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();});entry.paint=paint;
 }
 entry.row=row;entry.title.textContent=row.title;entry.details.classList.toggle('unread',!row.read);entry.read.hidden=!!row.read;entry.read.disabled=row.content==null;
 const date=new Date(row.at);entry.time.textContent=Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
 entry.paint();
}
api.onFrame(frame=>{
 if(frame.phase==='prepare'){
  const mine=epoch;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(mine===epoch&&frame.id===current&&frame.revision===revision)void api.action({id:current,revision,action:'painted'}).catch(()=>{});}));return;
 }
 if(frame.phase==='present'){if(frame.id===current&&frame.revision===revision){present();menu.querySelector('[aria-checked=true]')?.focus({preventScroll:true});}return;}
 if(frame.phase==='hide'){
  hideModelTooltip(document);
  const mine=++epoch,from=opacity();current=frame.id;revision=0;visible=false;menu.style.opacity='0';
  const animation=animateUI(menu,[{opacity:from},{opacity:0}],{kind:'fast',key:'menu-presence'});
  void Promise.resolve(animation?.finished).catch(()=>{}).then(()=>{if(mine===epoch)void api.action({id:frame.id,action:'hidden'}).catch(()=>{});});return;
 }
 const fresh=current!==frame.id;current=frame.id;
 if(!current){hideModelTooltip(document);epoch++;revision=0;visible=false;cancelMotion(menu,'menu-presence');menu.style.opacity='0';menu.replaceChildren();rows.clear();sizeKey='';menu.classList.remove('ui-topbar-menu');document.body.dataset.topbar='false';return;}
 if(fresh){const from=frame.visible?opacity():0;epoch++;cancelMotion(menu,'menu-presence');menu.style.opacity=String(from);}
 revision=frame.revision;visible=frame.visible===true;passive=frame.passive===true;
 if(frame.limits){menu.style.maxWidth=frame.limits.width+'px';menu.style.maxHeight=frame.limits.height+'px';}
 applyAppearanceFrame(document.body,frame.theme);
 const attached=frame.attachment?.kind==='topbar';menu.classList.toggle('ui-topbar-menu',attached);document.body.dataset.topbar=String(attached);menu.style.width=attached?frame.attachment.width+'px':'';
 // A titlebar extension uses its shared material even when a theme styles
 // ordinary native menus. Clear the overrides when this window is reused.
 for(const [property,value]of Object.entries({background:'var(--ui-topbar-surface)',border:'0','border-radius':'0 0 var(--ui-radius-menu) var(--ui-radius-menu)','backdrop-filter':'none','box-shadow':'var(--ui-topbar-menu-shadow)'})){
  if(attached)menu.style.setProperty(property,value,'important');else menu.style.removeProperty(property);
 }
 menu.classList.toggle('notice-panel',!!frame.rows);menu.classList.toggle('account-panel',!!frame.account);menu.classList.toggle('apps-panel',!!frame.apps);menu.setAttribute('role',frame.rows||frame.account?'region':'menu');
 if(frame.apps){const next=JSON.stringify(frame.apps);if(!fresh&&next===appsKey){resize();return;}appsKey=next;const focus=document.activeElement?.getAttribute?.('aria-label')?.replace(/^\S+ /,'');appRows(frame.apps,frame.id);if(focus&&!fresh)[...menu.querySelectorAll('.apps-pin')].find(b=>b.getAttribute('aria-label').endsWith(' '+focus))?.focus({preventScroll:true});}
 else if(frame.account)accountCard(frame.account,frame.items,frame.id,fresh);
 else if(frame.rows){
  if(fresh){
   menu.replaceChildren();rows.clear();const heading=document.createElement('header'),title=document.createElement('strong'),clear=document.createElement('button'),close=document.createElement('button'),list=document.createElement('div');
   title.textContent='系统信息';clear.textContent='全部清除';close.className='notice-close ui-icon-button';close.type='button';close.setAttribute('aria-label','收起系统信息');close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
   clear.onclick=()=>api.action({id:frame.id,action:'choose',value:'clear'});close.onclick=()=>api.action({id:frame.id,action:'dismiss'});heading.append(title,clear,close);list.className='notice-list';menu.append(heading,list);
  }
  frame.rows.forEach((row,index)=>notice(row,index,frame.id));
 }else if(fresh||itemsKey!==JSON.stringify(frame.items)){itemsKey=JSON.stringify(frame.items);menu.replaceChildren(...frame.items.map(item=>{const button=document.createElement('button');button.type='button';button.role=frame.models?'menuitemradio':'menuitem';button.textContent=item.label;if(frame.models){button.setAttribute('aria-checked',String(!!item.selected));if(item.model)setModelTooltip(button,item.model);}button.onclick=()=>api.action({id:frame.id,action:'choose',value:item.id});return button;}));if(frame.models){const title=document.createElement('p');title.className='surface-model-title';title.textContent=frame.models.title;menu.prepend(title);}}
 resize();if(fresh&&visible){present();if(frame.models)menu.querySelector('[aria-checked=true]')?.focus({preventScroll:true});}
});
document.documentElement.addEventListener('mouseleave',()=>{if(current)void api.action({id:current,action:'leave'});});
document.fonts.ready.then(resize);
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape'&&menu.classList.contains('notice-panel'))return;
 menuKey(event,{items:()=>menu.querySelectorAll('button,summary'),tab:true,onEscape:()=>{if(current)void api.action({id:current,action:'dismiss'});}});
});
