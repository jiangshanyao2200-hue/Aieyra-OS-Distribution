// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: SVG; check; contactIdentity; relativeTime; avatarFromFile; createContactStore; cleanupSummary; contactBusy; escapeCloses; ring; selfContact; selfFace; el; svgButton; stagger; arrowWalk; setupBioCard; setupContacts; confirmDialog; THINK_NAMES; EDITOR_SVG; setupContactEditor
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/contacts.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {promptSections,joinPromptSections,editPromptSection} from './prompt-sections.mjs';
import {tabKeyboard,positionMenu,positionTopbarMenu,bindMenuKeys} from './interaction.mjs';
import {createRoleRing,paintRoleRing,roleIdentity} from './role-identity.mjs';
import {setupGroups,groupDialog,groupFace} from './groups.mjs';
import {hoverGlide} from './glide.mjs';
import {setupSessionPreviews} from './session-preview.mjs';
import {animateUI,motionAllowed,motionDuration} from './motion.mjs';
import {setupWorkspaceSlide} from './workspace-slide.mjs';
import {cropImage} from './image-crop.mjs';
import {pickTheme} from './theme-library.mjs';
import {ROTATION_PRESETS} from './media-options.mjs';
import {setModelTooltip} from './tooltip.mjs';
// Contacts and sessions: one durable identity per agent, several sessions each.
// Data comes only from workspace.conversation; this module owns no model state.
const SVG={
 menu:'<svg viewBox="0 0 24 24" aria-hidden="true"><path class="m1" d="M5 7.5h14"/><path class="m2" d="M5 12h14"/><path class="m3" d="M5 16.5h14"/></svg>',
 people:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9.5" cy="8.5" r="3.2"/><path d="M3.8 19.2a5.7 5.7 0 0 1 11.4 0"/><path d="M15.6 5.6a3 3 0 0 1 0 5.8M17.6 13.9a5.7 5.7 0 0 1 2.9 5.3"/></svg>',
 plus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
 close:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
 chevron:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
 chat:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5Z"/><path d="M12 8v5M9.5 10.5h5"/></svg>',
 edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10Z"/><path d="m13.5 6.5 4 4"/></svg>',
 search:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/></svg>',
 group:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="9" r="3"/><path d="M3.5 18.5a5 5 0 0 1 10 0"/><path d="M18 8v6M15 11h6"/></svg>',
};
const check=value=>{if(value?.ok===false)throw Object.assign(Error(value.error||'操作未完成'),{code:value.code,cleanup:value.cleanup,retryable:value.retryable});return value;};
export function contactIdentity(contact,avatar=''){const name=contact?.name||'智能体';return {role:contact?.role||'conversation',name,ring:contact?.ring||'orbit',avatar,glyph:''};}
export function relativeTime(value,now=Date.now()){
 const at=Date.parse(value||'');if(!Number.isFinite(at))return '';
 const s=Math.max(0,(now-at)/1000);if(s<60)return '刚刚';if(s<3600)return Math.floor(s/60)+' 分钟前';
 const d=new Date(at),today=new Date(now);if(d.toDateString()===today.toDateString())return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
 const y=new Date(now-86400000);if(d.toDateString()===y.toDateString())return '昨天';
 return (d.getMonth()+1)+'/'+d.getDate();
}
// Square centre crop to a 160px PNG data URL; Core re-validates type and size.
export function avatarFromFile(file,{doc=document,size=160}={}){return new Promise((resolve,reject)=>{
 if(!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file?.type||''))return reject(Error('请选择一张图片'));
 const reader=new FileReader();reader.onerror=()=>reject(Error('无法读取这张图片'));
 reader.onload=()=>{const image=new Image();image.onerror=()=>reject(Error('无法读取这张图片'));image.onload=()=>{
  const side=Math.min(image.naturalWidth,image.naturalHeight),canvas=doc.createElement('canvas');canvas.width=canvas.height=size;
  const context=canvas.getContext('2d');context.imageSmoothingQuality='high';
  context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,size,size);resolve(canvas.toDataURL('image/png'));};image.src=reader.result;};
 reader.readAsDataURL(file);
});}

export function createContactStore(api,{doc=document,onError=()=>{}}={}){
 const listeners=new Set(),avatars=new Map(),pending=new Map(),failed=new Map();let contacts=[],groups=[],timer,closed=false,paused=false,epoch=0,unsupported=false,busy=null,lastError='',loaded=false,groupsLoaded=false,groupsUnsupported=false,groupError='';
 const call=p=>api.conversation(p).then(check);
 const current=mine=>!closed&&!paused&&mine===epoch;
 const emit=()=>{const mine=epoch;for(const fn of listeners){if(!current(mine))return;try{fn(contacts);}catch(e){if(current(mine))onError(e.message);}}};
 async function avatarFor(contact){
  if(closed||paused)return null;
  const id=contact.id,rev=contact.avatar_rev||0,known=avatars.get(id);
  if(!rev){if(known&&!(contacts.find(c=>c.id===id)?.avatar_rev||0)){avatars.delete(id);emit();}return {rev:0,url:''};}
  if(known?.rev===rev)return known;
  const queued=pending.get(id);if(queued?.rev===rev)return queued.promise;
  // A failed read is retried with backoff; the old picture stays until a new one arrives.
  const miss=failed.get(id);if(miss?.rev===rev&&Date.now()<miss.retry)return null;const mine=epoch,request={rev,promise:null};pending.set(id,request);
  request.promise=(async()=>{
   try{
    const value=await call({action:'contact_avatar',id});if(!current(mine))return null;
    const picture={rev:value.avatar_rev??rev,url:value.avatar||''};if(picture.rev!==rev)return null;
    // Detail may already be newer than the polling snapshot. Return its image
    // to that editor without relabelling the list's independently cached state.
    if(contacts.find(c=>c.id===id)?.avatar_rev===rev){failed.delete(id);avatars.set(id,picture);emit();}return picture;
   }catch(e){if(current(mine)&&pending.get(id)===request){const n=miss?.rev===rev?miss.n+1:1;failed.set(id,{rev,n,retry:Date.now()+Math.min(60000,2000*2**n)});if(n===1)onError(e.message);}return null;}
   finally{if(pending.get(id)===request)pending.delete(id);}
  })();return request.promise;
 }
 async function refresh(){
  if(closed||paused||unsupported||busy)return;const mine=epoch,request=Symbol('contacts');busy=request;clearTimeout(timer);timer=0;
  try{const rows=await call({action:'contacts'});if(!current(mine))return;if(!Array.isArray(rows))throw Error('联系人列表不可用');
   // Only an explicit unsupported action means an old Core. Other failures
   // retain the last confirmed list and have their own visible recovery state.
   try{const value=await call({action:'groups'});if(!current(mine))return;if(!Array.isArray(value))throw Error('群聊列表格式无效');groups=value;groupsLoaded=true;groupsUnsupported=false;groupError='';}
   catch(e){if(!current(mine))return;if(e.code==='core_update_required'||e.code==='unknown_action'||e.code==='unsupported_action'||/^未知的(?:联系人|对话智能体|群聊)操作$/.test(e.message)){groups=[];groupsLoaded=true;groupsUnsupported=true;groupError='';}else{const message='群聊列表读取失败：'+String(e?.message||e);if(message!==groupError)onError(message);groupError=message;}}
   if(!current(mine))return;contacts=rows;loaded=true;lastError='';emit();for(const c of rows)void avatarFor(c);}
  catch(e){if(current(mine)){unsupported=e.code==='core_update_required'||/未知的(联系人|对话智能体)操作/.test(e.message);if(!unsupported&&e.message!==lastError){lastError=e.message;onError(e.message);}}}
  finally{if(busy===request){busy=null;if(current(mine)&&!unsupported)timer=setTimeout(refresh,doc.hidden?6000:2500);}}
 }
 const visibility=()=>{if(!doc.hidden)void refresh();};doc.addEventListener('visibilitychange',visibility);void refresh();
 return {
  get contacts(){return contacts;},get people(){return contacts;},get groups(){return groups;},get loaded(){return loaded;},get unsupported(){return unsupported;},get groupsLoaded(){return groupsLoaded;},get groupsUnsupported(){return groupsUnsupported;},get groupError(){return groupError;},
  avatar:id=>avatars.get(id)?.url||'',
  // Repaint keys: the revision changes with the picture, its length may not.
  avatarRev:id=>avatars.get(id)?.rev||0,
  loadAvatar:avatarFor,
  find:id=>contacts.find(c=>c.id===id||c.sessions?.some(s=>s.id===id)),
  subscribe(fn){listeners.add(fn);fn(contacts);return ()=>listeners.delete(fn);},
  refresh,
  suspend(){if(closed||paused)return;paused=true;epoch++;busy=null;pending.clear();clearTimeout(timer);timer=0;},
  resume(){if(closed||!paused)return;paused=false;void refresh();},
  models:()=>call({action:'models'}),
  detail:id=>call({action:'contact',id}),
  async create(p){const v=await call({action:'contact_create',request_id:crypto.randomUUID(),...p});await refresh();return v;},
  async update(p){const v=await call({action:'contact_update',...p});if(!closed)avatars.delete(p.id);await refresh();return v;},
  async remove(id){const v=await call({action:'contact_delete',id});await refresh();return v;},
  async createGroup(name,members,hostContact,requestID=crypto.randomUUID()){const v=await call({action:'group_create',request_id:requestID,name,members,host_contact:hostContact||''});await refresh();return v;},
  async eyraSession(name){const v=await call({action:'eyra_session',name,request_id:crypto.randomUUID()});await refresh();return v;},
  async deleteSession(id){try{return await call({action:'session_delete',id,request_id:crypto.randomUUID()});}finally{await refresh();}},
  async newSession(contactId){const v=await call({action:'session_create',contact_id:contactId,request_id:crypto.randomUUID()});await refresh();return v;},
  open:(id,args={})=>api.conversationOpen({id,...args}).then(check),
  close(){if(closed)return;closed=true;paused=true;epoch++;busy=null;pending.clear();clearTimeout(timer);doc.removeEventListener('visibilitychange',visibility);listeners.clear();},
 };
}
export function cleanupSummary(session){
 const steps=session?.cleanup?.steps||[],done=steps.filter(s=>s.state==='completed').length;
 return steps.length?`待清理 · 已完成 ${done}/${steps.length}`:'待清理 · 可重试';
}
export const contactBusy=c=>!!c?.active||(c?.sessions||[]).some(s=>['queued','running'].includes(s.state));

// Esc closes our dialogs here, before the page-level Esc that navigates back.
export function escapeCloses(dialog){dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing){event.preventDefault();event.stopPropagation();dialog.close();}});return dialog;}
function ring(doc,identity,state='idle'){const node=createRoleRing(identity,{doc,state});node.classList.add('contact-ring');return node;}
const selfContact=Symbol('self');
function selfFace(doc,name,avatar,color){
 const face=el(doc,'span','cp-self-face');face.style.borderColor=color||'#e6e9f0';
 if(avatar){const img=doc.createElement('img');img.src=avatar;img.alt='';face.append(img);}
 else face.textContent=[...name][0];
 return face;
}
function el(doc,tag,cls,text){const node=doc.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;}
function svgButton(doc,id,label,icon,cls='quiet'){const b=el(doc,'button',cls);if(id)b.id=id;b.type='button';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=icon;return b;}
// Rows enter one after another from where they will rest; only the first dozen wait.
function stagger(nodes,{x=0,y=6}={}){nodes.slice(0,14).forEach((node,i)=>animateUI(node,[{opacity:0,translate:x+'px '+y+'px'},{opacity:1,translate:'0 0'}],{kind:'enter',key:'stagger',delay:i*22,fill:'backwards'}));}
// Up/Down walks a list of focusable rows.
function arrowWalk(event,selector){
 if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return false;
 const rows=[...event.currentTarget.parentElement.closest('[role=list]')?.querySelectorAll(selector)||[]].filter(n=>!n.hidden),i=rows.indexOf(event.currentTarget);
 const next=rows[i+(event.key==='ArrowDown'?1:-1)];if(!next)return false;event.preventDefault();next.focus();next.scrollIntoView({block:'nearest'});return true;
}

// One shared floating card: hovering any avatar shows that role's introduction.
function setupBioCard(doc){
 const card=el(doc,'div','contact-bio');card.hidden=true;card.setAttribute('role','tooltip');doc.body.append(card);let timer=0,owner=null;
 function show(anchor,contact,extra=''){clearTimeout(timer);timer=setTimeout(()=>{
  owner=anchor;card.replaceChildren(el(doc,'strong','',contact.name||'智能体'));
  const tag=contact.created_by==='eyra'?'Eyra 创建':contact.created_by==='user'?'我创建':contact.pinned?'母体':'';if(tag)card.append(el(doc,'small','contact-bio-tag',tag));
  const text=contact.description||extra;if(text)card.append(el(doc,'p','',text));card.hidden=false;
  const r=anchor.getBoundingClientRect(),w=card.offsetWidth,h=card.offsetHeight;
  card.style.left=Math.min(innerWidth-w-12,r.right+10)+'px';card.style.top=Math.max(8,Math.min(innerHeight-h-8,r.top+r.height/2-h/2))+'px';card.dataset.show='true';
 },320);}
 function hide(anchor){clearTimeout(timer);if(anchor&&anchor!==owner)return;owner=null;card.dataset.show='false';timer=setTimeout(()=>{card.hidden=true;},160);}
 function bind(anchor,source,extra){const contact=typeof source==='function'?source:()=>source;anchor.addEventListener('pointerenter',()=>show(anchor,contact(),extra));anchor.addEventListener('pointerleave',()=>hide(anchor));anchor.addEventListener('focus',()=>show(anchor,contact(),extra));anchor.addEventListener('blur',()=>hide(anchor));}
 return {bind,hide:()=>hide(),close(){clearTimeout(timer);card.remove();}};
}

export function setupContacts(api,navigation,{doc=document,profile=()=>({}),onError=()=>{},confirm=null,restoreDrawer=true}={}){
 const $=id=>doc.getElementById(id),body=doc.body,win=doc.defaultView,store=createContactStore(api,{doc,onError}),bio=setupBioCard(doc);
 confirm=confirm||confirmDialog;
 const report=e=>onError(String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));
 // Dock: the session menu leads the row; creation belongs to Contacts.
 // Open, the menu travels to the sidebar's right edge and becomes its collapse button.
 const dock=$('desktop-dock');
 const menuButton=svgButton(doc,'dock-sessions','会话',SVG.menu,'quiet');menuButton.setAttribute('aria-controls','session-drawer');menuButton.setAttribute('aria-expanded','false');
 const peopleButton=svgButton(doc,'dock-contacts','联系人',SVG.people,'quiet');peopleButton.insertAdjacentHTML('beforeend','<span class="dock-label">联系人</span>');peopleButton.setAttribute('aria-current','false');
 dock.prepend(menuButton);($('browser-slot')||$('dock-home')||menuButton).after(peopleButton);

 // ---------- Session sidebar ----------
 // It does not float over the page: open, it takes a column on the left and the
 // whole interface (pages, native views, input, the folded Eyra) moves right.
 const drawer=el(doc,'aside','session-drawer');drawer.id='session-drawer';drawer.setAttribute('aria-label','会话');drawer.hidden=true;
 const list=el(doc,'div','sd-list soft-scroll');list.setAttribute('role','list');
 // 拉开后的加号：选谁就直接开一段新会话。每段会话的记忆各自独立。
 const newButton=svgButton(doc,'sd-new','新建会话',SVG.plus,'quiet'),picker=el(doc,'div','sd-picker ui-menu ui-topbar-menu soft-scroll');newButton.hidden=true;newButton.inert=true;
 newButton.classList.add('ui-topbar-trigger');newButton.setAttribute('aria-haspopup','menu');newButton.setAttribute('aria-expanded','false');picker.setAttribute('role','menu');picker.hidden=true;dock.append(newButton);
 picker.popover='auto';drawer.append(list);body.append(drawer,picker);
 const previews=setupSessionPreviews(api,list,node=>{
  const key=node.dataset.key;
  if(key==='eyra')return {kind:'home',title:eyraIdentity().name};
  if(key?.startsWith('group:')){const group=store.groups.find(g=>g.id===key.slice(6));return group?{kind:'group',id:group.id,title:group.name}:null;}
  const contact=store.find(key),session=contact?.sessions?.find(s=>s.id===key)||contact?.sessions?.[0];
  return session?{kind:'session',id:session.id,title:contact.name+(contact.sessions.length>1?' · '+(node.querySelector('.sd-name')?.textContent||'会话'):''),pending:session.deletion_pending?cleanupSummary(session):''}:null;
 },{doc});
 function closePicker(){if(picker.hidden)return;if(picker.matches(':popover-open'))picker.hidePopover();picker.hidden=true;newButton.setAttribute('aria-expanded','false');}
 async function startSession(contact){
  closePicker();
  try{const s=contact?await store.newSession(contact.id):await store.eyraSession(eyraIdentity().name);await openSession(s.id);}catch(e){report(e);}
 }
 let pickerPainted='';
 function paintPicker(){
  if(picker.hidden)return;
  const eyra=eyraIdentity(),sig=JSON.stringify([eyra,store.people.map(c=>[c.id,c.name,c.ring,store.avatarRev(c.id)])]);
  if(sig===pickerPainted)return;pickerPainted=sig;
  const focused=picker.contains(doc.activeElement)?doc.activeElement.dataset.contact:null;
  const pick=(identity,name,contact)=>{const b=el(doc,'button','sd-pick');b.type='button';b.setAttribute('role','menuitem');b.setAttribute('aria-label',name);b.dataset.contact=contact?.id||'eyra';b.append(ring(doc,identity,'idle'),el(doc,'span','',name));b.onclick=()=>void startSession(contact);return b;};
  picker.replaceChildren(...(store.people.some(c=>c.builtin==='eyra')?[]:[pick(eyra,eyra.name,null)]),...store.people.map(c=>pick(contactIdentity(c,store.avatar(c.id)),c.name,c)));
  if(focused)([...picker.children].find(b=>b.dataset.contact===focused)||picker.querySelector('.sd-pick'))?.focus({preventScroll:true});
 }
 function positionPicker(){
  if(picker.hidden)return;
  const left=$('status-anchor').getBoundingClientRect().left,width=drawer.getBoundingClientRect().width;
  positionTopbarMenu(picker,newButton,{region:{left,right:left+width,width},maxHeight:360});
 }
 function openPicker(){
  picker.hidden=false;pickerPainted='';paintPicker();picker.showPopover();positionPicker();newButton.setAttribute('aria-expanded','true');picker.querySelector('.sd-pick')?.focus({preventScroll:true});
 }
 picker.addEventListener('toggle',event=>{if(event.newState==='closed')closePicker();});
 const stopPickerKeys=bindMenuKeys(picker,{items:()=>picker.querySelectorAll('[role=menuitem]')});
 newButton.onclick=event=>{event.stopPropagation();picker.hidden?openPicker():closePicker();};
 doc.addEventListener('pointerdown',event=>{if(!picker.hidden&&!picker.contains(event.target)&&!newButton.contains(event.target))closePicker();});
 picker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();closePicker();newButton.focus({preventScroll:true});}});
 // 右键删除：聊天和记忆一起删，先提醒。
 async function deleteSession(session,contact){
  const ok=await confirm({doc,title:session.deletion_pending?'继续清理这段会话？':'删除这段会话？',body:session.deletion_pending?cleanupSummary(session)+'。重试会继续清理剩余项目。':'这段会话的聊天记录和它的记忆会一起删除，不能恢复。联系人会保留，可以随时重新开始。',action:session.deletion_pending?'重试清理':'删除'});
  if(!ok)return;
  const wasCurrent=currentSession()===session.id;
  try{
   const result=await store.deleteSession(session.id);navigation.forgetConversation?.('conversation:'+session.id);
   if(!wasCurrent)return;
   const next=result?.replacement?.id||(store.find(contact.id)?.sessions||[]).find(s=>s.id!==session.id)?.id;
   if(next)await openSession(next);else $('dock-home')?.click();
  }catch(e){report(e);}
 }
 function sessionMenu(event,session,contact){
  event.preventDefault();
  void api.conversationMenu({x:event.clientX,y:event.clientY,canDelete:true}).then(value=>{
   if(value==='detach')return store.open(session.id,{detached:true});
   if(value==='delete')return deleteSession(session,contact);
  }).catch(report);
 }
 const drawerGlide=hoverGlide(list,'.sd-row');
 const stored=key=>{try{return localStorage.getItem(key);}catch{return null;}};
 const expanded=new Set((()=>{try{const v=JSON.parse(stored('aieyra.sessions.expanded')||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}})());
 const saveExpanded=()=>{try{localStorage.setItem('aieyra.sessions.expanded',JSON.stringify([...expanded]));}catch{}};
 const slide=setupWorkspaceSlide(doc,api,report);win.addEventListener('pagehide',()=>slide.close(),{once:true});
 let isOpen=false,painted='',settle=0,measureFrame=0,measureClosed=false,dockBox=null;
 const reserveDock=value=>{const text=value+'px';if(dock.style.getPropertyValue('--workspace-menu-reserve')===text)return;dock.style.setProperty('--workspace-menu-reserve',text);dock.dispatchEvent(new win.Event('workspace-dock-change'));};
 const bodyStyle=(key,value)=>{if(body.style.getPropertyValue(key)!==value)body.style.setProperty(key,value);};
 const sidebarWidth=()=>Math.round(Math.min(320,Math.max(232,win.innerWidth*.24),win.innerWidth*.46));
 // Narrow windows give the top bar less room, so the menu travels only as far as the bar allows.
 function measure(){
  if(measureFrame){win.cancelAnimationFrame(measureFrame);measureFrame=0;}
  const w=sidebarWidth();
  // A settled, closed sidebar has no travel to fit. Snapshot-driven dock
  // resizes can leave all button geometry and the inherited ratio untouched.
  if(!isOpen&&slide.x===0){bodyStyle('--sd-width',w+'px');reserveDock(0);return;}
  const style=win.getComputedStyle(dock),size=menuButton.offsetHeight||36,gap=parseFloat(style.columnGap)||0,left=dock.getBoundingClientRect().left;
  const required=[menuButton,doc.getElementById('dock-home'),doc.getElementById('dock-apps')].filter(Boolean);
  // Match dock-fit's content width and outer item widths, including the
  // session button's separator margin, before reserving the sidebar travel.
  const minimum=required.reduce((sum,node)=>{const css=win.getComputedStyle(node);return sum+node.getBoundingClientRect().width+(parseFloat(css.marginLeft)||0)+(parseFloat(css.marginRight)||0);},0)+Math.max(0,required.length-1)*gap;
  const width=Math.max(0,dock.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0));
  const want=Math.max(0,Math.round(w-12-size-left-gap)),room=Math.max(0,width-minimum),travel=Math.min(want,room);
  bodyStyle('--sd-width',w+'px');
  bodyStyle('--workspace-menu-ratio',String(travel/w));
  // Fit once for the destination, then retain that space while closing. Page
  // viewports and nodes are untouched; overflow stays in the native Apps menu.
  reserveDock(isOpen||slide.x>0?travel:0);
  positionPicker();
 }
 function scheduleMeasure(entries){
  if(measureClosed)return;
  const box=Array.isArray(entries)?entries.find(entry=>entry.target===dock)?.contentRect:null;
  if(box){if(dockBox?.width===box.width&&dockBox.height===box.height)return;dockBox={width:box.width,height:box.height};}
  if(!measureFrame)measureFrame=win.requestAnimationFrame(()=>{measureFrame=0;measure();});
 }
 // Set final insets once; shared motion handles visual travel without repeated reflow.
 function setDrawer(open,{remember=true}={}){
  if(open===isOpen)return;isOpen=open;clearTimeout(settle);
  newButton.inert=!open;newButton.setAttribute('aria-hidden',String(!open));if(!open)closePicker();
  if(open){drawer.hidden=false;newButton.hidden=false;}
  measure();body.classList.toggle('session-drawer-open',open);
  slide.to(open?sidebarWidth():0);bio.hide();previews.hide();
  menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'收起会话':'会话');menuButton.title=open?'收起':'会话';
  if(remember)try{localStorage.setItem('aieyra.sessions.open',open?'1':'0');}catch{}
  settle=setTimeout(()=>{if(!isOpen){drawer.hidden=true;newButton.hidden=true;reserveDock(0);}},motionAllowed(body)?motionDuration(body,'move')+40:0);
  if(open){paintDrawer();void store.refresh();}
 }
 const dockResize=win.ResizeObserver?new win.ResizeObserver(scheduleMeasure):null;dockResize?.observe(dock);
 menuButton.onclick=()=>setDrawer(!isOpen);
 const resized=event=>{if(event.isTrusted){measure();slide.to(isOpen?sidebarWidth():0,{instant:true});}};
 win.addEventListener('resize',resized);doc.addEventListener('workspace-theme-change',scheduleMeasure);doc.fonts?.addEventListener('loadingdone',scheduleMeasure);
 doc.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return;
  if(isOpen&&drawer.contains(doc.activeElement)){event.preventDefault();setDrawer(false);menuButton.focus();}},true);
 const currentSession=()=>navigation.is('conversation-view')?body.dataset.conversationId||'':'';
 // 列表里点 Eyra 是明确切回 Eyra：先放下上一个独立会话，再走 OS 按钮（悬浮模式也由它处理）。
 const openEyra=()=>{navigation.forgetChat?.();$('dock-home')?.click();};
 async function openSession(id){try{await store.open(id);}catch(e){report(e);}}
 function summary(last,from,cls='sd-last'){const node=el(doc,'span',cls+' chat-text '+(from==='user'?'user-text':'eyra-text'),last);node.dataset.author=from==='user'?'user':'assistant';return node;}
 function row(identity,{name,last,lastFrom,time,current,state='idle',onOpen,onMenu=null,contact,count=0,expandedState=null,onToggle=null,cls='',sessionId=''}){
  const node=el(doc,'div','sd-row '+cls);node.tabIndex=0;node.setAttribute('role','listitem');node.setAttribute('aria-current',String(!!current));
  const face=ring(doc,identity,state),text=el(doc,'div','sd-text'),line=el(doc,'div','sd-line');
  line.append(el(doc,'b','sd-name chat-name',name));if(time)line.append(el(doc,'time','sd-time',time));text.append(line);if(last)text.append(summary(last,lastFrom));node.append(face,text);
  if(count>1){const toggle=svgButton(doc,'',expandedState?'收起':'展开 '+count+' 个会话',SVG.chevron,'sd-toggle');toggle.dataset.count=count;toggle.setAttribute('aria-expanded',String(!!expandedState));toggle.onclick=event=>{event.stopPropagation();onToggle();};node.append(toggle);}
  if(onMenu)node.oncontextmenu=onMenu;
  let gesture=null,dragged=false;
  if(sessionId){
   node.onpointerdown=event=>{if(event.button!==0||event.target.closest('button'))return;gesture={x:event.screenX,y:event.screenY};dragged=false;node.setPointerCapture(event.pointerId);};
   node.onpointermove=event=>{if(gesture&&Math.hypot(event.screenX-gesture.x,event.screenY-gesture.y)>8)dragged=true;};
   node.onpointerup=event=>{if(!gesture)return;gesture=null;if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);if(dragged&&(event.clientX<0||event.clientY<0||event.clientX>win.innerWidth||event.clientY>win.innerHeight))void store.open(sessionId,{detached:true,x:event.screenX,y:event.screenY}).catch(report);};
   node.onpointercancel=()=>{gesture=null;dragged=false;};
  }
  node.onclick=()=>{if(!dragged)onOpen();dragged=false;};node.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen();}else if(count>1&&(event.key==='ArrowRight'&&!expandedState||event.key==='ArrowLeft'&&expandedState)){event.preventDefault();onToggle();}else arrowWalk(event,'.sd-row');};
  if(contact)bio.bind(face,contact);return node;
 }
 function lastText(session){if(session?.deletion_pending)return cleanupSummary(session);const last=session?.last;if(!last?.text)return session?.state==='running'||session?.state==='queued'?'正在回复…':'';return (last.from==='user'?'你：':'')+last.text;}
 // Eyra is the same bare ring here as on Home, unless she has a picture.
 const eyraIdentity=()=>{const c=store.contacts.find(c=>c.builtin==='eyra'),e=c?contactIdentity(c,store.avatar(c.id)):roleIdentity(profile(),'matrix');return e.avatar?e:{...e,glyph:''};};
 function groupNotice(cls){
  const node=el(doc,'p',cls,store.groupError||(store.groupsUnsupported?'当前版本不支持群聊':'正在读取群聊…'));
  if(store.groupError){node.setAttribute('role','alert');node.dataset.groupError='true';const retry=el(doc,'button','ce-secondary','重试');retry.type='button';retry.setAttribute('aria-label','重试群聊列表');retry.onclick=()=>void store.refresh();node.append(' ',retry);}
  return node;
 }
 function paintDrawer(){
  if(!isOpen)return;const current=currentSession(),eyra=eyraIdentity();
  // Polling repaints only when something visible changed, so hover and focus stay put.
  const sig=JSON.stringify([current,navigation.current,groups.current,eyra.name,eyra.avatar.length+eyra.avatar.slice(-24),[...expanded],store.groupError,store.groupsLoaded,store.groupsUnsupported,store.contacts.map(c=>[c.id,c.name,store.avatarRev(c.id),c.ring,contactBusy(c),(c.sessions||[]).map(s=>[s.id,s.state,s.last?.at,s.last?.text,s.deletion_pending,s.cleanup?.updated])]),store.groups.map(g=>[g.id,g.name,g.active,g.last?.at,g.members.length])]);
  if(sig===painted)return;painted=sig;
  const keep=list.scrollTop,focused=doc.activeElement?.closest?.('.sd-row')?.dataset.key,items=[];
  if(!store.contacts.some(c=>c.builtin==='eyra')){items.push(row(eyra,{name:eyra.name,current:!navigation.current,cls:'sd-eyra',contact:{name:eyra.name,pinned:true},onOpen:openEyra}));items[0].dataset.key='eyra';}
  for(const c of store.contacts){
   if(c.builtin!=='eyra'&&!c.sessions?.length)continue;
   const sessions=c.sessions||[],first=sessions[0],identity=c.builtin==='eyra'?eyra:contactIdentity(c,store.avatar(c.id)),open=expanded.has(c.id);
   items.push(row(identity,{name:c.name,last:lastText(first),lastFrom:first?.last?.from,time:relativeTime(first?.last?.at||c.activity),current:sessions.length===1&&first?.id===current,state:contactBusy(c)?'thinking':'idle',contact:c,count:sessions.length+(c.builtin==='eyra'?1:0),expandedState:open,
    onToggle:()=>{open?expanded.delete(c.id):expanded.add(c.id);saveExpanded();paintDrawer();list.querySelector(`[data-key="${c.id}"]`)?.focus({preventScroll:true});},
    sessionId:c.builtin!=='eyra'?first?.id||'':'',onMenu:sessions.length===1&&c.builtin!=='eyra'?event=>sessionMenu(event,first,c):null,
    onOpen:()=>c.builtin==='eyra'?openEyra():first?void openSession(first.id):void startSession(c)}));
   items.at(-1).dataset.key=c.builtin==='eyra'?'eyra':c.id;
   if(open&&(sessions.length>1||c.builtin==='eyra'&&sessions.length)){const group=el(doc,'div','sd-sessions');group.setAttribute('role','list');
    const born=[...sessions].sort((a,b)=>String(a.created).localeCompare(String(b.created)));
    sessions.forEach(s=>{const sub=row(identity,{name:'会话 '+(born.indexOf(s)+1),last:lastText(s),lastFrom:s.last?.from,time:relativeTime(s.last?.at||s.activity),current:s.id===current,state:['queued','running'].includes(s.state)?'thinking':'idle',onOpen:()=>void openSession(s.id),onMenu:event=>sessionMenu(event,s,c),cls:'sd-session',sessionId:s.id});sub.dataset.key=s.id;group.append(sub);});
    items.push(group);}
  }
  if(store.groupError||store.groupsUnsupported||!store.groupsLoaded)items.push(groupNotice('cp-empty'));
  for(const g of store.groups){
   const node=el(doc,'div','sd-row sd-groupchat');node.tabIndex=0;node.setAttribute('role','listitem');node.dataset.group=g.id;node.dataset.key='group:'+g.id;node.setAttribute('aria-current',String(navigation.is('group-view')&&groups.current===g.id));
   const text=el(doc,'div','sd-text'),line=el(doc,'div','sd-line');line.append(el(doc,'b','sd-name chat-name',g.name),el(doc,'time','sd-time',relativeTime(g.last?.at||g.activity)));
   text.append(line);if(g.last)text.append(summary((g.last.from==='user'?'你':g.last.name)+'：'+g.last.text,g.last.from));
   const face=groupFace(doc,g,id=>store.avatar(id),36);if(g.active)face.dataset.active='true';node.append(face,text);
   const go=()=>void groups.open(g.id).catch(report);node.onclick=go;node.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();go();}else arrowWalk(event,'.sd-row');};
   bio.bind(face,()=>({name:g.name,description:g.members.map(m=>m.name).join('、')}));
   items.push(node);
  }
  list.replaceChildren(...items);list.scrollTop=keep;drawerGlide.refresh();
  if(focused)list.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  previews.reposition();
 }
 // ---------- Contacts page ----------
 // Retain list nodes and scroll positions; only populated sections take space.
 const page=el(doc,'section','contacts-page embedded-panel');page.id='contacts-view';page.setAttribute('aria-label','联系人');
 const column=el(doc,'div','cp-column'),bar=el(doc,'header','cp-bar'),heading=el(doc,'h2','cp-title','联系人'),search=el(doc,'input','cp-search');search.type='search';search.placeholder='搜索会话、联系人和群聊';search.setAttribute('aria-label','搜索联系人');search.hidden=true;
 const searchButton=svgButton(doc,'','搜索',SVG.search,'cp-icon'),groupButton=svgButton(doc,'','新建群聊',SVG.group,'cp-icon'),createButton=svgButton(doc,'','新建联系人',SVG.people,'cp-icon cp-create');
 searchButton.setAttribute('aria-expanded','false');searchButton.onclick=()=>{search.hidden=!search.hidden;searchButton.setAttribute('aria-expanded',String(!search.hidden));if(!search.hidden)search.focus();else{search.value='';paintPage();}};
 for(const [button,label] of [[searchButton,'搜索'],[groupButton,'新建群聊'],[createButton,'新建联系人']])button.append(el(doc,'span','cp-action-label',label));
 bar.append(heading,search,searchButton,groupButton,createButton);
 const grid=el(doc,'div','cp-columns'),lists=new Map();
 for(const [id,title]of [['sessions','会话'],['people','联系人'],['groups','群聊']]){const section=el(doc,'section','cp-section'),label=el(doc,'h3','cp-section-title',title),list=el(doc,'div','cp-list soft-scroll');section.dataset.column=id;list.setAttribute('role','list');list.setAttribute('aria-label',title);if(id!=='people')section.append(label);section.append(list);grid.append(section);lists.set(id,list);}
 column.append(bar,grid);page.append(column);$('view-content').append(page);navigation.register('contacts-view');
 const pageGlides=[...lists.values()].map(list=>hoverGlide(list,'.cp-row'));let pagePainted='';
 peopleButton.onclick=()=>navigation.open('contacts-view','联系人',{toggle:true});
 doc.addEventListener('workspace-view-change',()=>{peopleButton.setAttribute('aria-current',navigation.is('contacts-view')||navigation.is('contacts-module-view')?'page':'false');if(navigation.is('contacts-view')){pagePainted='';paintPage();stagger([...grid.querySelectorAll('.cp-row')]);}paintDrawer();});
 search.oninput=()=>paintPage();createButton.onclick=()=>editor.open(null);
 search.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();grid.querySelector('.cp-row')?.focus();}if(event.key==='Escape'){event.stopPropagation();searchButton.click();searchButton.focus();}};
 async function remove(c){
  if(c.builtin||c.program)return false;
  const ok=await confirm({doc,title:'删除「'+c.name+'」？',body:'它会从联系人和会话列表移除，正在进行的回复会停止。历史对话归档保留。',action:'删除'});
  if(!ok)return false;try{await store.remove(c.id);return true;}catch(e){report(e);return false;}
 }
 function contactRow({face,name,desc,summaryFrom=null,onOpen,actions=[],key,cls=''}){
  const node=el(doc,'div','cp-row '+cls);node.tabIndex=0;node.setAttribute('role','listitem');node.dataset.key=key;
  const text=el(doc,'div','cp-text');text.append(el(doc,'b','cp-name chat-name',name));if(desc)text.append(summaryFrom===null?el(doc,'span','cp-desc',desc):summary(desc,summaryFrom,'cp-desc'));
  const tools=el(doc,'div','cp-tools');for(const [label,icon,fn] of actions){const b=svgButton(doc,'',label,icon,'cp-tool');b.onclick=event=>{event.stopPropagation();fn();};tools.append(b);}
  node.append(face,text,tools);
  node.ondblclick=event=>{if(!event.target.closest('button'))onOpen();};
  node.onkeydown=event=>{if(event.target!==node)return;if(event.key==='Enter'){event.preventDefault();onOpen();}else if(!arrowWalk(event,'.cp-row')&&event.key==='ArrowUp'){event.preventDefault();search.focus();}};
  return node;
 }
 function paintPage(){
  if(!navigation.is('contacts-view'))return;const q=search.value.trim().toLowerCase(),eyra=eyraIdentity();
  const sig=JSON.stringify([q,eyra.name,eyra.avatar.length+eyra.avatar.slice(-24),store.groupError,store.groupsLoaded,store.groupsUnsupported,store.contacts.map(c=>[c.id,c.name,c.description,store.avatarRev(c.id),c.ring,contactBusy(c),c.sessions]),store.groups.map(g=>[g.id,g.name,g.active,g.last,g.members.map(m=>[m.key,m.name,m.avatar_rev])])]);
  const me=profile(),signature=sig+JSON.stringify([me.version,me.name,me.userRingColor]);
  if(signature===pagePainted)return;pagePainted=signature;
  const match=text=>!q||text.toLowerCase().includes(q),focused=doc.activeElement?.closest?.('.cp-row')?.dataset.key ,rows=[];
  if(!store.people.some(c=>c.builtin==='eyra')&&match(eyra.name)){const face=ring(doc,eyra);bio.bind(face,{name:eyra.name,pinned:true});rows.push(contactRow({face,name:eyra.name,key:'eyra',cls:'cp-eyra',onOpen:openEyra}));}
  for(const c of store.people.filter(c=>match(c.name+' '+(c.description||'')))){
   const face=ring(doc,contactIdentity(c,store.avatar(c.id)),contactBusy(c)?'thinking':'idle');bio.bind(face,()=>c);
   const node=contactRow({face,name:c.name,desc:c.description,key:c.id,onOpen:()=>c.builtin==='eyra'?openEyra():c.sessions?.[0]?void openSession(c.sessions[0].id):void startSession(c),actions:[
    ['新会话',SVG.chat,async()=>{try{const s=await store.newSession(c.id);await openSession(s.id);}catch(e){report(e);}}],
    ['资料',SVG.edit,()=>editor.open(c.id)]]});
   if(c.program){node.dataset.program=c.program;node.setAttribute('aria-description','可建立独立的 OS 会话；程序内对话继续保留');}
   node.addEventListener('keydown',event=>{if(event.key==='Delete'&&event.target===node){event.preventDefault();void remove(c);}});rows.push(node);
  }
  const shownGroups=store.groups.filter(g=>match(g.name+' '+g.members.map(m=>m.name).join(' ')));
  const groupRows=[];if(store.groupError||store.groupsUnsupported||!store.groupsLoaded)groupRows.push(groupNotice('cp-empty'));
  for(const g of shownGroups){
   const face=groupFace(doc,g,id=>store.avatar(id),40);if(g.active)face.dataset.active='true';
   groupRows.push(contactRow({face,name:g.name,desc:g.members.map(m=>m.name).join('、'),key:'group:'+g.id,cls:'cp-group',onOpen:()=>void groups.open(g.id).catch(report)}));
  }
  const sessions=store.contacts.flatMap(c=>(c.sessions||[]).map(session=>({contact:c,session}))).sort((a,b)=>String(b.session.last?.at||b.session.activity||b.session.created||'').localeCompare(String(a.session.last?.at||a.session.activity||a.session.created||'')));
  const sessionRows=sessions.filter(({contact:c,session:s})=>match(c.name+' '+(s.title||'')+' '+(s.last?.text||''))).map(({contact:c,session:s})=>{
   const face=ring(doc,contactIdentity(c,store.avatar(c.id)),['queued','running'].includes(s.state)?'thinking':'idle');
   const node=contactRow({face,name:s.title||c.name,desc:lastText(s)||'暂无消息',summaryFrom:s.last?.from||'assistant',key:'session:'+s.id,cls:'cp-session',onOpen:()=>void openSession(s.id)});node.dataset.session=s.id;node.onclick=event=>{if(!event.target.closest('button'))void openSession(s.id);};node.ondblclick=null;node.oncontextmenu=event=>sessionMenu(event,s,c);return node;
  });
  for(const [id,items]of [['sessions',sessionRows],['people',rows],['groups',groupRows]]){
   const list=lists.get(id),top=list.scrollTop;
   const present=id==='people'||(id==='sessions'?sessions.length:store.groups.length||store.groupError);
   list.parentElement.hidden=!present;
   list.replaceChildren(...(items.length?items:q&&present?[el(doc,'p','cp-empty','没有匹配结果')]:[]));list.scrollTop=top;
  }
  for(const glide of pageGlides)glide.refresh();
  if(focused)grid.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
 }
 const editor=setupContactEditor({doc,store,report,openSession,remove,api});
 const groups=setupGroups(api,navigation,{doc,store,profile,onError,confirm});
 groupButton.onclick=()=>groupDialog({doc,store,confirm,report,save:(name,members,hostContact,requestID)=>store.createGroup(name,members,hostContact,requestID),afterSave:g=>groups.open(g.id)});
 const stopStore=store.subscribe(()=>{paintDrawer();paintPage();paintPicker();});
 // The sidebar comes back the way it was left. 联系人扩展页嵌在主窗口里，抽屉只归主窗口，扩展页不恢复（R63）。
 if(restoreDrawer&&stored('aieyra.sessions.open')==='1')requestAnimationFrame(()=>setDrawer(true,{remember:false}));
 return {store,groups,setDrawer,get open(){return isOpen;},openEditor:id=>editor.open(id),flushDrafts:()=>groups.flushDrafts(),close(){measureClosed=true;win.cancelAnimationFrame(measureFrame);measureFrame=0;dockResize?.disconnect();win.removeEventListener('resize',resized);doc.removeEventListener('workspace-theme-change',scheduleMeasure);doc.fonts?.removeEventListener('loadingdone',scheduleMeasure);stopStore();store.close();bio.close();previews.close();editor.close();groups.close();drawerGlide.close();for(const glide of pageGlides)glide.close();if(isOpen)setDrawer(false,{remember:false});closePicker();stopPickerKeys();picker.remove();drawer.remove();newButton.remove();menuButton.remove();peopleButton.remove();}};
}

// Small in-app confirmation; resolves true only on the explicit action.
export function confirmDialog({doc=document,title,body,action='确定',danger=true}){return new Promise(resolve=>{
 const dialog=el(doc,'dialog','contact-editor contact-confirm');dialog.setAttribute('aria-label',title);
 const form=el(doc,'form','cc-shell');form.method='dialog';form.append(el(doc,'h2','',title),el(doc,'p','',body));
 const foot=el(doc,'footer','ce-foot'),no=el(doc,'button','ce-secondary','取消'),yes=el(doc,'button','ce-primary'+(danger?' cc-danger':''),action);no.value='cancel';yes.value='ok';foot.append(no,yes);form.append(foot);dialog.append(form);doc.body.append(dialog);escapeCloses(dialog);
 dialog.addEventListener('close',()=>{resolve(dialog.returnValue==='ok');setTimeout(()=>dialog.remove(),320);},{once:true});dialog.showModal();no.focus();
});}

// Profile editor: one identity line (avatar, name, introduction), the prompt below,
// then model with its thinking choice and the toolbox. No form: nothing here can
// be blocked by validation, and every way out is an explicit button or key.
const THINK_NAMES={enabled:'开启',disabled:'关闭',none:'关闭',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'极致',auto:'自动',adaptive:'自适应',true:'开启',false:'关闭'};
const EDITOR_SVG={
 camera:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8.5A1.5 1.5 0 0 1 6 7h2l1.4-2h5.2L16 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 19H6a1.5 1.5 0 0 1-1.5-1.5Z"/><circle cx="12" cy="12.8" r="3.2"/></svg>',
 down:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
 check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg>',
};
export function setupContactEditor({doc,store,report,openSession,remove,api}){
 const dialog=el(doc,'dialog','contact-editor');dialog.setAttribute('aria-label','智能体资料');
 dialog.innerHTML=`<div class="ce-shell" tabindex="-1">
 <header class="ce-id">
  <div class="ce-face-wrap"><button type="button" class="ce-avatar" aria-label="更换头像" aria-haspopup="listbox" aria-expanded="false" title="更换头像"><span class="ce-avatar-cue">${EDITOR_SVG.camera}</span></button></div>
  <div class="ce-idtext"><input class="ce-name" maxlength="120" autocomplete="off" spellcheck="false" aria-label="名字"><textarea class="ce-bio" rows="1" maxlength="1000" spellcheck="false" placeholder="点击此处进行修改" aria-label="简介"></textarea></div>
  <button type="button" class="ce-close ui-icon-button" aria-label="关闭" title="关闭">${SVG.close}</button>
 </header>
 <section class="ce-prompt-wrap" aria-label="提示词"><nav class="ce-prompt-layer ui-tabs" role="tablist" aria-label="提示词分区"></nav><textarea class="ce-prompt" spellcheck="false" placeholder="它是谁、怎么说话、擅长什么。留空则使用默认对话模板。" aria-label="当前分区提示词"></textarea></section>
 <div class="ce-rows" role="tabpanel" aria-label="资料设置">
  <div class="ce-row"><span class="ce-label">模型</span><button type="button" class="ce-pick ce-model" aria-haspopup="listbox"><span class="ce-pick-text"></span>${EDITOR_SVG.down}</button></div>
  <div class="ce-row ce-think-row" hidden><span class="ce-label">思考</span><div class="ce-think" role="radiogroup" aria-label="思考"></div></div>
  <div class="ce-row ce-tools-row"><span class="ce-label">工具</span><div class="ce-chips"></div><button type="button" class="ce-add" aria-haspopup="listbox" aria-label="管理工具" title="管理工具">${SVG.plus}</button></div>
  <label class="ce-row ce-user-color-row" hidden><span class="ce-label">边框</span><select class="ce-user-color" aria-label="用户头像边框颜色"></select></label>
 </div>
 <footer class="ce-foot"><p class="ce-error" role="alert" hidden></p><button type="button" class="ce-delete">删除</button><button type="button" class="ce-secondary ce-cancel">取消</button><button type="button" class="ce-primary ce-save">保存</button></footer>
 </div>
 <div class="ce-menu" role="listbox" hidden><div class="ce-menu-viewport soft-scroll" role="presentation"></div></div>
 <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden>`;
 doc.body.append(dialog);
 const q=s=>dialog.querySelector(s),shell=q('.ce-shell'),nameInput=q('.ce-name'),bioInput=q('.ce-bio'),promptInput=q('.ce-prompt'),menu=q('.ce-menu'),file=q('input[type=file]');
 const menuViewport=q('.ce-menu-viewport'),menuGlide=hoverGlide(menuViewport,'.ce-option',{doc});
 let state=null,ticket=0,menuOwner=null,thinkTicket=0;
 const userColor=q('.ce-user-color');
 userColor.onchange=()=>{if(state&&!state.saving){state.userColor=userColor.value;paintFace();}};
 setModelTooltip(q('.ce-model'),()=>state?.models.find(m=>m.id===state.model));
 // Fixed conversation capabilities and Core conversationWorkTools. The
 // controller regression checks this list against the actual Core allowlist.
 const TOOLS=[
  {id:'web_search',name:'网页搜索',desc:'查最新资料并给出来源',fixed:true},
  {id:'view_image',name:'看图',desc:'查看你发来的图片',fixed:true},
  {id:'agents',name:'Link 协作',desc:'在当前会话中沟通与交接',fixed:true},
  {id:'memory',name:'记忆与上下文',desc:'维护自己的记忆、回查原文并整理上下文',fixed:true},
  {id:'update_plan',name:'计划',desc:'分步骤记录并更新进度'},
  {id:'report',name:'报告',desc:'发布可阅读、关闭和重开的报告'},
  {id:'project',name:'项目',desc:'查看项目并管理工程工作目录',risk:true},
  {id:'terminal',name:'终端',desc:'在工作目录里运行命令',risk:true},
  {id:'exec_command',name:'执行命令',desc:'执行命令并保留终端会话',risk:true},
  {id:'write_stdin',name:'终端输入',desc:'向运行中的终端会话发送输入',risk:true},
  {id:'read_shell_output',name:'终端输出',desc:'读取运行中终端会话的输出'},
  {id:'apply_patch',name:'修改文件',desc:'按补丁写入工作目录里的文件',risk:true},
 ];
 const PROGRAM_TOOLS=[
  {id:'toolbox',name:'工具箱',desc:'按需打开与调用所属能力',fixed:true},
  {id:'browser',name:'浏览器',desc:'访问、观察、截图和操作网页'},
  {id:'settings',name:'系统设置',desc:'读取与修改同一OS配置'},
  {id:'software_api',name:'软件接口',desc:'操作程序、模块及其公开API'},
  {id:'link',name:'Link',desc:'连接、工位和协作事项'},
  {id:'server',name:'服务器',desc:'服务器、SSH和探针管理'},
  {id:'community',name:'主题与资源',desc:'资源中心、图片、程序与社区'},
  {id:'cloud_report',name:'更新与反馈',desc:'更新诊断及既有官方流程'},
  {id:'image_gen',name:'图像生成',desc:'生成、编辑和持久图像批次'},
  {id:'video_gen',name:'视频生成',desc:'提交、查询和恢复视频任务'},
  {id:'computer',name:'电脑操作',desc:'观察与操作原生窗口'},
  {id:'tool_factory',name:'工具管理',desc:'发现和管理版本化工具'},
  {id:'human',name:'等待决定',desc:'保存需要用户处理的事项'},
  {id:'compact',name:'上下文整理',desc:'整理当前会话上下文'},
 ];
 const availableTools=()=>state?.contact?.program?[...TOOLS,...PROGRAM_TOOLS]:TOOLS;
 const error=text=>{q('.ce-error').textContent=text||'';q('.ce-error').hidden=!text;};
 const name=()=>nameInput.value.trim()||'智能体';
 let selectedPrompt=0;
 const promptRows=()=>state?.promptRows||[];
 const capturePrompt=()=>{const row=promptRows()[selectedPrompt];if(!row)return;editPromptSection(row.section,promptInput.value);for(const source of state.promptSources)source.draft=joinPromptSections(source.sections);};
 function displayPrompt(index){capturePrompt();selectedPrompt=index;const row=promptRows()[index];promptInput.value=row?.section.draft||'';promptInput.scrollTop=0;for(const [i,button]of [...q('.ce-prompt-layer').children].entries()){button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;}}
 tabKeyboard(q('.ce-prompt-layer'));
 promptInput.addEventListener('input',capturePrompt);
 const snapshot=()=>JSON.stringify([state?.promptSources.map(p=>p.draft),name(),bioInput.value.trim(),state.model,JSON.stringify(state.params||null),[...state.tools].sort(),state.avatarChanged?state.avatar:'',state.avatarRotation,state.ring,state.userColor]);
 const dirty=()=>!!state&&snapshot()!==state.initial;
 // A submitted form stays unchanged until its receipt. Native inert also
 // covers controls painted by a pending thinking read; leaving stays available.
 function lockEditing(mine){
  mine.editLock=[...dialog.querySelectorAll('input,textarea,button,select')].filter(node=>!node.matches('.ce-close,.ce-cancel')).map(node=>({node,disabled:node.disabled,readOnly:node.readOnly}));
  for(const {node}of mine.editLock){node.disabled=true;if('readOnly'in node)node.readOnly=true;}
  mine.inertLock=['.ce-face-wrap','.ce-idtext','.ce-prompt-wrap','.ce-rows'].map(selector=>{const node=q(selector),inert=node.inert;node.inert=true;return {node,inert};});
 }
 function unlockEditing(mine){
  for(const {node,disabled,readOnly}of mine?.editLock||[]){node.disabled=disabled;if('readOnly'in node)node.readOnly=readOnly;}
  for(const {node,inert}of mine?.inertLock||[])node.inert=inert;
  if(mine){mine.editLock=null;mine.inertLock=null;}
 }

 // ---------- Identity: click the face to change it, click the text to edit it ----------
 function paintFace(){
  // Closing blurs the name field after the state is gone.
  if(!state)return;
  const host=q('.ce-avatar'),old=host.querySelector('.role-ring');
  host.querySelector('.cp-self-face')?.remove();
  if(state.contact?.builtin==='user'){old?.remove();host.prepend(selfFace(doc,name(),state.avatar,state.userColor));}
  else {const identity=contactIdentity({...state.contact,ring:state.ring,name:name()},state.avatar);if(old)paintRoleRing(old,identity,'idle',doc);else host.prepend(ring(doc,identity));}
 }
 function paintSavedAvatar(mine,picture){
  // Opening another editor, saving, or choosing an avatar ends this read's
  // ownership. Receiving a saved image never turns it into a manual edit.
  if(!mine?.contact||mine.roleEdit||state!==mine||!dialog.open||mine.saving||mine.avatarChanged||!picture||picture.rev!==(mine.contact.avatar_rev||0)||mine.avatar===picture.url)return;
  mine.avatar=picture.url;paintFace();
 }
 async function loadSavedAvatar(mine){if(mine?.contact&&!mine.roleEdit&&store.loadAvatar)paintSavedAvatar(mine,await store.loadAvatar(mine.contact));}
 // A failed first read may recover through the existing polling/backoff path.
 // The subscription belongs to this editor component, not to each opening.
 const stopSavedAvatars=store.subscribe?.(()=>{const mine=state,id=mine?.contact?.id;if(id)paintSavedAvatar(mine,{rev:store.avatarRev(id),url:store.avatar(id)});});
 function invalidateAvatar(mine){if(mine)mine.avatarTicket++;q('.ce-avatar').removeAttribute('aria-busy');}
 const currentAvatar=(mine,stamp)=>state===mine&&!mine.saving&&mine.avatarTicket===stamp;
 function finishAvatar(mine,stamp){if(state===mine&&mine.avatarTicket===stamp)q('.ce-avatar').removeAttribute('aria-busy');}
 const avatarPreference=(mine,mode)=>({mode,intervalSeconds:mine?.avatarRotation?.intervalSeconds||900,nextAt:0,id:'',digest:''});
 function acceptAvatar(mine,stamp,value,rotation){
  if(!currentAvatar(mine,stamp))return;
  if(typeof value!=='string'||!value)throw Error('头像资源无效，请重新选择');
  mine.avatar=value;mine.avatarRotation=rotation?structuredClone(rotation):avatarPreference(mine,'custom');mine.avatarChanged=true;mine.avatarRotationChanged=true;paintFace();error('');
 }
 const fitBio=()=>{bioInput.style.height='auto';bioInput.style.height=Math.min(bioInput.scrollHeight,66)+'px';};
 // Enter keeps the edit, Esc puts back what was there; neither reaches the dialog.
 for(const input of [nameInput,bioInput]){
  input.addEventListener('focus',()=>{input.dataset.before=input.value;});
  input.addEventListener('keydown',event=>{
   if(event.isComposing)return;
   if(event.key==='Enter'&&!(input===bioInput&&event.shiftKey)){event.preventDefault();event.stopPropagation();shell.focus();}
   else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();input.value=input.dataset.before??input.value;shell.focus();}
  });
 }
 nameInput.addEventListener('blur',()=>{if(!nameInput.value.trim())nameInput.value=nameInput.dataset.before?.trim()||'智能体';paintFace();});
 nameInput.addEventListener('input',()=>{if(state)paintFace();});
 bioInput.addEventListener('input',fitBio);bioInput.addEventListener('blur',()=>{bioInput.value=bioInput.value.trim();fitBio();});
 async function takeAvatar(f){
  const mine=state;if(!f||!mine||mine.saving)return;
  if(!/^image\/(png|jpeg|webp|gif|bmp)$/.test(f.type||''))return error('请选择一张图片');
  const stamp=++mine.avatarTicket;q('.ce-avatar').setAttribute('aria-busy','true');
  try{
   const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('无法读取这张图片'));reader.onload=()=>resolve(reader.result);reader.readAsDataURL(f);});
   if(!currentAvatar(mine,stamp))return;
   const cropped=await cropImage(url,{doc,title:'裁切头像',round:true,frame:[300,300],output:[192,192],previews:[{label:'列表',size:42}]});
   if(cropped)acceptAvatar(mine,stamp,cropped);
  }catch(e){if(currentAvatar(mine,stamp))error(e.message);}finally{finishAvatar(mine,stamp);}
 }
 async function chooseAvatar(source,seconds){
  const mine=state;if(!mine||mine.saving)return;
  const stamp=++mine.avatarTicket;q('.ce-avatar').setAttribute('aria-busy','true');
  try{
   const chosen=source==='theme'?await pickTheme(api,{target:'avatar'}):check(await api.themeLibrary({action:'prepare',target:'avatar',mode:'random',intervalSeconds:seconds||mine.avatarRotation?.intervalSeconds||900,exclude_id:mine.avatarRotation?.id||''}));
   if(chosen)acceptAvatar(mine,stamp,chosen.value,chosen.rotation);
  }catch(e){if(currentAvatar(mine,stamp))error(e.message);}finally{finishAvatar(mine,stamp);}
 }
 function avatarOptions(intervals=false){
  const anchor=q('.ce-avatar'),mine=state;
  if(!mine||mine.saving)return;
  const current=mine.avatarRotation;
  const choosePeriod=seconds=>{
   if(current?.mode!=='random')return chooseAvatar('random',seconds);
   invalidateAvatar(mine);
   if(current.intervalSeconds!==seconds){mine.avatarRotation={...current,intervalSeconds:seconds,nextAt:Date.now()+seconds*1000};mine.avatarRotationChanged=true;}
   error('');
  };
  const choices=intervals?[['返回',()=>avatarOptions()],...ROTATION_PRESETS.map(([seconds,label])=>[label,()=>choosePeriod(seconds),current?.mode==='random'&&seconds===current.intervalSeconds])]:[
   ['头像库',()=>chooseAvatar('theme')],['随机',()=>avatarOptions(true)],['自定义',()=>{invalidateAvatar(mine);file.click();}],
   ['移除',()=>{invalidateAvatar(mine);mine.avatar='';mine.avatarRotation=avatarPreference(mine,'off');mine.avatarChanged=true;mine.avatarRotationChanged=true;paintFace();}]
  ];
  openMenu(anchor,choices.map(([label,action,selected])=>{const b=el(doc,'button','ce-option',label);b.type='button';b.setAttribute('role','option');if(selected!==undefined)b.setAttribute('aria-selected',String(selected));b.onclick=()=>{closeMenu(true);if(state===mine&&!mine.saving)action();};return b;}),intervals?'随机时间':'头像来源');
 }
 q('.ce-avatar').onclick=()=>menuOwner===q('.ce-avatar')?closeMenu(true):avatarOptions();
 file.onchange=()=>{const f=file.files?.[0];file.value='';void takeAvatar(f);};
 // A picture dropped on the face is for the face only, never for the message box.
 q('.ce-avatar').addEventListener('dragover',event=>{if([...event.dataTransfer?.items||[]].some(i=>i.kind==='file')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';q('.ce-avatar').dataset.drop='true';}});
 q('.ce-avatar').addEventListener('dragleave',()=>{delete q('.ce-avatar').dataset.drop;});
 q('.ce-avatar').addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();delete q('.ce-avatar').dataset.drop;void takeAvatar(event.dataTransfer?.files?.[0]);});

 // ---------- One floating list for avatar sources, the model and toolbox ----------
 function closeMenu(focus=false){if(menu.hidden)return;const owner=menuOwner;menu.hidden=true;menuOwner=null;owner?.setAttribute('aria-expanded','false');if(focus)owner?.focus();}
 function openMenu(anchor,items,label){
  closeMenu();menuOwner=anchor;anchor.setAttribute('aria-expanded','true');menu.setAttribute('aria-label',label);
  if(anchor===q('.ce-add'))menu.setAttribute('aria-multiselectable','true');else menu.removeAttribute('aria-multiselectable');
  menuViewport.replaceChildren(...items);menu.hidden=false;menuViewport.scrollTop=0;
  const box=dialog.getBoundingClientRect(),r=anchor.getBoundingClientRect(),h=menu.offsetHeight,w=Math.min(menu.offsetWidth,box.width-24);
  const below=box.bottom-r.bottom-12,top=below>=h+6?r.bottom-box.top+6:Math.max(12,r.top-box.top-h-6);
  menu.style.top=top+'px';menu.style.left=Math.max(12,Math.min(r.left-box.left,box.width-w-12))+'px';
  menuGlide.refresh();animateUI(menu,[{opacity:0,translate:'0 '+(top<r.top-box.top?6:-6)+'px',scale:.98},{opacity:1,translate:'0 0',scale:1}],{kind:'fast',key:'pop'});
  const focused=menu.querySelector('button.ce-option[aria-selected=true]')||menu.querySelector('button.ce-option');
  focused?.focus({preventScroll:true});
  focused?.scrollIntoView({block:'nearest',container:'nearest'});
 }
 shell.addEventListener('scroll',()=>closeMenu(),{passive:true});
 const stopMenuKeys=bindMenuKeys(menu,{items:()=>menu.querySelectorAll('button.ce-option'),onEscape:()=>closeMenu(true)});
 menu.addEventListener('keydown',event=>{if(event.key==='Tab')closeMenu();});
 dialog.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!menuOwner?.contains(event.target))closeMenu();});

 // ---------- Model and its thinking ----------
 const modelName=id=>{const m=state.models.find(m=>m.id===id);return m?m.name||m.model:id||'跟随 Eyra';};
 function paintModel(){q('.ce-model').disabled=false;q('.ce-model').removeAttribute('title');q('.ce-model .ce-pick-text').textContent=modelName(state.model);q('.ce-model').dataset.empty=String(!state.model);setModelTooltip(q('.ce-model'),()=>state?.models.find(m=>m.id===state.model));}
 q('.ce-model').onclick=()=>{
  if(menuOwner===q('.ce-model'))return closeMenu(true);
  if(!state.models.length){error('模型池里还没有可用的对话模型，请先在设置中添加。');return;}
  openMenu(q('.ce-model'),[...(state.contact?.builtin?[]:[{id:'',name:'跟随 Eyra'}]),...state.models].map(m=>{
   const b=el(doc,'button','ce-option');b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(m.id===state.model));
   const text=el(doc,'span','ce-option-text');text.append(el(doc,'b','',m.name||m.model),el(doc,'small','',[m.model!==m.name?m.model:'',m.context_window?Math.round(m.context_window/1000)+'K':''].filter(Boolean).join(' · ')));
   const mark=el(doc,'span','ce-option-mark');if(m.id===state.model)mark.innerHTML=EDITOR_SVG.check;b.append(text,mark);
   setModelTooltip(b,m);b.onclick=()=>{closeMenu(true);if(m.id===state.model)return;state.model=m.id;state.params=null;paintModel();void loadThinking();};return b;
  }),'模型');
 };
 // The choice is kept as a patch over the model's own parameters; "跟随模型" is no patch.
 async function loadThinking(change){
  const mine=state,id=state.model,n=++thinkTicket,row=q('.ce-think-row');
  if(state.contact?.builtin||!id||!api?.onboard){row.hidden=true;return;}
  try{
   const r=check(await api.onboard({action:'pool',op:'agent_thinking',id,...(change?{key:change.key,value:change.value}:{patch:state.params||{}})}));
   if(state!==mine||n!==thinkTicket||state.model!==id)return;
   if(change)state.params=Object.keys(r.patch||{}).length?r.patch:null;
   state.thinking=r.thinking;paintThinking();
  }catch(e){if(state===mine&&n===thinkTicket){if(change)error(e.message);else{state.thinking=null;paintThinking();}}}
 }
 function paintThinking(){
  const t=state.thinking,row=q('.ce-think-row'),host=q('.ce-think');
  // Budgets are numbers; the agent keeps them on the model pool's setting.
  if(!t||t.type==='integer'||!t.values?.length){row.hidden=true;host.replaceChildren();return;}
  row.hidden=false;
  const options=[['','跟随模型'],...t.values.map(v=>[String(v),THINK_NAMES[String(v)]||String(v)])],current=String(t.value??'');
  host.replaceChildren(...options.map(([value,label])=>{const b=el(doc,'button','ce-seg',label);b.type='button';b.setAttribute('role','radio');b.setAttribute('aria-checked',String(value===current));b.tabIndex=value===current?0:-1;
   b.onclick=()=>{if(value!==current)state.thinkingChange=loadThinking({key:t.key,value});};
   b.onkeydown=event=>{const d=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;if(!d)return;event.preventDefault();const all=[...host.children],n=all[(all.indexOf(b)+d+all.length)%all.length];n.focus();n.click();};return b;}));
 }

 // ---------- Toolbox ----------
 function paintTools(){
  const host=q('.ce-chips');q('.ce-add').hidden=!!state.contact?.builtin;
  host.replaceChildren(...availableTools().filter(t=>t.fixed||state.tools.has(t.id)).map(t=>{
   const chip=el(doc,'span','ce-chip',t.name);chip.title=t.desc;
   return chip;}));
 }
 async function addTool(tool,mine){
  if(state!==mine||mine.saving)return false;
  if(tool.risk&&!mine.confirmed.has(tool.id)){
   const ok=await confirmDialog({doc,title:'给「'+name()+'」添加'+tool.name+'？',body:tool.desc+'。添加后，此智能体会获得该工具的实际执行权限。',action:'添加',danger:false});
   if(!ok||state!==mine||mine.saving)return false;mine.confirmed.add(tool.id);
  }
  mine.tools.add(tool.id);return true;
 }
 function toolOptions(){
  const mine=state;
  return availableTools().map(t=>{
   // Search and vision are part of every agent: shown, not switchable.
   const on=t.fixed||state.tools.has(t.id),b=el(doc,t.fixed?'div':'button','ce-option ce-tool-option');if(!t.fixed)b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(on));b.dataset.tool=t.id;
   const text=el(doc,'span','ce-option-text');text.append(el(doc,'b','',t.name),el(doc,'small','',t.desc));
   const mark=el(doc,'span','ce-option-act');mark.setAttribute('aria-hidden','true');if(t.fixed){mark.textContent='始终';b.setAttribute('aria-disabled','true');}else mark.innerHTML=EDITOR_SVG.check;
   b.append(text,mark);
   let pending=false;
   b.onclick=async()=>{
    if(t.fixed||state!==mine||mine.saving||pending)return;
    pending=true;
    try{
     if(mine.tools.has(t.id))mine.tools.delete(t.id);else await addTool(t,mine);
     if(state!==mine||mine.saving)return;
     b.setAttribute('aria-selected',String(mine.tools.has(t.id)));
     paintTools();
     if(menu.contains(b)&&!menu.hidden)b.focus({preventScroll:true});
    }finally{pending=false;}
   };
   return b;});
 }
 q('.ce-add').onclick=()=>{if(menuOwner===q('.ce-add'))return closeMenu(true);openMenu(q('.ce-add'),toolOptions(),'工具');};

 // ---------- Leaving: × / 取消 / Esc ask before dropping unsaved changes ----------
 let closing=false;
 async function leave(){
  if(closing||!dialog.open)return;closeMenu();
  // A save under way keeps going; leaving just stops watching it (a failure is still reported).
  if(dirty()&&!state.saving){closing=true;const ok=await confirmDialog({doc,title:'放弃未保存的修改？',body:'关闭后，这次的修改不会保留。',action:'放弃'});closing=false;if(!ok)return;}
  dialog.close();
 }
 q('.ce-close').onclick=q('.ce-cancel').onclick=()=>void leave();
 dialog.addEventListener('cancel',event=>{event.preventDefault();void leave();});
 dialog.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();if(!menu.hidden)closeMenu(true);else void leave();}
  else if((event.ctrlKey||event.metaKey)&&(event.key==='Enter'||event.key==='s')){event.preventDefault();void save();}
 });
 // A save belongs to the editing that started it: if that editor was closed and
 // another opened meanwhile, a late answer neither closes nor marks the new one.
 async function save(){
  const mine=state;if(!mine||mine.saving)return;closeMenu();
  invalidateAvatar(mine);mine.saving=true;lockEditing(mine);error('');
  const here=()=>state===mine&&dialog.open;
  // What is on screen now is what gets saved, even if the editor is left meanwhile.
  capturePrompt();const label=name(),prompt=mine.promptSources[0]?.draft||'',description=bioInput.value.trim(),tools=[...mine.tools].sort(),before=(mine.contact?.tools||[]).filter(t=>!TOOLS.some(tool=>tool.fixed&&tool.id===t)).sort();
  const promptChanges=mine.roleEdit?.prompts.filter(p=>p.draft!==p.text).map(p=>({id:p.id,version:p.version,text:p.draft}));
  try{
   // The newest thinking choice is part of this save, however late its answer.
   for(let p;p!==mine.thinkingChange;)await (p=mine.thinkingChange);
   if(mine.contact?.builtin==='user'){
    check(await api.builtinRole({action:'save',builtin:'user',profile_version:mine.roleEdit.profile_version,...(mine.userColor!==mine.roleEdit.user_ring_color?{user_ring_color:mine.userColor}:{}),...(mine.avatarChanged?{avatar:mine.avatar}:{}),...(mine.avatarRotationChanged?{avatar_rotation:mine.avatarRotation}:{})}));
    if(here())dialog.close();
   }else if(mine.roleEdit){
    const r=mine.roleEdit;
    check(await api.builtinRole({action:'save',builtin:mine.contact.builtin,profile_version:r.profile_version,name:label,description,...(mine.avatarChanged?{avatar:mine.avatar||''}:{}),...(mine.avatarRotationChanged?{avatar_rotation:mine.avatarRotation}:{}),prompts:promptChanges,...(mine.model!==r.model_id?{model_id:mine.model,model_version:r.model_version}:{})}));
    await store.refresh();if(here())dialog.close();
   }else if(!mine.contact){
    const c=await store.create({name:label,description,prompt_text:prompt,model_id:mine.model,...(mine.avatarChanged?{avatar:mine.avatar||''}:{}),...(mine.avatarRotationChanged?{avatar_rotation:mine.avatarRotation}:{}),tools,...(mine.params?{model_parameters:mine.params}:{})});
    if(here()){dialog.close();await openSession(c.sessions[0].id);}
   }else{
    const c=mine.contact,p={id:c.id,name:label,description};
    if(mine.avatarChanged)p.avatar=mine.avatar||'';
    if(mine.avatarRotationChanged)p.avatar_rotation=mine.avatarRotation;
    if(mine.model!==(c.model_inherited?'':c.model_id)){p.model_id=mine.model;if(!mine.model)p.model_unconfigured=true;}
    if(JSON.stringify(mine.params||null)!==JSON.stringify(c.model_parameters||null))p.model_parameters=mine.params||null;
    if(prompt!==mine.prompt){p.prompt_text=prompt;p.prompt_hash=mine.promptHash;}
    if(tools.join()!==before.join())p.tools=tools;
    await store.update(p);if(here())dialog.close();
   }
  }catch(e){if(here())error(e.message);else report(e);}
  finally{mine.saving=false;if(state===mine)unlockEditing(mine);}
 }
 q('.ce-save').onclick=()=>void save();
 q('.ce-delete').onclick=async()=>{const mine=state,c=mine?.contact;if(c&&await remove(c)&&state===mine)dialog.close();};
 dialog.addEventListener('close',()=>{if(dialog.open)return;closeMenu();unlockEditing(state);state=null;error('');});

 // Chat models only: an image model cannot hold a conversation.
 async function chatModels(){
  const [rows,view]=await Promise.all([store.models(),api?.onboard?api.onboard({action:'pool',op:'view'}).catch(()=>null):null]);
  const kinds=new Map((view?.models||[]).map(m=>[m.id,m]));
  return (Array.isArray(rows)?rows:[]).filter(m=>{const v=kinds.get(m.id);return !v||v.kind==='chat'&&v.enabled!==false;}).map(m=>({...kinds.get(m.id),...m,context_window:m.context_window||kinds.get(m.id)?.context_window||0}));
 }
 async function open(id){
  if(dialog.open)return;unlockEditing(state);error('');const mine=++ticket;
  try{
   const self=id===selfContact;
   const [models,detail]=self?[[],{builtin:'user'}]:await Promise.all([chatModels(),id?store.detail(id):null]);
   if(mine!==ticket||dialog.open)return;
   const roleEdit=detail?.builtin?check(await api.builtinRole({action:'read',builtin:detail.builtin})):null;
   if(mine!==ticket||dialog.open)return;
   if(roleEdit)for(const p of roleEdit.prompts)p.draft=p.text;
   const model=detail?.builtin?roleEdit.model_id||'':detail?.model_inherited?'':detail?.model_id||'';
   state={ring:roleEdit?.ring||detail?.ring||'orbit',contact:detail,roleEdit,models,model,params:detail?.model_parameters&&Object.keys(detail.model_parameters).length?detail.model_parameters:null,thinking:null,
    avatar:roleEdit?.avatar??(detail&&detail.avatar_rev!==0?store.avatar(detail.id):''),avatarChanged:false,avatarTicket:0,avatarRotationChanged:false,
    avatarRotation:structuredClone(roleEdit?.avatar_rotation||detail?.avatar_rotation||{mode:(roleEdit?.avatar||(detail&&(detail.avatar_rev??store.avatar(detail.id))))?'custom':'off',intervalSeconds:900,nextAt:0,id:'',digest:''}),prompt:detail?.prompt??'',promptHash:detail?.prompt_hash||'',
    tools:new Set((detail?.tools||[]).filter(t=>!TOOLS.some(tool=>tool.fixed&&tool.id===t))),confirmed:new Set(detail?.tools||[])};
   invalidateAvatar(state);
   if(detail&&model&&!models.some(m=>m.id===model))models.unshift({id:model,name:model});
   dialog.dataset.self=String(self);dialog.setAttribute('aria-label',self?'我的资料':'智能体资料');
   nameInput.readOnly=self;q('.ce-user-color-row').hidden=!self;
   if(self){
    state.userColor=roleEdit.user_ring_color;
    userColor.replaceChildren(...roleEdit.palette.map(row=>{const option=el(doc,'option','',row.name);option.value=row.color;return option;}));
    userColor.value=state.userColor;
   }
   nameInput.maxLength=roleEdit?40:120;nameInput.value=roleEdit?.name||detail?.name||'智能体';bioInput.value=roleEdit?.description??detail?.description??'与你协作的助手';
   state.promptSources=roleEdit?.prompts||[{id:'contact',title:'提示词',text:state.prompt,draft:state.prompt}];
   for(const source of state.promptSources)source.sections=roleEdit&&roleEdit.prompts.length>1?[{id:source.id,title:source.title,prefix:'',present:true,order:0,text:source.draft,draft:source.draft}]:promptSections(source.draft);
   state.promptRows=state.promptSources.flatMap(source=>source.sections.map(section=>({source,section})));
   selectedPrompt=0;promptInput.value=state.promptRows[0]?.section.draft||'';
   q('.ce-prompt-layer').replaceChildren(...state.promptRows.map((row,index)=>{const b=el(doc,'button','',row.section.title);b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-selected',String(index===0));b.tabIndex=index===0?0:-1;b.onclick=()=>displayPrompt(index);return b;}));
   q('.ce-save').textContent=detail?'保存':'创建';q('.ce-save').disabled=false;q('.ce-delete').hidden=!detail||!!detail.builtin||!!detail.program;
   paintFace();paintModel();paintTools();q('.ce-think-row').hidden=true;
   state.initial=snapshot();
   dialog.showModal();fitBio();promptInput.scrollTop=0;
   // A new agent starts at its name; an existing one opens without stealing a field.
   if(detail)shell.focus({preventScroll:true});else{nameInput.focus();nameInput.select();}
   void loadThinking();
   void loadSavedAvatar(state);
  }catch(e){if(mine===ticket)report(e);}
 }
 return {open,close(){if(dialog.open)dialog.close();stopSavedAvatars?.();stopMenuKeys();menuGlide.close();dialog.remove();}};
}
