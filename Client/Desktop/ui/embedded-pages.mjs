// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupEmbeddedPages
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/embedded-pages.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 页面导航：宿主发来的 home / link / control / eyra 请求在 OS 主界面内执行。
export function setupEmbeddedPages(api,navigation,{link,control,desktop,openSettings,openContacts,apps,onError},doc=document){
 let modules={},closed=false;
 const report=e=>onError?.(e?.message||'页面操作未完成。');
 async function navigate({page}){
  if(closed||modules.home?.detached&&page!=='home')return;
  if(['link','control'].includes(page)&&modules.link?.detached){await api.openLinkApp?.();return;}
  // 回 OS 首页保留正在进行的独立会话（与 Dock 的 OS 按钮一致）。
  if(page==='home')navigation.resume();
  // Link 与指挥中心合为一体：两种请求都打开指挥中心（它自带“连接”页）。
  else if(page==='link'||page==='control')await control.open({toggle:false});
  else if(page==='contacts')await openContacts?.();
  else if(apps?.has(page))await apps.open(page);
  else if(page==='browser'){if(!navigation.is('browser-view'))doc.getElementById('browser-bubble')?.click();}
  else if(page==='settings')await (openSettings?openSettings({toggle:false}):doc.getElementById('api-bubble')?.click());
  else if(page==='eyra')desktop.showEyra();
  else if(page==='collapse-eyra')desktop.collapseEyra();
 }
 const stops=[api.onNavigate(value=>{void navigate(value).catch(report);}),api.onModuleState?.(state=>{if(state?.modules)modules=state.modules;})];
 const ready=(typeof api.moduleState==='function'?api.moduleState().catch(()=>null):Promise.resolve(null))
  .then(state=>{if(state?.modules)modules=state.modules;return api.pagesReady?.();}).catch(report);
 // Restore the page without recreating any product window or conversation DOM.
 const last=desktop.restorePage;
 if(['link','settings'].includes(last))void ready.then(()=>last==='settings'?doc.getElementById('api-bubble').click():navigate({page:last})).catch(report);
 return {ready,close(){closed=true;stops.forEach(stop=>stop?.());}};
}
