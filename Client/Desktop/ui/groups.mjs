// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: SVG; check; STATE; el; iconButton; clock; groupFace; setupGroups; createGroupSubmission; groupDialog
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/groups.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {createRoleRing,paintRoleRing,roleIdentity} from './role-identity.mjs';
import {bindChatSurface} from './chat-layout.mjs';
import {setupChatColumn} from './chat-column.mjs';
import {setupWorkParticipants} from './work-participants.mjs';
import {workingState,workNeedsAttention,workText} from './work-selection.mjs';
import {setupStage} from './stage.mjs';
import {hoverGlide} from './glide.mjs';
import {setupChoicePopover,positionMenu} from './interaction.mjs';
// Group chats ride an OS-internal Link channel in Core. This page shows the
// discussion and member work in the same scroller, and opens the group station.
const SVG={
 back:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
 station:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6"/></svg>',
 members:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9.5" cy="8.5" r="3.2"/><path d="M3.8 19.2a5.7 5.7 0 0 1 11.4 0"/><path d="M17 8v6M14 11h6"/></svg>',
 send:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
 close:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};
const check=value=>{if(value?.ok===false)throw Object.assign(Error(value.error||'操作未完成'),{code:value.code,rejected:true});return value;};
const STATE={idle:'空闲',replying:'回复中',working:'工作中',queued:'排队中',waiting_user:'等待输入',cancelling:'正在停止',failed:'失败',timed_out:'超时',interrupted:'已中断',persistence_failed:'保存失败'};
function el(doc,tag,cls,text){const node=doc.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;}
function iconButton(doc,cls,label,icon){const b=el(doc,'button',cls);b.type='button';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=icon;return b;}
export function clock(at){const d=new Date(at);return Number.isFinite(d.getTime())?String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'):'';}

// Up to three member faces inside one circle; the rail and drawer share it.
export function groupFace(doc,group,avatar,size=40){
 const face=el(doc,'span','group-face');face.style.setProperty('--size',size+'px');face.setAttribute('aria-hidden','true');
 face.dataset.count=String((group.members||[]).length);face.append(el(doc,'span','group-face-glyph',[...(group.name||'群')][0]));
 return face;
}

export function setupGroups(api,navigation,{doc=document,store,profile=()=>({}),onError=()=>{},confirm}){
 const $=id=>doc.getElementById(id),report=e=>onError(String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));
 const call=p=>api.conversation(p).then(check);
 const page=el(doc,'section','group-page embedded-panel');page.id='group-view';page.setAttribute('aria-label','群聊');
 page.innerHTML=`<header class="gv-head"><button type="button" class="gv-icon gv-back" aria-label="返回联系人" title="返回联系人">${SVG.back}</button><span class="gv-face"></span><div class="gv-title"><h2></h2><small></small></div><button type="button" class="gv-station-button" aria-label="打开群工位" title="群工位"><span class="gv-station-ring"></span><span class="gv-station-count"></span></button><button type="button" class="gv-icon gv-members-button" aria-label="成员管理" title="成员管理">${SVG.members}</button></header>
 <main class="gv-scroll soft-scroll" tabindex="0" aria-label="群聊记录"><div class="gv-messages shared-chat-messages" role="log" aria-live="polite"></div><section class="gv-working" aria-label="正在工作的成员" hidden></section></main>
 <footer class="gv-composer"><div class="gv-mention" role="listbox" aria-label="点名成员" hidden></div><textarea rows="1" aria-label="发到群里" placeholder="发到群里，@ 点名"></textarea><button type="button" class="gv-send" aria-label="发送" title="发送 (Enter)">${SVG.send}</button></footer>
 <aside class="gv-station" aria-label="群工位" hidden><header><h3>群工位</h3><button type="button" class="gv-icon gv-station-close" aria-label="收起群工位">${SVG.close}</button></header><div class="gv-station-body soft-scroll"></div></aside>`;
 $('view-content').append(page);navigation.register('group-view');
 page.querySelector('.gv-back').onclick=()=>navigation.open('contacts-view','联系人');
 const q=s=>page.querySelector(s),input=q('textarea'),list=q('.gv-messages'),scroll=q('.gv-scroll'),working=q('.gv-working'),station=q('.gv-station'),mention=q('.gv-mention');
 const previewRoot=el(doc,'aside','team-exec shared-work-previews'),workLayout=el(doc,'div','conversation-work-layout');previewRoot.hidden=true;scroll.replaceWith(workLayout);workLayout.append(scroll,previewRoot);const previews=setupStage(previewRoot,{api,doc,roles:[],getProfile:profile,readReceipt:(item,{snapshot,member_id,...offsets})=>api.conversation({action:'group_receipt',group_id:snapshot.session_id,member_id,call_id:item.id,receipt_generation:item.generation,...offsets})});
 const mentionGlide=hoverGlide(mention,'.gv-pick',{doc});
 let current='',view=null,timer=0,closed=false,paused=false,epoch=0,sending=false,composing=false,polling=null,follow=true,seq=0,messages=[],stationSig='',older=false,loadingOlder=null;
 const reading=mine=>!closed&&!paused&&mine===epoch;
 function invalidateReads(){epoch++;clearTimeout(timer);timer=0;polling=null;loadingOlder=null;}
 // Drafts belong to their group; an unconfirmed send keeps its text and request id for an exact retry.
 const drafts=new Map(),draftStates=new Map(),pending=new Map(),submitted=new Map();
 function draftState(id){let value=draftStates.get(id);if(!value){value={text:'',revision:'missing',sequence:0,saved:0,timer:0,writing:null,loaded:false};draftStates.set(id,value);}return value;}
 function setDraft(id,text,{delay=true}={}){
  const state=draftState(id);if(state.text===text)return;state.text=text;drafts.set(id,text);state.sequence++;
  if(state.timer)clearTimeout(state.timer);state.timer=0;
  if(delay&&api.groupDraft)state.timer=setTimeout(()=>{state.timer=0;void flushDraft(id).catch(e=>onError('群聊草稿未保存，当前输入仍保留：'+e.message));},280);
 }
 async function loadDraft(id,mine){
  const state=draftState(id);if(state.loaded||!api.groupDraft){state.loaded=true;return state;}
  const sequence=state.sequence;let result;
  try{result=await api.groupDraft({action:'load',id});}catch(e){if(!reading(mine))return;throw e;}
  if(!reading(mine))return;
  if(result?.ok===false)throw Error(result.error||'群聊草稿读取失败');
  state.revision=result.revision||'missing';state.loaded=true;
  if(state.sequence===sequence){state.text=result.text||'';drafts.set(id,state.text);}
  return state;
 }
 async function flushDraft(id){
  const state=draftState(id);if(state.timer){clearTimeout(state.timer);state.timer=0;}
  if(state.writing){await state.writing;return flushDraft(id);}
  if(!api.groupDraft||state.saved>=state.sequence)return;
  const sequence=state.sequence;
  const task=Promise.resolve(api.groupDraft({action:'save',id,text:state.text,expected_revision:state.revision})).then(result=>{
   if(result?.ok===false)throw Object.assign(Error(result.error||'群聊草稿未保存'),{code:result.code});
   state.revision=result.revision||'missing';state.saved=sequence;
  }).finally(()=>{if(state.writing===task)state.writing=null;});
  state.writing=task;await task;if(state.saved<state.sequence)await flushDraft(id);
 }
 async function flushDrafts(){
  if(current)setDraft(current,input.value,{delay:false});
  await Promise.all([...draftStates.keys()].map(flushDraft));
 }
 const avatar=key=>key==='host'?(view?.initial_host_contact?store.avatar(view.initial_host_contact):roleIdentity(profile(),'matrix').avatar):store.avatar(key);
 const identity=member=>member.key==='host'&&!view?.initial_host_contact?{...roleIdentity(profile(),'matrix'),name:member.name||'Eyra'}:{role:member.role||'conversation',name:member.name,ring:member.ring||'orbit',avatar:avatar(member.key),glyph:''};
 const column=setupChatColumn(list,{getProfile:profile}),chatSurface=bindChatSurface(scroll,profile);
 const refreshChatProfile=()=>{if(closed||paused)return;chatSurface.refresh();paintMessages(true);paintWorking();};
 doc.addEventListener('chat-profile-changed',refreshChatProfile);
 const participants=setupWorkParticipants(working,{getProfile:profile,fullMessages:true,retryMember:(member,attempt)=>call({action:'group_member_retry',id:current,session_id:member.session,member:member.key,generation:member.generation,attempt}),onInspect:m=>{if(m.session)void store.open(m.session).catch(report);}});
 let readingUntil=0,readingPointer=false;
 scroll.addEventListener('wheel',event=>{readingUntil=performance.now()+700;if(event.deltaY<0)follow=false;},{passive:true});
 scroll.addEventListener('pointerdown',()=>{readingPointer=true;},{passive:true});
 const endReading=()=>{readingPointer=false;readingUntil=performance.now()+200;};
 doc.addEventListener('pointerup',endReading);doc.addEventListener('pointercancel',endReading);
 scroll.addEventListener('keydown',event=>{if(event.target.closest('input,textarea,select')||!['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(event.key))return;readingUntil=performance.now()+700;if(['PageUp','Home','ArrowUp'].includes(event.key))follow=false;});
 scroll.addEventListener('scroll',()=>{if(readingPointer||performance.now()<readingUntil)follow=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<8;if(scroll.scrollTop<80)void loadOlder();},{passive:true});
 // Reading back: near the top, the page just older than the first message is put in front, keeping the view still.
 async function loadOlder(){
  if(closed||paused||!older||loadingOlder||!messages.length||!current||!navigation.is('group-view'))return;const request=Symbol('history'),mine=epoch,gid=current,first=messages[0].seq;loadingOlder=request;
  try{const value=await call({action:'group',id:gid,before:first});if(!reading(mine)||gid!==current||!navigation.is('group-view')||messages[0]?.seq!==first)return;
   const page=(value.messages||[]).filter(m=>m.seq<first);older=value.has_older===true;if(!page.length)return;
   const height=scroll.scrollHeight;messages=[...page,...messages];paintMessages(true,{prepend:true});scroll.scrollTop+=scroll.scrollHeight-height;}
  catch(e){if(reading(mine)&&gid===current&&navigation.is('group-view'))report(e);}finally{if(loadingOlder===request)loadingOlder=null;}
 }
 function paintMessages(fresh,{prepend=false}={}){
  // The live member owns its current failure. Preserve earlier system notes in history.
 const failures=new Set((view?.members||[]).filter(m=>workNeedsAttention(m)).map(m=>'result:'+m.session+':'+m.generation));
 const rows=messages.filter(m=>m.kind!=='system'||!failures.has(m.request)),seen=new Set(messages.map(m=>m.request));
  for(const [id,entry] of submitted)if(entry.group===current){
   if(seen.has('user:'+entry.request_id))submitted.delete(id);
   else rows.push({from:'user',text:entry.text,request:'user:'+entry.request_id,at:entry.at,delivery:entry.delivery});
  }
  if(fresh)column.paint(rows.map(msg=>{
   const member=view?.members.find(m=>m.key===msg.from)||{key:msg.from,name:msg.name};
   return {id:current+':'+(msg.from==='user'&&msg.request?msg.request:msg.seq),from:msg.from==='user'?'user':'eyra',text:msg.text,at:msg.at,delivery:msg.delivery,system:msg.kind==='system',role:member.role||'conversation',identity:msg.from==='eyra'?roleIdentity(profile(),'matrix'):identity(member)};
  }),{prepend});
  if(follow)scroll.scrollTop=scroll.scrollHeight;
 }
 function paintWorking(){
  page.dataset.working=String((view?.members||[]).some(m=>workingState(m.state)));
  previews.paint({session_id:current,link:{scope:current,members:(view?.members||[]).map(m=>({...m,id:m.session,avatar:avatar(m.key)}))}},null,{show:(view?.members||[]).some(m=>m.state!=='idle')});workLayout.dataset.preview=String(!previewRoot.hidden);
  participants.paint((view?.members||[]).map(m=>({...m,id:m.session||m.key,identity:identity(m),updated:Date.parse(m.updated||m.task_at)||0})),{key:current});
  if(follow)scroll.scrollTop=scroll.scrollHeight;
 }
 function paintHead(){
  const g=view;if(!g)return;q('.gv-title h2').textContent=g.name;const members=g.members.filter(m=>m.key!=='host'||g.initial_host_contact),names=members.filter(m=>!m.host).map(m=>m.name);
  q('.gv-title small').textContent=(g.host_name||'Eyra')+' 主持'+(names.length?' · '+names.join('、'):'');
  q('.gv-face').replaceChildren(groupFace(doc,{name:g.name,members},avatar,40));
  const busy=g.members.filter(m=>workingState(m.state)).length;q('.gv-station-button').dataset.busy=String(busy>0);q('.gv-station-count').textContent=busy?String(busy):'';
  q('.gv-station-button').setAttribute('aria-label',busy?'群工位 · '+busy+' 位成员在工作':'打开群工位');
  navigation.title(g.name);
 }
 function paintStation(){
  if(station.hidden||!view)return;const body=q('.gv-station-body');
  const notes=messages.filter(m=>m.kind==='note'||m.kind==='result'||m.kind==='system').slice(-30);
  const sig=JSON.stringify([current,view.members.map(m=>[m.key,m.name,m.state,m.task,m.session,m.error]),notes.map(n=>n.seq)]);if(sig===stationSig)return;stationSig=sig;
  const focusKey=doc.activeElement?.closest?.('.gs-member')?.dataset.key,focusAction=doc.activeElement?.dataset?.action;body.replaceChildren();
  body.append(el(doc,'h4','','成员'));
  for(const m of view.members){
   const row=el(doc,'div','gs-member');row.dataset.state=m.state;row.dataset.key=m.key;const face=createRoleRing(identity(m),{doc,state:workingState(m.state)&&m.state!=='queued'?'thinking':'idle'});
   const text=el(doc,'div','gs-text'),head=el(doc,'div','gs-head');head.append(el(doc,'b','',m.host?m.name+' · 主持':m.name),el(doc,'span','gv-chip',STATE[m.state]||m.state));
   text.append(head,el(doc,'small','',workNeedsAttention(m)?workText(m):m.task?'任务：'+m.task:m.state==='idle'?'等待点名':''));
   const actions=el(doc,'div','gs-actions');
   if(['working','replying','queued','waiting_user'].includes(m.state)){const stop=el(doc,'button','gs-action','停止');stop.type='button';stop.dataset.action='stop';stop.onclick=async()=>{stop.disabled=true;try{await call({action:'group_stop',id:current,member:m.key});await poll();}catch(e){stop.disabled=false;report(e);}};actions.append(stop);}
   if(m.session){const open=el(doc,'button','gs-action','查看');open.type='button';open.dataset.action='open';open.onclick=()=>void store.open(m.session).catch(report);actions.append(open);}
   if(m.key!=='host'||view.initial_host_contact){const assign=el(doc,'button','gs-action','派活');assign.type='button';assign.dataset.action='assign';assign.onclick=()=>{insertMention(m.name);station.hidden=true;};actions.append(assign);}
   row.append(face,text,actions);body.append(row);
  }
  body.append(el(doc,'h4','','协作记录'));
  for(const msg of notes){const row=el(doc,'div','gs-note');row.dataset.kind=msg.kind;row.append(el(doc,'time','',clock(msg.at)),el(doc,'b','',msg.name),el(doc,'span','',msg.text.length>160?msg.text.slice(0,160)+'…':msg.text));body.append(row);}
  if(focusKey)body.querySelector('.gs-member[data-key="'+CSS.escape(focusKey)+'"] [data-action="'+focusAction+'"]')?.focus({preventScroll:true});
 }
 async function poll(){
  clearTimeout(timer);timer=0;if(closed||paused||!current||!navigation.is('group-view'))return;if(polling)return;const mine=epoch,asked=current,request=Symbol('poll');polling=request;
  try{const value=await call({action:'group',id:asked,after:seq});if(!reading(mine)||asked!==current||value.id!==current||!navigation.is('group-view'))return;view=value;
   const fresh=!seq;if(fresh){messages=value.messages;older=value.has_older===true;}else messages.push(...value.messages.filter(m=>m.seq>seq));
   const added=!fresh&&value.messages.some(m=>m.seq>seq);seq=Math.max(seq,value.seq||0);
   paintMessages(true);
   paintHead();paintWorking();paintStation();
  }catch(e){if(!reading(mine)||asked!==current||!navigation.is('group-view'))return;report(e);if(/群聊(不存在|已删除)/.test(e.message)){current='';navigation.home();}}
  finally{if(polling===request)polling=null;if(reading(mine)&&asked===current&&current&&navigation.is('group-view'))timer=setTimeout(poll,(view?.members||[]).some(m=>workingState(m.state))?900:2200);}
 }
 async function open(id){
  if(closed||paused)return;invalidateReads();const mine=epoch;
  if(current!==id){if(current){setDraft(current,input.value,{delay:false});await flushDraft(current);if(!reading(mine))return;}current=id;seq=0;messages=[];older=false;view=null;stationSig='';column.clear();participants.paint([],{key:id});working.hidden=true;station.hidden=true;follow=true;input.value=drafts.get(id)||'';autosize();}
  const saved=await loadDraft(id,mine);if(!reading(mine)||current!==id)return;input.value=saved.text;autosize();
  navigation.open('group-view','群聊',{viewKey:'group:'+id});doc.body.dataset.groupId=id;await poll();if(reading(mine)&&current===id&&navigation.is('group-view'))input.focus({preventScroll:true});
 }
 const viewChanged=()=>{if(navigation.is('group-view'))void poll();else{clearTimeout(timer);timer=0;}};
 doc.addEventListener('workspace-view-change',viewChanged);
 async function send(){
  const text=input.value.trim(),gid=current;if(closed||paused||!text||sending||composing||!gid)return;sending=true;q('.gv-send').disabled=true;
  // Same text after an unknown result reuses the id, so Core returns the first receipt instead of posting twice.
  const last=[...submitted.values()].find(e=>e.group===gid&&e.text===text)||pending.get(gid),request_id=last?.text===text?last.request_id:crypto.randomUUID();const entry={group:gid,text,request_id,delivery:'pending',after:last?.request_id===request_id?last.after:seq,at:last?.request_id===request_id?last.at:new Date().toISOString()};pending.set(gid,entry);submitted.set(gid+':'+request_id,entry);follow=true;paintMessages(true);
  try{follow=true;await call({action:'group_post',id:gid,text,request_id,after:seq});entry.delivery='accepted';if(pending.get(gid)===entry)pending.delete(gid);
   // Clear only what was sent: a draft typed meanwhile, here or in another group, stays.
   if(current===gid){if(input.value.trim()===text){input.value='';autosize();setDraft(gid,'');}}else if((drafts.get(gid)||'').trim()===text)setDraft(gid,'');
   if(current===gid)await poll();}
  catch(e){
   entry.delivery='unknown';
   // group_post may commit the chat row before member dispatch fails. A
   // definite RPC rejection still needs a read-back before removing it.
   if(e.rejected)try{const actual=await call({action:'group',id:gid,after:entry.after});if(!(actual.messages||[]).some(m=>m.request==='user:'+request_id)){submitted.delete(gid+':'+request_id);if(pending.get(gid)===entry)pending.delete(gid);}}catch{}
   if(current===gid){paintMessages(true);report(e);}
  }finally{sending=false;q('.gv-send').disabled=false;if(!closed&&!paused&&current===gid&&navigation.is('group-view')&&(doc.activeElement===doc.body||doc.activeElement===q('.gv-send')))input.focus();}
 }
 function autosize(){input.style.height='auto';input.style.height=Math.min(160,input.scrollHeight)+'px';}
 // @ picker: typing "@" lists members; Enter or click inserts the name.
 let picks=[],pickIndex=0;
 function insertMention(name){
  const start=input.selectionStart,typed=mention.hidden?null:/@([^\s@]*)$/.exec(input.value.slice(0,start));
  input.setRangeText('@'+name+' ',typed?start-typed[0].length:start,start,'end');
  mention.hidden=true;input.focus();autosize();
 }
 function paintMention(){
  const start=input.selectionStart,before=input.value.slice(0,start),match=/@([^\s@]*)$/.exec(before);
  if(!match||!view){mention.hidden=true;return;}
  const query=match[1].toLowerCase();picks=view.members.map(m=>({name:m.host?'主持':m.name,label:m.host?m.name+' · 主持':m.name,member:m})).filter(p=>p.name.toLowerCase().includes(query));
  if(!picks.length){mention.hidden=true;return;}pickIndex=Math.min(pickIndex,picks.length-1);
  mention.replaceChildren(...picks.map((p,i)=>{const b=el(doc,'button','gv-pick');b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===pickIndex));const face=createRoleRing(identity(p.member),{doc});b.append(face,el(doc,'span','',p.label));b.onpointerdown=e=>e.preventDefault();b.onclick=()=>insertMention(p.name);return b;}));mention.hidden=false;mentionGlide.refresh();
 }
 input.addEventListener('input',()=>{autosize();if(current)setDraft(current,input.value);pickIndex=0;paintMention();});
 input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>{composing=false;paintMention();});
 input.addEventListener('blur',()=>setTimeout(()=>{mention.hidden=true;},120));
 input.addEventListener('keydown',event=>{
  if(event.isComposing||composing)return;
  if(!mention.hidden&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();pickIndex=(pickIndex+(event.key==='ArrowDown'?1:-1)+picks.length)%picks.length;paintMention();return;}
  if(!mention.hidden&&(event.key==='Enter'||event.key==='Tab')){event.preventDefault();insertMention(picks[pickIndex].name);return;}
  if(!mention.hidden&&event.key==='Escape'){event.preventDefault();event.stopPropagation();mention.hidden=true;return;}
  if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send();}
 });
 q('.gv-send').onclick=()=>void send();
 q('.gv-station-button').onclick=()=>{station.hidden=!station.hidden;q('.gv-station-button').setAttribute('aria-expanded',String(!station.hidden));paintStation();};
 q('.gv-station-close').onclick=()=>{station.hidden=true;q('.gv-station-button').setAttribute('aria-expanded','false');q('.gv-station-button').focus();};
 // Esc closes the station first; only a second Esc leaves the page.
 page.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.defaultPrevented||event.isComposing||station.hidden)return;event.preventDefault();event.stopPropagation();q('.gv-station-close').click();});
 q('.gv-members-button').onclick=()=>{const original=view,gid=current;void groupDialog({doc,store,group:original,save:async(name,members,hostContact)=>{await call({action:'group_update',id:gid,name,members,host_contact:hostContact||'',expected_host_contact:original.host_contact||''});await poll();},report,confirm,remove:async()=>{await call({action:'group_delete',id:gid});if(current===gid){current='';navigation.home();}await store.refresh();}});};
 return {open,poll,flushDrafts,get current(){return current;},
  suspend(){if(closed||paused)return;paused=true;invalidateReads();previews.paint({session_id:current,link:{scope:current}},null,{show:false});},
  resume(){if(closed||!paused)return;paused=false;chatSurface.refresh();void poll();},
  close(){if(closed)return;closed=true;paused=true;invalidateReads();void flushDrafts().catch(e=>onError('群聊草稿未保存，当前输入仍保留：'+e.message));column.close();chatSurface.close();doc.removeEventListener('chat-profile-changed',refreshChatProfile);doc.removeEventListener('workspace-view-change',viewChanged);participants.close();previews.close();mentionGlide.close();doc.removeEventListener('pointerup',endReading);doc.removeEventListener('pointercancel',endReading);page.remove();},
 };
}

// A retry of one creation intent must query the same Core receipt, even when
// the first call committed but its reply failed. A new dialog owns a new intent.
export function createGroupSubmission(save){
 let attempt;
 return (name,members,hostContact='')=>{
  const key=JSON.stringify([name,[...members].sort(),hostContact]);
  if(attempt?.pending)return attempt.key===key?attempt.pending:Promise.reject(Error('群聊正在创建，请稍后再试'));
  if(!attempt||attempt.key!==key)attempt={key,id:crypto.randomUUID(),done:false};
  const current=attempt;if(current.done)return Promise.resolve(current.value);
  current.pending=Promise.resolve().then(()=>save(name,[...members],hostContact,current.id)).then(value=>{current.done=true;current.value=value;return value;}).finally(()=>{current.pending=null;});
  return current.pending;
 };
}

// Create or edit a group: name plus member picks among existing contacts.
export function groupDialog({doc=document,store,group=null,save,afterSave=null,report=()=>{},confirm,remove=null}){
 const submit=group?save:createGroupSubmission(save);
 const dialog=el(doc,'dialog','contact-editor group-editor');dialog.setAttribute('aria-label',group?'群成员':'新建群聊');
 const shell=el(doc,'div','ce-shell');shell.tabIndex=-1;
 const head=el(doc,'header','ce-id'),faceHost=el(doc,'span','ge-face'),idtext=el(doc,'div','ce-idtext');
 const name=el(doc,'input','ce-name');name.maxLength=120;name.value=group?.name||'群聊';name.spellcheck=false;name.autocomplete='off';name.setAttribute('aria-label','群名');
 const count=el(doc,'span','ge-count');idtext.append(name,count);
 const close=iconButton(doc,'ce-close ui-icon-button','关闭',SVG.close);head.append(faceHost,idtext,close);
 const people=(store.people||store.contacts||[]).filter(c=>!c.program);
 const chosen=new Set((group?.members||[]).filter(m=>m.key!=='host').map(m=>m.key));if(group?.initial_host_contact)chosen.add(group.initial_host_contact);
 const originalMembers=new Set(chosen),legacyHost=!!group&&!group.initial_host_contact;
 let hostContact=group?.host_contact||'';const initial=JSON.stringify([name.value,[...chosen].sort(),hostContact]);
 const hostLabel=el(doc,'div','ce-row ge-host-row'),hostButton=el(doc,'button','ce-pick ge-host'),hostText=el(doc,'span','ce-pick-text');hostButton.type='button';hostButton.setAttribute('aria-label','群聊主持');hostButton.setAttribute('aria-haspopup','listbox');hostButton.setAttribute('aria-expanded','false');hostButton.append(hostText);
 hostButton.insertAdjacentHTML('beforeend','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>');hostLabel.append(el(doc,'span','ce-label','主持'),hostButton);
 const hostMenu=el(doc,'div','ui-menu ge-host-menu soft-scroll');hostMenu.id='group-host-'+crypto.randomUUID();hostMenu.popover='auto';hostMenu.setAttribute('role','listbox');hostMenu.setAttribute('aria-label','群聊主持');
 const wrap=el(doc,'div','ge-members'),picks=el(doc,'div','ge-picks soft-scroll');picks.setAttribute('role','group');picks.setAttribute('aria-label','选择已有联系人');
 const search=el(doc,'input','ge-search');search.type='search';search.placeholder='搜索联系人';search.setAttribute('aria-label','搜索已有联系人');
 const empty=el(doc,'p','ge-empty','没有匹配的联系人');empty.hidden=true;
 wrap.append(el(doc,'span','ce-label','选择联系人'),search,picks,empty);
 const error=el(doc,'p','ce-error');error.hidden=true;error.setAttribute('role','alert');
 const fail=text=>{error.textContent=text;error.hidden=!text;};
 function hostOption(id,label,{available=true,detail=''}={}){
  const b=el(doc,'button','ce-option ge-host-option');b.type='button';b.dataset.contact=id;b.setAttribute('role','option');b.setAttribute('aria-selected',String(id===hostContact));b.disabled=!available;b.setAttribute('aria-disabled',String(!available));
  const text=el(doc,'span','ce-option-text');text.append(el(doc,'b','',label));if(detail)text.append(el(doc,'small','',detail));b.append(text);
  const mark=el(doc,'span','ce-option-mark',id===hostContact?'✓':'');b.append(mark);
  b.onclick=()=>{if(b.disabled||ok.disabled||!dialog.open)return;hostMenu.hidePopover();hostContact=id;fail('');paintHead();hostButton.focus({preventScroll:true});};return b;
 }
 const paintHead=()=>{
  if(!group&&!chosen.has(hostContact))hostContact=[...chosen][0]||'';
  const candidates=people.filter(c=>chosen.has(c.id));
  const options=candidates.map(c=>{const available=!group||originalMembers.has(c.id);return hostOption(c.id,c.name,{available,detail:available?'':'保存成员后可设为主持'});});
  if(legacyHost)options.unshift(hostOption('','Eyra（已有主持）'));
  hostMenu.replaceChildren(...options);hostButton.disabled=!options.some(option=>!option.disabled);hostButton.dataset.empty=String(!options.length);
  const hostName=candidates.find(c=>c.id===hostContact)?.name||(hostContact===''&&legacyHost?'Eyra':group?.host_name);
  hostText.textContent=hostName||'先选择成员';
  faceHost.replaceChildren(groupFace(doc,{name:name.value.trim()||'群',members:[...chosen]},()=>'',88));
  count.textContent=chosen.size+' 位成员'+(hostName?' · '+hostName+' 主持':'');
 };
 const CHECK='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
 for(const c of people){
  const b=el(doc,'button','ce-option ge-pick');b.type='button';b.setAttribute('role','checkbox');b.dataset.contact=c.id;b.dataset.search=(c.name+' '+(c.description||'')).toLowerCase();
  const face=createRoleRing({role:c.role||'conversation',name:c.name,ring:c.ring||'orbit',avatar:store.avatar(c.id),glyph:''},{doc});
  const text=el(doc,'span','ce-option-text');text.append(el(doc,'b','',c.name),el(doc,'small','',c.description||(c.works?'工作型':'对话')));
  const act=el(doc,'span','ce-option-act');b.append(face,text,act);
  const paint=()=>{const on=chosen.has(c.id);b.setAttribute('aria-checked',String(on));act.innerHTML=on?CHECK:'';b.title=on?'取消选择 '+c.name:'选择 '+c.name;};
  b.onclick=()=>{if(ok.disabled||!dialog.open)return;if(group?.initial_host_contact===c.id)return fail('初始主持的群内会话需要保留');if(group&&hostContact===c.id)return fail('请先选择其他主持');if(chosen.has(c.id))chosen.delete(c.id);else{if(chosen.size>=30)return fail('一个群最多 30 位成员');chosen.add(c.id);}fail('');paint();paintHead();};
  paint();picks.append(b);
 }
 if(!people.length)picks.append(el(doc,'p','ge-empty','还没有联系人，添加联系人后即可邀请加入群聊。'));
 search.oninput=()=>{const query=search.value.trim().toLowerCase();let count=0;for(const row of picks.querySelectorAll('.ge-pick')){row.hidden=!row.dataset.search.includes(query);if(!row.hidden)count++;}empty.hidden=!people.length||count>0;};
 const glide=hoverGlide(picks,'.ge-pick',{doc});
 picks.addEventListener('keydown',event=>{if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;const all=[...picks.querySelectorAll('.ge-pick:not([hidden])')],i=all.indexOf(doc.activeElement);if(i<0)return;event.preventDefault();all[(i+(event.key==='ArrowDown'?1:-1)+all.length)%all.length].focus();});
 const foot=el(doc,'footer','ce-foot');foot.append(error);
 if(remove){const del=el(doc,'button','ce-delete','删除群聊');del.type='button';del.onclick=async()=>{if(await confirm({doc,title:'删除「'+group.name+'」？',body:'正在工作的成员会停下，群聊记录归档保留。',action:'删除'})){try{await remove();dialog.close();}catch(e){fail(String(e?.message||e));}}};foot.append(del);}
 const cancel=el(doc,'button','ce-secondary','取消');cancel.type='button';const ok=el(doc,'button','ce-primary',group?'保存':'创建');ok.type='button';foot.append(cancel,ok);
 shell.append(head,hostLabel,wrap,foot);dialog.append(shell,hostMenu);doc.body.append(dialog);
 const stopHost=setupChoicePopover(hostButton,hostMenu);
 hostButton.onclick=()=>{if(hostButton.disabled||ok.disabled||!dialog.open)return;if(hostMenu.matches(':popover-open'))return hostMenu.hidePopover();hostMenu.showPopover();positionMenu(hostMenu,hostButton);hostMenu.querySelector('[aria-selected=true]:not(:disabled),button:not(:disabled)')?.focus({preventScroll:true});};
 shell.addEventListener('scroll',()=>{if(hostMenu.matches(':popover-open'))positionMenu(hostMenu,hostButton);},{passive:true});
 // Enter keeps the name, Esc in the name puts it back; elsewhere Esc leaves.
 name.addEventListener('focus',()=>{name.dataset.before=name.value;});
 name.addEventListener('input',paintHead);
 name.addEventListener('blur',()=>{if(!name.value.trim())name.value=name.dataset.before?.trim()||'群聊';paintHead();});
 name.addEventListener('keydown',event=>{if(event.isComposing)return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();shell.focus();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();name.value=name.dataset.before??name.value;shell.focus();}});
 let leaving=false;
 async function leave(){
  if(leaving||ok.disabled)return;
  if(!ok.disabled&&JSON.stringify([name.value.trim(),[...chosen].sort(),hostContact])!==initial){leaving=true;const sure=await confirm({doc,title:'放弃未保存的修改？',body:'关闭后，这次的修改不会保留。',action:'放弃'});leaving=false;if(!sure)return;}
  dialog.close();
 }
 close.onclick=cancel.onclick=()=>void leave();
 dialog.addEventListener('cancel',event=>{event.preventDefault();void leave();});
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing){event.preventDefault();event.stopPropagation();void leave();}});
 ok.onclick=async()=>{
  if(ok.disabled||!dialog.open)return;
  const n=name.value.trim()||'群聊';if(!chosen.size)return fail('至少选一位成员');
  if(hostMenu.matches(':popover-open'))hostMenu.hidePopover();
  const controls=[...dialog.querySelectorAll('button,input,select')].map(node=>({node,disabled:node.disabled}));for(const {node}of controls)node.disabled=true;
  fail('');try{const value=await submit(n,[...chosen],hostContact);dialog.close();if(afterSave)await afterSave(value);}catch(e){if(dialog.open)fail(String(e?.message||e));else report(e);}finally{for(const {node,disabled}of controls)node.disabled=disabled;}
 };
 dialog.addEventListener('close',()=>{stopHost();glide.close();setTimeout(()=>dialog.remove(),320);},{once:true});
 paintHead();dialog.showModal();
 if(group)close.focus({preventScroll:true});else search.focus({preventScroll:true});
 return dialog;
}
