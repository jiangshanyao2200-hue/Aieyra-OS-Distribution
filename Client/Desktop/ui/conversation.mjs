// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: chat
// Regions: api; call; submitted; activity; openingModel; followTail; atTail; follow; identity; error; welcome; greetingView; chatSurface; memberRoot; avatars; linkIdentity; previewRoot; previews; refreshWorkOverlay; chatLayer; chatStructure; presentation; chatMotion; referenceToken; draftReady; durableDraft; saveDraft; syncReferences; attachments; imageViewer; mediaViewer; previewAttachments; theme; layout; busy; TOOL_TITLES; paintTools; loadToolImage; paint; refreshSettings; poll; send; stopKeys; stopState; stopVisible; stopSettings; resize
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/conversation.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupChatLayer,compactWorkRows,compactLiveRows} from './layered-chat.mjs';
import {chatStatus,chatFailureEntry} from './chat-status.mjs';
import {workPhase} from './work-selection.mjs';
import {sceneKind} from './model.mjs';
import {connectHalo} from '../../../Halo/runtime/desktop.mjs';
import {renderDigest,createDigestController} from './tool-digest.mjs';
import {resultFrame} from '../../../Tool/presentation/frame.mjs';
import {toolView} from './views.mjs';
import {activityLabel} from './activity.mjs';
import {setupMediaViewer,canPreviewMedia} from '../../../Theme/runtime/media.mjs';
import {setupImageViewer} from './image-viewer.mjs';
import {setupChatColumn,linkMessagePresentation,linkMessageGeneration,linkMessageAuthor} from './chat-column.mjs';
import {setupWorkParticipants} from './work-participants.mjs';
import {memberAvatars} from './member-avatars.mjs';
import {setupWorkSurface,conversationWorkReaders,conversationOperations} from './work-surface.mjs';
import {setupAskUser} from './ask-user.mjs';
import {createChatLayoutMotion} from './chat-reading.mjs';
import {ConversationPresentation} from './work-transcript.mjs';
import {mountComposer,composerLayout} from './composer-surface.mjs';
import {setupComposerKeys,setupComposerHistory} from './composer-keyboard.mjs';
import {setupAttachments,setupAttachmentIntake,paintBubbleAttachments} from './attachments.mjs';
import {subscribeWindowTheme} from './window-theme.mjs';
import {bindChatSurface,bindChatBottomRoom} from './chat-layout.mjs';
import {setupChoicePopover} from './interaction.mjs';
import {setupScrollEdges} from './scroll-edges.mjs';
import {bindDoubleClickCopy,clipboardWriter} from './copy-gesture.mjs';
import {createDraftPersistence} from './draft-persistence.mjs';
import {GreetingPresentation} from './experience.mjs';
const api=window.aieyraExtension,$=id=>document.getElementById(id),check=r=>{if(r?.ok===false)throw Object.assign(Error(r.error),{rejected:true});return r;};
connectHalo(api);
const call=p=>api.conversation(p).then(check);let descriptor,settings,profile={},snapshot=null,visible=true,closed=false,polling=false,timer,sending=false,composing=false,cursor=0,attempt=null,older=[],before=0;
const submitted=new Map();
const activity=new Map(),toolNodes=new Map(),scroll=$('conversation-scroll'),root=$('conversation-messages');
root.classList.add('shared-chat-messages');scroll.classList.add('soft-scroll');const stopScrollEdges=setupScrollEdges(document);
let openingModel=false,switchingModel=false,loadingOlder=false,lastPollError='',contactAvatar='',avatarRev=0,reloadingSettings=false;
setupChoicePopover($('conversation-model'),$('conversation-models'));
let followTail=true,tailFrame=0,readerUntil=0,readingPointer=false;
const atTail=()=>scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<60;
function follow(){if(followTail)chatMotion?.follow();}
// Reflow and native zoom also emit scroll. Only reading gestures can leave
// the tail; a layout event must never silently turn live following off.
scroll.addEventListener('scroll',()=>{if(readingPointer||performance.now()<readerUntil)followTail=atTail();},{passive:true});
scroll.addEventListener('wheel',event=>{readerUntil=performance.now()+700;if(event.deltaY<0)followTail=false;},{passive:true});
scroll.addEventListener('pointerdown',()=>{readingPointer=true;readerUntil=performance.now()+700;},{passive:true});
window.addEventListener('pointerup',()=>{if(!readingPointer)return;readingPointer=false;readerUntil=performance.now()+200;},{passive:true});
window.addEventListener('pointercancel',()=>readingPointer=false,{passive:true});
window.addEventListener('blur',()=>readingPointer=false);
scroll.addEventListener('keydown',event=>{if(event.target.closest('input,textarea,select')||!['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(event.key))return;readerUntil=performance.now()+700;if(['PageUp','Home','ArrowUp'].includes(event.key))followTail=false;});
const identity=()=>({role:settings?.contact?.role||'conversation',name:settings?.contact?.name||settings?.agent?.title||descriptor?.title||'智能体',ring:settings?.contact?.ring||'orbit',avatar:contactAvatar,glyph:''});
const error=text=>{$('conversation-error').textContent=text||'';$('conversation-error').hidden=!text;};
mountComposer();$('message').disabled=true;const column=setupChatColumn(root,{getProfile:()=>({...profile,roles:{...profile.roles,conversation:{name:identity().name,ring:identity().ring,avatar:contactAvatar}}})});
const welcome=setupChatColumn($('conversation-welcome'),{getProfile:()=>profile});
const greetingView=new GreetingPresentation();
const chatSurface=bindChatSurface(scroll,()=>profile);
const memberRoot=document.createElement('section');scroll.append(memberRoot);const participants=setupWorkParticipants(memberRoot,{getProfile:()=>profile});
const avatars=memberAvatars(m=>call({action:'member_avatar',member_id:m.id}),()=>paint());
const linkIdentity=m=>({role:m?.role||'conversation',name:m?.name||'成员',ring:m?.ring||'orbit',avatar:m?avatars.get(m):'',glyph:''});
const previewRoot=document.createElement('aside');previewRoot.id='stage';previewRoot.hidden=true;document.body.append(previewRoot);
const previews=setupWorkSurface(previewRoot,{...conversationWorkReaders(call,()=>snapshot),tools:true,
 browserSurface:api.browserWorkSurface,browserActive:()=>visible&&!closed});
const refreshWorkOverlay=()=>document.dispatchEvent(new CustomEvent('workspace-chat-layer-change'));
const chatLayer=setupChatLayer({content:scroll,nodes:[scroll,$('bottom-bar'),$('conversation-bar'),$('conversation-error')],initialOpen:true,onBeforeOpen:()=>chatMotion.follow({snap:true}),onChange:refreshWorkOverlay,onSettled:refreshWorkOverlay});
bindChatBottomRoom(document);
let chatStructure='',lastUser='';
const presentation=new ConversationPresentation();
const chatMotion=createChatLayoutMotion(scroll,{live:()=>root.querySelector('.chat-entry[data-work=true]')||root.lastElementChild,following:()=>visible&&followTail});

let referenceToken='',referenceSequence=0,pollAgain=false;
let draftReady=false,decisions;
const durableDraft=createDraftPersistence(p=>call({action:'draft_save',...p}),{onError:e=>error('草稿未保存：'+e.message)});
function saveDraft(){
 if(!draftReady)return;
 const text=decisions?.normalDraft?.value??$('message').value,files=attachments.values();
 const draft={value:text,pastes:'',attachments:files,outbox:[...submitted.values()].filter(e=>e.delivery!=='accepted').map(e=>({session_id:descriptor.agent_id,request_id:e.id,text:e.text,attachments:e.attachments,delivery:'pending'}))};
 durableDraft.schedule(draft);void durableDraft.flush().catch(e=>error('草稿未保存：'+e.message));syncReferences();
}
function syncReferences(receipts=[]){if(!referenceToken)return;void api.attachmentReferences({token:referenceToken,sequence:++referenceSequence,hashes:attachments.values().map(a=>a.sha256),receipts}).then(check).catch(()=>error('附件保留记录暂未同步，快照会继续保留。'));}
const attachments=setupAttachments($('composer-attachments'),$('add-attachment'),{choose:kind=>api.chooseAttachments({kind}),stagePaths:p=>api.stageAttachmentPaths(p),stageBytes:p=>api.stageAttachmentBytes(p),stageFileBytes:p=>api.stageFileBytes(p),thumbnail:a=>api.imageLibrary({action:'attachment',attachment:a,size:128,thumbnail:true}).then(check),preview:(a,all)=>previewAttachments(a,all),onChange:()=>{attempt=null;saveDraft();layout();},onError:error,onSettled:receipt=>syncReferences([receipt])});
decisions=setupAskUser({humanReply:p=>call({...p,action:'human_reply'})},{check,onError:error,onReply:poll,away:()=>!visible,
 getEditor:()=>({value:$('message').value,pastes:'',selection:[$('message').selectionStart,$('message').selectionEnd,$('message').selectionDirection],scroll:$('message').scrollTop}),
 setEditor:value=>{const m=$('message');m.value=value.value;const selection=value.selection||[m.value.length,m.value.length,'none'];m.setSelectionRange(...selection);m.scrollTop=value.scroll||0;layout();},
 readText:()=>$('message').value,isComposing:()=>composing,onChange:()=>layout()});
const imageViewer=setupImageViewer({call:p=>api.imageLibrary(p).then(check),attachItems:async items=>{const result=await attachments.addResult(()=>({attachments:items}));if(result?.accepted){imageViewer.close();$('message').focus();}},onError:error});
const mediaViewer=setupMediaViewer({read:attachment=>api.attachmentMedia({attachment}),subscribeVisibility:api.onVisibility});
document.addEventListener('eyra-media',event=>void mediaViewer.show(event.detail.attachment));
function previewAttachments(a,all){if(canPreviewMedia(a))return mediaViewer.show(a);const images=all.filter(x=>x.kind==='image');return imageViewer.show(images,Math.max(0,images.findIndex(x=>x.sha256===a.sha256)));}
document.addEventListener('eyra-attachment',e=>previewAttachments(e.detail.attachment,e.detail.attachments||[e.detail.attachment]));
setupAttachmentIntake($('message'),{api,attachments,open:()=>{},onError:error,paste:{insert(text){const input=$('message');input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));}}});
bindDoubleClickCopy(document,{copy:clipboardWriter(api)});
// R64：与首页同一套消息复制与“编辑后重新发送”。

document.addEventListener('aieyra:message-resend',event=>{event.detail.submit=()=>send({text:event.detail.text,request_id:event.detail.request_id});});
document.addEventListener('aieyra:chat-retry',event=>{const {id,generation,attempt}=event.detail;event.detail.submit=async()=>{if(id!==snapshot?.agent?.id)throw Error('会话已切换');await call({action:'retry_chat',id,generation,attempt});await poll();};});
const theme=subscribeWindowTheme(api,document.body,{chat:true,onProfile:value=>{profile=value;chatSurface.refresh();paint();}});
function layout(){composerLayout(document,{folded:false});document.body.style.setProperty('--conversation-composer-height',$('bottom-bar').offsetHeight+'px');}
function busy(){return ['queued','running','cancelling'].includes(snapshot?.agent?.state);}
// Retained calls use the same actual output and patch view as the workspace.
const TOOL_TITLES={web_search:'搜索',view_image:'看图',terminal:'终端',exec_command:'命令',write_stdin:'终端输入',read_shell_output:'终端输出',apply_patch:'修改文件'};
function paintTools(messages){
 const keep=new Set();
 for(const item of activity.values()){
  if(busy()&&item.generation===snapshot.agent.generation)continue;
  const user=messages.find(m=>m.from==='user'&&m.generation===item.generation);if(!user)continue;
  const parent=[...root.querySelectorAll('.chat-entry.user')].find(n=>n.dataset.id===user.id)?.querySelector('.chat-main');if(!parent)continue;
  const sourceKey=JSON.stringify([snapshot.core_epoch,snapshot.agent.id,item.generation,item.id]);keep.add(sourceKey);
  let record=toolNodes.get(sourceKey);
  if(!record){
   const node=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');node.className='conversation-tool';body.className='conversation-tool-body';node.append(summary,body);
   record={node,summary,body,item,image:'',imageLoading:false};
   const ownSession=snapshot.agent.id,ownEpoch=snapshot.core_epoch;
   record.controller=createDigestController(document,item,{
    readPage:offsets=>api.conversation({action:'receipt',call_id:item.id,receipt_generation:item.generation,...offsets}),
    isCurrent:()=>!closed&&visible&&snapshot?.agent.id===ownSession&&snapshot?.core_epoch===ownEpoch&&node.open&&node.isConnected,
    render:(doc,value,options)=>{
     if(!TOOL_TITLES[value.tool])return renderDigest(doc,value,options);
     const visual=doc.createElement('div');visual.className='tool-digest';visual.dataset.state=value.state||'';const frame=resultFrame(doc,visual,options.present),preview=value.preview||{};
     if(value.tool==='web_search'){
      const text=doc.createElement('div');text.textContent=preview.answer||preview.error?.message||value.detail||'';frame.content.append(text);
      for(const search of preview.searches||[])for(const hit of search.results||[]){const link=doc.createElement('a');link.href=hit.url;link.textContent=hit.title||hit.url;frame.content.append(link);}
     }else if(value.tool!=='view_image'){
      frame.content.append(toolView(value));const exit=value.exit_code??preview.exit_code;if(exit!=null){const status=doc.createElement('p');status.textContent='退出码 '+exit;frame.details.append(status);}
     }else{
      const text=doc.createElement('div');text.textContent=preview.observation||preview.error?.message||preview.description||value.detail||'';frame.content.append(text);
      if(preview.image_id){const img=doc.createElement('img');img.alt=preview.path||'查看的图片';img.loading='lazy';if(record.imageID===preview.image_id&&record.image)img.src=record.image;frame.content.append(img);}
     }
     return frame.finish();
    },
   });
   body.append(record.controller.element);node.ontoggle=()=>{record.controller.setVisible(visible&&node.open);if(node.open)void loadToolImage(record,sourceKey);};toolNodes.set(sourceKey,record);
  }
  record.item=item;record.node.dataset.state=item.state;
  const preview=item.preview||{},active=['queued','running'].includes(item.state),title=TOOL_TITLES[item.tool]||item.tool,target=item.command||preview.query||user.attachments?.find(a=>a.asset===preview.path)?.name||(preview.path?preview.path.split(/[\\/]/).at(-1):'')||item.targets?.join(' · ')||item.title||'';
  record.summary.title=preview.path||preview.query||'';record.summary.textContent=(TOOL_TITLES[item.tool]?[title,target].filter(Boolean).join(' · '):activityLabel(item))+(active?' · 进行中':preview.error?' · 未完成':'');
  record.controller.update(item);record.controller.setVisible(visible&&record.node.open);
  if(record.node.parentNode!==parent)parent.append(record.node);
  if(record.node.open)void loadToolImage(record,sourceKey);
 }
 for(const [id,record]of toolNodes)if(!keep.has(id)){record.controller.dispose();record.node.remove();toolNodes.delete(id);}
}
async function loadToolImage(record,key){
 const imageID=record.item.preview?.image_id;if(record.item.tool!=='view_image'||!imageID||record.imageLoading||record.imageID===imageID&&record.image||!visible||closed)return;
 record.imageLoading=true;
 try{const image=await call({action:'image',image_id:imageID});if(closed||!visible||!record.node.open||toolNodes.get(key)!==record||record.item.preview?.image_id!==imageID)return;record.imageID=imageID;record.image='data:'+image.mime+';base64,'+image.data;record.controller.update(record.item,{force:true});}
 catch(e){if(!closed&&visible&&toolNodes.get(key)===record)error(e.message);}
 finally{record.imageLoading=false;}
}
function paint(){
 if(!snapshot||closed||!visible)return;
 document.body.dataset.form=busy()?'work':'chat';
 const unique=new Map([...older,...snapshot.messages].map(m=>[m.id,{...m,role:m.from==='user'?'user':m.from==='mother'?'matrix':'conversation',identity:m.from==='user'||m.from==='mother'?undefined:identity(),text:m.text||(m.state==='cancelled'?'已停止':m.error)||''}]));
 let reconciled=false;for(const [id,entry] of submitted)if(unique.has(id)){submitted.delete(id);reconciled=true;}else unique.set(id,entry);
 if(reconciled)saveDraft();
 const messages=[...unique.values()];let entries=messages.filter(m=>m.from!=='core_link');
 const link=snapshot.link,members=(link?.members||[]).map(m=>({...m,avatar:avatars.get(m)}));
 for(const msg of link?.messages||[]){const member=linkMessageAuthor(link,msg);entries.push({id:'link:'+link.scope+':'+msg.seq,from:'eyra',role:member?.role||'conversation',identity:linkIdentity(member),...linkMessagePresentation(msg),generation:linkMessageGeneration(msg,snapshot.agent.id),at:msg.at,talk:true});}
 entries.sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0));const generation=snapshot.agent.generation,raw=snapshot.live||{},live=raw.generation===generation&&(!raw.agent_id||raw.agent_id===snapshot.agent.id)?{...raw,text:raw.new_body?'':raw.text}:{};
 const problem=chatFailureEntry(snapshot.agent,snapshot.agent.id,identity());
 entries=presentation.project(entries,{scope:snapshot.core_epoch+':'+snapshot.agent.id,agentId:snapshot.agent.id,generation,active:busy(),waiting:snapshot.agent.state==='waiting_user',live,briefs:[...activity.values()].filter(a=>a.generation===generation),status:chatStatus({state:snapshot.agent.state,phase:live.phase,activities:[...activity.values()],active:busy()}),identity:identity(),problem});
 chatLayer.update({identity:identity(),state:problem?'error':busy()?live.phase||'waiting':'idle',label:chatStatus({state:snapshot.agent.state,phase:live.phase,active:busy(),activities:[...activity.values()].filter(a=>a.generation===generation)}),active:busy(),rows:compactWorkRows(entries,generation),liveRows:compactLiveRows(entries,generation)});
 const lead={...snapshot.agent,name:identity().name,role:identity().role,ring:identity().ring,avatar:contactAvatar,activity:{items:[...activity.values()]}};
 const structure=JSON.stringify(entries.map(e=>[e.id,!!e.work])),user=entries.findLast(e=>e.from==='user')?.id||'',beforeMotion=chatStructure&&structure!==chatStructure?chatMotion.capture():null;
 const liveItem=[...activity.values()].filter(a=>a.state==='running').at(-1)||[...activity.values()].at(-1);
 const phase=workPhase({...lead,phase:live.phase||(live.text?'body':live.thought?'thinking':'waiting')});
 if(busy()&&phase==='body'&&live.text){const row=entries.at(-1);row.phase='body';row.effect='generic';}
 const greetingText=greetingView.project(snapshot.greeting?.text||'',{scope:snapshot.core_epoch+':'+snapshot.agent.id,working:busy()||sending||submitted.size>0});
 previews.update({core_epoch:snapshot.core_epoch,scope_id:snapshot.agent.id,active:busy(),hidden:!visible,operations:conversationOperations(snapshot,identity().name,[...activity.values()])});
 column.paint(entries,{motion:false});if(beforeMotion)chatMotion.commit(beforeMotion,{kind:user!==lastUser?'send':'brief'});chatStructure=structure;lastUser=user;
 decisions.update({core_epoch:snapshot.core_epoch,session_id:snapshot.agent.id,roles:[{...snapshot.agent,human_requests:snapshot.human_requests||[]}]});
 participants.paint([...members.filter(m=>m.id!==snapshot.agent.id).map(m=>({...m,identity:linkIdentity(m),phase:m.live?.phase,thought:m.live?.thought,text:m.live?.text,updated:Date.parse(m.updated)||0}))],{key:snapshot.agent.id});paintBubbleAttachments(root,messages);$('conversation-welcome').hidden=!greetingText;
 welcome.paint(greetingText?[{id:'greeting',from:'eyra',role:identity().role,identity:identity(),text:greetingText,greeting:true}]:[]);
 const greeting=$('conversation-welcome').querySelector('.chat-text'),name=$('conversation-welcome').querySelector('.chat-name');if(greeting)greeting.id='conversation-greeting';if(name)name.id='conversation-name';
 $('stop').hidden=!busy();$('send').disabled=sending||(!decisions.active&&busy())||snapshot.read_only===true;$('message').disabled=snapshot.read_only===true;$('message').placeholder=snapshot.read_only?'请回到原会话继续交流':'写下你的消息';$('add-attachment').disabled=snapshot.read_only===true;$('conversation-older').hidden=!(before?before>1:snapshot.has_older);
 layout();follow();
}
async function refreshSettings(){
 settings=await call({action:'settings'});if(closed)return;
 const rev=settings.contact?.avatar_rev||0;if(rev!==avatarRev){avatarRev=rev;try{contactAvatar=rev?(await call({action:'contact_avatar'})).avatar||'':'';}catch{contactAvatar='';}}
 const selected=settings.models.find(m=>m.id===settings.agent.model_id);
 $('conversation-model').textContent=selected?.name||selected?.model||'模型';
 $('conversation-model').disabled=snapshot?.read_only===true;
 $('conversation-model').title='仅切换当前会话；下一次请求生效';
 $('conversation-models').replaceChildren(...settings.models.map(model=>{
  const b=document.createElement('button');b.type='button';b.role='option';b.textContent=model.name||model.model;b.tabIndex=-1;b.disabled=switchingModel;b.setAttribute('aria-selected',String(model.id===settings.agent.model_id));
  b.onclick=async()=>{
   if(switchingModel)return;switchingModel=true;
   for(const item of $('conversation-models').children)item.disabled=true;
   try{await call({action:'session_model',revision:settings.agent.revision,model_id:model.id});$('conversation-models').hidePopover();$('conversation-model').focus({preventScroll:true});error('');}
   catch(e){error(e.message);}
   finally{switchingModel=false;try{await refreshSettings();}catch(e){error(e.message);}for(const item of $('conversation-models').children)item.disabled=false;if($('conversation-models').matches(':popover-open'))$('conversation-models').querySelector('[aria-selected=true]')?.focus({preventScroll:true});}
  };return b;
 }));paint();
}
async function poll(){clearTimeout(timer);if(closed||!visible)return;if(polling){pollAgain=true;return;}polling=true;
 try{const next=await call({action:'snapshot',since:cursor});if(closed)return;if(next.agent.generation<(snapshot?.agent?.generation||0)){pollAgain=true;return;}if(settings&&next.agent.revision!==settings.agent.revision&&!reloadingSettings){reloadingSettings=true;void refreshSettings().catch(()=>{}).finally(()=>reloadingSettings=false);}snapshot=next;const page=snapshot.activity;cursor=page.cursor;for(const item of page.items||[])if(item.hidden)activity.delete(item.id);else activity.set(item.id,item);if(lastPollError&&$('conversation-error').textContent===lastPollError)error('');lastPollError='';paint();}
 catch(e){lastPollError=e.message;error(e.message);}finally{polling=false;if(!closed&&visible){const delay=pollAgain?0:busy()?240:1600;pollAgain=false;timer=setTimeout(poll,delay);}}
}
async function send(options={}){
 const inline=typeof options.text==='string';
 if(!inline&&decisions.active)return decisions.submit();
 if(sending||busy()||composing||attachments.pending||snapshot?.read_only){if(inline)throw Error('当前暂不能发送，编辑内容已保留。');return;}const text=inline?options.text:$('message').value,files=inline?[]:attachments.values();if(!text.trim()&&!files.length)return;
 const signature=JSON.stringify([text,files]),retry=[...submitted.values()].find(e=>JSON.stringify([e.text,e.attachments])===signature);if(!inline&&(!attempt||attempt.signature!==signature))attempt={signature,id:retry?.id||crypto.randomUUID()};const own=inline?{signature,id:options.request_id}:attempt;submitted.set(own.id,{id:own.id,from:'user',text,attachments:files,at:new Date().toISOString(),state:'queued',delivery:'pending'});saveDraft();
 sending=true;followTail=true;readingPointer=false;readerUntil=0;error('');paint();let dispatched=false;
 try{await durableDraft.drain();dispatched=true;const accepted=await call({action:'send',request_id:own.id,message:text,attachments:files,generation:snapshot?.agent?.generation||0});if(submitted.has(own.id))submitted.get(own.id).delivery='accepted';if(snapshot)snapshot.agent={...snapshot.agent,...accepted};if(!inline&&$('message').value===text&&JSON.stringify(attachments.values())===JSON.stringify(files)){$('message').value='';attachments.clear();}if(!inline)attempt=null;saveDraft();await poll();}
 catch(e){if(!dispatched||e.rejected)submitted.delete(own.id);else if(submitted.has(own.id))submitted.get(own.id).delivery='unknown';saveDraft();error(e.message);if(inline&&(!dispatched||e.rejected))throw e;}finally{sending=false;paint();layout();}
}
$('send').onclick=send;$('stop').onclick=async()=>{try{await call({action:'cancel',generation:snapshot.agent.generation});await poll();}catch(e){error(e.message);}};
const stopKeys=setupComposerKeys($('message'),{send,isComposing:()=>composing}),stopHistory=setupComposerHistory($('message'),{isComposing:()=>composing,entries:()=>(snapshot?.messages||[]).filter(m=>m.from==='user').map(m=>m.text)});$('message').addEventListener('compositionstart',()=>composing=true);$('message').addEventListener('compositionend',()=>{composing=false;layout();});$('message').addEventListener('input',()=>{if(decisions.input())return;attempt=null;saveDraft();layout();});
$('conversation-model').onclick=async()=>{if(openingModel||switchingModel)return;if($('conversation-models').matches(':popover-open')){$('conversation-models').hidePopover();return;}openingModel=true;$('conversation-model').setAttribute('aria-busy','true');try{await refreshSettings();if(visible&&!closed)$('conversation-models').showPopover();}catch(e){error(e.message);}finally{openingModel=false;$('conversation-model').removeAttribute('aria-busy');}};
document.addEventListener('keydown',e=>decisions.escape(e),true);
$('conversation-older').onclick=async()=>{if(loadingOlder||!snapshot)return;loadingOlder=true;$('conversation-older').disabled=true;followTail=false;try{const value=await call({action:'snapshot',before:before||snapshot.before,since:cursor});if(closed)return;const height=scroll.scrollHeight;older=[...value.messages,...older];before=value.before;paint();scroll.scrollTop+=scroll.scrollHeight-height;}catch(e){error(e.message);}finally{loadingOlder=false;$('conversation-older').disabled=false;}};
document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link){event.preventDefault();void api.openLink({url:link.href}).then(check).catch(e=>error(e.message));}});
const stopState=api.onState(value=>{descriptor=value;document.body.dataset.placement=value.placement;document.title=value.title+' · Aieyra';});
const stopVisible=api.onVisibility(value=>{visible=value.visible;document.body.dataset.visible=String(visible);for(const record of toolNodes.values())record.controller.setVisible(visible&&record.node.open);if(!visible)previews.suspend();if(visible){void poll();layout();}else clearTimeout(timer);});
const stopSettings=api.onSettingsChanged(event=>{if(event.method==='saveProfile')void refreshSettings().catch(e=>error(e.message));});
const resize=new ResizeObserver(()=>{layout();follow();});resize.observe(document.body);resize.observe(scroll);resize.observe(root);
window.addEventListener('beforeunload',()=>{closed=true;for(const record of toolNodes.values())record.controller.dispose();toolNodes.clear();clearTimeout(timer);cancelAnimationFrame(tailFrame);theme.close();stopState();stopVisible();stopSettings();stopKeys();stopHistory();stopScrollEdges();resize.disconnect();column.close();welcome.close();chatSurface.close();chatLayer.close();participants.close();previews.close();chatMotion.close();decisions.close();avatars.close();},{once:true});
try{
 descriptor=check(await api.describe());chatLayer.scope('conversation:'+descriptor.agent_id);visible=descriptor.visible;document.body.dataset.placement=descriptor.placement;document.body.dataset.visible=String(visible);referenceToken=check(await api.attachmentState()).token;
 let saved;try{saved=await call({action:'draft_load'});durableDraft.initialize(saved);}catch(e){durableDraft.initialize(null,e.message);error('草稿无法读取：'+e.message);}
 if(saved){
  const draft=saved.draft;$('message').value=draft.value||'';attachments.restore(JSON.stringify(draft.attachments||[]));
  const pending=draft.outbox?.find(p=>p.session_id===descriptor.agent_id&&p.text===draft.value);
  if(pending)attempt={id:pending.request_id,signature:JSON.stringify([pending.text,pending.attachments||[]])};
  for(const entry of draft.outbox||[])if(entry.session_id===descriptor.agent_id)submitted.set(entry.request_id,{id:entry.request_id,from:'user',text:entry.text,attachments:entry.attachments||[],at:new Date().toISOString(),state:'queued',delivery:'unknown'});
 }
 draftReady=true;syncReferences();await theme.refresh();await refreshSettings();await poll();layout();void call({action:'greet'}).then(()=>poll()).catch(e=>error(e.message));
}catch(e){error(e.message);}
