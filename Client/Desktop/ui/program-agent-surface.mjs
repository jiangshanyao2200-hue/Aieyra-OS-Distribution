// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: chat, program
// Regions: programForView; busy; tabs; check; setupProgramAgentSurface
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/program-agent-surface.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {readViewportScale} from './chat-layout.mjs';
import {createSharedDraftPersistence} from './shared-draft.mjs';
import {validateAttachments} from './attachments.mjs';
import {ChatLayerState,chatLayerBounds,chatLayerMovePosition,chatLayerPreferences,compactWorkRows,compactLiveRows,chatBriefPreviewHeight,chatCompactTextMetrics,chatCompactPlacement} from './layered-chat.mjs';
import {chatStatus,chatFailureEntry} from './chat-status.mjs';
import {createDecisionSession} from './ask-user.mjs';
import {conversationOperations} from './work-surface.mjs';
import {ConversationPresentation} from './work-transcript.mjs';
import {linkMessagePresentation,linkMessageGeneration,linkMessageAuthor} from './chat-column.mjs';
import {memberAvatars} from './member-avatars.mjs';
import {paintProgramStatus} from './program-icons.mjs';

export function programForView(view){
 if(view==='browser-view')return 'browser';
 if(view==='settings-view')return 'settings';
 if(view==='link-view'||view==='control-view')return 'link';
 return /-module-view$/.test(view||'')?view.replace(/-module-view$/,''):'';
}
const busy=s=>['queued','running','cancelling'].includes(s);
const tabs={browser:'browser-bubble',settings:'api-bubble',contacts:'dock-contacts',link:'dock-link',servers:'dock-servers',center:'dock-center',coding:'dock-coding',workspace:'dock-workspace',together:'dock-together'};
const check=r=>{if(r?.ok===false)throw Object.assign(Error(r.error||'操作未完成'),{send_rejection:r.send_rejection===true});return r;};

// This is a projection and composer per durable program session. Core owns all
// execution; changing the visible program only stops its snapshot reader.
// Chain program -> chat/projection: mount the fixed program_session through
// shared chat/appearance/decision components. OS sessions are separate owners;
// displaying or detaching this surface must not rebind their history/tasks.
// Closing presentation releases subscriptions/readers, not persistent Agent data.
export function setupProgramAgentSurface(api,{navigation,profile=()=>({}),epoch=()=>'',sessionFocus=null,onError=()=>{}},doc=document){
 const sessions=new Map(),contacts=new Map(),panels=new Map(),unboundLayerChoices=new Map();let store=null,stopStore=null,selected=null,revision=0,closed=false,paused=false,timer=0,loading=false,pending=false,signature='',expanded=false,hover=false,inputHeight=72,editRevision=0,menu=false,lastError='';
 let layer=new ChatLayerState(false),layerScope='',preferenceVersion=0,dragOrigin=null,foldGeometry=null;const preferences=chatLayerPreferences(api.chatLayerPreference);
 const call=p=>api.conversation(p).then(check);
 const avatars=memberAvatars(m=>call({action:'member_avatar',id:m.actor,member_id:m.id}),()=>{signature='';paint();});
 const current=()=>programForView(navigation.current);
 let contactsFocus=sessionFocus;
 const conversationPage=()=>current()==='contacts'&&contactsFocus?.kind==='group';
 const active=()=>!conversationPage()&&selected?.program===current()&&contacts.has(current());
 const publish=()=>doc.dispatchEvent(new CustomEvent('aieyra:program-agent',{detail:active()?{program:selected.program,contact:selected.contact,session:selected.session,snapshot:selected.snapshot,configured:selected.configured}:null}));
 function record(id){
  if(sessions.has(id))return sessions.get(id);
  const r={id,error:'',draft:'',attachments:[],context:null,pending:null,sending:false,ready:false,refToken:'',refSequence:0,presentation:new ConversationPresentation()};
  r.decisions=createDecisionSession({humanReply:p=>call({...p,action:'human_reply',id}),askReply:()=>Promise.reject(Error('程序会话不接受首页问题'))},{check,onError,onReply:refresh,
   getEditor:()=>r.editor||{value:r.draft,pastes:'',selection:[r.draft.length,r.draft.length,'none']},
   setEditor:(value,active)=>{r.editor=active?value:null;editRevision++;},readText:()=>r.editor?.value||'',
   available:()=>!closed&&!paused&&selected?.session?.id===id&&active(),hasInput:()=>!!r.draft,
   openChat:()=>{expanded=true;},openInput:()=>{expanded=true;},
   onFrame:value=>{r.decision=value;},focusInput:()=>{},focusLater:()=>{}});
  r.persistence=createSharedDraftPersistence(p=>call({action:'draft_shared_save',id,...p}),{onError:e=>onError(e.message)});sessions.set(id,r);return r;
 }
 function save(r){if(!r?.ready)return;r.persistence.schedule({value:r.draft,pastes:'',attachments:r.attachments,context:r.context,outbox:r.pending?[{session_id:r.id,request_id:r.pending.request_id,text:r.pending.message,attachments:r.pending.attachments,context:r.pending.context,delivery:'pending',...(r.pending.inline?{preserve_draft:true}:{})}]:[]});}
 async function initialize(r){
  if(r.ready)return;if(r.initializing)return r.initializing;
  r.initializing=(async()=>{const value=await call({action:'draft_shared_load',id:r.id});r.draft=value.draft?.value||'';r.attachments=validateAttachments(value.draft?.attachments||[]);r.context=value.draft?.context||null;const p=value.draft?.outbox?.[0];if(p)r.pending={request_id:p.request_id,message:p.text,attachments:p.attachments||[],context:p.context||null,inline:p.preserve_draft===true};r.persistence.initialize(value);r.ready=true;
   const refs=check(await api.conversationAttachment({id:r.id,method:'attachmentState'}));r.refToken=refs.token;await references(r);
  })().finally(()=>{r.initializing=null;});return r.initializing;
 }
 async function references(r,receipts=[]){if(r.refToken)check(await api.conversationAttachment({id:r.id,method:'attachmentReferences',args:{token:r.refToken,sequence:++r.refSequence,hashes:r.attachments.map(a=>a.sha256),receipts}}));}
 async function refresh(){
  clearTimeout(timer);timer=0;if(closed||paused||!active()||doc.hidden)return;if(loading){pending=true;return;}loading=true;
  const own=revision,program=selected.program;
  try{
   const binding=await call({action:'program_open',program});if(closed||paused||own!==revision)return;
   selected={...selected,...binding,program};
   if(binding.configured&&binding.session){
    const r=record(binding.session.id);await initialize(r);if(closed||paused||own!==revision)return;
    if(!r.sending&&!r.persistence.busy){const draft=await call({action:'draft_shared_load',id:r.id});if(closed||paused||own!==revision)return;if(r.persistence.accept(draft)){r.draft=draft.draft.value;r.attachments=validateAttachments(draft.draft.attachments);r.context=draft.draft.context||null;const p=draft.draft.outbox?.[0];r.pending=p?{request_id:p.request_id,message:p.text,attachments:p.attachments||[],context:p.context||null}:null;editRevision++;}}
    const snap=await call({action:'snapshot',id:r.id});if(closed||paused||own!==revision)return;
    r.snapshot=snap;selected.snapshot=snap;selected.session=snap.agent;
    r.decisions.update({core_epoch:snap.core_epoch,session_id:r.id,roles:[{...snap.agent,human_requests:snap.human_requests||[]}]});
   }else selected.snapshot=null;
   selected.error='';lastError='';publish();paint();
  }catch(e){if(!closed&&own===revision){selected.error=e.message;if(lastError!==e.message){lastError=e.message;onError(e.message);}paint();}}
  finally{loading=false;if(!closed&&!paused&&active()){timer=setTimeout(refresh,pending?0:busy(selected.session?.state)?500:2000);pending=false;}}
 }
 function navigate(){
  if(selected)panels.set(selected.program,layer);
  revision++;clearTimeout(timer);signature='';expanded=hover=menu=false;editRevision=0;lastError='';dragOrigin=null;
  doc.body.dataset.programPage='';
  const program=current(),contact=contacts.get(program);layer=panels.get(program)||new ChatLayerState(false);layer.settle(layer.transition);expanded=layer.open;selected=contact?{program,contact,configured:!!contact.model_id,session:contact.program_session}:null;
  // The shared conversation projection has its own epoch, distinct from Home.
  // Reuse its last projection while returning, before the next read completes.
  if(selected?.session)selected.snapshot=sessions.get(selected.session.id)?.snapshot;
  if(!selected&&tabs[program])void api.foldedSurface?.({visible:false});
  publish();paint();if(selected)void refresh();
 }
 function updateContacts(rows){
  const programs=new Set(contacts.keys());
  contacts.clear();for(const contact of rows)if(contact.program)contacts.set(contact.program,contact);
  for(const program of contacts.keys())programs.add(program);
  for(const program of programs){
   const contact=contacts.get(program);
   paintProgramStatus(doc.getElementById(tabs[program]||'dock-'+program),contact,contact?.program_session);
  }
  if(selected?.program!==current()||!selected&&contacts.has(current())){navigate();return;}
  if(selected){const contact=contacts.get(selected.program);if(!contact){navigate();return;}const was=selected.configured;selected.contact=contact;selected.configured=!!contact.model_id;if(was!==selected.configured)void refresh();publish();paint();}
 }
 function visual(){const style=getComputedStyle(doc.body),theme={};for(const source of [doc.documentElement.style,doc.body.style])for(const name of source)if(/^--(?:os-|eyra-|chat-|space-|text|glass)/.test(name))theme[name]=style.getPropertyValue(name);return {theme,fontFamily:style.fontFamily,fontSize:style.fontSize,appearance:doc.body.dataset.osAppearance,reduced:doc.body.classList.contains('reduce-motion')||matchMedia('(prefers-reduced-motion: reduce)').matches};}
 function paint(){
  // A group owns its own composer inside the retained Contacts page. Keep
  // ownership of the native slot while hiding the program entry and mother.
  if(!closed&&!paused&&conversationPage()&&api.foldedSurface){
   if(signature!=='conversation'){signature='conversation';doc.body.dataset.programPage='';void api.foldedSurface({visible:false,takesPresence:true}).then(check).catch(e=>{signature='';onError(e.message);});}return true;
  }
  if(closed||paused||!active()||!api.foldedSurface)return false;
  const c=selected.contact,s=selected.session,snap=selected.snapshot,r=s&&sessions.get(s.id),configured=selected.configured,drawing=c.program_activity?.active===true,working=busy(s?.state)||drawing,state=drawing&&!busy(s?.state)?'running':s?.state||'idle';
  const unboundScope='program:'+selected.program+':'+c.id;
  const nextLayerScope='program:'+selected.program+':'+(s?.id||c.id);
  if(layerScope!==nextLayerScope){
   // A user's first click can precede the durable session binding. Adopt only
   // that explicit contact-scoped choice; replacement sessions keep their own.
   const clicked=layerScope===unboundScope&&expanded!==layer.open;
   const adopt=!!s?.id&&(clicked||unboundLayerChoices.has(unboundScope));
   layerScope=nextLayerScope;const own=++preferenceVersion;
   if(adopt){expanded=clicked?expanded:unboundLayerChoices.get(unboundScope);unboundLayerChoices.delete(unboundScope);preferences.write(layerScope,expanded);}
   else void preferences.read(layerScope,layer.open).then(open=>{if(!closed&&own===preferenceVersion&&layerScope===nextLayerScope){expanded=open;layer=new ChatLayerState(open);paint();}});
  }
  const identity={role:'conversation',name:c.name,avatar:store?.avatar(c.id)||'',ring:c.ring||'orbit',glyph:''};
  const presenceIdentity=selected.program==='browser'?{...identity,avatar:profile().eyraAvatar||''}:identity;
  const live=snap?.live&&s&&snap.live.generation===s.generation?snap.live:{};
  const all=(snap?.messages||[]).map(m=>({...m,role:m.from==='user'?'user':m.from==='mother'?'matrix':'conversation',identity:m.from==='user'?undefined:m.from==='mother'?{role:'matrix',name:profile().eyraName||'Eyra',avatar:profile().eyraAvatar||'',ring:'pulse'}:identity}));
  let messages=all.filter(m=>m.from!=='core_link');
  for(const msg of snap?.link?.messages||[]){const member=linkMessageAuthor(snap.link,msg),sender=member?.id===s?.id?identity:{role:member?.role||'conversation',name:member?.name||msg.name||'成员',ring:member?.ring||'orbit',avatar:member?avatars.get({...member,actor:s.id}):'',glyph:''};messages.push({id:'link:'+snap.link.scope+':'+msg.seq,from:'eyra',role:sender.role,identity:sender,...linkMessagePresentation(msg),generation:linkMessageGeneration(msg,s.id),at:msg.at,talk:true});}
  messages.sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0));
  const receipts=(snap?.activity?.items||[]).filter(a=>a.generation===s?.generation);
  const problem=chatFailureEntry(snap?.agent||s,s?.id,identity);
  if(r)messages=r.presentation.project(messages,{scope:(snap?.core_epoch||epoch())+':'+s.id,agentId:s.id,generation:s.generation,active:working,waiting:s.state==='waiting_user',live,briefs:receipts,status:chatStatus({state:s.state,phase:live.phase,activities:receipts,active:working}),identity,problem});
  const left=parseFloat(doc.body.style.getPropertyValue('--workspace-inset'))||0,available=Math.max(1,innerWidth-left);
  if(layer.set(expanded)){preferenceVersion++;preferences.write(layerScope,expanded);if(!s?.id)unboundLayerChoices.set(unboundScope,expanded);}
  if(layer.full)dragOrigin=null;
  const top=doc.getElementById('status-anchor')?.getBoundingClientRect?.().bottom||parseFloat(getComputedStyle(doc.body).getPropertyValue('--titlebar-height'))||48;
  const compactRows=r&&working?compactWorkRows(messages,s?.generation):[],compactLive=r&&working?compactLiveRows(messages,s?.generation):[];
  const compactStyle=getComputedStyle(doc.body),geometry={width:innerWidth,height:innerHeight,left,top,...chatCompactTextMetrics(compactStyle),position:preferences.position(layerScope),previewHeight:chatBriefPreviewHeight(compactStyle,compactRows.length),details:working};
  foldGeometry=geometry;
  const ready=!!(r?.ready&&snap),input=expanded||layer.closing,bounds=chatLayerBounds({...geometry,full:layer.full}),placement=chatCompactPlacement(geometry),anchor=placement.anchor;
  const miniPosition={x:anchor.x-bounds.x+16,bottom:bounds.y+bounds.height-(anchor.y+anchor.height)+16};
  doc.body.dataset.programPage=selected.program;
  const phase=!configured?'idle':problem?'error':working?(receipts.some(a=>a.state==='running')?'tool':live.phase||'waiting'):state==='waiting_user'?'waiting_user':'idle';
  const scope=(snap?.core_epoch||epoch())+':program:'+revision;
  // Also suppress the separate native mother presence on browser and contacts.
  const value={visible:!doc.hidden&&!doc.querySelector('dialog:modal'),quick:false,takesPresence:true,bounds,content:{background_bounds:{x:left,y:top,width:available,height:Math.max(1,innerHeight-top)},layered:true,layer_transition:layer.transition,layer_closing:layer.closing,program:selected.program,task_id:s?.id||c.id,core_epoch:scope,configured,identity:presenceIdentity,profile:profile(),layout:{width:available,scale:readViewportScale(doc.body)},expanded,messages,documents:snap?.documents||[],input,focusInput:expanded,active:working,ready,composerError:r?.error||'',draft:r?.decision?r.editor?.value||'':r?.draft||'',decision:r?.decision||null,pending_decisions:(snap?.human_requests||[]).some(q=>q.state==='waiting_user'),sent:!!r?.sent,edit_revision:editRevision,attachments:r?.attachments||[],context:r?.context||null,attachmentPending:!!r?.attaching,composerHeight:inputHeight,viewportHeight:innerHeight,ringSize:64,compact:true,shortWindow:false,name:c.name,description:c.description||'',label:configured?chatStatus({state:selected.error?'error':state,phase:live.phase,activities:receipts,active:working}):'',body:'',instrument:{data:{state:phase,role:'conversation',name:c.name},label:c.name,code:'',avatar:presenceIdentity.avatar,avatarHidden:!presenceIdentity.avatar,glyph:''},effect:identity.ring,...visual(),receipts,work:{core_epoch:snap?.core_epoch,scope_id:s?.id,active:working,hidden:!expanded,operations:conversationOperations(snap,c.name)}}};
  Object.assign(value.content,{compact_rows:compactRows,compact_live:compactLive,mini_position:miniPosition,content_extra:placement.contentExtra,content_rise:placement.contentRise,preview_height:placement.previewHeight});
  const key=JSON.stringify(value);if(key===signature)return true;signature=key;if(r)r.sent=false;
  void api.foldedSurface(value).then(check).catch(e=>{signature='';onError(e.message);});return true;
 }
 async function addAttachments(r,method,args){
  r.attaching=true;paint();try{const value=check(await api.conversationAttachment({id:r.id,method,args}));const next=[...r.attachments];for(const a of value.attachments||[])if(!next.some(v=>v.sha256===a.sha256))next.push(a);r.attachments=validateAttachments(next);save(r);await references(r,value.receipts||[value.receipt].filter(Boolean));}finally{r.attaching=false;paint();}
 }
 async function send(r){
  if(!r.ready||r.sending||r.attaching||!r.pending&&!r.draft.trim()&&!r.attachments.length&&!r.context?.references?.length)return;
  const attempt=r.pending||{request_id:crypto.randomUUID(),message:r.draft,attachments:structuredClone(r.attachments),context:structuredClone(r.context)};r.pending=attempt;r.sending=true;r.error='';save(r);
  try{await r.persistence.flush();const {inline,...request}=attempt;await call({action:'send',id:r.id,...request});r.pending=null;if(!inline){if(JSON.stringify(r.context)===JSON.stringify(attempt.context))r.context=null;if(r.draft===attempt.message)r.draft='';const sent=new Set(attempt.attachments.map(a=>a.sha256));r.attachments=r.attachments.filter(a=>!sent.has(a.sha256));}r.sent=true;save(r);await r.persistence.flush();await references(r);await store?.refresh();if(selected?.session?.id===r.id)await refresh();}
  catch(e){if(e.send_rejection){r.pending=null;save(r);await r.persistence.flush();r.error=e.message+'；消息尚未发送，草稿已保留。';}else r.error=e.message+'；原请求已保留，再次发送会核对同一请求。';onError(r.error);}
  finally{r.sending=false;paint();}
 }
 const stopActions=api.onFoldedAction?.(async p=>{
  if(p.action==='files'){const r=sessions.get(p.task_id);if(r){try{const value=JSON.parse(p.text);r.attachments=validateAttachments([...r.attachments,...value.attachments.filter(a=>!r.attachments.some(b=>a.sha256===b.sha256))]);save(r);await references(r,value.receipts||[]);paint();}catch(e){onError(e.message);}}return;}
  if(!active())return;const c=selected,s=c.session,r=s&&sessions.get(s.id),scope=(c.snapshot?.core_epoch||epoch())+':program:'+revision;
  // Opening a panel is local UI. Its first frame can carry the home epoch
  // while the program snapshot arrives; retain the click for this navigation.
  // Drafts and execution still require the exact current conversation epoch.
  const local=['hover','toggle','home','close','escape','layout','menu','layer_settled','move'].includes(p.action);
  if(local){if(![s?.id,c.contact.id].includes(p.task_id)||!String(p.core_epoch||'').endsWith(':program:'+revision))return;}
  else if(p.task_id!==(s?.id||c.contact.id)||p.core_epoch!==scope)return;
  try{
   if(r&&['input','send','composition'].includes(p.action)&&(p.decision_key||'')!==(r.decision?.key||''))return;
   if(p.action==='decision'&&r){const v=JSON.parse(p.text||'{}');if(v.action==='reveal')r.decisions.reveal();else await r.decisions.action(v.action,v.value,v.key);}
   else if(p.action==='composition'&&r)r.decisions.composition(p.text==='start');
   else if(p.action==='move'){
    if(expanded||layer.closing)return;
    const v=JSON.parse(p.text||'{}');if(![v.dx,v.dy].every(Number.isFinite)||typeof v.done!=='boolean'||Math.abs(v.dx)>20000||Math.abs(v.dy)>20000)throw Error('折叠位置无效');
    if(!foldGeometry)return;dragOrigin??={...foldGeometry};
    const position=chatLayerMovePosition(dragOrigin,v.dx,v.dy);
    preferences.move(layerScope,position,{save:v.done});if(v.done)dragOrigin=null;
   }
   else if(p.action==='hover'){hover=p.text==='true';}
   else if(p.action==='layer_settled'){layer.settle(p.text);}
   else if(p.action==='toggle'||p.action==='home'){expanded=!expanded;}
   else if(p.action==='close'||p.action==='escape'){expanded=false;hover=false;}
   else if(p.action==='layout')inputHeight=Math.max(48,Math.min(260,Number(p.text)||72));
   else if(p.action==='menu')menu=p.text==='open';
   else if(r&&c.configured){
    if(p.action==='resend'){const value=JSON.parse(p.text);if(typeof value.text!=='string'||typeof value.request_id!=='string')throw Error('编辑消息格式无效');if(!r.ready||r.attaching)throw Error('输入仍在准备，编辑内容已保留。');if(r.sending||r.pending&&r.pending.request_id!==value.request_id)throw Error('请先等当前发送完成，编辑内容已保留。');r.pending??={request_id:value.request_id,message:value.text,attachments:[],context:null,inline:true};await send(r);}
    if((p.action==='input'||p.action==='send')&&r.decisions.active){editRevision=p.edit_revision||0;r.editor={...r.editor,value:p.text||''};r.decisions.input();if(p.action==='send')await r.decisions.submit();}
    else if(p.action==='input'||p.action==='send'){editRevision=p.edit_revision||0;r.error='';r.draft=p.text||'';expanded=true;save(r);if(p.action==='send')await send(r);}
    else if(p.action==='canvas_references'){r.error='';r.context=JSON.parse(p.text||'null');save(r);await r.persistence.flush();}
    else if(p.action==='stop'){await call({action:'cancel',id:r.id,generation:s.generation});await refresh();}
    else if(p.action==='attachment'||p.action==='attachment_media')await addAttachments(r,'chooseAttachments',{kind:p.action==='attachment_media'?'media':'file'});
    else if(p.action==='attachment_remove'){r.attachments=r.attachments.filter(a=>a.sha256!==p.text);save(r);await references(r);}
    else if(p.action==='files'){const value=JSON.parse(p.text);r.attachments=validateAttachments([...r.attachments,...value.attachments.filter(a=>!r.attachments.some(b=>a.sha256===b.sha256))]);save(r);await references(r,value.receipts||[]);}
    else if(p.action==='compact'){await call({action:'compact',id:r.id,generation:s.generation,request_id:crypto.randomUUID(),reason:'用户整理程序上下文'});await refresh();}
   }
   paint();
  }catch(e){onError(e.message);}
 });
 // 程序页请求开关自己的侧栏（如 Workspace 里「交给 Agent」）：只认当前显示的程序，宿主已核对发起页面。
 const stopSidebar=api.onProgramSidebar?.(p=>{if(!active()||p?.program!==selected.program)return;expanded=p.open!==false;hover=false;paint();});
 const stopFocus=api.onSessionFocus?.(value=>{
  if(closed||contactsFocus?.kind===value?.kind&&contactsFocus?.id===value?.id)return;
  contactsFocus=value;
  if(current()!=='contacts')return;
  revision++;clearTimeout(timer);signature='';publish();paint();if(active())void refresh();
 });
 const tabSelector=Object.values(tabs).map(id=>'#'+id).join(',');
 // 第二次点击顶栏里当前程序的图标：开关右侧对话栏，不再回首页，也不再挤压页面。
 const topClick=e=>{const tab=e.target?.closest?.(tabSelector);if(!tab)return;
  if(current()==='coding'&&tab.id===tabs.coding&&api.extensionOpen){e.preventDefault();e.stopImmediatePropagation();void api.extensionOpen({key:'coding',chatToggle:true}).then(check).catch(e=>onError(e.message));return;}
  if(!active()||tabs[selected.program]!==tab.id)return;e.preventDefault();e.stopImmediatePropagation();expanded=!expanded;hover=false;paint();};
 doc.addEventListener('click',topClick,true);
 const changed=()=>{signature='';paint();};
 doc.addEventListener('workspace-view-change',navigate);doc.addEventListener('workspace-inset-change',changed);doc.addEventListener('workspace-theme-change',changed);doc.addEventListener('workspace-modal-change',changed);doc.addEventListener('visibilitychange',refresh);doc.defaultView.addEventListener('resize',changed);
 return {paint,toggle(){if(active()){expanded=!expanded;paint();}},ownsPage:()=>!!tabs[current()]||contacts.has(current()),connectStore(value){store=value;stopStore?.();stopStore=store.subscribe(updateContacts);},refresh,async flush(){await Promise.all([...sessions.values()].map(r=>r.persistence.drain()));},
  suspend(){paused=true;revision++;clearTimeout(timer);},resume(){paused=false;navigate();},
  close(){closed=true;revision++;clearTimeout(timer);avatars.close();for(const r of sessions.values())r.decisions.close();stopStore?.();stopActions?.();stopSidebar?.();stopFocus?.();doc.removeEventListener('click',topClick,true);doc.removeEventListener('workspace-view-change',navigate);doc.removeEventListener('workspace-inset-change',changed);doc.removeEventListener('workspace-theme-change',changed);doc.removeEventListener('workspace-modal-change',changed);doc.removeEventListener('visibilitychange',refresh);doc.defaultView.removeEventListener('resize',changed);}
 };
}
