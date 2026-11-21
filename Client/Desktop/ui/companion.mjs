// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: chat
// Regions: $; reduced; replyPreview; setupCompanion
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/companion.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {trailingInputs,orderTurnReplies,mergeTimed} from './turn-scope.mjs';
import {memberAvatars} from './member-avatars.mjs';
import {composerLayout} from './composer-surface.mjs';
import {createConversationPager} from './conversation-pages.mjs';
import {isolatedHTML} from './html-document.mjs';
import {applyBackground} from './window-theme.mjs';
import {el} from './views.mjs';
import {renderMarkdown} from './markdown.mjs';
import {setupPresence} from './presence.mjs';
import {setupReports} from './reports.mjs';
import {failureNoticeKey} from './failure-notice.mjs';
import {redactNoticeText,noticeFailureText} from './system-notices.mjs';
import {EyraState,RoleState,latestParagraph,roleLive} from './eyra-state.mjs';
import {initialGuideVisible} from './setup-guidance.mjs';
import {sceneKind} from './model.mjs';
import {setupWorkSurface,homeWorkReaders,homeOperations} from './work-surface.mjs';
import {activityLabel} from './activity.mjs';
import {setupChatColumn,chatRounds,linkMessagePresentation,linkMessageGeneration,linkMessageAuthor} from './chat-column.mjs';
import {paintBubbleAttachments} from './attachments.mjs';
import {createTypewriter} from './typewriter.mjs';
import {applyChatLayout,bindChatBottomRoom} from './chat-layout.mjs';
import {roleIdentity,taskViewProfile} from './role-identity.mjs';
import {setupPlanOrb} from './plan-orb.mjs';
import {VoiceRotation,workingVoices,paintVoiceTabs,helperView} from './voice-rotation.mjs';
import {createThoughtView} from './thought-view.mjs';
import {SubconsciousTimeline} from './subconscious-timeline.mjs';
import {captureChatReading,restoreChatReading,serializeChatReading,createChatLayoutMotion,createChatReadingIntent} from './chat-reading.mjs';
import {setupChatLayer,compactWorkRows,compactLiveRows} from './layered-chat.mjs';
import {chatStatus,chatFailureEntry} from './chat-status.mjs';
import {createWorkTranscript,WorkTranscript,workTranscriptSegments} from './work-transcript.mjs';
import {GreetingPresentation} from './experience.mjs';

const $=id=>document.getElementById(id);
const reduced=()=>document.body.classList.contains('reduce-motion')||matchMedia('(prefers-reduced-motion: reduce)').matches;
export const replyPreview=latestParagraph;
export {isolatedHTML} from './html-document.mjs';




export function setupCompanion(api,check,{openSettings,openHistory,navigation,onFlow,beforeLayout}){
  const caption=$('presence-caption');caption.hidden=true;
  let captionFull='';
  const stoppedProgress=el('small','中断前进度','task-stopped-progress');stoppedProgress.hidden=true;$('answer-stage').insertBefore(stoppedProgress,$('voice'));
  const chatLayer=setupChatLayer({nodes:[$('conversation'),$('bottom-bar')],container:$('screen'),preference:api.chatLayerPreference,onBeforeOpen:()=>chatMotion.follow({snap:true}),onChange:()=>document.dispatchEvent(new CustomEvent('workspace-chat-layer-change'))});
  const layerVisibility=()=>chatLayer.enable(!navigation.current);
  document.addEventListener('workspace-view-change',layerVisibility);layerVisibility();
  let profile={name:'',initialized:false},lastSnapshot=null,lastPresentation=null,lastDisconnected=false,pending=[],flow=null,overlayEntries=[],compactRows=[],compactLive=[],closed=false;
  const viewProfile=()=>taskViewProfile(profile,lastSnapshot);
  const workSurface=setupWorkSurface($('stage'),{...homeWorkReaders(api,()=>lastSnapshot),tools:true});
  window.addEventListener('pagehide',()=>workSurface.close(),{once:true});
  const avatars=memberAvatars(m=>api.conversation({action:'contact_avatar',id:m.contact_id}),()=>{if(lastSnapshot)paint(lastSnapshot,lastPresentation,lastDisconnected);});
  const acceptedSends=new Map();
  let question=null,planSignature='',booted=false,guideDismissed=false;
  const state=new EyraState({storage:sessionStorage});
  const greetingView=new GreetingPresentation();
  const roleStates=new Map();
  const chat=setupChatColumn($('conversation-content'),{getProfile:()=>taskViewProfile(profile,lastSnapshot,{history:true})}),subTimeline=new SubconsciousTimeline();
  const trailing=document.createElement('div');trailing.id='conversation-queued';trailing.className='shared-chat-messages';trailing.hidden=true;$('emergence').after(trailing);
  const conversationPager=createConversationPager();let loadingConversation=false;
  // 正文打字机（UI设计知识库 形态 §5）：光圈旁的行进中正文一份；回复落进聊天列时另一份接着打完。
  // 工作形态与折叠态的正文条只有光圈高：跟着打字滚到最新；你用滚轮往上翻时不打扰，翻回底部再恢复跟随。
  // 聊天列同理：在底部时一直跟着长高（包括回复落下后继续打字）；你用滚轮往上翻就停下，翻回底部再恢复（Codex A1 发现长回复不跟随）。
  let followStrip=true,followChat=true,heldId=null,readerAnchor=null,responseRows=new Map();
  const workJournal=new WorkTranscript(),briefRowsByTurn=new Map();
  // 首页的聊天与工作形态共用同一条聊天列；工作形态只是把它收到左半边，右半边给展示台。
  const columnForm=()=>['chat','work'].includes(document.body.dataset.form);
  // navigation 隐藏首页时浏览器就可能把 scrollTop 归零，必须在切页前保存阅读位置。
  const rememberReading=()=>{if(!nativeChat&&columnForm()&&!followChat)readerAnchor=captureChatReading($('conversation'))||readerAnchor;};
  document.addEventListener('workspace-view-before-change',rememberReading);
  document.addEventListener('workspace-form-before-change',rememberReading);
  function follow(){
    const form=document.body.dataset.form;
    if(form==='folded'&&followStrip){const box=$('answer-stage');box.scrollTo({top:box.scrollHeight,behavior:'instant'});}
    if(!nativeChat&&columnForm()&&followChat)chatMotion.follow();
  }
  // 换形态先恢复正文、聊天列和滚动位置，再让 desktop-shell 测光圈终点。
  // 不能等下一次 150ms 重绘：隐藏的聊天列展开会把已经开始滑行的光圈拉到屏外（seq78）。
  document.addEventListener('workspace-form-settle',()=>{if(lastSnapshot)paint(lastSnapshot,lastPresentation,lastDisconnected,undefined,{settle:true});});
  $('answer-stage').addEventListener('scroll',()=>{const box=$('answer-stage');followStrip=box.scrollHeight-box.scrollTop-box.clientHeight<6;},{passive:true});
  // 聊天列跟底（用户 2026-10-13：往上滚经常被拉回去）。只有用户自己的滚动（滚轮、触控板、拖滚动条、键盘）才改变"跟不跟"：
  // 往上动一下就停止跟随；回到最底（差 4px 以内）才恢复。程序自己滚到底、内容长高产生的 scroll 事件一律不算。
  // 旧做法在"离底 40px 内"就恢复跟随，触控板一点点往上滚时还没出这 40px 就被判回跟随，下一次重绘又拽回底部。
  const chatScroller=$('conversation'),readingIntent=createChatReadingIntent();
  let chatStructure='',motionTurn='';const chatMotion=createChatLayoutMotion(chatScroller,{live:()=>$('emergence'),following:()=>followChat,onSettled:()=>document.dispatchEvent(new CustomEvent('workspace-chat-layout-settled'))});
  const contextMore=el('button','加载更多','context-load-more');contextMore.id='context-load-more';contextMore.type='button';contextMore.hidden=true;
  contextMore.setAttribute('aria-label','加载更早的对话');
  chatScroller.insertBefore(contextMore,$('conversation-content'));
  contextMore.onclick=()=>{
    if(loadingConversation||!lastSnapshot)return;
    loadingConversation=true;followChat=false;rememberReading();
    conversationPager.more();
    try{paint(lastSnapshot,lastPresentation,lastDisconnected,undefined,{page:true});}
    finally{loadingConversation=false;}
    if(contextMore.hidden){const first=$('conversation-content').firstElementChild;if(first){first.tabIndex=-1;first.focus({preventScroll:true});}}
  };
  // The fixed work reader owns its scroll. Its contained wheel/key events do
  // not detach the surrounding conversation or recapture its history anchor.
  const workReading=e=>!!e?.target?.closest?.('.work-transcript');
  const markUser=e=>{readingIntent.following=followChat;if(!workReading(e)&&readingIntent.input(e))followChat=readingIntent.following;};
  chatScroller.addEventListener('wheel',markUser,{passive:true});
  chatScroller.addEventListener('pointerdown',e=>{if(e.target===chatScroller)markUser();},{passive:true});
  chatScroller.addEventListener('touchstart',markUser,{passive:true});
  chatScroller.addEventListener('keydown',e=>{if(['PageUp','PageDown','ArrowUp','ArrowDown','Home','End',' '].includes(e.key))markUser(e);});
  chatScroller.addEventListener('scroll',()=>{
    if(nativeChat||!columnForm())return;
    if(readingIntent.scrolled(chatScroller.scrollHeight-chatScroller.scrollTop-chatScroller.clientHeight<=4))followChat=readingIntent.following;
  },{passive:true});
  // Follow actual layout growth too: font loading, wrapping and settled messages
  // can change height after the last text delta. Respect the reader's scroll.
  const followLayout=new ResizeObserver(()=>follow());
  followLayout.observe(chatScroller);followLayout.observe($('conversation-content'));followLayout.observe($('emergence'));followLayout.observe(trailing);
  const typer=createTypewriter({render:(node,text)=>{renderMarkdown(node,text);follow();}}),landing=createTypewriter({render:(node,text)=>{renderMarkdown(node,text);follow();}});
  const reports=setupReports(api,check,isolatedHTML,navigation);
  const presence=setupPresence({presence:$('presence'),signal:$('presence-glyphs'),brand:document.querySelector('.brand'),status:$('brand-status'),voice:$('voice'),thought:$('thought'),work:$('work')});
  // 计划泡泡（形态 §8）、灵感浮现（形态 §10；见 UI设计知识库）。工作可视化与 Coding 复用同一终端和搜索视图。
  const planOrb=setupPlanOrb({root:$('plan-orb'),button:$('plan-bubble'),track:$('plan-current'),count:$('plan-count'),pop:$('plan-pop'),content:$('plan-pop-content')});
  const voiceRotation=new VoiceRotation();let overlayVoice=null,identityKey='',portalRole='matrix';
  const thoughtView=createThoughtView({reduced});
  let workTranscript=null,nativeChat=false,readingRevision=0,readingSequence=0,readingScope='';
  const readingKey=()=>JSON.stringify([lastSnapshot?.session_id,lastSnapshot?.core_epoch,lastSnapshot?.history_segment]);
  function nativeChatVisibility(value){
    if(nativeChat===value)return;
    if(value){rememberReading();workTranscript?.visibility(false);}
    readingIntent.reset(followChat);
    nativeChat=value;readingRevision++;readingSequence=0;
    if(!value){workTranscript?.visibility(true);if(followChat)follow();else restoreChatReading(chatScroller,readerAnchor);}
  }
  const portalReading=()=>({key:readingKey(),revision:readingRevision,sequence:readingSequence,history:{following:followChat,anchor:serializeChatReading(readerAnchor)},work:workTranscript?{key:workTranscript.snapshot().key,...workTranscript.reading}:null});
  function acceptPortalReading(value){
    if(!nativeChat||value?.key!==readingKey()||value.revision!==readingRevision||!Number.isSafeInteger(value.sequence)||value.sequence<=readingSequence)return false;
    if(value.history){followChat=value.history.following!==false;readingIntent.following=followChat;readerAnchor=value.history.anchor||null;}
    if(value.work&&value.work.key===workTranscript?.snapshot().key)workTranscript.restoreReading(value.work);
    readingSequence=value.sequence;return true;
  }
  $('live-details').onclick=()=>openHistory();
  // 收起（UI设计知识库 形态 §15 F10，设置 E3）：折叠态里点光圈头顶的按钮，收起右侧的思考与正文；一直收着，直到再点一次。回到首页（聊天形态）时复位。
  const stripLabel=dismissed=>{const b=$('strip-hide');b.setAttribute('aria-pressed',String(dismissed));b.title=dismissed?'展开右侧的思考与正文':'收起右侧的思考与正文';b.setAttribute('aria-label',b.title);};
  const restoreStrip=()=>{document.body.classList.remove('strip-dismissed');stripLabel(false);};
  $('strip-hide').onclick=event=>{event.stopPropagation();if(document.body.classList.contains('strip-dismissed')){restoreStrip();return;}
    document.body.classList.add('strip-dismissed');stripLabel(true);};
  async function greet(options={}){
    const task_id=lastSnapshot?.session_id,epoch=lastSnapshot?.core_epoch;
    try{const result=check(await api.greet({...options,task_id}));return task_id===lastSnapshot?.session_id&&epoch===lastSnapshot?.core_epoch?result:null;}
    catch(e){if(task_id===lastSnapshot?.session_id&&epoch===lastSnapshot?.core_epoch)throw e;return null;}
  }
  $('reconnect').onclick=()=>flow?.connectionAction==='settings'?openSettings():greet({retry:true}).catch(e=>reports.notice(e.message,true));
  $('welcome-start').onclick=()=>{if(flow?.needsSetup)openSettings();else{guideDismissed=true;if(lastSnapshot)paint(lastSnapshot,lastPresentation,lastDisconnected);}};
  $('startup-settings').onclick=openSettings;
  $('startup-skip').onclick=()=>greet({skip:true}).catch(e=>reports.notice(e.message,true));
  $('startup-retry').onclick=$('reconnect').onclick;

  const scaleProfile=()=>{applyChatLayout(document.body.style,profile.chatLayout);scheduleInput();};
  bindChatBottomRoom(document);
  window.addEventListener('os-scale',scaleProfile);
  // 光圈只有一个：其他页面轮到谁，就显示谁的头像和名字。
  function paintIdentity(role){
    const id=roleIdentity(viewProfile(),role),key=[role,id.name,id.glyph,id.avatar,id.ring].join('|');
    if(key===identityKey)return;identityKey=key;
    const node=$('presence'),avatar=$('presence-avatar'),glyph=$('presence-glyph');
    node.dataset.name=id.name;if(role==='matrix')delete node.dataset.role;else node.dataset.role=role;
    $('eyra-name').textContent=id.name;document.body.dataset.ringEffect=id.ring;$('presence').dataset.ringEffect=id.ring;
    if(id.avatar)avatar.src=id.avatar;else avatar.removeAttribute('src');avatar.hidden=!id.avatar;
    const face=role!=='matrix'&&!id.avatar?id.glyph:'';glyph.textContent=face;glyph.hidden=!face;
  }
  function applyProfile(){
    scaleProfile();
    document.body.dataset.ringEffect=profile.roles?.matrix?.ring||'pulse';
    $('eyra-name').textContent=profile.eyraName||'Eyra';
    // 光圈静止时就是 Eyra 的头像（UI设计知识库 形态 §2）。
    identityKey='';paintIdentity('matrix');
    // 首页背景：图片、模糊、遮罩（desktop-shell.css 的 has-space-background）。
    applyBackground(document.body,profile);
    if(lastSnapshot)paint(lastSnapshot,lastPresentation,lastDisconnected);
  }
  let resizeFrame=0,layerFrame=0,measuredInput=null;
  // Geometry is measured on real input/layout events. A stream snapshot only
  // compares DOM state; even composerLayout's cache would otherwise read sizes.
  const inputState=()=>[$('message').value,$('composer').hidden,$('stop').hidden,$('composer').classList.contains('first-input'),document.body.dataset.form,navigation.current,document.body.dataset.chatExpanded];
  const inputChanged=()=>!measuredInput||inputState().some((value,index)=>value!==measuredInput[index]);
  function resizeInput(){if(closed)return;if(resizeFrame){cancelAnimationFrame(resizeFrame);resizeFrame=0;}composerLayout();measuredInput=inputState();}
  function scheduleInput(){if(!closed&&!resizeFrame)resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;resizeInput();});}
  function restoreLayerReading(){
    layerFrame=0;if(closed||nativeChat||navigation.current||!chatLayer.expanded)return;
    if(followChat)follow();else restoreChatReading(chatScroller,readerAnchor);
  }
  for(const event of ['input','focus','blur'])$('message').addEventListener(event,resizeInput);window.addEventListener('resize',scheduleInput);
  for(const event of ['workspace-view-change','workspace-inset-change','workspace-theme-change'])document.addEventListener(event,scheduleInput);
  document.fonts?.addEventListener('loadingdone',scheduleInput);
  // 换页面形态、输入框变宽变窄（矮窗口里和光圈并排）时按新布局重算，不等下一次输入。宽度变化放到下一帧处理，避免在 ResizeObserver 回调里改尺寸。
  const inputAttributes=new MutationObserver(records=>{if(inputChanged())scheduleInput();if(records.some(r=>r.attributeName==='data-chat-expanded')&&!layerFrame)layerFrame=requestAnimationFrame(restoreLayerReading);});
  inputAttributes.observe(document.body,{attributes:true,attributeFilter:['data-form','data-chat-expanded']});
  const inputResize=new ResizeObserver(scheduleInput);inputResize.observe($('message'));inputResize.observe($('composer'));
  // 计划泡泡（UI设计知识库 形态 §8）：右侧栏的圆 + 当前任务胶囊；30 秒规则、换任务时滚动与"啵"、完成后淡出都在 plan-orb.mjs。
  function paintPlan(presentation){
    planOrb.paint(presentation?.plan()||null,{active:!!flow?.active,feedback:presentation?.planFeedback?.()||''});
  }
  function paint(next,presentation,disconnected=false,attempts,{settle=false,page=false}={}){
    chatLayer.scope(next.session_id?'home:'+next.session_id:'');
    if(!settle&&!navigation.current&&!$('conversation-content').hidden)rememberReading();
    if(next.link?.members){const visual=members=>members.map(m=>({...m,avatar:m.contact_id?avatars.get(m):''}));next={...next,link:{...next.link,members:visual(next.link.members),authors:visual(next.link.authors||[])}};}
    lastSnapshot=next;lastPresentation=presentation;lastDisconnected=disconnected;
    const readingChanged=readingScope!==readingKey();
    if(readingChanged){readingScope=readingKey();readingRevision++;readingSequence=0;responseRows.clear();briefRowsByTurn.clear();chatMotion.reset();motionTurn='';}
    if(settle){const previous=landing.progress();landing.detach();if(previous.el?.isConnected)renderMarkdown(previous.el,previous.full);}
    const ids=new Set((next.messages||[]).map(m=>m.id));
    for(const [id,entry]of acceptedSends)if(entry.session_id!==next.session_id||ids.has(id))acceptedSends.delete(id);
    if(attempts){const shown=new Map(pending.map(m=>[m.id,m.at]));pending=[...attempts,...acceptedSends.values()].filter(e=>e.session_id===next.session_id).map(e=>({id:e.request_id,from:'user',text:e.text,attachments:e.attachments||[],at:e.at||shown.get(e.request_id)||new Date().toISOString(),state:'queued',delivery:e.rejection?'prepared':e.delivery||'pending',rejected:!!e.rejection}));}
    pending=pending.filter(m=>!ids.has(m.id));
    const running=(presentation?.current?.()||[]).findLast(i=>i.state==='running');
    // 场景只留最近三条且只算最后一段正文之后的调用；被挤出场景的长命令仍在跑，也要算“正在操作”。
    const toolRunning=!!running&&running.tool!=='update_plan'||(presentation?.liveActivities?.()||[]).some(i=>i.state==='running'&&i.tool!=='update_plan');
    flow=state.project(next,{items:presentation?.terminal?.()||[],workItems:presentation?.liveActivities?.('matrix')||[],pending,disconnected,toolRunning});
    beforeLayout?.(flow);
    const roleFlows={matrix:flow};
    for(const row of next.roles||[]){
      if(row.role==='matrix')continue;
      if(!roleStates.has(row.role))roleStates.set(row.role,new RoleState({role:row.role,storage:sessionStorage}));
      const items=presentation?.liveActivities?.(row.role)||[];
      roleFlows[row.role]=roleStates.get(row.role).project(next,{items,disconnected,toolRunning:items.some(i=>i.state==='running'&&i.tool!=='update_plan')});
    }
    for(const name of roleStates.keys())if(!roleFlows[name])roleStates.delete(name);
    reports.paint(next);paintPlan(presentation);
    document.body.dataset.conversationMode=flow.mode;document.body.dataset.eyraCompact=String(flow.compact);document.body.dataset.canvasMode=flow.active?'live':'settled';
    // 其他页面左下角：协同时轮到谁就显示谁（voice-rotation.mjs）。
    const voices=navigation.current?workingVoices(next,roleFlows):[],voice=voiceRotation.pick(voices,performance.now()),guest=voice&&voice.role!=='matrix'?voice:null,guestFlow=guest?roleFlows[guest.role]:null;
    const guestRunning=guest?(presentation?.liveActivities?.(guest.role)||[]).findLast(i=>i.state==='running'):null,shownRunning=guest?guestRunning:running;
    const rotated=!!navigation.current&&(guest?.role||'matrix')!==portalRole;portalRole=guest?.role||'matrix';
    const showWelcome=!navigation.current&&initialGuideVisible(next,profile,flow,guideDismissed);
    const localWelcome=!showWelcome&&!navigation.current&&!flow.active&&!flow.submitted&&!flow.user&&!flow.preview&&!next.messages?.length&&next.greeting?.state==='offline';
    $('welcome-start').hidden=true;
    paintIdentity(portalRole);
    const pendingAsk=(next.ask_requests||[]).some(q=>q.state==='pending'),waitingForAnswer=pendingAsk&&!flow.active&&!guest;
    const displayState=waitingForAnswer?'waiting_user':guest?guestFlow.state:flow.state;
    onFlow?.({state:waitingForAnswer?'waiting_user':flow.state,identity:roleIdentity(viewProfile(),'matrix')});
    presence.paint(showWelcome?'idle':displayState,shownRunning?sceneKind(shownRunning):'generic',{reduced:reduced(),content:showWelcome||!!guest||!!flow.preview||flow.state==='thinking'});
    const voiceName=roleIdentity(viewProfile(),portalRole).name;
    const workStatus=$('eyra-work-status'),shownFlow=guestFlow||flow;
    const statusText=waitingForAnswer?'有问题等你补充':chatStatus({state:shownFlow.state,phase:shownFlow.state,label:$('presence-label').textContent,caption:shownFlow.caption,active:!!shownFlow.active,activities:presentation?.liveActivities?.(portalRole)||[]});
    if(workStatus.textContent!==statusText)workStatus.textContent=statusText;workStatus.hidden=!statusText;
    $('eyra-trigger').removeAttribute('title');$('eyra-trigger').dataset.tip='折叠对话 · 双击查看历史';
    const captionError=flow.state==='error',captionDetails=captionError?noticeFailureText(next,flow.caption):redactNoticeText(flow.caption);
    captionFull=captionDetails;caption.hidden=true;
    // The original failure is retained in notifications/history, never opened
    // automatically above the avatar or appended to a partial reply.
    const failureKey=captionError?failureNoticeKey(next,captionDetails):'';
    if(failureKey)void reports.notice(captionDetails,true,{quiet:true,eventKey:failureKey});
    $('reconnect').hidden=showWelcome||flow.state!=='offline'||disconnected;
    $('reconnect').textContent=flow.connectionAction==='settings'?'配置模型':'重新连接';
    $('reconnect').dataset.action=flow.connectionAction;
    const startupDetails=$('startup-connection-details'),startupReason=$('startup-connection-reason');
    const connectionReason=localWelcome&&flow.state==='offline'?redactNoticeText(flow.captionReason):'';
    startupDetails.hidden=!connectionReason;
    if(startupReason.textContent!==connectionReason){
      startupDetails.open=false;
      $('startup-connection-summary').textContent=flow.caption?flow.caption+' · 详情':'连接详情';
      startupReason.textContent=connectionReason;
    }
    // 等待用户决定：问题优先于正文，直接浮现在 Eyra 旁边。
    question=(next.roles||[]).flatMap(r=>r.human_requests||[]).find(q=>q.state==='waiting_user')||null;
    // 聊天形态（UI设计知识库 形态 §4）：首页且 Eyra 没在干活。结尾正文已经并入聊天列，光圈旁只放思考和行进中的正文。
    const chatForm=!navigation.current&&flow.mode!=='work',columnShown=!navigation.current,scroller=$('conversation'),emergence=$('emergence'),root=$('conversation-content');
    const restoring=columnShown&&root.hidden;
    if(!columnShown&&!root.hidden&&columnForm())rememberReading();
    $('answer-stage').dataset.name=voiceName;
    $('answer-stage').dataset.identity=String(next.session_id===next.root_id&&next.identity?.phase==='active');
    const handoff=typer.progress();
    const thoughtText=question?'':guest?guestFlow.thought:flow.thought;
    // 工作形态（UI设计知识库 形态 §6）：正文条里的正文停留到下一次思考。其他页面也一样。
    const foldedForm=!!navigation.current,thought=(guestFlow||flow).state==='thinking';
    const workFrame={scope_id:next.session_id,core_epoch:next.core_epoch,operations:homeOperations(next,voiceName,presentation?.liveActivities?.('matrix',{process:true,plan:true}),{tools:true}),active:flow.mode==='work',hidden:foldedForm};
    // 开场问候作为 Eyra 的一句话放进聊天列（不再按展示期消散）；结尾正文同理，所以聊天形态里它们不再留在光圈旁。
    const greeting=greetingView.project(['online','local'].includes(next.greeting?.state)&&String(next.greeting.text||'').trim()?{id:'greeting:'+next.core_epoch,text:next.greeting.text,after:next.greeting.after_generation||0,...(Object.hasOwn(next.greeting,'after_message_id')?{afterID:next.greeting.after_message_id}:{})}:null,{scope:next.core_epoch+':'+next.session_id,working:flow.active||flow.submitted});
    const landed=p=>!!p&&(p.kind==='final'||String(p.id).startsWith('greeting:'));
    // 光圈托着最后一句（UI设计知识库 形态 §15 C1）：聊天形态里最后一条是 Eyra 的回复（或开场问候）时，它留在光圈旁，光圈不动；
    // 你发出下一句时它才落进聊天列、原位留下头像，光圈移到你的消息下面。
    // 工作形态：本轮已经说过的过程正文像普通消息一样留在列里往上走，光圈旁只放正在写的那一段（不重复）；任务结束回到聊天形态时它们退场。
    const currentRole=next.roles?.find(r=>r.role==='matrix');
    const tailIds=flow.active?trailingInputs(next.messages,pending,currentRole,flow.turnID):new Set();
    trailing.hidden=!columnShown||!tailIds.size;
    let rounds=columnShown?chatRounds((next.messages||[]).filter(m=>m.state!=='withdrawn').map(m=>({...m,text:m.display_text||m.text})),pending,{limit:Infinity,greeting,commentary:null,talk:next.team_talk}):[];
    if(columnShown){
      const current=conversationPager.update(rounds,JSON.stringify([next.session_id,next.core_epoch,next.history_segment]),{reading:!followChat});
      if(current.reset&&!page){followChat=true;readerAnchor=null;}
      rounds=current.entries;
      contextMore.hidden=!current.hasMore;
    }else contextMore.hidden=true;
    if(columnShown&&next.link?.messages?.length){
      const members=next.link.members||[];
      const actor=next.roles?.find(r=>r.role===portalRole),lead=members.find(m=>m.id===next.link.lead),current=next.link.actor_id===actor?.id&&next.link.actor_generation===actor?.generation;
      const linked=next.link.messages.map(msg=>{const member=linkMessageAuthor(next.link,msg),base=roleIdentity(viewProfile(),member?.lead?'matrix':member?.role||'conversation'),generation=linkMessageGeneration(msg,next.link.lead);return {id:'link:'+next.link.scope+':'+msg.seq,from:'eyra',role:base.role,identity:{...base,name:member?.name||msg.name||base.name,avatar:member?.avatar||base.avatar,ring:member?.ring||base.ring},...linkMessagePresentation(msg),turnID:current&&generation&&generation===lead?.generation?shownFlow.turnID:'',at:msg.at,talk:true};});
      rounds=orderTurnReplies(mergeTimed(rounds,linked));
    }

    subTimeline.ingest(next);
    const retryingTurn=!!currentRole?.chat_retry_attempt&&!!shownFlow.turnID&&!guest&&!question;
    const last=rounds.at(-1),held=chatForm&&!retryingTurn&&!flow.active&&!flow.submitted&&!question&&!thoughtText&&last?.from==='eyra'&&(!last.role||last.role==='matrix')?last:null;
    const released=heldId&&heldId!==held?.id?heldId:null;heldId=held?.id||null;
    const chatEntries=held?rounds.slice(0,-1):rounds;
    // 折叠态只在 Eyra 工作中带着正文（UI设计知识库 形态 §15 F9）；没在工作时换页，不带正文，免得遮挡别的页面。
    // 成员还没写正文时显示它正在做的事，和首页工作时一样。
    const guestLast=guest?(presentation?.liveActivities?.(guest.role)||[]).at(-1):null;
    const guestView=guest?helperView({active:guestFlow.active,phase:guestFlow.state,thought:guestFlow.thought,body:guestFlow.body?.text,label:guestFlow.caption||(guestLast?activityLabel(guestLast):'')}):null;
    const guestText=guestView?.body||guestView?.label||'';
    const guestBody=guestFlow?.body||(guestText?{id:'guest:'+guest.role,kind:'progress',text:guestText,full:guestText,signature:'guest:'+guest.role+':'+guestText}:null);
    const preview=captionError&&!flow.active?null:foldedForm?(guest?guestBody:flow.active?flow.preview:null):held?{id:held.id,originId:held.originId,kind:'final',text:held.text,full:held.text,signature:'held:'+held.id}:chatForm&&landed(flow.preview)?null:flow.preview;
    // Task completion and the committed reply can arrive in separate polls.
    // Keep this input's exact reader during that gap (also after cancellation),
    // until a real final reply or a different input takes its place.
    const retainWork=columnShown&&workTranscript&&workJournal.key===shownFlow.workKey&&responseRows.has(shownFlow.turnID)&&!held;
    const problem=chatFailureEntry(currentRole,next.session_id,roleIdentity(viewProfile(),'matrix'));
    const stableWork=!question&&!problem&&(flow.active||flow.submitted||guestFlow?.active||retainWork);
    const journalValue={key:shownFlow.workKey,phase:shownFlow.state,live:shownFlow.live,thought:thoughtText,text:shownFlow.active&&preview?.kind!=='final'?(preview?.full||preview?.text||''):'',briefs:shownFlow.workItems,status:statusText};
    if(stableWork)workJournal.update(journalValue);
    const segments=stableWork?workTranscriptSegments(workJournal.snapshot()):null;
    const workKey=segments?.current.key||shownFlow.workKey,workEntryId=retryingTurn&&responseRows.get(shownFlow.turnID)||'home-work:'+workKey;
    if(problem&&shownFlow.turnID){problem.id=responseRows.get(shownFlow.turnID)||workEntryId;problem.response=true;responseRows.set(shownFlow.turnID,problem.id);}
    const workValue={...journalValue,key:workKey,journal:segments?.current};
    if(stableWork&&shownFlow.turnID)briefRowsByTurn.set(shownFlow.turnID,segments.briefs.map(row=>({id:'home-work:'+row.key,from:'eyra',role:portalRole,identity:roleIdentity(viewProfile(),portalRole),text:row.text,brief:true,turnID:shownFlow.turnID})));
    if(stableWork&&shownFlow.turnID)responseRows.set(shownFlow.turnID,workEntryId);
    const responseEntry=e=>e.from==='eyra'&&!e.talk&&responseRows.has(e.turnID)?{...e,id:responseRows.get(e.turnID),identity:e.identity||roleIdentity(viewProfile(),e.role||'matrix'),response:true}:e;
    const withBriefs=(entries,appendTurn='')=>{
      const out=[],seen=new Set();
      for(const e of entries){if(stableWork&&e.turnID===shownFlow.turnID&&e.from==='eyra'&&!e.talk&&!seen.has(e.turnID)){out.push(...briefRowsByTurn.get(e.turnID)||[]);seen.add(e.turnID);}out.push(responseEntry(e));}
      if(stableWork&&appendTurn===shownFlow.turnID&&!seen.has(appendTurn))out.push(...briefRowsByTurn.get(appendTurn)||[]);
      return out;
    };
    const historyEntries=withBriefs(chatEntries,stableWork?shownFlow.turnID:held?.turnID),currentDisplayId=stableWork?workEntryId:responseRows.get(held?.turnID)||held?.id||workEntryId;
    const handoffKind=stableWork&&shownFlow.turnID!==motionTurn?'send':'brief';motionTurn=shownFlow.turnID||held?.turnID||motionTurn;
    const structure=JSON.stringify([next.core_epoch,next.session_id,historyEntries.map(e=>e.id),currentDisplayId,!!stableWork]);
    const layoutBefore=chatStructure&&structure!==chatStructure&&columnShown&&!nativeChat&&!settle&&!page&&!restoring&&columnForm()?chatMotion.capture():null;chatStructure=structure;
    // Capture the original reading geometry before tool columns change it.
    // The same handoff now owns both the Brief and the surrounding reflow.
    workSurface.update(workFrame);
    const retainedTurns=new Set(rounds.map(e=>e.turnID));for(const turn of responseRows.keys())if(turn!==shownFlow.turnID&&!retainedTurns.has(turn)){responseRows.delete(turn);briefRowsByTurn.delete(turn);}
    emergence.dataset.work=String(!!stableWork);
    emergence.dataset.response=String(!!stableWork||!!held&&responseRows.has(held.turnID));
    emergence.dataset.readingId=stableWork?workEntryId:responseRows.get(held?.turnID)||held?.id||workEntryId;
    // Match the retained DOM: history, the current work row, then inputs
    // submitted during that work. Both renderers keep the original row ids.
    const trailingRounds=stableWork?rounds.filter(e=>tailIds.has(e.id)):[];
    overlayEntries=withBriefs(stableWork?rounds.filter(e=>!tailIds.has(e.id)):rounds,stableWork?shownFlow.turnID:'');
    if(problem){
      for(const entries of [historyEntries,overlayEntries]){
        const prior=entries.findIndex(e=>e.id===problem.id);
        if(prior<0)entries.push(problem);else entries[prior]=problem;
      }
    }
    const interruptedProgress=captionError&&!guest&&!!preview&&preview.kind!=='final';
    stoppedProgress.hidden=true;$('answer-stage').classList.toggle('interrupted-progress',interruptedProgress);
    const tabs=voices.map(v=>({role:v.role,name:roleIdentity(viewProfile(),v.role).name}));
    paintVoiceTabs($('voice-tabs'),tabs,portalRole,{pinned:voiceRotation.pinned,onPick:role=>pinVoice(role)});
    overlayVoice={role:portalRole,voices:tabs,pinned:voiceRotation.pinned,kind:thoughtText?'thinking':'body',text:guest?thoughtText||guestText:''};
    $('answer-stage').hidden=!showWelcome&&!localWelcome&&!preview&&!question&&!thought&&!flow.active&&!flow.submitted&&!(captionError&&!navigation.current);
    // 收起按钮：折叠态里 Eyra 在工作、或右侧有内容、或已经收起时都在（悬停光圈出现），两段之间不闪掉。
    const dismissed=document.body.classList.contains('strip-dismissed');
    $('strip-hide').hidden=!(foldedForm&&(dismissed||flow.active||!!preview||!!thoughtText||!!question));
    if(chatForm&&dismissed)restoreStrip();
    if(!preview)typer.detach();
    if(!thought||question)thoughtView.detach();
    const completedWork=!stableWork&&!!workTranscript;
    if(completedWork){workTranscript.close();workTranscript=null;$('voice').replaceChildren();}
    if(stableWork){
      typer.detach();thoughtView.detach();
      if(!workTranscript){$('voice').replaceChildren();workTranscript=createWorkTranscript($('voice'));}
      workTranscript.visibility(!nativeChat);
      workTranscript.update(workValue);
      const workEntry={id:workEntryId,from:'eyra',role:portalRole,turnID:shownFlow.turnID,identity:roleIdentity(viewProfile(),portalRole),response:true,text:'',streaming:true,phase:shownFlow.state,work:{key:workKey,phase:workValue.phase,status:statusText,journal:workTranscript.snapshot(),reading:workTranscript.reading}};
      if(retryingTurn&&!historyEntries.some(e=>e.id===workEntryId))historyEntries.push(workEntry);
      if(!retryingTurn||!overlayEntries.some(e=>e.id===workEntryId))overlayEntries.push(workEntry);
      overlayEntries.push(...trailingRounds);
      $('answer-stage').dataset.kind='work';$('answer-stage').hidden=false;
      $('answer-stage').setAttribute('aria-label',voiceName+' 的工作过程');
    }
    else if(question){
      const voice=$('voice'),signature='ask:'+question.id+':'+question.version;
      if(voice.dataset.signature!==signature){typer.detach();voice.dataset.signature=signature;renderMarkdown(voice,[question.question,question.recommendation].filter(Boolean).join('\n\n'));}
      $('answer-stage').dataset.kind='question';$('answer-stage').setAttribute('aria-label',voiceName+' 在等你的决定');
    }
    else if(thought){
      // 思维的涌现（thought-view.mjs）：标题 + 最新一两行，新字浮现，旧行平滑上推。
      const voice=$('voice');
      if(voice.dataset.signature!=='thinking'||!thoughtView.attached){typer.detach();voice.dataset.signature='thinking';thoughtView.attach(voice);}
      thoughtView.update(thoughtText);
      $('answer-stage').dataset.kind='thinking';$('answer-stage').setAttribute('aria-label',voiceName+' 的思考');
    }
    else if(preview){
      const voice=$('voice'),shown=preview.full||preview.text,shownFlow=guestFlow||flow,streaming=shownFlow.active&&shownFlow.state==='body'&&preview.kind!=='final';
      // 返回页面时已完成的回复原样显示，不能重新打字并再次改变光圈的落点。
      // 轮到另一个角色时直接显示，不从头打字。
      const still=completedWork||captionError||rotated||(settle||next.greeting?.resumed&&String(preview.id||'').startsWith('greeting:'))&&!streaming;
      if(still)typer.detach();
      voice.dataset.signature=preview.signature;typer.show(voice,shown,{done:!streaming,from:still?shown.length:null});
      voice.dataset.bodyId=preview.originId||preview.id;$('answer-stage').dataset.kind=preview.kind;$('answer-stage').setAttribute('aria-label',preview.kind==='final'?'结尾正文':'行进中正文');
      $('live-details').hidden=true;$('live-details').textContent='在历史中阅读';
    }
    else if(localWelcome){
      const voice=$('voice');
      if(voice.dataset.signature!=='local-welcome'){voice.textContent='你好，欢迎回来。';voice.dataset.signature='local-welcome';delete voice.dataset.bodyId;}
      $('answer-stage').dataset.kind='status';$('answer-stage').setAttribute('aria-label','本地欢迎');
      $('live-details').hidden=true;
    }
    else if(showWelcome){
      // First-use guidance uses the same live body renderer and theme slots as
      // replies. It is local guidance, never a generated or persisted message.
      const voice=$('voice'),signature='welcome:'+voiceName+':'+flow.needsSetup;
      if(voice.dataset.signature!==signature){
        const nextStep=flow.needsSetup?'先在设置中接入 Aieyra API 或其他供应商，把模型加入模型池，再为我选择主模型。连接好后，在下方告诉我你想做什么。':'在下方告诉我你想做什么，我们就从这里开始。头像、背景和文字外观都可以在设置中调整。';
        renderMarkdown(voice,'你好，我是 '+voiceName+'。你可以和我聊聊，也可以让我规划任务、使用工具，帮你完成工作。\n\n'+nextStep);
        voice.dataset.signature=signature;delete voice.dataset.bodyId;
      }
      $('answer-stage').dataset.kind='greeting';$('answer-stage').setAttribute('aria-label',voiceName+' 的首次使用引导');
      $('live-details').hidden=true;
    }
    else{
      const voice=$('voice'),label=$('presence-label').textContent;
      if(voice.textContent)voice.textContent='';
      voice.dataset.signature='state:'+flow.state;
      $('answer-stage').dataset.kind='status';$('answer-stage').setAttribute('aria-label',voiceName+' 的状态');
    }
    compactRows=shownFlow.active?compactWorkRows(overlayEntries,shownFlow.turnID):[];
    compactLive=shownFlow.active?compactLiveRows(overlayEntries,shownFlow.turnID):[];
    chatLayer.update({identity:roleIdentity(viewProfile(),portalRole),state:displayState,label:statusText,active:!!shownFlow.active,rows:compactRows,liveRows:compactLive});
    const user=flow.user;root.hidden=!columnShown;let added=[];
    if(columnShown){
      added=chat.paint(historyEntries,{prepend:page,tailRoot:trailing,tailIds,motion:false});
      paintBubbleAttachments(root,rounds);paintBubbleAttachments(trailing,rounds);
      // 回复落进聊天列：从光圈旁已经打出的位置接着打完（没见过的回复从头快速打出），250ms 内结束。
      // 光圈托着的那一句早已完整显示，落下时原样留下，不再重打。
      const reply=added.findLast(e=>e.from==='eyra'),target=reply&&reply.id!==released&&root.querySelector('.chat-entry[data-id="'+CSS.escape(reply.id)+'"] .chat-text');
      // The receipt owns its body and retry action. Typing it as prose would remove the live controls.
      if(target&&!reply.problem&&!reply.streaming&&!settle&&!page&&!restoring&&!reduced())landing.show(target,reply.text,{done:true,from:handoff.full&&reply.text.startsWith(handoff.text)?handoff.text.length:reply.text.length});
    }
    $('live-current').hidden=true;$('live-actions').hidden=true;$('live-body-history').hidden=true;$('thought-stream').hidden=true;$('work').hidden=true;$('startup').hidden=true;emergence.hidden=(!!problem||retryingTurn)&&columnShown&&!guest&&!question;
    const stopHidden=!flow.active||disconnected;if($('stop').hidden!==stopHidden)$('stop').hidden=stopHidden;
    $('composer').classList.toggle('first-input',!user&&!flow.preview);
    if(settle||inputChanged())resizeInput();
    if(layoutBefore)chatMotion.commit(layoutBefore,{kind:handoffKind});
    if(columnShown&&!nativeChat){
      if(followChat)chatMotion.follow({snap:settle||restoring||readingChanged||page,reserve:!!layoutBefore&&handoffKind==='send'});
      else restoreChatReading(scroller,readerAnchor);
    }
  }
  function pinVoice(role){voiceRotation.pin(role);if(lastSnapshot)paint(lastSnapshot,lastPresentation,lastDisconnected);}
  return {paint,resizeInput,toggleChat:()=>chatLayer.toggle(),expandChat:()=>chatLayer.set(true),get chatExpanded(){return chatLayer.expanded;},get chatPosition(){return chatLayer.position;},moveChat(position,options){chatLayer.move(position,options);},get compactRows(){return compactRows;},get compactLive(){return compactLive;},get nativeBackground(){return workSurface.nativeVisible;},get chatEntries(){return overlayEntries;},get portalReading(){return portalReading();},nativeChatVisibility,acceptPortalReading,get currentPlan(){return lastPresentation?.plan()||null;},get reportHandles(){return reports.handles();},openDocument:(...a)=>reports.open(...a),notice:(...a)=>reports.notice(...a),
    close(){if(closed)return;closed=true;cancelAnimationFrame(resizeFrame);cancelAnimationFrame(layerFrame);inputAttributes.disconnect();inputResize.disconnect();for(const event of ['input','focus','blur'])$('message').removeEventListener(event,resizeInput);window.removeEventListener('resize',scheduleInput);for(const event of ['workspace-view-change','workspace-inset-change','workspace-theme-change'])document.removeEventListener(event,scheduleInput);document.fonts?.removeEventListener('loadingdone',scheduleInput);reports.dispose();planOrb.close();chatLayer.close();workTranscript?.close();document.removeEventListener('workspace-view-change',layerVisibility);followLayout.disconnect();contextMore.remove();conversationPager.clear();trailing.remove();chatMotion.close();chat.close();avatars.close();typer.detach();landing.detach();thoughtView.detach();window.removeEventListener('os-scale',scaleProfile);document.removeEventListener('workspace-view-before-change',rememberReading);document.removeEventListener('workspace-form-before-change',rememberReading);},
    get pendingQuestion(){return question;},
    get profile(){return {...profile};},
    get viewProfile(){return viewProfile();},
    get subconsciousState(){return subTimeline.active;},
    get overlayState(){const v=overlayVoice,other=!!v&&v.role!=='matrix',kind=other?v.kind:flow?.state==='thinking'?'thinking':'body';const active=!!flow?.active||other;const body=active?(other?v.text:flow?.state==='thinking'?flow.thought:flow?.state==='body'?flow?.preview?.full||flow?.preview?.text||'':''):'';return {active,kind,body,name:roleIdentity(viewProfile(),v?.role||'matrix').name,label:$('eyra-work-status').textContent||'',caption:captionFull,voices:v?.voices||[],voice:v?.role||'matrix',pinned:v?.pinned||''};},
    pinVoice,
    updateProfile(p){if(p){profile=p;applyProfile();}},
    get conversationMode(){return flow?.mode||'chat';},get compact(){return flow?.compact||false;},get worked(){return flow?.worked||false;},
    get needsAnimation(){return !!flow?.active||typer.active||landing.active||!booted||lastSnapshot?.greeting?.state==='connecting';},
    async initialize(p){profile=p||profile;applyProfile();if(profile.warning)reports.notice(profile.warning,true);booted=true;document.body.classList.add('awakened');await greet();},
    beginSend(text,id,attachments=[],at=new Date().toISOString()){
      readingIntent.reset();followChat=followStrip=true;readerAnchor=null;
      // Reject delayed reading acknowledgements from the preceding native turn.
      readingRevision++;readingSequence=0;
      pending.push({id,from:'user',text,attachments,at,state:'queued',delivery:'pending'});if(lastSnapshot)paint(lastSnapshot,lastPresentation,lastDisconnected);return id;
    },
    acceptSend(entry){if(entry.session_id===lastSnapshot?.session_id)acceptedSends.set(entry.request_id,{...entry,delivery:'accepted'});},
    sendFailed(id){pending=pending.filter(m=>m.id!==id);}
  };
}
