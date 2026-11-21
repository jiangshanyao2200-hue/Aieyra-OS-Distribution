import {mountProgramToolbar} from '../../../../Theme/runtime/program-toolbar.mjs';
import {app,call,say,setupShell,$} from '../../../../Client/Desktop/ui/app-shell.mjs';
import {setupChatAttachmentViewer} from '../../../../Client/Desktop/ui/chat-attachment-viewer.mjs';
import {createAgentDock} from '../../../../Client/Desktop/ui/agent-dock.mjs';
import {setupChatColumn} from '../../../../Client/Desktop/ui/chat-column.mjs';
import {applyChatLayout} from '../../../../Client/Desktop/ui/chat-layout.mjs';
import {mountComposer,composerLayout} from '../../../../Client/Desktop/ui/composer-surface.mjs';
import {setupComposerKeys} from '../../../../Client/Desktop/ui/composer-keyboard.mjs';
import {createSharedDraftPersistence} from '../../../../Client/Desktop/ui/shared-draft.mjs';
import {setupAttachments,setupAttachmentIntake} from '../../../../Client/Desktop/ui/attachments.mjs';
import {roleIdentity} from '../../../../Client/Desktop/ui/role-identity.mjs';
import {setupToolWorkSurface} from '../../../../Client/Desktop/ui/work-surface.mjs';
import {setupProjectLayout} from './project-layout.mjs';
import {activityLabel} from '../../../../Client/Desktop/ui/activity.mjs';
import {createReceiptReader} from '../../../../Tool/presentation/receipt-reader.mjs';
import {bindDialog} from '../../../../Client/Desktop/ui/interaction.mjs';
import {setupChatLayer} from '../../../../Client/Desktop/ui/layered-chat.mjs';
import {chatStatus,chatFailureEntry} from '../../../../Client/Desktop/ui/chat-status.mjs';
import {setupPlanOrb} from '../../../../Client/Desktop/ui/plan-orb.mjs';
import {planData} from '../../../../Tool/base/official/update_plan/presentation/model.mjs';
import {setupProjectView} from './project-view.mjs';
import {setupReportSurface} from '../../../../Client/Desktop/ui/report-surface.mjs';
import {haloRuntime} from '../../../../Halo/runtime/desktop.mjs';
import {setupTooltips} from '../../../../Client/Desktop/ui/tooltip.mjs';
setupShell();
setupTooltips(document);
const halo=haloRuntime(),busy=s=>['queued','running','cancelling','replying','working'].includes(s);
let binding=null,profile={},group=null,epoch='',pending=null,sending=false,closed=false,visible=true,polling=false,again=false,timer=0,ticket=0,lastSeq=-1,draftScope='',draftReady=false,draftToken='',referenceSequence=0,terminalScope='',lastError='';
let operations=[],flowKey=0,flowActive=false,chatRefresh=null;
const flowMembers=new Map();
const avatars=new Map(),stream=$('t-stream');
const members=()=>binding?.members||[],working=()=>members().some(m=>busy(m.state));
const memberOf=sender=>members().find(m=>m.contact_id===sender||m.role===sender||sender==='host'&&m.role==='cota');
const identityOf=sender=>{if(sender==='eyra')return roleIdentity(profile,'matrix');const m=memberOf(sender),role=m?.role==='vaya'?'project':'execution',base=roleIdentity(profile,role);return {...base,role,name:m?.name||base.name,avatar:avatars.get(m?.role)||base.avatar,ring:m?.ring||base.ring};};
const read=(action,p={})=>call({...p,action});
const readReceipt=p=>app.invoke({...p,action:'receipt'});
const readTerminal=p=>app.invoke({...p,action:'terminal_output'});
const projectLayout=setupProjectLayout(document.querySelector('.cd-project'));
const terminalView=setupToolWorkSurface(stream,{flow:true,readReceipt,readTerminal,identityFor:item=>identityOf(item.member),onReceipt:showReceipt,
 readImage:p=>app.invoke({...p,action:'work_image'}),
 readProgram:p=>app.invoke({...p,action:'work_program'})}),transcript=terminalView.transcript;
mountComposer();
const message=$('message'),send=$('send'),stop=$('stop');
const chatLayer=setupChatLayer({nodes:[document.querySelector('.cd-side')],initialOpen:false,preference:p=>app.invoke({scope:'os',action:'chat_layer',...p})});
const projectView=setupProjectView({root:document.querySelector('.cd-project'),read,dropProject:files=>app.projectDrop(files),onError:e=>say(e,true),onBindingChanged:next=>{ticket++;binding=next;clearOperations();paintTerminal();terminalScope='';lastSeq=-1;clearTimeout(timer);timer=setTimeout(tick,0);}});
const projectDialog=$('project-dialog'),filesButton=$('project-open');
const files=bindDialog(projectDialog,{opener:filesButton,onClose:()=>{projectView.setVisible(false);void projectView.flush().catch(e=>say(e.message,true));}});
projectView.setVisible(false);
function showFiles(){
 if(projectDialog.open)return;
 files.show();projectView.setVisible(visible);updateProject();
}
mountProgramToolbar($('coding-toolbar'));
filesButton.onclick=showFiles;
$('project-new').onclick=()=>{showFiles();void projectView.chooseProject('new');};
$('project-choose').onclick=()=>{showFiles();void projectView.chooseProject('directory');};
$('project-close').onclick=files.close;
const openFilesByKey=e=>{
 if(e.defaultPrevented||e.altKey||!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='o'||document.querySelector('dialog[open]')||document.body.dataset.chatExpanded==='true')return;
 e.preventDefault();showFiles();void projectView.chooseFile(e.shiftKey).catch(()=>{});
};
document.addEventListener('keydown',openFilesByKey,true);
const planOrb=setupPlanOrb({root:$('plan-orb'),button:$('plan-bubble'),track:$('plan-current'),count:$('plan-count'),pop:$('plan-pop'),content:$('plan-pop-content')});
const reports=setupReportSurface({read,onError:e=>say(e,true)});
document.querySelector('.cd-side').addEventListener('click',e=>{if(e.target.closest('.role-ring'))chatLayer.toggle();});message.maxLength=20000;message.setAttribute('aria-label','给 Coding 写消息');
const layout=()=>composerLayout(document,{folded:false});
const drafts=createSharedDraftPersistence(p=>read('draft_save',p),{delay:0,onError:e=>say('草稿未保存：'+e.message,true)});
const attachment=(method,args={})=>read('attachment',{method,args});
const syncReferences=receipts=>draftToken?attachment('attachmentReferences',{token:draftToken,sequence:++referenceSequence,hashes:attachments.values().map(a=>a.sha256),receipts:receipts||[]}):Promise.resolve();
function saveDraft(){if(!draftReady)return;drafts.schedule({value:message.value,pastes:'',attachments:attachments.values(),outbox:pending?[{session_id:draftScope,request_id:pending.request_id,text:pending.message,attachments:pending.attachments,delivery:'pending'}]:[]});}
const attachments=setupAttachments($('composer-attachments'),$('add-attachment'),{choose:kind=>attachment('chooseAttachments',{kind}),stagePaths:p=>attachment('stageAttachmentPaths',p),stageBytes:p=>attachment('stageAttachmentBytes',p),stageFileBytes:p=>attachment('stageFileBytes',p),thumbnail:a=>attachment('imageLibrary',{action:'attachment',attachment:a,size:128,thumbnail:true}),preview:(a,all)=>attachmentViewer.preview(a,all),onChange:()=>{saveDraft();layout();void syncReferences().catch(e=>say(e.message,true));},onSettled:r=>void syncReferences([r]).catch(e=>say(e.message,true)),onError:e=>say(e,true)});
const attachmentViewer=setupChatAttachmentViewer({read:attachment,subscribeVisibility:app.onVisibility,attachItems:async items=>{await attachments.addResult(()=>({attachments:items}));attachmentViewer.close();message.focus();},onError:e=>say(e,true)});
setupAttachmentIntake(message,{api:app,attachments,open:()=>message.focus(),onError:e=>say(e,true),paste:{insert(text){message.setRangeText(text,message.selectionStart,message.selectionEnd,'end');message.dispatchEvent(new Event('input',{bubbles:true}));}}});
const welcome=setupChatColumn($('welcome'),{getProfile:()=>profile});
const dock=createAgentDock({root:$('chat'),scroller:$('chat-scroll'),read,getProfile:()=>profile,identityOf,historyActions:false,onState:s=>{const text=s.error||(s.busy&&!s.loaded?'正在读取记录…':s.loadingOlder?'正在读取更早的记录…':s.indexing?'正在整理记录…':'');$('chat-status').textContent=text;$('chat-status').hidden=!text;}});
function paintWelcome(){
 const m=members().find(m=>m.role==='cota'),id=identityOf('cota');
 $('welcome').hidden=lastSeq>1;
 welcome.paint([{id:'coding-welcome',from:'eyra',role:id.role,identity:id,greeting:true,text:m?.configured?'可以把编程任务交给我。开始工作后，调查和执行过程会显示在工作区。':'Cota 和 Vaya 默认跟随 Eyra；可在右上角选择模型。也可以直接打开项目和文件。'}]);
}
function liveEntries(){return (group?.members||[]).flatMap(m=>{
 const live=m.live||m,who=memberOf(m.key||m.contact_id||m.role),id=identityOf(who?.role||m.key);
 const failure=chatFailureEntry({...m,id:m.session},binding?.scope_id,id);
 if(failure)return m.generation>(binding?.project?.generation_floor?.[m.session]||0)?[{...failure,id:'live:'+m.session+':'+m.generation}]:[];
 if(!busy(m.state)&&m.state!=='waiting_user')return [];
 const receipts=operations.filter(item=>item.member===who?.role&&item.generation===m.generation);
 const phase=live.phase||(live.text?'body':live.thought?'thinking':receipts.some(r=>r.state==='running')?'tool':'waiting');
 const key='live:'+m.session+':'+m.generation;
 return [{id:key,from:'eyra',role:id.role,identity:id,text:'',streaming:busy(m.state),phase,haloState:phase,work:{key,phase,live,thought:live.thought||'',text:live.new_body?'':live.text||'',briefs:receipts,status:chatStatus({state:m.state,phase,activities:receipts,active:busy(m.state)})}}];
});}
function clearOperations(){operations=[];flowMembers.clear();flowActive=false;flowKey++;}
function updateProject(){
 const path=binding?.project?.root||'';$('project-path').textContent=path||'未打开项目';$('project-path').title=path;
 if(!projectDialog.open)return;
 projectLayout.activity(!!binding?.project?.root,false);
 void projectView.update({binding,operations}).catch(e=>say(e.message,true));
}
function paintTerminal(){
 const activeMembers=members().filter(m=>busy(m.state)||m.state==='waiting_user'),active=activeMembers.length>0;
 if(active&&!flowActive){flowMembers.clear();flowKey++;}
 for(const member of activeMembers)flowMembers.set(member.role,member.generation);
 flowActive=active;
 const current=operations.filter(item=>flowMembers.get(item.member)===item.generation);
 document.body.dataset.form=active&&current.length?'work':'chat';
 terminalView.update({scope_id:binding?.scope_id,project_key:binding?.project_key,core_epoch:epoch,flow_key:flowKey,operations:current,active,hidden:!visible});
 const live=(group?.members||[]).find(m=>busy(m.state)),phase=live?.live?.phase||live?.phase||live?.state||'idle';
 const label=chatStatus({state:live?.state||members().find(m=>['failed','interrupted'].includes(m.state))?.state||'idle',phase,activities:operations,active:working()});
 chatLayer.update({identity:identityOf(live?.key||'cota'),state:phase,label,active:working()});
 const plan=operations.findLast(item=>isPlan(item)&&item.state==='completed'&&planData(item).steps.length);
 planOrb.paint(plan?{...plan,key:plan.id}:null,{active:working()});
 updateProject();

}
const isPlan=item=>item.tool==='update_plan'||item.preview?.kind==='plan';
const detail=bindDialog($('work-detail'));let receiptReader=null;
function showReceipt(item){
 const own=terminalScope;
 receiptReader?.dispose();$('detail-title').textContent=activityLabel(item);
 receiptReader=createReceiptReader(document,{isCurrent:()=>!closed&&visible&&terminalScope===own,
  readPage:page=>readReceipt({role:item.member,call_id:item.call_id,generation:item.generation,...page})});
 $('detail-body').replaceChildren(receiptReader.element);detail.show();receiptReader.element.open=true;
}
$('work-detail').addEventListener('close',()=>{receiptReader?.dispose();receiptReader=null;});
$('detail-close').onclick=detail.close;
function controls(){const ready=!!binding?.host_session_id&&draftReady;send.disabled=!ready||sending||attachments.pending;message.disabled=!ready;$('add-attachment').disabled=!ready||sending;stop.hidden=!working();message.placeholder=ready?'交给 Cota…':'请在右上角选择模型';}
async function submit(){
 if(sending||!draftReady||attachments.pending)return;
 if(!pending&&!message.value.trim()&&!attachments.length)return;
 const attempt=pending||{request_id:crypto.randomUUID(),message:message.value,attachments:attachments.values()};pending=attempt;sending=true;saveDraft();controls();
 try{await drafts.drain();await read('send',attempt);pending=null;if(message.value===attempt.message)message.value='';const used=new Set(attempt.attachments.map(a=>a.sha256));attachments.restore(JSON.stringify(attachments.values().filter(a=>!used.has(a.sha256))));saveDraft();await drafts.drain();await syncReferences();void tick();}
 catch(e){say(e.message+'；草稿和原请求已保留，再次发送会核对同一请求。',true);}
 finally{sending=false;layout();controls();}
}
send.onclick=()=>void submit();stop.onclick=async()=>{try{for(const m of members().filter(m=>busy(m.state)))await read('cancel',{role:m.role,generation:m.generation});void tick();}catch(e){say(e.message,true);}};
const stopKeys=setupComposerKeys(message,{send:()=>void submit()});
message.addEventListener('input',()=>{saveDraft();layout();});
document.addEventListener('aieyra:chat-retry',event=>{
 const d=event.detail;
 if(d.failureId){
  const project_key=binding?.project_key;
  const member=members().find(m=>m.session_id===d.id&&m.generation===d.generation);
  d.submit=async()=>{
   if(!member)throw Error('编程成员或任务已变化');
   await read('retry',{role:member.role,session_id:member.session_id,generation:member.generation,project_key,attempt:d.attempt});
   void tick();
  };
 }
});
async function initializeDraft(scope){
 if(draftScope===scope&&draftReady)return;
 if(draftReady)await drafts.drain();draftReady=false;draftScope=scope;
 const value=await read('draft_load');drafts.initialize(value);message.value=value.draft?.value||'';attachments.restore(JSON.stringify(value.draft?.attachments||[]));const p=value.draft?.outbox?.[0];pending=p?{request_id:p.request_id,message:p.text,attachments:p.attachments||[]}:null;
 const refs=await attachment('attachmentState');draftToken=refs.token;referenceSequence=0;draftReady=true;await syncReferences();layout();
}
async function tick(){
 clearTimeout(timer);if(closed||!visible||document.hidden)return;if(polling){again=true;return;}polling=true;const own=ticket;
 try{
  const status=await read('status',{after:Math.max(0,lastSeq),open:true});if(closed||own!==ticket)return;
  binding=status.binding;chatLayer.scope(binding?.scope_id?'coding:'+binding.scope_id:'');profile=status.profile||{};group=status.group;applyChatLayout(document.body.style,profile.chatLayout);
  for(const m of members())if(!avatars.has(m.role)){try{avatars.set(m.role,(await read('avatar',{role:m.role})).avatar||'');}catch{avatars.set(m.role,'');}}
  if(binding.host_session_id){await initializeDraft(binding.host_session_id);if(closed||own!==ticket)return;
   const terminal=await read('terminal');if(closed||own!==ticket)return;
   if(terminal.scope_id!==binding.scope_id||terminal.project_key!==binding.project_key){again=true;return;}
   reports.paint({session_id:binding.scope_id,core_epoch:terminal.core_epoch,documents:terminal.documents||[]});
   epoch=terminal.core_epoch||'';const scope=JSON.stringify([binding.scope_id,binding.project_key,epoch]);if(scope!==terminalScope){clearOperations();terminalScope=scope;lastSeq=-1;}
   operations=terminal.items||[];
   paintTerminal();
   dock.open({scope_id:binding.scope_id,kind:'group',core_epoch:epoch});
   refreshChat(group?.seq||0,own);
   if(terminal.warning){$('chat-status').textContent='部分操作记录暂不可读';$('chat-status').hidden=false;}
  }else{dock.reset();draftReady=false;lastSeq=0;clearOperations();terminalScope='';epoch='';paintTerminal();presentChat();}
  lastError='';
 }catch(e){showReadError(e,own);}
 finally{polling=false;if(!closed){controls();if(visible&&!document.hidden)timer=setTimeout(tick,again||own!==ticket?0:working()||transcript.rows().some(row=>row.active)?600:2000);again=false;}}
}
function presentChat(){paintWelcome();chatLayer.presented({empty:true});}
function showReadError(error,own){if(!closed&&own===ticket&&error.message!==lastError){lastError=error.message;$('chat-status').textContent='会话暂不可读，正在重试';$('chat-status').hidden=false;chatLayer.presented({empty:true});}}
function refreshChat(sequence,own){
 const scope=terminalScope;
 if(chatRefresh?.ticket===own&&chatRefresh.scope===scope)return;
 if(lastSeq===sequence){dock.live(liveEntries());presentChat();return;}
 // History and its matching live entries commit together. Tool snapshots keep
 // polling while the chat page is being read or indexed.
 const request={ticket:own,scope};chatRefresh=request;
 const current=()=>!closed&&ticket===own&&terminalScope===scope&&chatRefresh===request;
 void dock.refresh(liveEntries()).then(ok=>{
  if(ok&&current()){lastSeq=sequence;presentChat();}
 }).catch(error=>{if(current())showReadError(error,own);}).finally(()=>{if(chatRefresh===request)chatRefresh=null;});
}
const stopVisibility=app.onVisibility?.(value=>{visible=value?.visible===true;projectView.setVisible(visible&&projectDialog.open);receiptReader?.setVisible(visible);clearTimeout(timer);ticket++;if(!visible)terminalView.suspend();if(visible)void tick();});
const stopEvents=app.on?.(e=>{
 if(e?.type==='theme'){avatars.clear();void tick();}else if(e?.type==='chat-layer')chatLayer.toggle();
 else if(e?.type==='prepare-drafts')void(async()=>{
  const wasInert=document.body.inert;document.body.inert=true;let ok=false;
  try{saveDraft();await drafts.drain();await projectView.flush();ok=true;}
  catch{say('编辑草稿尚未保存，页面已保留。',true);}
  finally{document.body.inert=wasInert;await app.invoke({action:'drafts_saved',id:e.id,ok});}
 })().catch(()=>{});
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void tick();});window.addEventListener('resize',layout);
window.addEventListener('pagehide',()=>{saveDraft();void drafts.drain().catch(()=>{});closed=true;ticket++;clearTimeout(timer);stopVisibility?.();stopEvents?.();stopKeys();document.removeEventListener('keydown',openFilesByKey,true);dock.close();welcome.close();terminalView.close();files.destroy();detail.destroy();projectLayout.close();chatLayer.close();projectView.close();planOrb.close();reports.close();receiptReader?.dispose();attachmentViewer.dispose();halo.close();},{once:true});
controls();void tick();
