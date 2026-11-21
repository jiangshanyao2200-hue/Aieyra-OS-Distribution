// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ICON; TABS; setupAppsMenu
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/apps-menu.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 顶栏的“应用”按钮。菜单由宿主的原生小窗画：其他页面是盖在主页面上的原生视图，
// 画在主页面里的菜单会被压在下面，看得见也点不到。
import {fitDock} from './dock-fit.mjs';
const ICON={
 program:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m9 10 2.5 2L9 14M13 15h3"/>',
 grid:'<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
};
const TABS={'module:browser':['browser-slot','browser-bubble'],'module:contacts':['dock-contacts'],'module:settings':['api-slot','api-bubble'],'module:link':['dock-link'],'module:center':['dock-center'],'module:coding':['dock-coding'],'module:servers':['dock-servers']};
export function setupAppsMenu(api,{doc=document,onError=()=>{}}={}){
 if(typeof api?.apps!=='function')return {close(){}};
 const dock=doc.getElementById('desktop-dock');if(!dock)return {close(){}};
 const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]||ICON.program}</svg>`;
 const toggle=doc.createElement('button');toggle.id='dock-apps';toggle.className='quiet';toggle.type='button';toggle.setAttribute('aria-label','应用');toggle.setAttribute('aria-haspopup','true');toggle.setAttribute('aria-expanded','false');
 toggle.innerHTML=svg('grid')+'<span class="dock-label">应用</span>';
 const pinnedSlot=doc.createElement('span');pinnedSlot.id='dock-pinned-apps';
 dock.append(pinnedSlot,toggle);
 const fit=fitDock(dock,{doc,entries:()=>[...Object.values(TABS).map(ids=>doc.getElementById(ids[0])),...pinnedSlot.children].filter(Boolean)});
 let apps=[],open=false,closedAt=0;
 const run=promise=>Promise.resolve(promise).then(r=>{if(r?.ok===false)throw Error(r.error||'操作没有完成');return r;}).catch(e=>{onError(e.message);return null;});
 function paintDock(){
  for(const row of apps.filter(a=>a.kind==='module')){const node=doc.getElementById(TABS[row.id]?.[0]);if(node)node.toggleAttribute('data-unpinned',!row.pinned);}
  pinnedSlot.replaceChildren(...apps.filter(a=>a.kind!=='module'&&a.pinned).map(row=>{
   const b=doc.createElement('button');b.className='quiet';b.type='button';b.setAttribute('aria-label',row.title);b.dataset.app=row.id;b.innerHTML=svg(row.icon);
   const label=doc.createElement('span');label.className='dock-label';label.textContent=row.title;b.append(label);b.onclick=()=>void run(api.apps({action:'open',id:row.id}));return b;
  }));
 }
 function launch(id){
  const tab=TABS[id];if(tab){doc.getElementById(tab.at(-1))?.click();return;}
  void run(api.apps({action:'open',id}));
 }
 async function openMenu(){
  // 点按钮时菜单先因失焦关掉，这次点击不能又把它打开。
  if(open||Date.now()-closedAt<300)return;
  open=true;toggle.setAttribute('aria-expanded','true');
  const r=toggle.getBoundingClientRect(),result=await run(api.appsMenu({x:Math.max(16,r.left),y:r.bottom+16}));
  open=false;closedAt=Date.now();toggle.setAttribute('aria-expanded','false');
  if(result?.choice)launch(result.choice);else if(result)void load();
 }
 const load=()=>run(api.apps({action:'list'})).then(r=>{
  if(!r)return;
  apps=r.apps;paintDock();
  if(r.legacyLinkRetired)doc.getElementById('dock-link')?.setAttribute('data-unpinned','');
 });
 toggle.onclick=()=>void openMenu();
 const off=api.onAppsChanged?.(()=>void load());void load();
 return {close(){off?.();fit.close();toggle.remove();pinnedSlot.remove();}};
}
