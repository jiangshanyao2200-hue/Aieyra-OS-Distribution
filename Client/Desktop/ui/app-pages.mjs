// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: APP_PAGES; setupAppPages
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/app-pages.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 目录里带 page 的模块在这里接到顶栏和导航；和联系人一样是主窗口里的原生视图，能拖出。
// Official program pages are generated from their package navigation metadata.
import {setupModulePage} from './module-page.mjs';
import {programPages} from '../../../Program/official/navigation.mjs';
export const APP_PAGES=Object.freeze([...programPages]);
export function setupAppPages(api,navigation,{onError=()=>{},doc=document}={}){
 const pages=new Map(APP_PAGES.map(app=>[app.key,setupModulePage(api,navigation,{key:app.key,title:app.title,onError,doc})]));
 const open=key=>pages.get(key).open();
 const paint=()=>{for(const app of APP_PAGES)doc.getElementById(app.tab)?.setAttribute('aria-current',navigation.is(app.key+'-module-view')?'page':'false');};
 for(const app of APP_PAGES){const tab=doc.getElementById(app.tab);if(tab)tab.onclick=()=>void open(app.key).catch(e=>onError(e.message));}
 doc.addEventListener('workspace-view-change',paint);paint();
 return {open,has:key=>pages.has(key),tabs:Object.fromEntries(APP_PAGES.map(app=>[app.key,doc.getElementById(app.tab)])),close(){doc.removeEventListener('workspace-view-change',paint);for(const page of pages.values())page.close();}};
}
