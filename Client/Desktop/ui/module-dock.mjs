// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupModuleDock
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/module-dock.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupModuleGestures} from './module-gestures.mjs';
import {mountProgramIcon} from './program-icons.mjs';


export function setupModuleDock(api,{tabs,current=()=>'',goHome=()=>{},onError=()=>{}},doc=document){
 for(const [page,tab] of Object.entries(tabs))mountProgramIcon(tab,page);
 if(typeof api?.moduleState!=='function'||typeof api?.moduleDetach!=='function')return {close(){},state:()=>({})};
 const MODULE_OF=Object.fromEntries(Object.keys(tabs).map(id=>[id,id]));
 const win=doc.defaultView;let modules={},closed=false,menu=null,dismissMenu=null;
 const entries=Object.entries(tabs).filter(([page,tab])=>tab&&MODULE_OF[page]);
 function paint(){
  for(const [page,tab] of entries){
   const row=modules[MODULE_OF[page]]||{};
   const state=row.detached?'detached':row.starting?'starting':'docked';
   const hidden=page!=='home'&&row.detached&&!row.starting&&!row.error;
   tab.dataset.moduleState=state;tab.hidden=!!hidden;tab.dataset.parked=String(!!row.parked);
   if(['browser','settings'].includes(page)&&tab.parentElement)tab.parentElement.hidden=!!hidden;
   tab.setAttribute('aria-description',page==='home'?'OS 首页，固定在主窗口':row.detached?'点击打开已有独立窗口；右键放回或关闭':'按住拖动排序或拖出；右键或菜单键：在独立窗口中打开');
  }
  // 当前正停在已外嵌的页面上时回到 OS 首页。
  const value=current(),page=String(value).replace(/(?:-module)?-view$/,'');if(page!=='home'&&MODULE_OF[page]&&modules[MODULE_OF[page]]?.detached)goHome();
 }
 function accept(value){if(closed||!value?.modules)return;
  modules={...modules,...value.modules};gestures.accept(value.order);paint();}
 function acceptSettings(value){if(closed||value?.key!=='settings')return;modules.settings={detached:value.placement==='detached'};paint();}
 async function action(page,choice='detach',point={}){
  closeMenu();
  try{const result=await api.moduleAction({module:page,action:choice,...point});if(result?.ok===false)throw Error(result.error);accept(result);}
  catch(error){onError(error.message||'模块操作未完成。');}
 }
 const detach=(page,point)=>action(page,'detach',point);
 function closeMenu(){menu?.remove();menu=null;if(dismissMenu)doc.removeEventListener('pointerdown',dismissMenu,true);dismissMenu=null;}
 function openMenu(page,tab,at){
  if(page==='home')return;
  closeMenu();
  if(typeof api.moduleMenu==='function'){
   void api.moduleMenu({page,x:at.x,y:at.y}).then(choice=>{if(closed)return;if(['detach','dock','close','open'].includes(choice))return action(page,choice);tab.focus();}).catch(error=>onError(error.message));return;
  }
  menu=doc.createElement('div');menu.className='module-dock-menu';menu.setAttribute('role','menu');
  const choices=modules[page]?.detached?[['open','打开独立窗口'],['dock','放回 OS'],['close','关闭独立窗口']]:[['detach','在独立窗口中打开']];
  for(const [choice,label]of choices){const item=doc.createElement('button');item.type='button';item.setAttribute('role','menuitem');item.textContent=label;item.onclick=()=>{void action(page,choice);};menu.append(item);}
  Object.assign(menu.style,{position:'fixed',left:Math.round(at.x)+'px',top:Math.round(at.y)+'px',zIndex:2147483000});
  doc.body.append(menu);menu.children?.[0]?.focus();
  dismissMenu=event=>{if(!menu?.contains(event.target))closeMenu();};
  doc.addEventListener('pointerdown',dismissMenu,true);
  menu.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();closeMenu();tab.focus();}};
 }
 const gestures=setupModuleGestures({entries,detach,preview:api.moduleDragPreview,save:async order=>{const r=await api.moduleOrder({order});if(r?.ok===false)throw Error(r.error||'排序未保存');return r;},onError,doc});
 const unbind=[];
 for(const [page,tab] of entries){
  tab.draggable=false;
  const context=event=>{event.preventDefault();openMenu(page,tab,{x:event.clientX,y:event.clientY});};
  const key=event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();const r=tab.getBoundingClientRect();openMenu(page,tab,{x:r.left,y:r.bottom+4});}};
  const click=event=>{
   if(modules[page]?.detached){event.preventDefault();event.stopImmediatePropagation();void action(page,'open');}
  };
  tab.addEventListener('click',click,true);
  tab.addEventListener('contextmenu',context);tab.addEventListener('keydown',key);
  unbind.push(()=>{tab.removeEventListener('click',click,true);tab.removeEventListener('contextmenu',context);tab.removeEventListener('keydown',key);});
 }
 const stop=api.onModuleState?.(accept);
 const stopSettings=api.onExtensionState?.(acceptSettings);
 void api.moduleState().then(accept).catch(()=>{});
 void api.extensionState?.().then(value=>value.windows?.forEach(acceptSettings)).catch(()=>{});
 return {state:()=>modules,entries:()=>entries,paint,detach:(page,point={})=>detach(page,point),close(){closed=true;gestures.close();closeMenu();stop?.();stopSettings?.();unbind.forEach(fn=>fn());}};
}
