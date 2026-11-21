// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupModulePreview
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/module-preview.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 顶栏程序图标的悬停预览：独立或内嵌的程序共用原生提示层与生命周期（原属桌面模式，桌面模式退役后独立保留）。
import {setPreviewTooltip} from './tooltip.mjs';

export function setupModulePreview(api,moduleDock,doc=document){
 if(typeof api?.deskPreview!=='function')return {close(){}};
 const unbind=[],root=doc.documentElement,viewport=()=>({width:root.clientWidth,height:Math.max(1,root.clientHeight-56)});
 for(const [page,tab]of moduleDock?.entries?.()||[]){
  if(page==='home')continue;
  unbind.push(setPreviewTooltip(tab,async()=>{
   const r=await api.deskPreview({module:page}),size=viewport();
   return {module:page,title:tab.getAttribute('aria-label')||r?.title||'程序',url:r?.available?r.url:'',width:r?.width||size.width,height:r?.height||size.height,state:''};
  },viewport));
 }
 return {close(){for(const stop of unbind)stop();}};
}
