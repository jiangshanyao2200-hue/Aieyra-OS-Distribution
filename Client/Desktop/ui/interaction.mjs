// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: syncProperty; syncAttribute; syncChildren; tabKeyboard; menuKey; bindMenuKeys; bindMenuPointerFocus; bindDialog; setupChoicePopover; positionMenu; topbarMenuGeometry; positionTopbarMenu
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/interaction.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Keep interaction state with the surface the user is actually reading.
export function syncProperty(node, key, value) {
  if (node[key] !== value) node[key] = value;
}

export function syncAttribute(node, key, value) {
  const text = String(value);
  if (node.getAttribute(key) !== text) node.setAttribute(key, text);
}

export function syncChildren(root, children) {
  const keep = new Set(children);
  for (let index = 0; index < children.length; index++) {
    if (root.children[index] !== children[index]) root.insertBefore(children[index], root.children[index] || null);
  }
  for (const node of [...root.children]) if (!keep.has(node)) node.remove();
}

export function tabKeyboard(root) {
  root.setAttribute('role', 'tablist');
  root.addEventListener('keydown', event => {
    const tabs = [...root.querySelectorAll('[role="tab"]')].filter(tab => !tab.disabled && !tab.closest('[hidden],[inert],[aria-hidden="true"]') && (!tab.checkVisibility || tab.checkVisibility({checkVisibilityCSS:true})));
    const index = tabs.indexOf(event.target);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click();
    tabs[next].focus({ preventScroll: true });
    tabs[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

// Shared navigation for focused menu rows and aria-activedescendant lists.
// Native inputs retain editing shortcuts; callers own selection and dismissal.
export function menuKey(event,{items,current,activate,onEscape,onEnter,wrap=true,tab=false}={}){
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey)return false;
  if(event.key==='Escape'&&onEscape){event.preventDefault();event.stopPropagation();onEscape();return true;}
  const nodes=[...items()].filter(n=>!n.disabled&&n.getAttribute('aria-disabled')!=='true'&&!n.closest('[hidden],[inert],[aria-hidden="true"]')&&(!n.checkVisibility||n.checkVisibility({checkVisibilityCSS:true})));
  if(!nodes.length)return false;
  const active=current?current():nodes[0].ownerDocument.activeElement,at=nodes.indexOf(active);
  if(event.key==='Enter'&&onEnter){event.preventDefault();onEnter(nodes[Math.max(0,at)]);return true;}
  if(!['ArrowDown','ArrowUp','Home','End',...(tab?['Tab']:[])].includes(event.key))return false;
  if(['Home','End'].includes(event.key)&&event.target?.closest?.('input,textarea,[contenteditable="true"]'))return false;
  const back=event.key==='ArrowUp'||event.key==='Tab'&&event.shiftKey;
  let next=event.key==='Home'?0:event.key==='End'?nodes.length-1:at<0?(back?nodes.length-1:0):at+(back?-1:1);
  next=wrap?(next+nodes.length)%nodes.length:Math.max(0,Math.min(nodes.length-1,next));
  event.preventDefault();
  if(activate)activate(nodes[next]);else{nodes[next].focus({preventScroll:true});nodes[next].scrollIntoView?.({block:'nearest'});}
  return true;
}
export function bindMenuKeys(root,options){const key=event=>menuKey(event,options);root.addEventListener('keydown',key);return ()=>root.removeEventListener('keydown',key);}

// Pointer and keyboard address one menu row. A selected radio row is a value,
// not a second hovered/focused item while the pointer is on another choice.
export function bindMenuPointerFocus(root){
 root.dataset.menuInput='pointer';
 const pointer=event=>{root.dataset.menuInput='pointer';const row=event.target?.closest?.('button,[role=option]');if(row&&root.contains(row)&&!row.disabled&&root.ownerDocument.activeElement!==row)row.focus({preventScroll:true});};
 const key=event=>{if(['ArrowUp','ArrowDown','Home','End','Tab'].includes(event.key))root.dataset.menuInput='keyboard';};
 root.addEventListener('pointerover',pointer);root.addEventListener('pointermove',pointer);root.addEventListener('keydown',key,true);
 return ()=>{root.removeEventListener('pointerover',pointer);root.removeEventListener('pointermove',pointer);root.removeEventListener('keydown',key,true);delete root.dataset.menuInput;};
}

// Native dialog owns focus trapping. This layer owns dismissal, cleanup and a
// safe return to its opener; closing an old surface must not steal new focus.
export function bindDialog(dialog,{opener,canClose=()=>true,onClose=()=>{},remove=false}={}){
  const doc=dialog.ownerDocument;let origin=null,disposed=false,shown=false,outsideDown=false;
  const outside=e=>{if(e.target!==dialog)return false;const r=dialog.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
  function close(){if(!disposed&&dialog.open&&canClose())dialog.close();}
  // Consume dismissal before shell navigation sees the same keydown. Native
  // cancel fires later, after bubbling, which otherwise leaves the program.
  const key=e=>{if(dialog.open&&e.key==='Escape'&&!e.defaultPrevented&&!e.isComposing&&e.keyCode!==229){
    e.preventDefault();e.stopPropagation();
    // Preserve the search field's native first-Escape behaviour before the
    // dialog consumes dismissal. Publish input so its result list stays live.
    const field=e.target;
    if(field?.matches?.('input[type="search"]')&&field.value&&!field.disabled&&!field.readOnly){field.value='';field.dispatchEvent(new (doc.defaultView?.Event||Event)('input',{bubbles:true}));return;}
    close();
  }};
  const cancel=e=>{e.preventDefault();close();},down=e=>{outsideDown=outside(e);},click=e=>{if(outsideDown&&outside(e))close();outsideDown=false;};
  function ended(){
    if(!shown||dialog.open)return;shown=false;
    const active=doc.activeElement,target=typeof origin==='function'?origin():origin;
    if(target?.isConnected&&!target.closest('[hidden],[inert]')&&(!target.checkVisibility||target.checkVisibility({checkVisibilityCSS:true}))&&(!active||active===doc.body||active===dialog||dialog.contains(active)))target.focus({preventScroll:true});
    onClose();
    if(remove){const animations=dialog.getAnimations?.()||[];Promise.allSettled(animations.map(a=>a.finished)).then(()=>{if(!shown){destroy();dialog.remove();}});}
  }
  function destroy(){if(disposed)return;disposed=true;dialog.removeEventListener('keydown',key);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('pointerdown',down);dialog.removeEventListener('click',click);dialog.removeEventListener('close',ended);}
  dialog.addEventListener('keydown',key);dialog.addEventListener('cancel',cancel);dialog.addEventListener('pointerdown',down);dialog.addEventListener('click',click);dialog.addEventListener('close',ended);
  return {show(){if(disposed||dialog.open)return;origin=opener||doc.activeElement;shown=true;dialog.showModal();},close,destroy};
}

// Native popovers own light-dismiss and Escape; choices share one focus model.
export function setupChoicePopover(button,list){
  const doc=button.ownerDocument,win=doc.defaultView;
  button.setAttribute('aria-controls',list.id);
  const choices=()=>[...list.querySelectorAll('[role=option]')].filter(n=>!n.disabled&&n.getAttribute('aria-disabled')!=='true'&&!n.closest('[hidden],[inert],[aria-hidden=true]')&&(!n.checkVisibility||n.checkVisibility({checkVisibilityCSS:true})));
  const focusSelected=()=>{const nodes=choices();(nodes.find(n=>n.getAttribute('aria-selected')==='true')||nodes[0])?.focus({preventScroll:true});};
  const hide=()=>{if(list.matches(':popover-open'))list.hidePopover();};
  const toggle=event=>{const opened=event.newState==='open';button.setAttribute('aria-expanded',String(opened));if(opened)focusSelected();};
  const key=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(list.matches(':popover-open'))focusSelected();else button.click();}};
  const stopKeys=bindMenuKeys(list,{items:choices,onEscape:()=>{hide();button.focus({preventScroll:true});}});
  list.addEventListener('toggle',toggle);button.addEventListener('keydown',key);
  win.addEventListener('blur',hide);win.addEventListener('resize',hide);doc.addEventListener('visibilitychange',hide);doc.addEventListener('workspace-view-before-change',hide);
  const observer=new win.MutationObserver(()=>{if(doc.hidden||doc.body.dataset.visible==='false'||!button.checkVisibility({checkVisibilityCSS:true}))hide();});
  observer.observe(doc.body,{subtree:true,attributes:true,attributeFilter:['hidden','data-visible']});
  return ()=>{hide();stopKeys();observer.disconnect();list.removeEventListener('toggle',toggle);button.removeEventListener('keydown',key);win.removeEventListener('blur',hide);win.removeEventListener('resize',hide);doc.removeEventListener('visibilitychange',hide);doc.removeEventListener('workspace-view-before-change',hide);};
}

// All menus align to the actual trigger in viewport coordinates, including zoom.
export function positionMenu(menu,anchor,{align='start',gap=8,edge=16}={}){
 const win=menu.ownerDocument.defaultView,r=anchor.getBoundingClientRect();
 Object.assign(menu.style,{position:'fixed',inset:'auto',margin:'0'});
 const box=menu.getBoundingClientRect(),width=win.innerWidth,height=win.innerHeight;
 const x=align==='end'?r.right-box.width:r.left;
 const y=r.bottom+gap+box.height<=height-edge?r.bottom+gap:Math.max(edge,r.top-gap-box.height);
 menu.style.left=Math.round(Math.max(edge,Math.min(width-box.width-edge,x)))+'px';
 menu.style.top=Math.round(Math.max(edge,Math.min(height-box.height-edge,y)))+'px';
}

// A titlebar dropdown continues its owning region downwards. Keep the top
// attached even in short/zoomed windows; its own content scrolls instead of
// flipping over the trigger. Native surfaces consume the same CSS coordinates.
export function topbarMenuGeometry(anchor,{region=anchor,align='start',width,minWidth=0,maxHeight=480}={}){
 const doc=anchor.ownerDocument,win=doc.defaultView,viewport=win.visualViewport;
 const view={left:viewport?.offsetLeft||0,top:viewport?.offsetTop||0,width:viewport?.width||win.innerWidth,height:viewport?.height||win.innerHeight};
 const source=typeof region==='function'?region():region,r=source?.getBoundingClientRect?source.getBoundingClientRect():source||anchor.getBoundingClientRect();
 const bar=doc.getElementById('status-anchor')?.getBoundingClientRect()||anchor.getBoundingClientRect();
 const requested=width??r.width??(r.right-r.left),size=Math.min(view.width,Math.max(0,requested,minWidth));
 const left=Math.max(view.left,Math.min(view.left+view.width-size,align==='end'?r.right-size:r.left));
 const top=Math.max(view.top,Math.min(view.top+view.height,bar.bottom));
 return {left,top,width:size,maxHeight:Math.max(0,Math.min(maxHeight,view.top+view.height-top-8))};
}

export function positionTopbarMenu(menu,anchor,options){
 const box=topbarMenuGeometry(anchor,options);
 menu.classList.add('ui-topbar-menu');
 Object.assign(menu.style,{position:'fixed',inset:'auto',margin:'0',left:box.left+'px',top:box.top+'px',width:box.width+'px',minWidth:'0',maxWidth:box.width+'px',maxHeight:box.maxHeight+'px'});
 return box;
}
