// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupExtensionOverflow
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/extension-overflow.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// A display edge cannot provide space outside a maximized window. Keep the
// native rail hidden and expose its collection through this explicit menu.
export function setupExtensionOverflow(api,{doc=document}={}){
 if(!api.extensionState||!api.onExtensionState)return {close(){}};
 const root=doc.createElement('nav'),button=doc.createElement('button'),list=doc.createElement('div');
 root.id='extension-overflow';root.hidden=true;root.setAttribute('aria-label','收纳的团队与扩展');
 button.type='button';button.className='quiet';button.textContent='◉';button.title='团队与扩展';button.setAttribute('aria-label','团队与扩展');button.setAttribute('aria-expanded','false');
 list.id='extension-overflow-list';list.hidden=true;list.setAttribute('role','group');list.setAttribute('aria-label','团队与扩展');
 button.setAttribute('aria-controls',list.id);root.append(button,list);doc.getElementById('desktop-dock').after(root);
 const closeMenu=()=>{list.hidden=true;button.setAttribute('aria-expanded','false');};
 const fail=(row,error)=>{row.title=String(error.message||error);row.dataset.error='true';};
 let signature='',closed=false;
 function paint(value){
  if(closed||!value?.overflow)return;
  const rows=[...value.overflow.left,...value.overflow.right],next=JSON.stringify(rows);if(next===signature)return;signature=next;
  root.hidden=!rows.length;button.setAttribute('aria-label','团队与扩展，'+rows.length+'项');
  const focused=doc.activeElement,focusKey=focused?.dataset?.key,oldIndex=[...list.children].indexOf(focused);list.replaceChildren();
  for(const row of rows){const item=doc.createElement('button');item.type='button';item.dataset.key=row.key;item.textContent=row.title;item.title=row.summary||row.title;
   item.onclick=()=>{void api.extensionOpen({key:row.key}).then(result=>{if(result?.ok===false)throw Error(result.error);closeMenu();}).catch(error=>fail(item,error));};
   item.onkeydown=event=>{if(event.key==='Enter'&&event.shiftKey){event.preventDefault();void api.extensionDetach({key:row.key}).then(result=>{if(result?.ok===false)throw Error(result.error);closeMenu();}).catch(error=>fail(item,error));}};
   list.append(item);
  }
  if(focusKey){const next=[...list.children].find(n=>n.dataset.key===focusKey)||list.children[Math.min(Math.max(0,oldIndex),list.children.length-1)];if(next&&!list.hidden)next.focus({preventScroll:true});else if(!root.hidden)button.focus({preventScroll:true});}
  if(!rows.length)closeMenu();
 }
 button.onclick=()=>{list.hidden=!list.hidden;button.setAttribute('aria-expanded',String(!list.hidden));if(!list.hidden)list.firstElementChild?.focus();};
 const pointer=event=>{if(!root.contains(event.target))closeMenu();};
 const key=event=>{
  if(list.hidden||!root.contains(event.target))return;
  if(event.key==='Escape'){event.preventDefault();closeMenu();button.focus();return;}
  const nodes=[...list.children],index=nodes.indexOf(doc.activeElement),delta={ArrowDown:1,ArrowUp:-1}[event.key];
  const target=event.key==='Home'?0:event.key==='End'?nodes.length-1:delta!=null?Math.max(0,Math.min(nodes.length-1,index+delta)):null;
  if(target!=null){event.preventDefault();nodes[target]?.focus();}
 };
 doc.addEventListener('pointerdown',pointer);root.addEventListener('keydown',key);
 const off=api.onExtensionState(paint);void api.extensionState().then(paint).catch(error=>fail(button,error));
 return {close(){closed=true;off();doc.removeEventListener('pointerdown',pointer);root.removeEventListener('keydown',key);root.remove();}};
}
