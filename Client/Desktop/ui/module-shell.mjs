// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: api; setupModuleShell
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/module-shell.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {applyWindowTheme} from './window-theme.mjs';
// 独立模块窗口外壳：窗口控件、"放回 OS"、提示条、页签切换。只依赖 preload 暴露的 aieyraModule。
const api=globalThis.window?.aieyraModule;

export function setupModuleShell({tabs,initial,onShow,defaultPage},doc=document){
 const $=id=>doc.getElementById(id);
 const notice=$('module-notice');let page='',os=false,standalone=false,closed=false;
 function say(text,error=false){notice.textContent=text||'';notice.hidden=!text;notice.classList.toggle('error',!!error);}
 // OS 退出时选了"只退出 OS"的窗口从此单独运行，不再显示放回。
 // 与 OS 同一份背景（UI设计知识库 形态 §15.11 L2）：图片铺底、模糊、遮罩，与 OS 的 has-space-background 相同。
 function paintAppearance(a){
  applyWindowTheme(doc.body,a);
 }
 function paintDock(){$('module-dock').hidden=!os||standalone;}
 function show(next){
  if(!Object.hasOwn(tabs,next))next=defaultPage;
  if(next===page)return;
  const previous=page;page=next;
  for(const [name,{tab,pane}] of Object.entries(tabs)){
   const active=name===next;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;pane.hidden=!active;
  }
  try{sessionStorage.setItem('module:page',next);}catch{}
  Promise.resolve(onShow?.(next,previous)).catch(error=>say(error.message,true));
 }
 for(const [name,{tab}] of Object.entries(tabs)){
  tab.onclick=()=>show(name);
  tab.onkeydown=event=>{
   const names=Object.keys(tabs),at=names.indexOf(name);
   if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const next=names[(at+(event.key==='ArrowRight'?1:names.length-1))%names.length];show(next);tabs[next].tab.focus();}
  };
 }
 $('minimize-window').onclick=()=>api.invoke('minimizeWindow');
 $('maximize-window').onclick=()=>api.invoke('toggleMaximize');
 $('close-window').onclick=()=>api.invoke('closeWindow');
 $('module-dock').onclick=async()=>{
  $('module-dock').disabled=true;say('正在保存并放回 Aieyra OS…');
  try{const result=await api.invoke('dock',{page});if(result?.ok===false)throw Error(result.error);}
  catch(error){say(error.message,true);$('module-dock').disabled=false;}
 };
 const stop=api.on(event=>{
  if(closed)return;
  if(event?.name==='os'){os=!!event.payload?.online;standalone=event.payload?.main_open===false;paintDock();}
  else if(event?.name==='standalone'){standalone=true;paintDock();}
  else if(event?.name==='appearance')paintAppearance(event.payload);
  else if(event?.name==='notice')say(event.payload?.text,event.payload?.error);
  else if(event?.name==='navigate')show(event.payload?.page);
 });
 void api.invoke('appearance').then(paintAppearance).catch(()=>{});
 let stored='';try{stored=sessionStorage.getItem('module:page')||'';}catch{}
 const ready=api.invoke('info').then(info=>{if(Number.isFinite(info?.barHeight))doc.documentElement.style.setProperty('--bar-height',info.barHeight+'px');os=!!info?.os;standalone=!!info?.standalone;paintDock();show(initial||info?.page||stored||defaultPage);api.invoke('ready');}).catch(error=>{show(defaultPage);say(error.message,true);});
 return {ready,say,show,current:()=>page,close(){closed=true;stop?.();}};
}
