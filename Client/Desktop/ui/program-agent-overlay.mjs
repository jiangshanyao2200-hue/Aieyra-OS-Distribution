// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: native-chat, projection
// Regions: setupProgramOverlay; setupProgramWorkOverlay
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/program-agent-overlay.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setFeedback} from './feedback.mjs';
import {setupChatAttachmentViewer} from './chat-attachment-viewer.mjs';
import {createAgentDock} from './agent-dock.mjs';
import {applyChatLayout,bindChatBottomRoom} from './chat-layout.mjs';
import {composerLayout} from './composer-surface.mjs';
import {setupChatLayer} from './layered-chat.mjs';
import {setupChatColumn} from './chat-column.mjs';
import {paintBubbleAttachments} from './attachments.mjs';
import {mountPlanOrb} from './plan-orb.mjs';
import {planData} from '../../../Tool/base/official/update_plan/presentation/model.mjs';
import {setupReportSurface} from './report-surface.mjs';
import {setupWorkSurface} from './work-surface.mjs';
import {setupProgramImageJobs} from './program-image-jobs.mjs';
import {captureChatReading,restoreChatReading,serializeChatReading,createChatLayoutMotion,createChatReadingIntent} from './chat-reading.mjs';
import {applyAppearanceFrame,applyResourceTheme} from './appearance.mjs';

// 程序侧栏复用 OS 消息与输入框；顶部提供始终可达的收起按钮。
// 消息列由 agent-dock 提供：先取最近 20 轮，向上滚动加载更早的，直到全部。
export function setupProgramOverlay({frame,action,read},doc=document){
 const edge=doc.createElement('button');
 edge.type='button';edge.className='program-panel-edge';edge.id='program-panel-edge';edge.setAttribute('aria-label','展开对话侧栏');edge.setAttribute('aria-controls','program-panel-content');edge.textContent='‹';edge.onclick=()=>action('toggle');doc.body.append(edge);
 const header=doc.createElement('header'),title=doc.createElement('span'),collapse=doc.createElement('button');
 header.className='program-panel-header';title.className='program-panel-title';collapse.type='button';collapse.id='program-panel-collapse';collapse.className='panel-collapse';collapse.setAttribute('aria-label','收起对话侧栏');collapse.setAttribute('aria-controls','program-panel-content');collapse.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';collapse.onclick=()=>action('close');header.append(title,collapse);doc.body.append(header);
 const recent=doc.createElement('section'),status=doc.createElement('div'),welcome=doc.createElement('div'),messages=doc.createElement('div');
 status.className='program-status';status.hidden=true;status.setAttribute('aria-live','polite');welcome.className='program-panel-welcome';
 recent.id='program-panel-content';recent.setAttribute('role','complementary');recent.setAttribute('aria-label','程序对话');recent.className='program-recent';messages.className='program-messages';
 recent.append(status,welcome,messages);doc.body.append(recent);
 const avatarToggle=e=>{if(e.target.closest('.role-ring'))void action('close');};recent.addEventListener('click',avatarToggle);
 let chatMotion;
 const layer=setupChatLayer({doc,content:recent,nodes:[header,recent,doc.getElementById('bottom-bar')],initialOpen:false,external:true,deferMotion:true,onMove:move=>action('move',JSON.stringify(move)),onChange:open=>action(open?'toggle':'close'),onBeforeOpen:()=>chatMotion?.follow({snap:true}),onSettled:token=>{if(!frame().expanded)void action('layer_settled',String(token));else chatMotion?.follow({snap:true});}});
 layer.enable(false);
 const profile=()=>{const f=frame(),p=f.profile||{};return {...p,eyraName:f.identity?.name,eyraAvatar:f.identity?.avatar,roles:{...p.roles,matrix:{...f.identity},conversation:{...f.identity}}};};
 // 历史里的发言人：母体的委派回复用母体身份，其余都是这个程序的 Agent。
 const identityOf=sender=>{const f=frame(),p=f.profile||{};return sender==='mother'?{role:'matrix',name:p.eyraName||'Eyra',avatar:p.eyraAvatar||'',ring:'pulse'}:{...f.identity,role:'conversation'};};
 const readChecked=async(name,p)=>{const r=await read(name,p);if(r?.ok===false)throw Error(r.error||'读取记录失败');return r;};
 const attachmentViewer=setupChatAttachmentViewer({read:(method,args)=>readChecked('attachment',{method,args}),onError:message=>showError(Error(message))});
 let dockState={},current={},statusKey='';
 function paintWelcome(){const v=current,empty=!v.configured||dockState.empty&&!(v.messages||[]).length;welcome.hidden=v.program==='home'||!empty;}
 function paintStatus(){
  const s=dockState,text=s.error?'记录暂不可读':(!s.loaded&&s.busy?'正在读取记录…':s.loadingOlder?'正在读取更早的记录…':s.indexing?'正在整理记录…':''),key=JSON.stringify([text,!!s.error,!!s.more]);
  if(key===statusKey)return;statusKey=key;status.replaceChildren();status.hidden=!text;if(!text)return;
  const line=doc.createElement('span');line.textContent=text;status.append(line);
  if(s.error){const retry=doc.createElement('button');retry.type='button';retry.className='quiet';retry.textContent='重试';retry.onclick=()=>void(dockState.loaded&&dockState.more?dock.older():dock.refresh());status.append(retry);}
 }
 const dock=createAgentDock({root:messages,scroller:recent,read:readChecked,getProfile:profile,identityOf,layoutMotion:{capture:()=>chatMotion.capture(),commit:(...args)=>chatMotion.commit(...args),follow:(...args)=>chatMotion.follow(...args),reset:()=>chatMotion.reset()},onState:s=>{dockState=s;paintWelcome();paintStatus();layer.presented({empty:!!s.error});}});
 const homeColumn=setupChatColumn(messages,{getProfile:profile});
 const planOrb=mountPlanOrb(doc),reports=setupReportSurface({read:readChecked,onError:message=>showError(Error(message))});
 const decisionButton=doc.createElement('button');decisionButton.type='button';decisionButton.className='ask-orb';decisionButton.textContent='?';decisionButton.setAttribute('aria-label','查看待回答的问题');decisionButton.hidden=true;decisionButton.onclick=()=>action('decision',JSON.stringify({action:'reveal'}));doc.getElementById('status-rail').append(decisionButton);
 const historyButton=doc.createElement('button');historyButton.type='button';historyButton.className='quiet program-history';historyButton.textContent='历史';historyButton.onclick=()=>action('history');doc.getElementById('status-rail').prepend(historyButton);
 let homeReading=null,homeSequence=0,homeScrollTarget=null,homeStructure='',homeUserKey='';
 const homeIntent=createChatReadingIntent();
 const canReadHome=()=>current.program==='home'&&current.expanded&&!recent.hidden&&recent.checkVisibility?.({checkVisibilityCSS:true})!==false;
 chatMotion=createChatLayoutMotion(recent,{live:()=>messages.querySelector('.chat-entry[data-work=true]')||messages.lastElementChild,following:()=>canReadHome()?homeReading?.history?.following!==false:current.program!=='home'&&!!current.expanded&&!doc.hidden&&dock.state().following,onSettled:()=>doc.dispatchEvent(new doc.defaultView.CustomEvent('workspace-chat-layout-settled'))});
 bindChatBottomRoom(doc);
 function sendReading(patch){
  if(!canReadHome()||!current.home_reading)return;
  homeReading={...homeReading,...patch,sequence:++homeSequence};
  // A read-position acknowledgement may arrive after this native view closes.
  // It carries no user operation to retry or surface as a chat failure.
  void Promise.resolve(action('reading',JSON.stringify(homeReading))).catch(()=>{});
 }
 function rememberHome(following=homeReading?.history?.following!==false){
  if(!canReadHome())return;
  const anchor=serializeChatReading(captureChatReading(recent))||homeReading?.history?.anchor||null;
  sendReading({history:{following,anchor}});
 }
 const homeInput=event=>{
  if(!canReadHome()||!homeIntent.input(event))return;
  homeScrollTarget=null;
  if(event.type==='wheel'&&event.deltaY<0||event.type==='keydown'&&['PageUp','Home','ArrowUp'].includes(event.key))rememberHome(false);
 };
 const homeScroll=()=>{
  if(!canReadHome())return;
  if(homeScrollTarget!==null&&Math.abs(recent.scrollTop-homeScrollTarget)<1){homeScrollTarget=null;return;}
  if(homeIntent.scrolled(recent.scrollHeight-recent.scrollTop-recent.clientHeight<=4))rememberHome(homeIntent.following);
 };
 const workReading=event=>{if(current.program==='home'&&event.detail?.key===homeReading?.work?.key)sendReading({work:{key:event.detail.key,...event.detail.reading}});};
 for(const name of ['wheel','pointerdown','touchstart','keydown'])recent.addEventListener(name,homeInput,{passive:true});
 recent.addEventListener('scroll',homeScroll,{passive:true});messages.addEventListener('aieyra:work-reading',workReading);
 function syncHomeReading(value){
  const incoming=value.home_reading;if(!incoming)return;
  if(!homeReading||incoming.key!==homeReading.key||incoming.revision!==homeReading.revision){homeIntent.reset(incoming.history?.following);homeScrollTarget=null;homeReading=incoming;homeSequence=incoming.sequence||0;}
  else if((incoming.sequence||0)>=homeSequence){homeReading=incoming;homeSequence=incoming.sequence||0;}
  // A new work generation replaces its own reader, even while a previous
  // reading acknowledgement is in flight. History keeps its independent anchor.
  else if(incoming.work?.key!==homeReading.work?.key)homeReading={...homeReading,work:incoming.work};
  homeIntent.following=homeReading.history?.following!==false;
 }
 const jobs=doc.createElement('section');jobs.className='program-image-jobs';jobs.setAttribute('aria-label','绘图任务');recent.append(jobs);
 messages.classList.add('shared-chat-messages');
 const welcomeColumn=setupChatColumn(welcome,{getProfile:profile});welcome.classList.add('shared-chat-messages');
 const referenceButton=doc.createElement('button'),referenceChips=doc.createElement('div'),referencePicker=doc.createElement('div'),composerContext=doc.createElement('div'),feedback=doc.createElement('div');
 composerContext.className='program-composer-context';feedback.className='program-composer-error';feedback.id='program-composer-error';feedback.setAttribute('role','status');feedback.hidden=true;composerContext.hidden=true;
 referenceButton.type='button';referenceButton.id='program-reference';referenceButton.className='quiet';referenceButton.textContent='@';referenceButton.setAttribute('aria-label','引用画布对象');
 referenceChips.className='program-reference-chips';referencePicker.className='program-reference-picker';referencePicker.hidden=true;
 doc.querySelector('.composer-actions').append(referenceButton);composerContext.append(feedback,referenceChips,referencePicker);doc.getElementById('composer').prepend(composerContext);
 const showError=e=>{const target=doc.getElementById('overlay-error');setFeedback(target,e.message||String(e));};
 const imageJobs=setupProgramImageJobs({root:jobs,read:readChecked,onError:showError},doc);
 const same=(a,b)=>a.id===b.id&&a.sourceProjectId===b.sourceProjectId;
 const choose=(ref,selected)=>{const old=frame().context?.references||[],next=selected?[...old.filter(r=>!same(r,ref)),ref]:old.filter(r=>!same(r,ref));void action('canvas_references',JSON.stringify(next.length?{program:'workspace',references:next}:null));};
 let referenceOptions=[],referencesKey='';
 function paintReferences(){
  const f=frame(),available=f.program==='workspace'&&f.configured&&f.ready;
  referenceButton.hidden=!available;referenceChips.hidden=!available;
  if(!available){referencePicker.hidden=true;return;}
  const selected=f.context?.references||[],key=JSON.stringify([selected,referenceOptions]);if(key===referencesKey)return;referencesKey=key;referenceChips.replaceChildren();referencePicker.replaceChildren();
  for(const ref of selected){const chip=doc.createElement('button');chip.type='button';chip.className='quiet';chip.textContent='@'+ref.title+' ×';chip.title=ref.sourceProjectName+' · 移除引用';chip.onclick=()=>choose(ref,false);referenceChips.append(chip);}
  for(const ref of referenceOptions){const label=doc.createElement('label'),check=doc.createElement('input'),name=doc.createElement('span');check.type='checkbox';check.checked=selected.some(r=>same(r,ref));check.onchange=()=>choose(ref,check.checked);name.textContent=ref.title;label.append(check,name);referencePicker.append(label);}
  if(!referenceOptions.length)referencePicker.textContent='当前画布没有可引用的对象。';
 }
 const syncContext=()=>{composerContext.hidden=feedback.hidden&&!referenceChips.childElementCount&&referencePicker.hidden;};
 const layoutComposer=()=>{syncContext();doc.defaultView.requestAnimationFrame(()=>{const f=frame(),height=composerLayout(doc,{viewportHeight:f.viewportHeight,folded:true});if(f.input&&height>0)void action('layout',String(Math.ceil(height)));});};
 referenceButton.onclick=async()=>{if(!referencePicker.hidden){referencePicker.hidden=true;layoutComposer();return;}const scope=frame().task_id,epoch=frame().core_epoch;referenceButton.disabled=true;try{const result=await read('references');if(result?.ok===false)throw Error(result.error);if(frame().task_id!==scope||frame().core_epoch!==epoch)return;referenceOptions=result.references||[];referencesKey='';referencePicker.hidden=false;paintReferences();layoutComposer();}catch(e){showError(e);}finally{referenceButton.disabled=false;}};
 function paint(value,changed){
  current=value;
  imageJobs.paint(value);
  const program=!!value.program,open=program&&!!value.expanded,painting=open||program&&value.layer_closing;
  if(!open){dock.suspend();attachmentViewer.close();reports.minimize();}
  historyButton.hidden=value.program!=='home';doc.getElementById('status-rail').hidden=!painting;
  const planItem=(value.receipts||[]).findLast(item=>item.tool==='update_plan'&&item.state==='completed'&&planData(item).steps.length);
  planOrb.paint(value.plan||(planItem?{...planItem,key:planItem.id}:null),{active:!!value.active});
  reports.paint({session_id:value.task_id,core_epoch:value.core_epoch,documents:value.documents||[]});
  decisionButton.hidden=!value.pending_decisions||!!value.decision;
  doc.body.dataset.programAgent=String(program);doc.body.dataset.programConfigured=String(!!value.configured);doc.body.dataset.programSidebar=String(program&&value.sidebar);
  header.hidden=!painting;title.textContent=value.identity?.name||value.name||'对话';edge.hidden=true;edge.setAttribute('aria-expanded',String(!!value.expanded));recent.hidden=!painting;
  layer.enable(program&&!!value.layered);
  if(program)layer.update({identity:value.identity,state:value.instrument?.data?.state,label:value.label,active:!!value.active,rows:value.compact_rows||[],liveRows:value.compact_live||[],workScope:value.core_epoch+':'+value.task_id,miniPosition:value.mini_position,previewHeight:value.preview_height,contentExtra:value.content_extra,contentRise:value.content_rise,surfaceScale:value.surfaceScale});
  layer.set(open,{token:value.layer_transition,animate:!changed,notify:false,reset:changed});
  doc.body.dataset.programExpanded=String(open);
  if(!program){dock.reset();return;}
  applyChatLayout(doc.body.style,value.profile?.chatLayout,value.layout?.scale,value.layout?.width);
  if(changed){attachmentViewer.close();referencePicker.hidden=true;referenceOptions=[];referencesKey='';}
  setFeedback(feedback,program?value.composerError||'':'');
  paintReferences();syncContext();
  welcomeColumn.paint([{id:'program-welcome',from:'eyra',role:'conversation',identity:value.identity,greeting:true,text:value.configured?(value.description||'可以在这里交给我任务。'):'默认跟随 Eyra，也可以在右上角选择模型后开始对话。'}]);
  if(!value.configured)dock.reset();
  else if(value.program==='home'){
   if(changed)dock.reset();
   syncHomeReading(value);
   homeColumn.visibility(open);
   if(open){
    const entries=(value.messages||[]).map(e=>e.work?{...e,work:{...e.work,reading:homeReading?.work?.key===e.work.key?homeReading.work:e.work.reading}}:e);
    const structure=JSON.stringify(entries.map(e=>[e.id,!!e.brief])),userKey=entries.findLast(e=>e.from==='user')?.id||'',kind=userKey!==homeUserKey?'send':'brief';
    if(changed)chatMotion.reset();
    const before=!changed&&homeStructure&&structure!==homeStructure?chatMotion.capture():null;
    homeColumn.paint(entries,{motion:false});paintBubbleAttachments(messages,entries);
    if(before)chatMotion.commit(before,{kind});
    if(homeReading?.history?.following!==false)chatMotion.follow({snap:changed||!homeStructure,reserve:!!before&&kind==='send'});
    else restoreChatReading(recent,homeReading.history.anchor);
    homeStructure=structure;homeUserKey=userKey;
    homeScrollTarget=recent.scrollTop;
   }
  }else if(open&&value.ready){dock.open({scope_id:value.task_id,kind:'conversation',core_epoch:value.core_epoch});if(value.sent)dock.resumeFollowing();dock.live(value.messages||[]);}
  paintWelcome();paintStatus();
 }
 // 侧栏只在顶栏图标或边缘按钮的明确操作下展开，鼠标悬停消息不会打开它。
 const pendingEdits=new Set();let closed=false;
 doc.addEventListener('aieyra:chat-retry',event=>{if(closed||!frame().program)return;const {id,session_id,generation,attempt}=event.detail;event.detail.submit=()=>readChecked('retry_chat',{id,session_id,generation,attempt});});
 const edit=e=>{if(closed||!frame().program)return;const scope=frame().task_id,epoch=frame().core_epoch,p=e.detail;e.detail.submit=async()=>{
  if(closed)throw Error('对话已关闭。');
  const sent=await action('resend',JSON.stringify({text:p.text,request_id:p.request_id}));if(closed)throw Error('对话已关闭。');if(sent?.ok===false)throw Error(sent.error||'消息未发送');
  // The bridge accepts dispatch first. Only the actual, durably queued user
  // row acknowledges this editor; a timeout retains the same retry identity.
  await new Promise((resolve,reject)=>{let settled=false;const observer=new MutationObserver(check),timer=setTimeout(()=>finish(Error('暂未确认接收，编辑内容已保留；重试会核对同一请求。')),8000);function finish(error){if(settled)return;settled=true;clearTimeout(timer);observer.disconnect();pendingEdits.delete(finish);error?reject(error):resolve();}function check(){if(frame().task_id!==scope||frame().core_epoch!==epoch){finish(Error('会话已切换，编辑内容已保留。'));return;}const row=messages.querySelector('.chat-entry.user[data-id="'+CSS.escape(p.request_id)+'"]');if(row&&!['pending','unknown','prepared'].includes(row.dataset.delivery))finish();}pendingEdits.add(finish);observer.observe(messages,{subtree:true,childList:true,attributes:true,attributeFilter:['data-id','data-delivery']});check();});
 };};doc.addEventListener('aieyra:message-resend',edit);
 return {paint,presented:()=>layer.presented(),previewAttachment:(a,all)=>attachmentViewer.preview(a,all),thumbnail:a=>readChecked('attachment',{method:'imageLibrary',args:{action:'attachment',attachment:a,size:128,thumbnail:true}}),hidden(){layer.suspend();dock.suspend();chatMotion.reset();homeColumn.visibility(false);imageJobs.hidden();attachmentViewer.close();referencePicker.hidden=true;},close(){if(closed)return;closed=true;for(const finish of pendingEdits)finish(Error('对话已关闭。'));imageJobs.close();planOrb.close();reports.close();for(const name of ['wheel','pointerdown','touchstart','keydown'])recent.removeEventListener(name,homeInput);recent.removeEventListener('scroll',homeScroll);messages.removeEventListener('aieyra:work-reading',workReading);layer.close();chatMotion.close();homeColumn.close();attachmentViewer.dispose();welcomeColumn.close();dock.close();decisionButton.remove();recent.remove();header.remove();historyButton.remove();edge.remove();referenceButton.remove();composerContext.remove();doc.removeEventListener('aieyra:message-resend',edit);}};
}

// Native programs keep their real page below the foreground chat. This
// separate read-only surface survives folding and shares the original readers.
export function setupProgramWorkOverlay(api,doc=document){
 const stage=doc.createElement('aside');stage.id='stage';doc.body.append(stage);
 doc.body.dataset.workOnly='true';
 let frame={},timer=0,closed=false;
 const read=async(action,p={})=>{const r=await api.read({...p,action,task_id:frame.task_id,core_epoch:frame.core_epoch});if(r?.ok===false)throw Error(r.error||'读取记录失败');return r;};
 const surface=setupWorkSurface(stage,{doc,tools:true,onSettled:()=>{if(!closed&&frame.frame_revision)void api.painted(frame.frame_revision,{work_hidden:true});},
  readReceipt:p=>read('receipt',{id:p.call_id,receipt_generation:p.generation,input_offset:p.input_offset,output_offset:p.output_offset,receipt_version:p.receipt_version}),
  readTerminal:p=>read('terminal_read',{call_id:p.call_id,receipt_generation:p.generation,offset:p.offset}),
  readImage:p=>read('image',{image_id:p.image_id}),
  readProgram:p=>read('program_projection',{call_id:p.call_id,receipt_generation:p.generation})});
 const acknowledge=revision=>{clearTimeout(timer);if(closed||frame.frame_revision!==revision)return;
  if(doc.defaultView.innerWidth<=0||doc.defaultView.innerHeight<=0||Math.abs(doc.defaultView.innerWidth-frame.surfaceWidth)>1.5||Math.abs(doc.defaultView.innerHeight-frame.surfaceHeight)>1.5){timer=setTimeout(()=>acknowledge(revision),16);return;}
  // This document shares the chat portal's readiness gate. Reveal only after
  // its real native viewport and retained work layout agree on this revision.
  stage.getBoundingClientRect();doc.body.dataset.frameRevision=String(revision);doc.body.dataset.frameReady='true';
  const workPending=frame.work?.active&&frame.work.operations?.length;
  void api.painted(revision,{work_hidden:stage.hidden&&!workPending});
 };
 const showWork=()=>surface.update({...frame.work,core_epoch:frame.core_epoch,scope_id:frame.task_id,hidden:false});
 const stop=api.onFrame(value=>{frame=value;doc.body.hidden=false;doc.body.dataset.visible='true';doc.body.classList.toggle('reduce-motion',!!value.reduced);
  for(const [key,v]of Object.entries(value.theme||{}))doc.body.style.setProperty(key,v);
  if(value.appearanceTheme)applyAppearanceFrame(doc.body,value.appearanceTheme);else applyResourceTheme(doc,value.themeCss);
  if(value.appearance)doc.body.dataset.osAppearance=value.appearance;
  showWork();acknowledge(value.frame_revision);
 });
 const visibility=api.onVisibility(value=>{doc.body.hidden=!value.visible;doc.body.dataset.visible=String(!!value.visible);if(value.visible)showWork();else{clearTimeout(timer);doc.body.dataset.frameReady='false';surface.suspend();}});
 doc.defaultView.addEventListener('beforeunload',()=>{closed=true;clearTimeout(timer);stop();visibility();surface.close();},{once:true});
}
