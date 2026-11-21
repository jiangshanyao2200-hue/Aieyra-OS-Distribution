/* @file-map:start
文件: link/desktop/ui/workspace.mjs
位置: 三环·页面编排 | 首页、仓库、工位、群聊、管理、接入的状态与事件编排。
约束: 可复用结构进入共享模块，编排层保留业务状态和授权动作；继续使用generation/epoch取消旧响应；不得重建整页破坏焦点和草稿
下游: link/desktop/ui/activity-history.mjs, link/desktop/ui/appearance.mjs, link/desktop/ui/audit.mjs, link/desktop/ui/carousel.mjs, link/desktop/ui/collaboration.mjs, link/desktop/ui/connection.mjs, link/desktop/ui/controls.mjs, link/desktop/ui/detail-view.mjs, link/desktop/ui/development.mjs, link/desktop/ui/elections.mjs, link/desktop/ui/engineering.mjs, link/desktop/ui/icons.mjs, link/desktop/ui/live.mjs, link/desktop/ui/markdown.mjs, link/desktop/ui/member-menu.mjs, link/desktop/ui/native-overlays.mjs, link/desktop/ui/project-governance.mjs, link/desktop/ui/source-browser.mjs, link/desktop/ui/surfaces.mjs, link/desktop/ui/unified.mjs, link/desktop/ui/welcome.mjs, link/desktop/ui/work-status.mjs, link/desktop/ui/workflow.mjs, link/office/web/motion.mjs
上游: link/desktop/ui/index.html, link/desktop/ui/login.html
链路: shared-ui, modal, governance
验证: AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/desktop/modal-aidebug.cjs, tests/test_u81_runtime.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  $ | function
  api.name | handler
  syncOfficeMotion | function
  getState | method
  moderate | method
  paintDevelopment | function
  paintReleaseTransfer | function
  openRelease | function
  date | function
  halo | function
  empty | function
  notice | function
  reportError | function
  surfaceStatus | function
  errorHTML | function
  dialog | function
  form | function
  form.formNode.oninput | handler
  form.formNode.onsubmit | handler
  header | function
  clearScope | function
  receive | function
  refresh | function
  navigate | function
  shell | function
  render | function
  activeWorkspace | function
  refreshDelay | function
  schedule | function
  hideBroadcastPreview | function
  showBroadcastPreview | function
  showBroadcastPreview.expire | function
  paintBroadcast | function
  applyBroadcast | function
  readBroadcast | function
  scheduleBroadcast | function
  pollHome | function
  pulse | function
  snapshotDialog | function
  myTasksDialog | function
  taskRecordsDialog | function
  engineeringDecision | function
  releaseBuilds | function
  chooseRelease | function
  workflowRecords | function
  liveDialog | function
  liveDialog.current | function
  liveDialog.refresh | function
  sourceDialog | function
  sourceDialog.refresh | function
  localEngineeringDialog | function
  localRunDialog | function
  paintAgentActivity | function
  agentView | function
  pollPersonalStation | function
  paintHomeSnapshot | function
  activityHistory | function
  loadElection | function
  loadBoard | function
  paintHomeBoard | function
  paintHomeBoard.electionHTML | method
  paintHomeBoard.blueprintHTML | method
  paintHomeBoard.goalCard | method
  agendaCard | function
  votes | function
  ballots | function
  voteActions | function
  goal | function
  agenda | function
  discussion | function
  discussion.node.oninput | handler
  discussion.node.onsubmit | handler
  showDecision | function
  showCandidate | function
  selectElectionGoals | function
  selectElectionGoals.node.onsubmit | handler
  repositoryView | function
  submitChannel | function
  chatView | function
  chatView.oninput | handler
  chatView.onkeydown | handler
  chatView.onclick | handler
  chatView.onchange | handler
  chatView.onscroll | handler
  previewImages | function
  attach | function
  chatLength | function
  updateChatLength | function
  send | function
  updateChat | function
  loadChat | function
  chatAsset | function
  loadChatImages | function
  loadChatImages.worker | function
  loadChatImages.worker.img.onclick | handler
  managed | function
  moderateMember | function
  managementView | function
  onclick | handler
  syncVisibleWorkspace | function
  onInset | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {userAttributes,avatar,railButton} from './controls.mjs';
import {mountProgramToolbar} from './vendor/program-toolbar.mjs';
import {SourceBrowser} from './source-browser.mjs';
import {broadcastHTML,homeHTML,managementHTML,milestoneStyle,releaseVotesHTML} from './unified.mjs';
import {inboxHTML,eventHTML} from './collaboration.mjs';
import {workStatusHTML,personalStationView,situationItems,operationItems,operationsHTML,updateOperations} from './work-status.mjs';
import {Appearance,defaults as appearanceDefaults} from './appearance.mjs';
import {bindNativeOverlays} from './native-overlays.mjs';
import {ActivityPages} from './activity-history.mjs';
import {developmentHTML,developmentLogsHTML,updateDevelopment} from './development.mjs';
import {projectGovernanceHTML,governanceForm} from './project-governance.mjs';
import {connectionMessage,homeRetryDelay} from './connection.mjs';
import {bindMemberMenu} from './member-menu.mjs';
import {welcomePhase,welcomeHTML} from './welcome.mjs';
import {auditHTML} from './audit.mjs';
import {detailButton,createDetailView} from './detail-view.mjs';
import {Carousel,carouselControls} from './carousel.mjs';
import {electionHTML,electionGuide,replacementHTML,roleName} from './elections.mjs';
import {escape as e,markdown} from './markdown.mjs';
import {icon,decorate} from './icons.mjs';
import {Surfaces,project} from './surfaces.mjs';
import {animateUI,cancelMotion,setupMotion} from '../../office/web/motion.mjs';
import {blueprintHTML,repositoryHTML,versionTrackHTML,taskHTML,briefHTML,engineeringGuide,liveGuide,myTasksHTML,taskRecordsHTML,taskRecordTitles} from './engineering.mjs';
import {workflowHTML,verificationsHTML,releasesHTML,releaseHTML,handoffsHTML,localEngineeringHTML,localRunHTML} from './workflow.mjs';
import {liveEntryHTML,liveOverviewHTML,livePageHTML,roomHTML,planHTML,contextHTML,pheromonesHTML} from './live.mjs';
const api={...window.linkHost},/* @chain-region $ | calls: document.getElementById */ $=id=>document.getElementById(id),workspace=$('workspace');
const hostOS=window.linkInOS;
if(hostOS){
  document.documentElement.dataset.osHost='';
  document.documentElement.dataset.mode='local';
}
// Electron preserves the fields on plain results crossing the isolated world.
for(const [name,invoke] of Object.entries(api)){
  if(name==='retry'||name==='onState'||name==='onDevelopment'||name==='onReleaseDownload')continue;
  /* @chain-region api.name | calls: invoke, Object.assign, Error */ api[name]=async(...args)=>{
    const result=await invoke(...args);
    if(!result?.ok)throw Object.assign(Error(result?.error||'请求未完成。'),{
      status:result?.status||0,code:result?.code,retryAfter:result?.retryAfter||0,outcomeUnknown:!!result?.outcomeUnknown,
    });
    return result.data;
  };
}
setupMotion(document,{tooltips:false});
bindNativeOverlays(api);
const detailView=createDetailView($('detail-dialog'));
const appearance=new Appearance($('desktop-background'),options=>api.backgroundState(options));
const motionPreference=new MutationObserver(()=>void syncOfficeMotion());
motionPreference.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
/* @chain-region syncOfficeMotion | calls: catch, api.officeMotion, console.error */ async function syncOfficeMotion(){
  await api.officeMotion(document.documentElement.dataset.motion!=='reduced').catch(error=>console.error('office_motion_failed',error.message));
}
void syncOfficeMotion();
const mainTabs=[...$('tabs').querySelectorAll('[data-tab]')];
let state={signedIn:false,user:null,access:null,adminUntil:0,mode:hostOS?'local':'cloud'},tab=hostOS?'office':'home',home='goals',lane='approved',repo='cloud',memberPage=0,viewEpoch=0;
let board=null,code=null,chosen='',filter='',folders=new Set(),chatCursor=0,chatRows=new Map(),chatAssets=new Map(),draftImages=[],draftId='',draftText='',chatBusy=false;
let timer,noticeTimer,liveTimer,adminTab='applications',adminPage=0, navigation=0,dialogEpoch=0;
let direction=0,pendingTab='',broadcastPreviewTimer;
const surfaces=new Surfaces(workspace),formDrafts=new Map(),sourceBrowser=new SourceBrowser(api);
let repositoryStatus=null;
let updateChannels=null, pendingChannelRequest=null;
let governancePage=null, governanceOffset=0;
let homeData=null,managementOffsets={applications:0,members:0,agendas:0,audit:0};
let homeRevision=null,homeMilestones=[],homeReadAt=0,homeMilestoneView='all',homeBundled=false;
let pulseFlight=null,visibilityRevision=0,lastHidden=document.hidden;
let broadcastRevision=null,broadcastItems=[],broadcastSeen=null,broadcastFlight=null,broadcastTimer=null;
const memberMenu=bindMemberMenu({/* @chain-region getState */ getState:()=>state,/* @chain-region moderate | calls: catch, moderateMember, notice */ moderate:(member,action)=>void moderateMember(member,action).catch(error=>notice(error.message))});
let accessSignature='',headerSignature='',chatFlight=null,boardFlight=null,attachBusy=false,chatAssetFlights=new Map();
let agentCopyBusy=false,stationTimer,stationContext=null,stationSnapshot=null,stationFlight=null;
let admittedAgent=null,stationWasStale=false;
let developmentCloudRevision=null,developmentState={},developmentTimer,developmentLogCursors=[0],developmentLogIndex=0;
/* @chain-region paintDevelopment | calls: $, updateDevelopment, workspace.querySelector, connectionMessage, clearTimeout, includes, setTimeout, catch … */ function paintDevelopment(value){
 developmentState=value;value={...value,cloud_revision:developmentCloudRevision};
 const target=$('development-host');if(target)updateDevelopment(target,value,{suppressError:workspace.querySelector('.surface')?.dataset.failureMessage===connectionMessage({message:value.error})});
 clearTimeout(developmentTimer);
 if(tab==='repository'&&['cloud','download'].includes(repo)&&value.state==='running')developmentTimer=setTimeout(()=>api.development('status').then(paintDevelopment).catch(error=>notice(error.message)),2500);
}
api.onDevelopment?.(paintDevelopment);
let releaseTransfer;
/* @chain-region paintReleaseTransfer | calls: includes, $, Math.floor, entry.setAttribute, querySelectorAll, row.querySelector */ function paintReleaseTransfer(){
  const transfer=releaseTransfer?.generation===state.generation?releaseTransfer:null;
  const active=['preparing','downloading','retrying','verifying'].includes(transfer?.state);
  const message=transfer?{
    preparing:'正在核对版本',downloading:'正在下载',
    retrying:transfer.status===429?'服务繁忙，等待续传':'连接中断，等待续传',
    verifying:'正在校验文件',saved:'校验通过 · '+transfer.name,
    cancelled:'已暂停，可继续下载',failed:transfer.message
  }[transfer.state]:'';
  const entry=$('release-transfer');
  entry.hidden=!(transfer&&state.signedIn&&state.access?.member);
  if(transfer){
    const percent=active&&transfer.total?' '+Math.floor(100*transfer.received/transfer.total)+'%':'';
    entry.title='版本下载 · '+message+percent;
    entry.setAttribute('aria-label',entry.title);
    entry.dataset.transferState=transfer.state;
  }
  for(const row of $('dialog-body').querySelectorAll('[data-artifact]')){
    const download=row.querySelector('[data-artifact-download]');
    const match=transfer?.sha===row.dataset.artifact&&transfer.id===download.dataset.release;
    const progress=row.querySelector('progress'),status=row.querySelector('[role="status"]');
    download.disabled=active;
    download.hidden=match&&(active||transfer.state==='saved');
    download.textContent=match&&['failed','cancelled'].includes(transfer.state)?'继续下载':'下载';
    row.querySelector('[data-artifact-cancel]').hidden=!(match&&active);
    row.querySelector('[data-artifact-reveal]').hidden=!(match&&transfer.state==='saved');
    progress.hidden=!(match&&active&&transfer.total);
    if(match&&transfer.total)progress.value=transfer.received;
    const rowMessage=match?message:'';
    if(status.textContent!==rowMessage)status.textContent=rowMessage;
    status.hidden=!rowMessage;
  }
}
api.onReleaseDownload?.(value=>{
  if(value.generation!==state.generation)return;
  releaseTransfer=value;
  paintReleaseTransfer();
  if(value.state==='saved')notice('已保存 '+value.name);
});
/* @chain-region openRelease | calls: dialog, api.call, $, releaseHTML, paintReleaseTransfer, e */ async function openRelease(id){
  const token=dialog('版本与构建产物','<div class="loading" role="status" aria-label="读取版本"></div>');
  try{
    const value=await api.call('/engineering/release?id='+id);
    if(token!==dialogEpoch||!$('dialog').open)return;
    dialog('版本与构建产物',releaseHTML(value));
    paintReleaseTransfer();
  }catch(error){
    if(token===dialogEpoch&&$('dialog').open)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button data-engineering-release-id="${e(id)}">重试读取</button>`;
  }
}
let activitySource='cloud';
const activityPages=new ActivityPages(before=>activitySource==='local'?api.localActivity(before):api.call('/engineering/events?view=activity&before='+before));
const situationCarousel=new Carousel('situation','#situation-title'),conversationCarousel=new Carousel('conversation','#personal-conversation',11000);
let pairing=null,taskPage=0,snapshotPage=0,agentList=[],electionData=null,electionPage=0;
decorate();
const names={approved:'执行中',voting:'投票中',rejected:'已否决',deferred:'待议',completed:'已完成',draft:'草稿',cancelled:'已取消'};
const /* @chain-region date | calls: toLocaleString, Date */ date=value=>new Date(value*1000).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const /* @chain-region halo | calls: Math.min, Math.max, e */ halo=(value='',progress=0)=>`<div class="halo" aria-hidden="true"><svg viewBox="0 0 220 220" fill="none"><circle class="orbit-track" cx="110" cy="110" r="104"/><circle class="orbit-inner" cx="110" cy="110" r="88"/><circle class="orbit-main" cx="110" cy="110" r="70"/><circle class="orbit-inner" cx="110" cy="110" r="60"/><circle class="orbit-runner" cx="110" cy="110" r="88"/><circle class="orbit-arc" cx="110" cy="110" r="70" stroke-dasharray="440" stroke-dashoffset="${440*(1-Math.min(100,Math.max(0,progress))/100)}"/><g class="orbit-points"><circle cx="110" cy="22" r="2"/><circle cx="110" cy="198" r="1.5"/></g></svg><strong>${e(value)}</strong></div>`;
const /* @chain-region empty | calls: icon, e */ empty=(message,type='agendas')=>`<p class="empty">${icon(type)}<span>${e(message)}</span></p>`;
/* @chain-region notice | calls: clearTimeout, $, setTimeout */ function notice(message,duration=6500){clearTimeout(noticeTimer);$('notice').textContent=message;$('notice').hidden=!message;noticeTimer=setTimeout(()=>$('notice').hidden=true,duration);}
/* @chain-region reportError | calls: workspace.querySelector, includes, test, surfaceStatus, notice, connectionMessage */ function reportError(error){
 const surface=workspace.querySelector('.surface');
 if(surface?.dataset.loaded==='true'&&([429,502,503,504].includes(error.status)||/连接|账号.*(?:服务|验证|响应)/.test(error.message||'')))surfaceStatus(error);
 else notice(connectionMessage(error));
}
/* @chain-region surfaceStatus | calls: workspace.querySelector, $, connectionMessage, project, e, icon, paintDevelopment */ function surfaceStatus(error=null){
  const surface=workspace.querySelector('.surface'),banner=$('surface-status');if(!surface||!banner)return;
  surface.dataset.syncState=error?'stale':tab==='home'&&document.hidden?'paused':'current';
  if(error){
    surface.dataset.failureMessage=connectionMessage(error);
    project(banner,`<span class="connection-message">${e(surface.dataset.failureMessage)}</span><button data-action="refresh" aria-label="重试连接">${icon('refresh')}<span>重试</span></button>`);
    banner.hidden=false;
  }else{
    delete surface.dataset.failureMessage;
    surface.dataset.loaded='true';banner.hidden=true;
  }
  if($('development-host'))paintDevelopment(developmentState);
}
/* @chain-region errorHTML | calls: icon, e, connectionMessage */ function errorHTML(error){return `<section class="load-failure" role="status">${icon('cloud')}<h2>${e(connectionMessage(error))}</h2><button data-action="refresh" class="secondary">重试</button></section>`;}
/* @chain-region dialog | calls: clearTimeout, detailView.close, appearance.closeMenu, $, showModal, queueMicrotask, focus, querySelector */ function dialog(title,html){
  clearTimeout(liveTimer);
  detailView.close({restore:false});appearance.closeMenu();
  const body=$('dialog-body');
  delete body.__projection;
  dialogEpoch++;$('dialog-title').textContent=title;body.innerHTML=html;
  $('dialog').scrollTop=0;$('dialog-body').scrollTop=0;if(!$('dialog').open)$('dialog').showModal();
  const epoch=dialogEpoch;
  queueMicrotask(()=>{if(epoch===dialogEpoch&&$('dialog').open)$('dialog-body').querySelector('input,textarea,button')?.focus({preventScroll:true});});
  return dialogEpoch;
}
$('dialog').addEventListener('close',()=>{if($('dialog').open)return;clearTimeout(liveTimer);dialogEpoch++;appearance.closeMenu();detailView.close({restore:false});});
document.addEventListener('click',event=>{
  const close=event.target.closest('[data-dialog-close]');if(!close)return;
  event.preventDefault();event.stopImmediatePropagation();appearance.closeMenu();
  if(close.closest('dialog')===$('detail-dialog'))detailView.close();
  else{clearTimeout(liveTimer);dialogEpoch++;detailView.close({restore:false});$('dialog').close();}
},true);
/* @chain-region form | calls: fields.some, formDrafts.get, dialog, join, fields.map, e, f.options.map, String … */ function form(title,fields,save,label='提交',scope=title){
  const confidential=fields.some(f=>f.type==='password'||f.name==='code');
  const saved=confidential?{}:formDrafts.get(scope)||{};
  dialog(title,`<form id="action-form">${fields.map(f=>`<label>${e(f.label)}${f.options?`<select name="${e(f.name)}">${f.options.map(([v,label])=>`<option value="${e(v)}" ${String(saved[f.name]??f.value)===String(v)?'selected':''}>${e(label)}</option>`).join('')}</select>`:f.short?`<input name="${e(f.name)}" type="${e(f.type||'text')}" autocomplete="${confidential?'off':'on'}"`:`<textarea name="${e(f.name)}"`} ${f.options?'':`required minlength="${f.min||1}" maxlength="${f.max||1000}" ${f.short?`value="${e(saved[f.name]??f.value??'')}">`:`>${e(saved[f.name]??f.value??'')}</textarea>`}`} </label>`).join('')}<p class="error" role="alert"></p><div class="actions"><button class="primary">${e(label)}</button></div></form>`);
  const formNode=$('action-form'),generation=state.generation;
  /* @chain-region form.formNode.oninput | calls: formDrafts.delete, next, formDrafts.keys, formDrafts.set, Object.fromEntries, FormData */ formNode.oninput=()=>{if(!confidential){if(formDrafts.size>40)formDrafts.delete(formDrafts.keys().next().value);formDrafts.set(scope,Object.fromEntries(new FormData(formNode)));}};
  /* @chain-region form.formNode.onsubmit | calls: event.preventDefault, node.querySelector, Object.fromEntries, FormData, button.setAttribute, save, formDrafts.delete, close … */ formNode.onsubmit=async event=>{
    event.preventDefault();const node=event.currentTarget,button=node.querySelector('button'),values=Object.fromEntries(new FormData(node));
    if(button.disabled)return;button.disabled=true;button.setAttribute('aria-busy','true');node.querySelector('.error').textContent='';
    if(confidential)node.querySelector('input').value='';
    try{await save(values);if(generation!==state.generation)return;formDrafts.delete(scope);if(node.isConnected)$('dialog').close();}
    catch(error){if(generation!==state.generation)return;if(node.isConnected)node.querySelector('.error').textContent=error.message;else notice(error.message);}
    finally{button.disabled=false;button.removeAttribute('aria-busy');}
  };
}
/* @chain-region header | calls: $, scheduleBroadcast, forEach, document.querySelectorAll, button.classList.toggle, button.setAttribute, JSON.stringify, avatar … */ function header(){
  const member=state.signedIn&&state.access?.member;
  $('broadcast-button').hidden=!member;
  scheduleBroadcast();
  document.querySelectorAll('[data-tab]').forEach(button=>{
    const section=button.dataset.tab;
    if(section==='office'&&hostOS)button.hidden=false;
    else if(section==='agents')button.hidden=!state.signedIn;
    else button.hidden=section!=='home'&&(!member||section==='management'&&!state.access?.admin&&!state.access?.project_manager);
    button.classList.toggle('active',button.dataset.tab===tab);button.setAttribute('aria-current',button.dataset.tab===tab?'page':'false');
  });
  const signature=JSON.stringify([state.signedIn,state.user]);
  if(signature!==headerSignature){headerSignature=signature;$('account').innerHTML=state.signedIn?`${avatar(state.user)}<span>${e(state.user?.name)}</span>`:'登录';}
  $('account').ariaLabel=state.signedIn?'账号信息':'登录';
  if(hostOS){
    const tools=$('local-office-tools');
    $('tabs').hidden=false;
    tools.hidden=state.mode!=='local';
    $('local-office-tabs').hidden=tools.hidden;
    for(const button of $('local-office-tabs').querySelectorAll('button'))button.disabled=!state.localReady;
    for(const button of tools.querySelectorAll('button'))button.disabled=!state.localReady;
    const connection=tools.querySelector('[data-office-action="connections"]');
    connection.dataset.cloud=state.localCloud||'unknown';
    connection.title={
      online:'云服务在线',
      offline:'云服务未连接',
      unavailable:'连接状态暂不可用',
    }[state.localCloud]||'正在读取连接';
    connection.setAttribute('aria-description',connection.title);
  }
  paintReleaseTransfer();
}
/* @chain-region clearScope | calls: memberMenu.close, cancelMotion, $, hideBroadcastPreview, activityPages.reset, clearTimeout, detailView.close, paintBroadcast … */ function clearScope(){
  memberMenu.close();
  direction=0;pendingTab='';cancelMotion($('navigation-sweep'));hideBroadcastPreview();
  repositoryStatus=null;
  updateChannels=null;pendingChannelRequest=null;
  governancePage=null;governanceOffset=0;
  activityPages.reset(null);
  clearTimeout(developmentTimer);developmentCloudRevision=null;developmentState={};developmentLogCursors=[0];developmentLogIndex=0;
  releaseTransfer=null;
  detailView.close();
  clearTimeout(broadcastTimer);broadcastTimer=null;broadcastRevision=null;broadcastItems=[];broadcastSeen=null;broadcastFlight=null;
  paintBroadcast();
  homeData=null;homeRevision=null;homeMilestones=[];homeReadAt=0;homeMilestoneView='all';homeBundled=false;managementOffsets={applications:0,members:0,agendas:0,audit:0};admittedAgent=null;stationWasStale=false;state.onboarding=null;stationContext=null;stationSnapshot=null;stationFlight=null;clearTimeout(stationTimer);situationCarousel.clear();conversationCarousel.clear();
  navigation++;viewEpoch++;chatRows.clear();chatAssets.clear();chatCursor=0;draftImages=[];draftText='';draftId='';chatBusy=false;board=null;code=null;
  chosen='';filter='';folders.clear();notice('');formDrafts.clear();surfaces.clear();accessSignature='';chatFlight=null;boardFlight=null;chatAssetFlights.clear();memberPage=0;home='goals';repo='cloud';tab='home';pairing=null;taskPage=0;snapshotPage=0;agentList=[];electionData=null;electionPage=0;
  $('dialog').close();$('dialog-body').replaceChildren();
}
/* @chain-region receive | calls: appearance.setEnabled, clearScope, api.tab, surfaces.clear, close, $, paintAgentActivity, header … */ async function receive(next){
  const wasSignedIn=state.signedIn,previous=state.generation,grant=state.adminUntil,oldAccess=state.access,oldActivity=state.onboarding?.last?.at;
  state={...state,...next};
  appearance.setEnabled(!hostOS&&!!state.signedIn);
  if(previous!==undefined&&previous!==state.generation){clearScope();state.access=null;}
  if(next.access)state.access=next.access;
  if(!state.signedIn){state.access=null;state.user=null;if(state.mode==='cloud')tab='home';}
  if(state.mode==='local'&&!pendingTab)tab='office';
  else if(!hostOS&&!wasSignedIn&&state.signedIn){tab='agents';await api.tab('agents');}
  if(oldAccess?.member&&state.access&&!state.access.member){clearScope();}
  if(next.releaseTransfer?.generation===state.generation&&!releaseTransfer)releaseTransfer=next.releaseTransfer;
  if(oldAccess?.admin&&!state.access?.admin){surfaces.clear();$('dialog').close();}
  if(tab==='management'&&!state.access?.admin&&!state.access?.project_manager)tab='home';
  if(next.onboarding)paintAgentActivity(next.onboarding);
  header();if(next.error)reportError(typeof next.error==='string'?{message:next.error}:next.error);
  const signature=JSON.stringify([state.mode,state.localReady,state.localError,state.hostAuth,state.signedIn,state.access]);
  if(signature!==accessSignature){accessSignature=signature;await render();}
  else if(next.onboarding?.last?.at&&next.onboarding.last.at!==oldActivity&&tab==='agents'){await render();}
  else if(grant!==state.adminUntil&&tab==='management'){surfaces.clear();await render();}
}
api.onState(next=>void receive(next));
/* @chain-region refresh | calls: receive, api.refresh, render, workspace.querySelector, surfaceStatus, notice, surfaces.open */ async function refresh(){
  const epoch=viewEpoch,serial=navigation,generation=state.generation;
  try{await receive(await api.refresh());if(serial!==navigation||generation!==state.generation)return;if(epoch===viewEpoch)await render();}
  catch(error){
    if(serial!==navigation||generation!==state.generation)return;
    if(workspace.querySelector('.surface')?.dataset.loaded==='true')surfaceStatus(error);else notice(error.message);
    if(state.signedIn&&!state.access)surfaces.open('checking-error',`<section class="login-stage"><h1>暂时无法验证云端权限</h1><button class="secondary" data-action="refresh">重试连接</button></section>`);
  }
}
/* @chain-region navigate | calls: hostOS.mode, Error, api.tab, mainTabs.find, previous.getBoundingClientRect, target.getBoundingClientRect, Math.sign, header … */ async function navigate(next){
  if(next===tab&&!pendingTab)return;
  const serial=++navigation;
  pendingTab=next;
  try{
    if(hostOS){
      const surface=next==='office'?'local':'cloud';
      if(surface!==state.mode){
        const switched=await hostOS.mode(surface);
        if(!switched.ok)throw Error(switched.error);
        if(serial!==navigation)return;
        state.mode=surface;document.documentElement.dataset.mode=surface;
      }
    }
    await api.tab(next);if(serial!==navigation)return;
    const previous=mainTabs.find(button=>button.dataset.tab===tab);
    const target=mainTabs.find(button=>button.dataset.tab===next);
    const from=previous.getBoundingClientRect(),to=target.getBoundingClientRect();
    direction=Math.sign(to.left-from.left);
    tab=next;header();
    const sweep=$('navigation-sweep');
    sweep.dataset.destination=tab;
    if(direction){
      sweep.style.left=`${to.left-$('tabs').getBoundingClientRect().left+(to.width-34)/2}px`;
      animateUI(sweep,[
        {opacity:.6,translate:`${from.left-to.left}px 0`},
        {offset:.75,opacity:1,translate:'0 0'},
        {opacity:0,translate:'0 0'},
      ],{duration:300});
    }
    const rendering=render({refreshStation:next==='agents'});
    direction=0;
    await rendering;
  }
  catch(error){if(serial===navigation)notice(error.message);}
  finally{if(serial===navigation)pendingTab='';}
}
/* @chain-region shell | calls: join, Date.now, surfaces.open, workspace.querySelector, project */ function shell(rail,heading,actions='',key=''){
  const scope=key||[tab,tab==='management'?state.adminUntil>Date.now():''].join(':');
  const title=tab==='agents'?heading:({repository:'仓库',chat:'开发者群聊',management:'治理'})[tab];
  const status=`<div id="surface-status" class="surface-status" role="status" hidden></div><div class="actions">${actions}</div>`;
  const head=tab==='agents'?`<h1>${title}</h1><div class="surface-tools">${status}</div>`:
    title?`<h1 class="together-page-title">${title}</h1><div class="surface-tools">${status}</div>`:status;
  const created=surfaces.open(scope,`<section class="surface"><header class="${tab==='agents'?'':'surface-toolbar'}">${head}</header><div id="content" class="scroll"><div class="loading" role="status" aria-label="加载中"></div></div></section>`,direction);
  const bar=workspace.querySelector('.surface>header');
  if(!created&&bar.__shellHeading!==head)project(bar,head);
  bar.__shellHeading=head;
  return created;
}
/* @chain-region render | calls: clearTimeout, surfaces.open, halo, icon, JSON.stringify, e, schedule, agentView … */ async function render({refreshStation=false}={}){
  const epoch=++viewEpoch,visibility=visibilityRevision;clearTimeout(timer);clearTimeout(stationTimer);
  if(state.mode==='local'){
    if(state.localError)surfaces.open('office-offline','<section class="login-stage"><h1>本地办公室暂不可用</h1><button class="secondary" data-action="retry-office">重新连接</button></section>');
    else if(!state.localReady)surfaces.open('office-loading','<div class="loading" role="status" aria-label="本地办公室正在启动"></div>');
    else surfaces.open('office','');
    return;
  }
  if(!state.signedIn){
    if(hostOS){
      if(state.hostAuth==='unavailable')surfaces.open('os-cloud-unavailable','<section class="os-cloud-status"><p role="status">云端暂未连接</p><button class="secondary" data-action="refresh">重试</button></section>');
      else if(state.hostAuth==='signed-out')surfaces.open('os-cloud-signed-out','<section class="os-cloud-status"><p role="status">请使用 OS 顶栏登录账号</p></section>');
      else surfaces.open('os-cloud-connecting','<section class="os-cloud-status"><p role="status">正在连接云端</p></section>');
    }else surfaces.open('login',`<section class="login-stage welcome-stage" data-welcome-phase="login">${halo()}<h1>欢迎您，亲爱的工程师。</h1><button class="primary" data-action="login">登录 ${icon('arrow')}</button></section>`);
    return;
  }
  if(!state.access){surfaces.open('checking','<div class="loading" role="status" aria-label="验证开发资格"></div>');return;}
  if(!state.access.member&&tab!=='agents'){const application=state.access.application;surfaces.open('application:'+JSON.stringify(application),`<section class="login-stage">${halo()}<h1>欢迎，${e(state.user.name)}</h1><p>${application?.status==='pending'?'开发申请正在审核。':application?.status==='rejected'?`申请未通过：${e(application.reason)}`:'申请工程师资格'}</p><div class="actions">${application?.status!=='pending'?'<button class="primary" data-action="apply">申请加入开发</button>':''}<button class="secondary" data-action="refresh">刷新资格</button></div></section>`);return;}
  if(tab==='office'){surfaces.open('office','');schedule(epoch);return;}
  let delay;
  try{
    if(tab==='agents')await agentView(epoch,refreshStation);
    if(tab==='home'){
      await pollHome(epoch,visibility,true);
      if(!activeWorkspace(epoch,visibility))return;
    }
    if(tab==='repository')await repositoryView(epoch);
    if(tab==='chat')await chatView(epoch);
    if(tab==='management')await managementView(epoch);
    if(epoch===viewEpoch&&tab!=='agents')surfaceStatus();
  }catch(error){
    if(epoch===viewEpoch&&(tab!=='home'||activeWorkspace(epoch,visibility))){
      if(tab==='home')delay=homeRetryDelay(error);
      const surface=workspace.querySelector('.surface'),content=$('content');
      if(surface?.dataset.loaded==='true')surfaceStatus(error);
      else if(content){project(content,errorHTML(error));surface.dataset.syncState='stale';}
      else notice(error.message);
    }
  }
  schedule(epoch,delay);
}
/* @chain-region activeWorkspace */ function activeWorkspace(epoch,visibility){
  return epoch===viewEpoch&&visibility===visibilityRevision&&!document.hidden;
}
/* @chain-region refreshDelay | calls: document.querySelector */ function refreshDelay(){
  if(tab==='home')return homeBundled?30000:5000;
  if(tab==='chat')return 5000;
  if(tab!=='agents')return 30000;
  if(document.querySelector('[data-welcome-phase="checking"],[data-welcome-phase="reconnect"]'))return 2500;
  return document.querySelector('[data-welcome-phase="connect"]')?5000:20000;
}
/* @chain-region schedule | calls: refreshDelay, clearTimeout, setTimeout, pulse, Math.ceil, Math.random */ function schedule(epoch,delay=refreshDelay()){
  if(epoch!==viewEpoch||document.hidden)return;
  clearTimeout(timer);
  timer=setTimeout(()=>void pulse(epoch),Math.ceil(delay*(1+Math.random()*.2)));
}
/* @chain-region hideBroadcastPreview | calls: clearTimeout, $, cancelMotion */ function hideBroadcastPreview(){
  clearTimeout(broadcastPreviewTimer);
  const preview=$('broadcast-preview');
  cancelMotion(preview,'arrival');
  preview.hidden=true;
}
/* @chain-region showBroadcastPreview | calls: milestoneStyle, $, preview.querySelector, icon, join, filter, animateUI, clearTimeout … */ function showBroadcastPreview(item){
  const style=milestoneStyle(item);
  if(!style)return;
  const [label,symbol,tone]=style,preview=$('broadcast-preview');
  preview.dataset.tone=tone;
  preview.querySelector('.broadcast-preview-icon').innerHTML=icon(symbol);
  preview.querySelector('strong').textContent=label;
  preview.querySelector('small').textContent=item.title||item.actor||'';
  preview.title=[label,item.title||item.actor].filter(Boolean).join(' · ');
  preview.hidden=false;
  animateUI(preview,[
    {opacity:.3,translate:'8px 0'},
    {opacity:1,translate:'0 0'},
  ],{duration:240,key:'arrival'});
  clearTimeout(broadcastPreviewTimer);
  const /* @chain-region showBroadcastPreview.expire | calls: preview.matches, setTimeout, hideBroadcastPreview */ expire=()=>{
    if(preview.matches(':focus-visible,:hover'))broadcastPreviewTimer=setTimeout(expire,1600);
    else hideBroadcastPreview();
  };
  broadcastPreviewTimer=setTimeout(expire,6200);
}
/* @chain-region paintBroadcast | calls: $, querySelector, items.filter, Number, showBroadcastPreview, String, button.setAttribute, project … */ function paintBroadcast(){
  const items=broadcastItems;
  const latest=items[0]?.seq??0;
  const panel=$('dialog').open&&$('dialog-body').querySelector('[data-shared-broadcast]');
  if(broadcastRevision!==null&&(broadcastSeen===null||latest<broadcastSeen||panel))broadcastSeen=latest;
  const unread=broadcastSeen===null?0:items.filter(item=>item.seq>broadcastSeen).length;
  const badge=$('broadcast-unread'),button=$('broadcast-button');
  if(unread>Number(badge.textContent)&&!document.hidden)showBroadcastPreview(items[0]);
  badge.hidden=!unread;badge.textContent=unread?String(unread):'';
  button.setAttribute('aria-label',unread?`共创动态，${unread} 条新记录`:'共创动态');
  if(panel)project($('dialog-body'),broadcastHTML(items,date));
}

/* @chain-region applyBroadcast | calls: Number.isSafeInteger, paintBroadcast */ function applyBroadcast(signal){
  broadcastRevision=Number.isSafeInteger(signal.home_revision)?signal.home_revision:null;
  if(signal.milestones){broadcastItems=signal.milestones;paintBroadcast();}
}
/* @chain-region readBroadcast | calls: catch, then, api.call, applyBroadcast */ async function readBroadcast(){
  if(document.hidden)return;
  if(broadcastFlight)return broadcastFlight;
  const generation=state.generation,member=state.access?.user?.id,visibility=visibilityRevision;
  const flight=api.call('/public/events?scope=home'+(broadcastRevision===null?'':'&after='+broadcastRevision)).then(signal=>{
    if(document.hidden||visibility!==visibilityRevision||generation!==state.generation||member!==state.access?.user?.id||!state.access?.member)return;
    applyBroadcast(signal);
  }).catch(error=>{if(error.status!==404)throw error;});
  broadcastFlight=flight;
  try{await flight;}finally{if(broadcastFlight===flight)broadcastFlight=null;}
}

/* @chain-region scheduleBroadcast | calls: clearTimeout, setTimeout, Math.random, readBroadcast, Math.max, scheduleBroadcast */ function scheduleBroadcast(delay=0){
  if(tab==='home'||document.hidden||!state.access?.member){
    clearTimeout(broadcastTimer);broadcastTimer=null;return;
  }
  if(broadcastTimer!==null)return;
  const scheduled=setTimeout(async()=>{
    let next=30000+Math.random()*6000;
    try{await readBroadcast();}catch(error){next=Math.max(11000,error.retryAfter*1000||0,error.status===429?60000:0);}
    finally{if(broadcastTimer===scheduled){broadcastTimer=null;scheduleBroadcast(next);}}
  },delay);
  broadcastTimer=scheduled;
}

/* @chain-region pollHome | calls: shell, activeWorkspace, workspace.querySelector, Date.now, URLSearchParams, pages.set, catch, api.call … */ async function pollHome(epoch,visibility,force){
  shell('','','','home');
  if(!activeWorkspace(epoch,visibility))return;
  if(force)homeRevision=null;
  const surface=workspace.querySelector('.surface');
  const age=Date.now()-homeReadAt, conditional=surface?.dataset.loaded==='true'&&
    (homeBundled||surface.dataset.syncState==='current')&&homeRevision!==null&&age<(homeBundled?120000:30000);
  const pages=new URLSearchParams({scope:'home',view:'workspace',cards:'1',page_cycle:board?.cycle?.id||'',
    election_offset:electionPage,task_offset:taskPage,member_offset:memberPage*12});
  if(conditional)pages.set('after',homeRevision);
  const signal=await api.call('/public/events?'+pages).catch(async error=>{
    if(error.status===404)return null;
    if(error.status===403&&activeWorkspace(epoch,visibility))await receive(await api.refresh());
    throw error;
  });
  if(!activeWorkspace(epoch,visibility))return;
  if(signal)applyBroadcast(signal);
  const revision=signal?broadcastRevision:null;
  if(conditional&&revision===homeRevision&&!signal.workspace)return;
  if(signal?.workspace){
    homeBundled=true;
    paintHomeSnapshot(signal.workspace,broadcastItems);
  }else{
    homeBundled=false;
    await api.refresh();
    if(!activeWorkspace(epoch,visibility))return;
    const [[goals,agendas],election,overview,tasks,members]=await Promise.all([loadBoard(),loadElection(),api.call('/engineering/overview'),api.call('/engineering/tasks?offset='+taskPage),api.call('/members?offset='+memberPage*12)]);
    if(!activeWorkspace(epoch,visibility))return;
    paintHomeSnapshot({board:{...goals,...agendas},election,overview,tasks,members},broadcastItems);
  }
  homeRevision=revision;
}
/* @chain-region pulse | calls: activeWorkspace, pollHome, api.refresh, updateChat, agentView, repositoryView, managementView, surfaceStatus … */ async function pulse(epoch){
  const visibility=visibilityRevision;
  if(!activeWorkspace(epoch,visibility)||(pulseFlight?.epoch===epoch&&pulseFlight.visibility===visibility))return;
  const flight={epoch,visibility};pulseFlight=flight;
  let delay;
  try{
    if(tab==='home')await pollHome(epoch,visibility,false);
    else{
      if(tab!=='agents')await api.refresh();
      if(!activeWorkspace(epoch,visibility))return;
      if(tab==='chat')await updateChat(false,epoch);
      else if(tab==='agents')await agentView(epoch);
      else if(tab==='repository')await repositoryView(epoch);
      else if(tab==='management')await managementView(epoch);
    }
    if(activeWorkspace(epoch,visibility)&&tab!=='agents')surfaceStatus();
  }catch(error){
    if(!activeWorkspace(epoch,visibility))return;
    const retry=error.retryAfter*1000||0;
    delay=tab==='home'?homeRetryDelay(error):error.status===429?(retry||60000):Math.max(retry,30000);
    if(workspace.querySelector('.surface')?.dataset.loaded==='true')surfaceStatus(error);
    else notice(error.message);
  }finally{
    if(pulseFlight===flight)pulseFlight=null;
  }
  if(activeWorkspace(epoch,visibility))schedule(epoch,delay);
}
/* @chain-region snapshotDialog | calls: e, dialog, revision.slice, Promise.all, api.call, $, repository.snapshots.find, exact.reports.filter … */ async function snapshotDialog(revision,offset=0,taskId='',taskOffset=0){
 const back=taskId?`<div class="actions task-workbench-back"><button class="secondary" data-task-records="revisions:${e(taskId)}:${taskOffset}">返回任务版本</button></div>`:'';
 const origin=taskId?` data-from-task="${e(taskId)}" data-task-offset="${taskOffset}"`:'';
 const token=dialog('源码版本 '+revision.slice(0,10),'<div class="loading" role="status" aria-label="读取源码版本"></div>');
 try{
  const [value,legacy,repository]=await Promise.all([api.call('/engineering/manifest?revision='+revision+'&offset='+offset),api.call('/engineering/reviews?revision='+revision),api.call('/engineering/repository?offset='+snapshotPage)]);
  let exact=null,flow=null;
  if(repository.repository.workflow_protocol>=2)[exact,flow]=await Promise.all([api.call('/engineering/verifications?revision='+revision),api.call('/engineering/workflow')]);
  if(token!==dialogEpoch||!$('dialog').open)return;
  const selected=repository.snapshots.find(s=>s.revision===revision)||value;
  const reports=exact?exact.reports.filter(r=>exact.latest.includes(r.id)):legacy.reports,own=reports.find(r=>r.reviewer===selected.author&&r.outcome==='pass');
  const canIntegrate=exact?.quorum?exact.quorum.passed:!!(own&&reports.some(r=>r.reviewer!==selected.author&&r.outcome==='pass'&&(!exact||r.script_sha256===own.script_sha256))&&!reports.some(r=>r.outcome==='fail'));
  dialog('源码版本 '+revision.slice(0,10),`${back}<h3>${e(selected.message||'固定源码版本')}</h3><p class="connection-note">${value.total} 个文件 · ${e(revision.slice(0,12))}</p>${exact?verificationsHTML(exact):''}<details><summary>查看源码文件</summary><div class="snapshot-files">${value.files.map(f=>`<button data-snapshot-file="${e(f.path)}" data-revision="${e(revision)}">${e(f.path)}</button>`).join('')}</div>${offset?`<button data-snapshot-more="${revision}" data-offset="${Math.max(0,offset-100)}"${origin}>上一页</button>`:''}${value.next_offset!==null?`<button data-snapshot-more="${revision}" data-offset="${value.next_offset}"${origin}>下一页</button>`:''}</details>${legacy.reports.length?`<details><summary>早期验证声明</summary>${legacy.reports.map(r=>`<article><strong>${r.outcome==='pass'?'通过声明':'发现问题'}</strong><p>${e(r.summary)}</p><p>${e(r.environment)}</p></article>`).join('')}</details>`:''}`);
  if(flow?.can_authorize&&selected.status==='candidate')$('dialog-body').insertAdjacentHTML('beforeend',`<div class="actions"><button class="primary" data-engineering-integrate="${e(revision)}" ${canIntegrate?'':'disabled'}>${canIntegrate?'授权 Agent 整合到云代码':'等待精确复验通过'}</button></div>`);
  if(state.access.admin&&selected.status==='candidate')$('dialog-body').insertAdjacentHTML('beforeend',`<details><summary>运营方调节</summary><button data-promote-snapshot="${e(revision)}" data-repository-version="${repository.repository.version}" ${canIntegrate?'':'disabled'}>受限整合</button></details>`);
 }catch(error){if(token===dialogEpoch&&$('dialog').open)$('dialog-body').innerHTML=`${back}<p class="error">${e(error.message)}</p><button class="secondary" data-snapshot-more="${e(revision)}" data-offset="${offset}"${origin}>重试</button>`;}
}
/* @chain-region myTasksDialog | calls: key.split, Number, includes, Number.isSafeInteger, dialog, api.call, $, myTasksHTML … */ async function myTasksDialog(key){
 const [mode,rawOffset]=key.split(':'),offset=Number(rawOffset);
 if(!['active','all'].includes(mode)||!Number.isSafeInteger(offset)||offset<0)return;
 const token=dialog('我的任务','<div class="loading" role="status" aria-label="读取我的任务"></div>');
 try{
   const value=await api.call('/engineering/tasks?owner=me&offset='+offset+(mode==='active'?'&active=1':''));
   if(token===dialogEpoch&&$('dialog').open)dialog('我的任务',myTasksHTML(value,mode,offset));
 }catch(error){
   if(token===dialogEpoch&&$('dialog').open)project($('dialog-body'),`<p class="error">${e(connectionMessage(error))}</p><button class="secondary" data-my-tasks="${e(key)}">重试</button>`);
 }
}
/* @chain-region taskRecordsDialog | calls: key.split, Number, Object.hasOwn, test, Number.isSafeInteger, dialog, api.call, $ … */ async function taskRecordsDialog(key){
 const [kind,id,rawOffset]=key.split(':'),offset=Number(rawOffset);
 if(!Object.hasOwn(taskRecordTitles,kind)||!/^[a-f0-9]{32}$/.test(id)||!Number.isSafeInteger(offset)||offset<0)return;
 const title=taskRecordTitles[kind],token=dialog(title,'<div class="loading" role="status" aria-label="读取任务记录"></div>');
 try{
   const query=kind==='checkpoints'?'/engineering/task?view=checkpoints&id='+id:'/engineering/repository?task_id='+id;
   const value=await api.call(query+'&offset='+offset);
   if(token===dialogEpoch&&$('dialog').open)dialog(title,taskRecordsHTML(kind,id,value,offset));
 }catch(error){
   if(token===dialogEpoch&&$('dialog').open)project($('dialog-body'),`<p class="error">${e(connectionMessage(error))}</p><div class="actions task-workbench-back"><button class="secondary" data-live-context="${e(id)}">返回任务</button><button class="secondary" data-task-records="${e(key)}">重试</button></div>`);
 }
}
/* @chain-region engineeringDecision | calls: dialog, api.call, $, Error, form, showDecision, insertAdjacentHTML, e … */ async function engineeringDecision(action,extra={}){
 const token=dialog('读取阶段决定','<div class="loading" role="status" aria-label="读取当前阶段"></div>'),generation=state.generation;
 try{
 const flow=await api.call('/engineering/workflow');
 if(token!==dialogEpoch||generation!==state.generation||!$('dialog').open)return;
 if(!flow.can_authorize)throw Error('仅当选负责人可授权此阶段决策。');
 if(!flow.phase)throw Error('请先确立本轮目标。');
 const common={revision:flow.repository.cloud,repository_version:flow.repository.version,phase_version:flow.phase.version,...extra};
 const accept=action==='engineering.accept-goal',release=action==='engineering.release';
 const title=accept?'验收阶段目标':release?(extra.channel==='stable'?'确认稳定版本':'发布开发版本'):action==='engineering.integrate'?'整合固定候选':'进入集中 Debug';
 const fields=release?[{name:'name',label:'版本名称',short:true,max:80,value:'0.1.0-experiment'},{name:'notes',label:'试用、验收与发布结论',min:10,max:3000}]:[{name:accept?'summary':'reason',label:accept?'目标验收结论':'决定与理由',min:10,max:accept?2000:1000}];
 form('授权 Agent · '+title,fields,async values=>{const result=await api.call('/elections/authorize',{cycle_id:flow.cycle_id,version:flow.authorization_version,action,payload:{...common,...values}});if(generation===state.generation)showDecision(result);},'授予本次精确授权',action+':'+common.revision+':'+(extra.goal_id||extra.channel||''));
 $('action-form').insertAdjacentHTML('afterbegin',`<p>源码 <code>${e(common.revision.slice(0,12))}</code> · 当前授权绑定本版本。</p>${release?`<p>${extra.artifacts.length} 项构建产物 · 构建证据 ${e(extra.verification_id.slice(0,12))}</p><details><summary>核对产物</summary>${extra.artifacts.map(a=>`<p>${e(a.path)} · ${(a.bytes/1024/1024).toFixed(2)} MB</p><code class="artifact-digest">${e(a.sha256)}</code>`).join('')}</details>`:''}`);
 }catch(error){if(token!==dialogEpoch||!$('dialog').open)return;const retry=action==='engineering.integrate'?`data-engineering-integrate="${e(extra.revision)}"`:action==='engineering.accept-goal'?`data-accept-goal="${e(extra.goal_id)}"`:action==='engineering.release'?`data-engineering-release="${e(extra.channel)}"`:'data-engineering-freeze="true"';$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" ${retry}>重新读取决定依据</button>`;}
}
/* @chain-region releaseBuilds | calls: api.call */ function releaseBuilds(revision,offset=0){
 return api.call('/engineering/verifications?revision='+revision+'&builds=1&offset='+offset);
}
/* @chain-region chooseRelease | calls: dialog, api.call, $, Error, engineeringDecision, releaseBuilds, value.reports.filter, value.latest.includes … */ async function chooseRelease(channel,offset=0){
 const token=dialog('选择已验证的本地构建','<div class="loading" role="status" aria-label="读取构建记录"></div>');
 try{
 const flow=await api.call('/engineering/workflow');
 if(token!==dialogEpoch||!$('dialog').open)return;
 if(channel==='stable'){
  const dev=flow.development_release;
  if(!dev)throw Error('当前源码尚无已试用的开发版。');
  await engineeringDecision('engineering.release',{channel,builder:dev.builder,verification_id:dev.verification_id,artifacts:dev.artifacts});return;
 }
 const value=await releaseBuilds(flow.repository.cloud,offset);
 if(token!==dialogEpoch||!$('dialog').open)return;
 const rows=value.reports.filter(r=>value.latest.includes(r.id)&&r.outcome==='pass'&&r.evidence.execution.artifacts?.length);
 dialog('选择已验证的本地构建',rows.map(r=>`<button class="snapshot-row" data-release-build="${e(r.id)}" data-channel="${channel}" data-offset="${offset}"><div><strong>${e(r.name||r.reviewer.slice(0,8))}</strong><small>${r.evidence.execution.artifacts.length} 项产物 · ${e(r.summary)}</small></div><span>选择 ↗</span></button>`).join('')||(offset?'<p>本页暂无构建</p>':'<p>暂无可选构建</p>'));
 if(offset||value.next_offset!==null)$('dialog-body').insertAdjacentHTML('beforeend',`<div class="pager"><button data-builds-page="${Math.max(0,offset-20)}" data-channel="${channel}" ${offset?'':'disabled'}>上一页</button><button data-builds-page="${value.next_offset??offset}" data-channel="${channel}" ${value.next_offset!==null?'':'disabled'}>下一页</button></div>`);
 }catch(error){if(token===dialogEpoch&&$('dialog').open)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" data-builds-page="${offset}" data-channel="${e(channel)}">重试读取构建</button>`;}
}
/* @chain-region workflowRecords | calls: dialog, api.call, $, verificationsHTML, releasesHTML, handoffsHTML, e */ async function workflowRecords(resource,offset=0,revision=''){
 const titles={verifications:'全部执行记录',releases:'版本记录',handoffs:'议程接续'};
 const token=dialog(titles[resource],'<div class="loading" role="status" aria-label="读取工程记录"></div>');
 try{
  const value=await api.call('/engineering/'+resource+'?offset='+offset+(revision?'&revision='+revision:''));
  if(token!==dialogEpoch||!$('dialog').open)return;
  dialog(titles[resource],resource==='verifications'?verificationsHTML(value,{history:true,offset}):resource==='releases'?releasesHTML(value,offset):handoffsHTML(value,offset));
 }catch(error){if(token===dialogEpoch&&$('dialog').open)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" data-${{verifications:'verification-page',releases:'releases-page',handoffs:'handoffs-page'}[resource]}="${offset}" data-revision="${e(revision)}">重试</button>`;}
}
/* @chain-region liveDialog | calls: dialog, refresh */ async function liveDialog(kind='overview',id='',offset=0){
 const titles={overview:'持续协作',room:'相关小会议',queue:'融合队列',rooms:'相关小会议',drafts:'我的云端草稿',context:'当前工作定义'};
 const token=dialog(titles[kind],'<div class="loading" role="status" aria-label="读取协作状态"></div>'),generation=state.generation;
 let previous=false;
 const /* @chain-region liveDialog.current | calls: $ */ current=()=>token===dialogEpoch&&generation===state.generation&&$('dialog').open;
 const /* @chain-region liveDialog.refresh | calls: current, setTimeout, refresh, Promise.all, api.call, liveOverviewHTML, encodeURIComponent, roomHTML … */ refresh=async()=>{
  if(!current())return;
  if(document.hidden){liveTimer=setTimeout(()=>void refresh(),10000);return;}
  try{
   let html;
   if(kind==='overview'){
    const [queue,rooms,drafts]=await Promise.all([api.call('/engineering/live/queue?state=active'),api.call('/engineering/live/rooms'),api.call('/engineering/live/drafts')]);
    html=liveOverviewHTML({queue,rooms,drafts});
   }else if(kind==='room'){
    const value=await api.call('/engineering/live/room?id='+encodeURIComponent(id)+'&after='+offset);html=roomHTML(value);
    if(current())$('dialog-title').textContent=value.room.title;
   }else if(kind==='context')html=contextHTML(await api.call('/engineering/live/context?task_id='+encodeURIComponent(id)));
   else html=livePageHTML(kind,await api.call('/engineering/live/'+kind+'?offset='+offset+(kind==='queue'?'&state=active':'')));
   if(!current())return;
   project($('dialog-body'),html);const status=$('dialog-body').querySelector('.live-status');if(status){status.hidden=true;status.textContent='';}previous=true;
  }catch(error){
   if(!current())return;
   const status=$('dialog-body').querySelector('.live-status');
   if(previous&&status){status.textContent='暂时无法更新，正在显示上次记录。稍后会自动重试。';status.hidden=false;}
   else project($('dialog-body'),`<p class="error">${e(error.message)}</p><button class="secondary" ${kind==='context'?`data-live-context="${e(id)}"`:'data-action="live-overview"'}>重试读取协作状态</button>`);
  }
  if(current())liveTimer=setTimeout(()=>void refresh(),10000);
 };
 await refresh();
}
/* @chain-region sourceDialog | calls: dialog, api.call, encodeURIComponent, e, value.revision.slice, $, project, refresh */ async function sourceDialog(path,revision){
 const token=dialog(path,'<div class="loading" role="status" aria-label="读取文件"></div>'),generation=state.generation;
 try{
  const value=await api.call('/engineering/file?revision='+revision+'&path='+encodeURIComponent(path));
  const content=`<small>版本 ${e(value.revision.slice(0,10))} · ${value.bytes} B</small><div id="code-pheromones"></div><pre class="snapshot-source">${e(value.content??'二进制文件')}</pre>`;
  if(token!==dialogEpoch||generation!==state.generation||!$('dialog').open)return;
  project($('dialog-body'),content);
  const /* @chain-region sourceDialog.refresh | calls: $, api.call, encodeURIComponent, project, pheromonesHTML, setTimeout, refresh */ refresh=async()=>{
   if(token!==dialogEpoch||generation!==state.generation||!$('dialog').open)return;
   try{
    const annotations=await api.call('/engineering/live/pheromones?revision='+revision+'&path='+encodeURIComponent(path));
    if(token===dialogEpoch&&generation===state.generation&&$('code-pheromones'))project($('code-pheromones'),pheromonesHTML(annotations));
   }catch{
    if(token===dialogEpoch&&$('code-pheromones'))project($('code-pheromones'),'<small class="muted">代码线索暂未更新。</small>');
   }
   if(token===dialogEpoch&&generation===state.generation&&$('dialog').open)liveTimer=setTimeout(()=>void refresh(),10000);
  };
  await refresh();
 }catch(error){if(token===dialogEpoch&&generation===state.generation&&$('dialog').open)project($('dialog-body'),`<p class="error">${e(error.message)}</p><button class="secondary" data-snapshot-file="${e(path)}" data-revision="${e(revision)}">重试</button>`);}
}
/* @chain-region localEngineeringDialog | calls: dialog, api.localEngineering, $, localEngineeringHTML, e */ async function localEngineeringDialog(){
 const token=dialog('本地工作区与运行','<div class="loading" role="status" aria-label="读取本地环境"></div>');
 try{const value=await api.localEngineering();if(token!==dialogEpoch||!$('dialog').open)return;
  dialog('本地工作区与运行',localEngineeringHTML(value));
 }catch(error){if(token===dialogEpoch&&$('dialog').open)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" data-action="local-engineering">重试本机查询</button>`;}
}
/* @chain-region localRunDialog | calls: dialog, api.localEngineeringInspect, $, localRunHTML, e */ async function localRunDialog(id,offset=0){
 const token=dialog('本机执行记录','<div class="loading" role="status" aria-label="读取执行记录"></div>');
 try{const value=await api.localEngineeringInspect(id,offset);if(token!==dialogEpoch||!$('dialog').open)return;
  dialog('本机执行记录',localRunHTML(value));
 }catch(error){if(token===dialogEpoch&&$('dialog').open)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" data-local-run="${e(id)}">重试读取</button>`;}
}
/* @chain-region paintAgentActivity | calls: $, flow.classList.toggle, label.classList.toggle */ function paintAgentActivity(value=state.onboarding||{}){
  const flow=$('agent-flow');if(flow){flow.classList.toggle('agent-busy',!!value.agent);flow.classList.toggle('api-busy',!!value.api);}
  const message=value.api?'正在与云端交换信息':value.agent?'正在处理 Agent 请求':'等待下一次操作';
  for(const id of ['agent-activity','work-activity']){const label=$(id);if(label){const busy=!!(value.api||value.agent);label.textContent=message;label.hidden=id==='work-activity'||!busy;label.classList.toggle('is-busy',busy);}}
}
/* @chain-region agentView | calls: shell, carouselControls, setAttribute, document.querySelector, api.workStatus, workspace.querySelector, data.agents.filter, Date.now … */ async function agentView(epoch,refresh=false){
  shell('','<span id="situation-title">加载中…</span>',carouselControls('situation'),'agents');
  document.querySelector('.surface>header').setAttribute('data-carousel-area','');
  const data=await api.workStatus(refresh);if(epoch!==viewEpoch)return;
  const surface=workspace.querySelector('.surface');surface.dataset.loaded='true';surface.dataset.syncState=data.stale?'stale':'current';
  agentList=data.agents;
  const agents=data.agents.filter(a=>!a.revoked&&a.expires>Date.now()/1000);
  const active=agents.find(a=>a.ready||a.enrollment?.state==='completed')||agents[0];
  const phase=welcomePhase({...data,agents:active?[active]:[]}),working=!!active&&(phase==='ready'||phase==='reconnect'||active.enrollment?.state==='completed'),content=$('content');
  const entry=document.querySelector('[data-tab=agents]');entry.querySelector('span')?.replaceChildren(document.createTextNode(working?'我的工位':'接入'));entry.setAttribute('aria-label',working?'我的工位':'Agent 接入');entry.title=working?'我的工位':'Agent 接入';
  if(!working){
    project(content,welcomeHTML(data,state.access,halo(),agentCopyBusy));content.dataset.stationMode='welcome';
    situationCarousel.set([{key:'connect',text:'欢迎加入共创'}]);stationSnapshot=null;conversationCarousel.clear();
  }else{
    const manager=data.context.leadership?.management?.agent_id;
    const stationMode=JSON.stringify([active.id,manager,agents.map(a=>[a.id,a.ready])]);
    if(content.dataset.stationMode!==stationMode){
      project(content,workStatusHTML(data,active,date)+`<details class="onboarding-stage onboarding-manage station-manage"><summary>管理 Agent 接入</summary><p id="station-sync" class="work-sync" role="status"></p><div id="agent-flow" class="agent-flow" aria-hidden="true"><div class="flow-node">Agent</div><div class="flow-wire agent-wire"><i></i></div><div class="flow-link">Link</div><div class="flow-wire api-wire"><i></i></div><div class="flow-node">API</div></div><p id="agent-activity" class="flow-activity" hidden></p><button class="primary" data-action="agent-add">新增 Agent</button>${agents.map(agent=>`<div class="station-connection"><strong>${e(agent.name||'Agent')}</strong>${manager===agent.id?' · 管理 Agent':''}<div class="actions"><button class="secondary" data-agent="${e(agent.id)}" data-action="agent-copy">复制接入信息</button><button class="secondary" data-action="agent-replace-prompt" data-replace="${e(agent.id)}">更换 Agent</button><button class="danger" data-agent-revoke="${e(agent.id)}">撤销接入</button></div></div>`).join('')}</details>`);
      content.dataset.stationMode=stationMode;
    }
    const reconnect=$('station-reconnect'),needsReconnect=phase==='reconnect'||data.connection?.state==='idle'||data.connection?.state==='unlinked';
    const add=workspace.querySelector('[data-action=agent-add]');
    add.hidden=!data.parallel_agents;
    add.disabled=Number.isInteger(data.workstation_limit)&&data.workstations_used>=data.workstation_limit;
    add.textContent=Number.isInteger(data.workstation_limit)?'新增工位 · '+data.workstations_used+'/'+data.workstation_limit:'新增工位';
    reconnect.hidden=!needsReconnect;
    reconnect.querySelector('p').textContent='重新连接 Agent';
    const sync=$('station-sync');sync.textContent=`${data.stale?'同步暂缓 · 上次态势':'已同步'} · ${date(Date.parse(data.observed_at)/1000)}`;sync.classList.toggle('is-stale',data.stale);
    const warning=$('station-warning');warning.hidden=!data.stale;
    if(!data.stale){
      if(admittedAgent!==active.id&&!needsReconnect)notice(`${active.name||'Agent'} 已接入`,3500);
      else if(stationWasStale)notice('同步已恢复。',3500);
      admittedAgent=active.id;
    }
    stationWasStale=!!data.stale;
    situationCarousel.set(situationItems(data));
  }
  paintAgentActivity();stationContext=data.context;
  if(working)await pollPersonalStation(epoch);
}
/* @chain-region pollPersonalStation | calls: clearTimeout, $, api.personalStation, flight.then, includes, personalStationView, project, operationItems … */ async function pollPersonalStation(epoch){
  clearTimeout(stationTimer);if(epoch!==viewEpoch||tab!=='agents'||document.hidden||!$('personal-station'))return;
  try{if(!stationFlight){const flight=api.personalStation();stationFlight=flight;flight.then(()=>{if(stationFlight===flight)stationFlight=null;},()=>{if(stationFlight===flight)stationFlight=null;});}const value=await stationFlight;if(epoch!==viewEpoch)return;stationSnapshot=value;}
  catch(error){if(epoch!==viewEpoch)return;stationSnapshot=[401,403].includes(error.status)?{unlinked:true}:{...stationSnapshot,stale:true};}
  const view=personalStationView(stationSnapshot,stationContext,date);project($('personal-station'),view.html);
  const scroller=$('link-activity-scroll'),list=$('link-activity-list'),items=operationItems(stationSnapshot);
  const anchor=scroller.scrollTop>12?[...list.children].find(n=>n.getBoundingClientRect().bottom>scroller.getBoundingClientRect().top):null;
  const key=anchor?.dataset.activityId,offset=anchor?.getBoundingClientRect().top;
  updateOperations(list,items,date);
  if(key){const current=list.querySelector(`[data-activity-id="${CSS.escape(key)}"]`);if(current)scroller.scrollTop+=current.getBoundingClientRect().top-offset;}
  const older=workspace.querySelector('[data-action=activity-older]');older.hidden=!operationItems(stationSnapshot).length;
  if(epoch===viewEpoch)stationTimer=setTimeout(()=>void pollPersonalStation(epoch),3000);
}
/* @chain-region paintHomeSnapshot | calls: Map, map, workspace.querySelectorAll, filter, Set, agendas.filter, includes, tasks.tasks.filter … */ function paintHomeSnapshot({board:nextBoard,election,overview,tasks,members},milestones){
  const priorSteps=new Map([...workspace.querySelectorAll('[data-stage-step]')].map(node=>[node.dataset.stageStep,node.dataset.stepState]));
  const isNewMilestone=homeRevision!==null&&milestones[0]?.seq> (homeMilestones[0]?.seq??0);
  const cycle=nextBoard.cycle?.id||null;
  if((board?.cycle?.id||null)!==cycle&&tasks.cycle_id===cycle){
    taskPage=0;electionPage=0;
  }
  const agendas=cycle?(nextBoard.agendas||[]).filter(agenda=>agenda.goal_id===cycle):[];
  if(tasks.cycle_id!==cycle){
    const activeAgendas=new Set(agendas.filter(agenda=>['approved','completed'].includes(agenda.status)).map(agenda=>agenda.id));
    const rows=tasks.tasks.filter(task=>activeAgendas.has(task.agenda_id)),counts={};
    for(const task of rows)counts[task.state]=(counts[task.state]||0)+1;
    tasks={...tasks,tasks:rows,counts};
  }
  board={...nextBoard,agendas};electionData=election;
  homeData={overview,tasks,members};
  homeMilestones=milestones;
  homeReadAt=Date.now();paintHomeBoard();
  for(const node of workspace.querySelectorAll('[data-stage-step]')){
    const previous=priorSteps.get(node.dataset.stageStep);
    if(!previous||previous===node.dataset.stepState||node.dataset.stepState==='waiting')continue;
    animateUI(node.querySelector('.home-stage-step'),[
      {opacity:.62,translate:'0 7px'},
      {opacity:1,translate:'0 0'},
    ],{duration:295,key:'stage-progress'});
  }
  if(isNewMilestone&&!document.hidden){
    const latest=workspace.querySelector('.home-milestones li');
    if(latest?.dataset.milestone!==String(milestones[0].seq))return;
    $('milestone-announcement').textContent=latest.textContent.trim().replace(/\s+/g,' ');
    if(document.documentElement.dataset.motion!=='reduced'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      latest.dataset.arrival='true';
      setTimeout(()=>{delete latest.dataset.arrival;},900);
    }
  }
}
/* @chain-region activityHistory | calls: activityPages.reset, dialog, querySelectorAll, $, activityPages.page, project, operationsHTML, operationItems … */ async function activityHistory(delta=0,before=null){
 if(before!==null){activityPages.reset(before);dialog('更早的 Link 操作','<div class="loading" role="status" aria-label="读取操作记录"></div>');}
 const token=dialogEpoch;
 for(const button of $('dialog-body').querySelectorAll('[data-activity-page]'))button.disabled=true;
 try{
  const page=await activityPages.page(delta);if(!page||token!==dialogEpoch||!$('dialog').open)return;
  project($('dialog-body'),`<div class="lanes"><button data-activity-source="cloud" aria-pressed="${activitySource==='cloud'}">Link 操作</button><button data-activity-source="local" aria-pressed="${activitySource==='local'}">本机操作</button></div><section class="activity-history">${operationsHTML(operationItems({operations:page.value}),date)}</section><nav class="pager" aria-label="操作记录分页"><button data-activity-page="-1" ${page.previous?'':'disabled'}>上一页</button><span>第 ${page.index+1} 页</span><button data-activity-page="1" ${page.next?'':'disabled'}>下一页</button></nav>`);
  $('dialog-body').scrollTop=0;
 }catch(error){
  if(token!==dialogEpoch||!$('dialog').open)return;
  project($('dialog-body'),`<p class="error">${e(error.message)}</p><button class="secondary" data-activity-page="0">重试</button>`);
 }
}
/* @chain-region loadElection | calls: api.call, Promise.all, map, filter, Object.values, data.candidates.some */ async function loadElection(){
    const data=await api.call('/elections?offset='+electionPage);
    await Promise.all(Object.values(data.roles||{}).filter(term=>term&&!data.candidates.some(c=>c.id===term.candidate_id)).map(async term=>{
      const value=await api.call('/elections/candidate?id='+term.candidate_id);term.name=value.candidate.name;
    }));
    return data;
}
/* @chain-region loadBoard | calls: Promise.all, api.call, flight.then */ function loadBoard(){
  if(!boardFlight){
    const flight=Promise.all([api.call('/goals'),api.call('/agendas')]);
    boardFlight=flight;
    flight.then(()=>{if(boardFlight===flight)boardFlight=null;},()=>{if(boardFlight===flight)boardFlight=null;});
  }
  return boardFlight;
}
/* @chain-region paintHomeBoard | calls: $, project, homeHTML */ function paintHomeBoard(){
  if(!board||!homeData||!$('content'))return;
  project($('content'),homeHTML({board,election:electionData,...homeData,milestones:homeMilestones,milestoneView:homeMilestoneView,memberPage,date,avatar,attributes:userAttributes,
    /* @chain-region paintHomeBoard.electionHTML | calls: electionHTML, replacementHTML */ electionHTML:(data,date)=>electionHTML(data,date)+replacementHTML(data,date),
    /* @chain-region paintHomeBoard.blueprintHTML | calls: blueprintHTML */ blueprintHTML:(overview,tasks)=>blueprintHTML(overview,tasks,taskPage),agendaCard,
    /* @chain-region paintHomeBoard.goalCard | calls: e, votes, icon */ goalCard:c=>`<article class="quest home-goal"><h2>${e(c.title)}</h2><p>${e(c.summary)}</p>${votes(c,'goal')}<button class="secondary" data-goal="${e(c.id)}">查看详情 ${icon('arrow')}</button></article>`}));
}
/* @chain-region agendaCard | calls: Math.min, icon, e, votes */ function agendaCard(a,i=0,showStatus=true){return `<article class="quest" data-status="${a.status}" style="animation-delay:${Math.min(i,5)*35}ms">${showStatus?`<span class="eyebrow">${icon(a.status==='approved'?'play':a.status==='completed'?'check':'agendas')}<i class="status-dot"></i>${names[a.status]}</span>`:''}<h3>${e(a.title)}</h3><p>${e(a.summary)}</p><div class="author">${e(a.assignee_name||a.author_name)}</div>${votes(a,'agenda')}<div class="actions"><button class="secondary" data-agenda="${a.id}">进入议程 ${icon('arrow')}</button></div></article>`;}
/* @chain-region votes | calls: icon */ function votes(item,kind){
  const total=item.votes.support+item.votes.oppose;
  return `<div class="vote-summary" aria-label="公开选票"><div class="vote-totals"><button class="vote-count" data-ballots="${kind}:${item.id}:support">${icon('like')}<b data-vote-number="${kind}:${item.id}:support">${item.votes.support}</b><span>支持</span></button><button class="vote-count oppose" data-ballots="${kind}:${item.id}:oppose">${icon('close')}<b data-vote-number="${kind}:${item.id}:oppose">${item.votes.oppose}</b><span>反对</span></button></div>${total?`<div class="vote-meter" aria-hidden="true"><i style="flex:${item.votes.support}"></i><i style="flex:${item.votes.oppose}"></i></div>`:''}</div>`;
}
/* @chain-region ballots | calls: dialog, api.call, $, join, value.votes.map, avatar, e, date … */ async function ballots(kind,id,choice,offset=0){
  const token=dialog(choice==='support'?'公开支持票':'公开反对票','<div class="loading" aria-label="读取选票"></div>');
  try{const value=await api.call(`/votes?kind=${kind}&id=${id}&choice=${choice}&offset=${offset}`);if(token!==dialogEpoch||!$('dialog').open)return;
    $('dialog-body').innerHTML=`<div class="ballot-list">${value.votes.map(v=>`<article><div class="row">${avatar(v)}<strong>${e(v.name)}</strong><time>${date(v.updated)}</time></div><p>${e(v.reason||'历史投票未填写理由')}</p></article>`).join('')||empty('暂无投票','goals')}</div>${offset||value.has_more?`<div class="pager"><button data-ballot-page="${kind}:${id}:${choice}:${Math.max(0,offset-20)}" ${offset?'':'disabled'}>上一页</button><button data-ballot-page="${kind}:${id}:${choice}:${offset+20}" ${value.has_more?'':'disabled'}>下一页</button></div>`:''}`;
  }catch(error){if(token===dialogEpoch)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" data-ballot-page="${kind}:${id}:${choice}:${offset}">重试</button>`;}
}
/* @chain-region voteActions | calls: join, map, icon */ function voteActions(item,kind,eligible){return eligible?`<section class="vote-choice" aria-label="我的投票"><div><strong>你的选择</strong><small>选票与理由公开</small></div><div class="actions">${['support','oppose'].map(choice=>`<button class="secondary vote-option ${choice}" data-vote="${kind}:${item.id}:${choice}" aria-pressed="${item.my_vote===choice}">${icon(choice==='support'?'like':'close')}${choice==='support'?'支持':'反对'}${item.my_vote===choice?' ✓':''}</button>`).join('')}${item.my_vote&&item.my_vote!=='abstain'?`<button data-withdraw="${kind}:${item.id}">撤回</button>`:''}</div></section>`:'';}

/* @chain-region goal | calls: board.candidates.find, dialog, e, detailButton, api.call, $, data.candidates.find, Error … */ async function goal(id){
  const cached=board?.candidates.find(item=>item.id===id);
  const token=dialog(cached?.title||'目标',cached?`<span class="eyebrow">${cached.adopted_rank?`已采纳 · 第 ${cached.adopted_rank} 位`:'候选目标'}</span><p>${e(cached.summary)}</p>${detailButton('验收标准',cached.acceptance,{label:'验收标准'})}<small class="record-meta">提出者：${e(cached.author_name)}</small><div class="loading" role="status" aria-label="读取最新详情"></div>`:'<div class="loading"></div>');
  try{const data=await api.call('/goals');if(token!==dialogEpoch||!$('dialog').open)return;board={...board,...data};const item=data.candidates.find(x=>x.id===id);if(!item)throw Error('目标已变更，请刷新。');
    $('dialog-title').textContent=item.title;$('dialog-body').innerHTML=`<span class="eyebrow">${item.adopted_rank?`已采纳 · 第 ${item.adopted_rank} 位`:'候选目标'}</span><p>${e(item.summary)}</p>${detailButton('验收标准',item.acceptance,{label:'验收标准'})}<small class="record-meta">提出者：${e(item.author_name)}</small>${votes(item,'goal')}${voteActions(item,'goal',data.cycle.status==='voting'&&data.cycle.closes>Date.now()/1000&&data.cycle.eligible)}<div id="engagement" class="dialog-section"></div>`;
    await discussion('goal',id,token);
  }catch(error){if(token===dialogEpoch)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" data-goal="${id}">重试</button>`;}
}
/* @chain-region agenda | calls: board.agendas.find, dialog, e, api.call, $, detailButton, date, votes … */ async function agenda(id){
  const cached=board?.agendas.find(item=>item.id===id);
  const token=dialog(cached?.title||'议程',cached?`<span class="eyebrow">${e(names[cached.status]||cached.status)}</span><p>${e(cached.summary)}</p><div class="loading" role="status" aria-label="读取最新详情"></div>`:'<div class="loading"></div>');
  try{const {agenda:a}=await api.call('/agendas/'+id);if(token!==dialogEpoch||!$('dialog').open)return;const own=a.author===state.access.user.id,assigned=a.assignee===state.access.user.id;
    $('dialog-title').textContent=a.title;$('dialog-body').innerHTML=`<span class="eyebrow">${names[a.status]}</span><p>${e(a.summary)}</p>${detailButton('开发计划',a.plan,{label:'开发计划',format:'markdown'})}${detailButton('验收标准',a.acceptance,{label:'验收标准'})}${a.status==='voting'&&a.review?.review_until?`<p class="connection-note">等待负责人确认；${date(a.review.review_until)} 到期重核三支持零反对后自动通过。</p>${a.can_confirm?`<button class="secondary" data-confirm-agenda="${a.id}">负责人授权确认</button>`:''}`:''}${a.decision?detailButton(a.status==='completed'?'完成记录':'决议',a.decision,{label:a.status==='completed'?'完成记录':'决议'}):''}${votes(a,'agenda')}${voteActions(a,'agenda',a.status==='voting'&&a.eligible)}<div class="actions">${assigned&&a.status==='approved'?`<button class="primary" data-complete="${id}">提交完成记录</button><button class="secondary" data-key="${id}">议程 Agent Key</button>`:''}${state.access.admin?`<button class="danger" data-remove-agenda="${id}">移除议程</button>`:''}</div><div id="engagement" class="dialog-section"></div>`;
    await discussion('agenda',id,token);
  }catch(error){if(token===dialogEpoch)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" data-agenda="${id}">重试</button>`;}
}
/* @chain-region discussion | calls: $, formDrafts.get, crypto.randomUUID, root.querySelector, e, api.call, icon, join … */ async function discussion(kind,id,token=dialogEpoch,before=''){
  const root=$('engagement');if(!root)return;
  const scope='comment:'+kind+':'+id,draft=formDrafts.get(scope)||{body:'',request:crypto.randomUUID()};
  if(!root.querySelector('#comment-form')){
    root.innerHTML=`<div class="row between"><h3>讨论与回应</h3><div id="discussion-likes"></div></div><div id="discussion-comments" class="comment-list"><div class="loading"></div></div><form id="comment-form"><label>回应<textarea name="body" required maxlength="3000" placeholder="提出建议、补充计划或回应讨论…">${e(draft.body)}</textarea></label><p class="error" role="alert"></p><button class="primary">发表回应</button></form>`;
    const node=$('comment-form');/* @chain-region discussion.node.oninput | calls: crypto.randomUUID, formDrafts.set */ node.oninput=()=>{draft.body=node.elements.body.value;draft.request=crypto.randomUUID();formDrafts.set(scope,draft);};
    /* @chain-region discussion.node.onsubmit | calls: event.preventDefault, node.querySelector, api.call, crypto.randomUUID, formDrafts.delete, discussion */ node.onsubmit=async event=>{event.preventDefault();const button=node.querySelector('button');if(button.disabled)return;const value=node.elements.body.value,request=draft.request;button.disabled=true;node.querySelector('.error').textContent='';
      try{await api.call('/discussions/comment',{kind,id,body:value,request_id:request});if(token!==dialogEpoch)return;if(node.elements.body.value===value){draft.body='';draft.request=crypto.randomUUID();formDrafts.delete(scope);node.elements.body.value='';}await discussion(kind,id,token);}
      catch(error){if(token===dialogEpoch)node.querySelector('.error').textContent=error.message;}finally{button.disabled=false;}
    };
  }
  try{const value=await api.call(`/discussions?kind=${kind}&id=${id}${before?'&before='+before:''}`);if(token!==dialogEpoch||!root.isConnected)return;
    $('discussion-likes').innerHTML=`<button class="secondary" data-like="${kind}:${id}:${!value.liked}" aria-pressed="${value.liked}">${icon('like')}赞 ${value.likes}</button>`;
    $('discussion-comments').innerHTML=`${value.has_more?`<button class="secondary" data-discussion-before="${kind}:${id}:${value.before}">更早的回应</button>`:''}${value.comments.map(c=>`<article><div class="row between"><div class="row">${avatar(c)}<strong>${e(c.name)}</strong></div><small>${date(c.created)}</small></div><div class="comment-body">${c.body.length>280?`<p>${e(c.body.slice(0,180))}…</p>${detailButton(c.name+' · 完整回应',c.body,{label:'查看全文',format:'markdown'})}`:`<div class="markdown">${markdown(c.body)}</div>`}</div>${state.access.admin?`<button class="danger" data-remove-comment="${kind}:${id}:${c.id}">移除</button>`:''}</article>`).join('')||empty('暂无讨论','chat')}${before?`<button data-discussion-before="${kind}:${id}:">最新回应</button>`:''}`;
  }catch(error){if(token===dialogEpoch&&root.isConnected)$('discussion-comments').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" data-discussion-before="${kind}:${id}:${before}">重试</button>`;}
}
/* @chain-region showDecision | calls: date, JSON.stringify, dialog, join, value.payload.goal_ids.map, e, electionData.pool.find */ function showDecision(value){
  const text=`请先核对 Link 授权内容，再由本人 Agent 执行。\n授权 ID：${value.authorization_id}\n有效至：${date(value.expires)}\n动作：${value.action}\n精确内容：${JSON.stringify(value.payload)}\n读取：election --resource authorization --id "${value.authorization_id}"\n将 {"request_id":"decision-${value.authorization_id}","authorization_id":"${value.authorization_id}"} 保存为执行.json，再运行 election --action execute --body-file "执行.json"。`;
  dialog('已授权，等待 Agent 执行',`<p>授权有效期 10 分钟</p>${value.action==='select-goals'?`<h3>本次选择 ${value.payload.goal_ids.length} 项目标</h3><ul>${value.payload.goal_ids.map(id=>`<li>${e(electionData?.pool.find(p=>p.candidate_id===id)?.title||id)}</li>`).join('')}</ul><p>${e(value.payload.reason)}</p>`:`<p>本次授权：${e({'confirm-agenda':'确认当前议程','engineering.integrate':'整合固定候选','engineering.accept-goal':'验收阶段目标','engineering.freeze':'进入集中 Debug','engineering.release':'发布精确版本','engineering.transfer':'邀请接手议程'}[value.action]||value.action)}</p><p>${e(value.payload.summary||value.payload.reason||value.payload.notes||'')}</p>`}<details><summary>Agent 执行说明</summary><pre id="decision-instructions" class="engineering-guide">${e(text)}</pre></details><p id="decision-status" role="status"></p><div class="actions"><button class="primary" data-action="decision-copy">复制给 Agent</button><button class="secondary" data-decision-check="${value.authorization_id}">核对执行结果</button></div>`);
}
/* @chain-region showCandidate | calls: dialog, api.call, $, roleName, e, detailButton, join, data.votes.map … */ async function showCandidate(id,offset=0){
  const token=dialog('参选方案','<div class="loading"></div>');
  try{const data=await api.call('/elections/candidate?id='+id+'&offset='+offset);if(token!==dialogEpoch)return;const c=data.candidate;
    $('dialog-title').textContent=c.name+' · '+roleName(c.role);$('dialog-body').innerHTML=`<p>${e(c.statement)}</p><p>${e(c.commitment)}</p><h3>${e(c.goal_title)}</h3><h4>${e(c.agenda_title)}</h4><p>${e(c.agenda_summary)}</p>${detailButton('配套议程 · 开发计划',c.agenda_plan,{label:'开发计划',format:'markdown'})}${detailButton('配套议程 · 验收标准',c.agenda_acceptance,{label:'验收标准'})}<h3>公开职位票</h3><div class="ballot-list">${data.votes.map(v=>`<article><div class="row"><strong>${e(v.name)}</strong><time>${date(v.updated)}</time></div><p>${e(v.reason)}</p></article>`).join('')||'<p class="muted">暂无职位票</p>'}</div>${offset||data.has_more?`<div class="pager"><button data-candidate-page="${id}:${Math.max(0,offset-20)}" ${offset?'':'disabled'}>上一页</button><button data-candidate-page="${id}:${offset+20}" ${data.has_more?'':'disabled'}>下一页</button></div>`:''}`;
  }catch(error){if(token===dialogEpoch)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p>`;}
}
/* @chain-region selectElectionGoals | calls: dialog, api.call, Error, $, join, data.pool.map, e */ async function selectElectionGoals(){
  const token=dialog('选择高票目标','<div class="loading"></div>'),data=await api.call('/elections');if(token!==dialogEpoch)return;
  if(!data.can_select)throw Error('当前无法选择目标，请核对任期和本轮状态。');
  $('dialog-body').innerHTML=`<form id="selection-form">${data.pool.map(p=>`<fieldset><label class="selection-option"><input type="checkbox" name="goal" value="${p.candidate_id}" checked>${e(p.title)}</label><label>不选时的暂缓原因<textarea name="defer-${p.candidate_id}" maxlength="500"></textarea></label></fieldset>`).join('')}<label>本次选择理由<textarea name="reason" required minlength="2" maxlength="1000"></textarea></label><p class="error" role="alert"></p><button class="primary">授权 Agent 选择</button></form>`;
  const node=$('selection-form');/* @chain-region selectElectionGoals.node.onsubmit | calls: event.preventDefault, node.querySelector, FormData, values.getAll, Error, ids.includes, trim, String … */ node.onsubmit=async event=>{event.preventDefault();const button=node.querySelector('button');if(button.disabled)return;button.disabled=true;
    try{const values=new FormData(node),ids=values.getAll('goal');if(!ids.length)throw Error('至少选择一个目标。');const deferred={};for(const p of data.pool)if(!ids.includes(p.candidate_id)){const reason=String(values.get('defer-'+p.candidate_id)||'').trim();if(reason.length<2)throw Error('请为暂缓目标写明原因。');deferred[p.candidate_id]=reason;}
      const value=await api.call('/elections/authorize',{cycle_id:data.cycle.id,version:data.version,action:'select-goals',payload:{goal_ids:ids,reason:values.get('reason'),deferred_reasons:deferred}});if(token===dialogEpoch)showDecision(value);
    }catch(error){if(node.isConnected)node.querySelector('.error').textContent=error.message;}finally{button.disabled=false;}
  };
}
/* @chain-region repositoryView | calls: shell, $, project, Promise.allSettled, api.development, api.call, workspace.querySelector, paintDevelopment … */ async function repositoryView(epoch){
  shell('','','','repository');
  if(!$('repository-host'))project($('content'),'<section id="repository-versions" aria-label="版本通道"></section><div id="update-channels"></div><div id="development-host"></div><div id="repository-host"></div>');
  const [local,remote,channels]=await Promise.allSettled([api.development('status'),api.call('/engineering/repository?offset=0'),api.call('/engineering/updates')]);
  if(epoch!==viewEpoch)return;
  const surface=workspace.querySelector('.surface');let failure;
  if(local.status==='fulfilled'){paintDevelopment(local.value);surface.dataset.loaded='true';}else failure=local.reason;
  if(remote.status==='rejected')throw remote.reason;
  const data=remote.value;developmentCloudRevision=data.repository.development??data.repository.cloud;paintDevelopment(developmentState);
  if(channels.status==='fulfilled'){
    updateChannels=channels.value;
    const dev=updateChannels.development,stable=updateChannels.stable;
    const build=updateChannels.builds?.find(item=>item.revision===dev?.revision&&item.commit_id===dev?.commit_id&&item.sequence>(stable?.sequence||0));
    const commit=updateChannels.can_commit&&updateChannels.cloud!==dev?.revision;
    project($('update-channels'),`<section class="update-streams"><div><h3>开发版</h3><code>${e(dev?.commit_id.slice(0,12)||'尚未提交')}</code>${commit?'<button class="primary" data-action="channel-commit">提交开发版</button>':''}</div><div><h3>稳定版</h3><code>${e(stable?.build_id||'沿用线上稳定版')}</code>${updateChannels.can_sync&&build?`<button class="primary" data-action="channel-sync" data-build="${e(build.id)}">同步 ${e(build.id)}</button>`:''}</div></section>`);
  }else{updateChannels=null;failure||=channels.reason;}
  project($('repository-versions'),versionTrackHTML(data.repository,repositoryStatus));
  await sourceBrowser.mount($('repository-host'),data.repository.cloud);if(epoch!==viewEpoch)return;
  if(data.repository.workflow_protocol>=2){
    const [flow]=await Promise.allSettled([api.call('/engineering/workflow?repository_status=1')]);
    if(epoch!==viewEpoch)return;
    if(flow.status==='fulfilled'){
      repositoryStatus=flow.value;
      project($('repository-versions'),versionTrackHTML(data.repository,repositoryStatus));
    }else failure||=flow.reason;
  }
  surface.dataset.loaded='true';if(failure)throw failure;
}

/* @chain-region submitChannel | calls: JSON.stringify, crypto.randomUUID, api.call, render */ async function submitChannel(route,payload){
  const intent=JSON.stringify([state.generation,route,payload]);
  if(pendingChannelRequest?.intent!==intent)pendingChannelRequest={intent,id:crypto.randomUUID()};
  await api.call(route,{...payload,request_id:pendingChannelRequest.id});
  pendingChannelRequest=null;await render();
}
/* @chain-region chatView | calls: shell, $, updateChat, classList.add, workspace.querySelector, icon, updateChatLength, addEventListener … */ async function chatView(epoch){
  const created=shell('','','','chat');
  if(!created&&$('chat-input')){await updateChat(false,epoch);return;}
  workspace.querySelector('.surface').classList.add('chat-surface');
  $('content').outerHTML=`<div id="chat-log" class="chat-log" aria-live="polite" aria-relevant="additions"></div><button class="new-messages" data-action="chat-bottom" hidden>查看新消息 ↓</button><form id="composer" class="composer"><div id="attachment-preview" class="attachment-preview"></div><div id="chat-preview" class="chat-preview markdown" hidden></div><textarea id="chat-input" maxlength="6000" placeholder="分享开发进展、代码或想法（至少30字）" aria-label="群聊消息"></textarea><p id="chat-error" class="compose-error" role="alert"></p><footer><div class="actions"><button type="button" id="image-choose" class="secondary" aria-label="添加图片">${icon('image')}</button><button type="button" data-action="preview" class="secondary" aria-pressed="false">预览</button><small id="chat-length" aria-live="polite"></small><input type="file" id="image-input" accept="image/png,image/jpeg,image/webp" multiple hidden></div><button class="primary" id="send">发送 ${icon('send')}</button></footer></form>`;
  $('chat-input').value=draftText;/* @chain-region chatView.oninput | calls: updateChatLength */ $('chat-input').oninput=event=>{draftText=event.target.value;draftId='';updateChatLength();};updateChatLength();
  /* @chain-region chatView.onkeydown | calls: event.preventDefault, requestSubmit, $ */ $('chat-input').onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();$('composer').requestSubmit();}};
  /* @chain-region chatView.onclick | calls: click, $ */ $('image-choose').onclick=()=>$('image-input').click();/* @chain-region chatView.onchange | calls: attach */ $('image-input').onchange=event=>void attach([...event.target.files]);$('composer').onsubmit=send;
  $('chat-input').addEventListener('paste',event=>{const files=[...(event.clipboardData?.files||[])];if(files.length){event.preventDefault();void attach(files);}});
  /* @chain-region chatView.onscroll | calls: $, workspace.querySelector */ $('chat-log').onscroll=()=>{const log=$('chat-log');if(log.scrollHeight-log.scrollTop-log.clientHeight<70)workspace.querySelector('.new-messages').hidden=true;};
  previewImages();await updateChat(true,epoch);
}
/* @chain-region previewImages | calls: $, join, draftImages.map */ function previewImages(){if(!$('attachment-preview'))return;$('attachment-preview').innerHTML=draftImages.map((image,i)=>`<div><img src="${image.preview}" alt="待发送图片"><button type="button" data-image-remove="${i}" aria-label="移除图片">×</button></div>`).join('');}
/* @chain-region attach | calls: Error, includes, createImageBitmap, Math.min, document.createElement, Math.max, Math.round, drawImage … */ async function attach(files){
  if(attachBusy||chatBusy)return;attachBusy=true;const generation=state.generation;
  try{if(draftImages.length+files.length>4)throw Error('每条消息最多4张图片。');for(const source of files){
    if(source.size>20*1024*1024||!['image/png','image/jpeg','image/webp'].includes(source.type))throw Error('请选择20MB以内的PNG、JPEG或WebP图片。');
    const bitmap=await createImageBitmap(source);let scale=Math.min(1,1600/bitmap.width,1600/bitmap.height),blob;
    try{for(let attempt=0;attempt<7;attempt++){const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(blob&&blob.size<=524288)break;scale*=.7;}}finally{bitmap.close();}
    if(!blob||blob.size>524288)throw Error('图片压缩失败，请选择较小图片。');
    const bytes=new Uint8Array(await blob.arrayBuffer()),digest=await crypto.subtle.digest('SHA-256',bytes),sha=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(generation!==state.generation)return;let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    draftImages.push({bytes,sha,preview:'data:image/png;base64,'+btoa(binary),request:crypto.randomUUID()});
  }draftId='';previewImages();
  }catch(error){if(generation===state.generation)notice(error.message);}finally{attachBusy=false;if($('image-input'))$('image-input').value='';}
}
const /* @chain-region chatLength | calls: Array.from, text.replace */ chatLength=text=>Array.from(text.replace(/[\s\u001c-\u001f\u0085]/gu,'')).length;
/* @chain-region updateChatLength | calls: chatLength, $ */ function updateChatLength(){const count=chatLength(draftText);if($('chat-length'))$('chat-length').textContent=count<30?`${count} / 30 字`:`${count} 字`;if($('send'))$('send').disabled=chatBusy||count<30;}
/* @chain-region send | calls: event.preventDefault, chatLength, $, setAttribute, crypto.randomUUID, api.call, image.bytes.slice, String.fromCharCode … */ async function send(event){
  event.preventDefault();if(chatBusy||attachBusy)return;if(chatLength(draftText)<30){$('chat-error').textContent='正文至少30字';return;}
  chatBusy=true;$('send').disabled=true;$('send').setAttribute('aria-busy','true');$('chat-error').textContent='';
  const generation=state.generation,text=draftText,images=[...draftImages],request=draftId||=crypto.randomUUID();
  try{
    const assets=[];
    for(const image of images){
      if(!image.id){const upload=await api.call('/chat/uploads',{request_id:image.request,size:image.bytes.length,sha256:image.sha});let offset=upload.received;
        while(offset<image.bytes.length){const part=image.bytes.slice(offset,offset+16384);let binary='';for(const byte of part)binary+=String.fromCharCode(byte);offset=(await api.call('/chat/uploads/'+upload.id+'/chunk',{offset,data:btoa(binary)})).received;}
        image.id=(await api.call('/chat/uploads/'+upload.id+'/complete',{})).id;
      }assets.push(image.id);
    }
    if(generation!==state.generation)return;
    await api.call('/chat/messages',{body:text,attachments:assets,request_id:request});if(generation!==state.generation)return;
    if(draftText===text){draftText='';if($('chat-input'))$('chat-input').value='';}
    draftImages=draftImages.filter(image=>!images.includes(image));if(draftId===request)draftId='';previewImages();
    if(tab==='chat')await updateChat(false);
  }catch(error){if(generation!==state.generation)return;if($('chat-error'))$('chat-error').textContent=error.message;else notice(error.message);}
  finally{if(generation===state.generation){chatBusy=false;if($('send')){$('send').removeAttribute('aria-busy');updateChatLength();}}}
}
/* @chain-region updateChat | calls: $, loadChat */ async function updateChat(reset=false,epoch=viewEpoch,before){
  if(chatFlight){await chatFlight;if(epoch!==viewEpoch||!$('chat-log'))return;}
  const job=loadChat(reset,epoch,before);chatFlight=job;
  try{await job;}finally{if(chatFlight===job)chatFlight=null;}
}
/* @chain-region loadChat | calls: api.call, $, chatRows.clear, chatRows.set, Math.max, chatRows.values, chatRows.delete, sort … */ async function loadChat(reset,epoch,before){
  const data=await api.call('/chat/messages'+(before?'?before='+before:!reset&&chatCursor?'?after='+chatCursor:''));if(epoch!==viewEpoch||!$('chat-log'))return;
  if(reset){chatRows.clear();chatCursor=0;}
  for(const message of data.messages){chatRows.set(message.seq,message);chatCursor=Math.max(chatCursor,message.seq);}
  for(const id of data.removed||[])for(const message of chatRows.values())if(message.id===id){message.removed=true;message.body='';message.attachments=[];}
  // Cap retained history at 150 while preserving the requested earlier range.
  while(chatRows.size>150)chatRows.delete([...chatRows.keys()].sort((a,b)=>before?b-a:a-b)[0]);
  const log=$('chat-log'),bottom=log.scrollHeight-log.scrollTop-log.clientHeight<70;
  const anchor=[...log.querySelectorAll('.message')].find(node=>node.getBoundingClientRect().bottom>=log.getBoundingClientRect().top);
  const anchorTop=anchor?.getBoundingClientRect().top,rows=[...chatRows.values()].sort((a,b)=>a.seq-b.seq),ids=new Set(rows.map(row=>row.id));
  for(const node of log.querySelectorAll('.message'))if(!ids.has(node.dataset.message))node.remove();
  log.querySelector('.empty')?.remove();
  let more=log.querySelector('[data-chat-before]');
  if(rows.length){if(!more){more=document.createElement('button');more.className='secondary';more.textContent='更早的消息';log.prepend(more);}more.dataset.chatBefore=rows[0].seq;more.disabled=rows[0].seq<=1;}
  let previous=more,newCount=0;
  for(const m of rows){
    let node=log.querySelector(`[data-message="${m.id}"]`);const fingerprint=JSON.stringify([m,state.access.admin]);
    if(!node){
      node=document.createElement('article');node.className='message';node.dataset.message=m.id;newCount++;
      if(!reset&&!before&&!m.removed&&!document.hidden){
        node.dataset.arrival='true';
        const messageNode=node;
        setTimeout(()=>{delete messageNode.dataset.arrival;},900);
      }
    }
    if(node.__projection!==fingerprint){
      node.dataset.own=String(m.author.id===state.access.user.id);
      node.innerHTML=`${avatar(m.author)}<div><header><strong ${userAttributes(m.author)}>${e(m.author.name)}</strong><time>${date(m.created)}</time>${state.access.admin&&!m.removed?`<button class="danger" data-remove-chat="${m.id}">移除</button>`:''}</header>${m.removed?'<p class="muted">此消息已由管理员移除</p>':`<div class="markdown">${markdown(m.body)}</div><div class="message-images">${m.attachments.map(id=>`<span data-asset="${id}">加载图片…</span>`).join('')}</div>`}</div>`;
      node.__projection=fingerprint;
    }
    if(previous?.nextElementSibling!==node){if(previous)previous.after(node);else log.prepend(node);}previous=node;
  }
  if(!rows.length)log.innerHTML=empty('分享你的第一条开发进展。','chat');
  if(epoch!==viewEpoch)return;
  if(reset||bottom&&!before)log.scrollTop=log.scrollHeight;
  else if(anchor?.isConnected)log.scrollTop+=anchor.getBoundingClientRect().top-anchorTop;
  if(!bottom&&!reset&&!before&&newCount){
    const badge=workspace.querySelector('.new-messages');
    const pending=(badge.hidden?0:Number(badge.dataset.count)||0)+newCount;
    badge.dataset.count=String(pending);
    badge.textContent=`查看 ${pending} 条新消息 ↓`;
    badge.hidden=false;
  }
  void loadChatImages(log,state.generation);
}
/* @chain-region chatAsset | calls: chatAssets.has, chatAssets.get, chatAssetFlights.get, api.call, chatAssetFlights.set, test, Error, chatAssets.delete … */ async function chatAsset(id){
  if(chatAssets.has(id))return chatAssets.get(id);
  let flight=chatAssetFlights.get(id);
  if(!flight){flight=api.call('/chat/assets/'+id);chatAssetFlights.set(id,flight);}
  try{
    const asset=await flight;
    if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(asset.data))throw Error('图片格式无效');
    if(chatAssetFlights.get(id)===flight){
      if(chatAssets.size>=80)chatAssets.delete(chatAssets.keys().next().value);
      chatAssets.set(id,asset);
    }
    return asset;
  }finally{if(chatAssetFlights.get(id)===flight)chatAssetFlights.delete(id);}
}
/* @chain-region loadChatImages | calls: log.querySelectorAll, Promise.all, Array.from, Math.min */ async function loadChatImages(log,generation){
  const nodes=[...log.querySelectorAll('[data-asset]:not([data-loading])')];let next=0;
  const /* @chain-region loadChatImages.worker | calls: chatAsset, node.removeAttribute, document.createElement, img.decode, node.getBoundingClientRect, log.getBoundingClientRect, node.replaceWith */ worker=async()=>{
    while(next<nodes.length){
      const node=nodes[next++],id=node.dataset.asset;node.dataset.loading='true';
      try{
        const asset=await chatAsset(id);
        if(generation!==state.generation||!node.isConnected){node.removeAttribute('data-loading');continue;}
        const img=document.createElement('img');img.src=asset.data;img.alt='开发者分享的图片';
        /* @chain-region loadChatImages.worker.img.onclick | calls: dialog */ img.onclick=()=>dialog('图片',`<img src="${asset.data}" alt="开发者分享的图片" style="max-width:100%">`);
        await img.decode();
        if(generation!==state.generation||!node.isConnected){node.removeAttribute('data-loading');continue;}
        const atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<70;
        const above=node.getBoundingClientRect().top<log.getBoundingClientRect().top,oldHeight=log.scrollHeight;
        node.replaceWith(img);
        if(atBottom)log.scrollTop=log.scrollHeight;
        else if(above)log.scrollTop+=log.scrollHeight-oldHeight;
      }catch{node.removeAttribute('data-loading');if(generation===state.generation&&node.isConnected)node.textContent='图片暂不可用';}
    }
  };
  await Promise.all(Array.from({length:Math.min(4,nodes.length)},worker));
}
/* @chain-region managed | calls: action */ async function managed(action){if(state.access?.admin)await action();}
/* @chain-region moderateMember | calls: api.call, projectGovernanceHTML, project, $, managed, crypto.randomUUID, form, Number … */ async function moderateMember(member,action){
  if(!state.access?.admin&&!state.access?.project_manager)return;
  const offset=governanceOffset;
  const page=await api.call('/elections/management?offset='+offset);
  if(epoch!==viewEpoch||offset!==governanceOffset)return;
  governancePage=page;
  const projectPanel=projectGovernanceHTML(page,offset,e);
  if(!state.access.admin){project($('content'),projectPanel);return;}
  const label={ban:'封禁',unban:'解除封禁',mute:'禁言',unmute:'解除禁言'}[action];if(!label)return;
  await managed(()=>{
    const request_id=crypto.randomUUID(),fields=[...(action==='mute'?[{name:'duration',label:'时长',value:'3600',options:[['600','10 分钟'],['3600','1 小时'],['86400','1 天'],['604800','7 天']]}]:[]),{name:'reason',label:'原因',min:2,max:1000}];
    form(label+' · '+member.name,fields,async values=>{await api.call('/admin/users/moderate',{id:member.id,action,reason:values.reason,request_id,...(action==='mute'?{duration:Number(values.duration)}:{})});await refresh();},label,'moderate:'+member.id+':'+action);
  });
}
/* @chain-region managementView | calls: shell, URLSearchParams, map, Object.entries, Promise.all, api.call, project, $ … */ async function managementView(epoch){
  shell('','','','management');
  if(!state.access?.admin)return;
  const query=new URLSearchParams(Object.entries(managementOffsets).map(([key,value])=>[key+'_offset',value]));
  const [data,applications]=await Promise.all([api.call('/admin/overview?dashboard=1&'+query),api.call('/admin/applications?offset='+managementOffsets.applications)]);
  if(epoch!==viewEpoch||offset!==governanceOffset)return;data.offsets={...managementOffsets};
  project($('content'),projectPanel+managementHTML(data,applications,{attributes:userAttributes,avatar,date,auditHTML}));
}
document.addEventListener('click',async event=>{
  const carousel=event.target.closest('[data-carousel]');if(carousel){const [name,action]=carousel.dataset.carousel.split(':');(name==='situation'?situationCarousel:conversationCarousel).action(action);return;}
  const section=event.target.closest('[data-home-section]');
  if(section){
    const target=$('home-'+section.dataset.homeSection);
    target?.focus({preventScroll:true});
    target?.scrollIntoView({block:'start'});
    return;
  }
  const filter=event.target.closest('[data-milestone-view]');
  if(filter){
    homeMilestoneView=filter.dataset.milestoneView;
    const feed=filter.closest('.home-milestones');
    feed.dataset.view=homeMilestoneView;
    feed.querySelector('ol').scrollTop=0;
    for(const button of feed.querySelectorAll('[data-milestone-view]')){
      button.setAttribute('aria-pressed',String(button===filter));
    }
    return;
  }
  const button=event.target.closest('button');if(!button||button.disabled)return;const d=button.dataset,action=d.action;
  try{
    if(d.governPage!==undefined){governanceOffset=Number(d.governPage);await render();return;}
    if(d.govern){
      const editor=governanceForm(governancePage,d);if(!editor)return;
      const request_id=crypto.randomUUID();
      form(editor.title,editor.fields,async values=>{
        await api.call('/elections/manage',{...editor.payload(values),request_id});await render();
      },'确定',d.govern+':'+d.row);return;
    }
    if(action==='channel-commit'&&updateChannels?.can_commit){
      const snapshot=updateChannels,build=snapshot.builds.find(item=>item.revision===snapshot.cloud);
      form('提交开发版',[{name:'commit',label:'Git 提交',short:true,min:40,max:64,value:build?.commit_id||''}],async values=>{
        await submitChannel('/engineering/updates/commit',{revision:snapshot.cloud,commit_id:values.commit.trim(),expected_sequence:snapshot.development?.sequence||0});
        notice('开发版已更新');
      },'提交');return;
    }
    if(action==='channel-sync'&&updateChannels?.can_sync){
      const snapshot=updateChannels,dev=snapshot.development;
      button.disabled=true;
      try{await submitChannel('/admin/engineering/updates/sync',{revision:dev.revision,commit_id:dev.commit_id,build_id:d.build,expected_sequence:snapshot.stable?.sequence||0});notice('稳定版已同步');}
      finally{if(button.isConnected)button.disabled=false;}return;
    }
    if(d.member){const member=homeData?.members?.members.find(m=>m.id===d.member);if(member)dialog(member.name,`<div class="profile">${avatar(member)}<p>${e(member.bio||'')}</p></div>`);return;}
    if(d.managementPage){const [kind,offset]=d.managementPage.split(':');if(Object.hasOwn(managementOffsets,kind))managementOffsets[kind]=Number(offset);await render();return;}
    if(d.releaseVote){const [id,choice]=d.releaseVote.split(':');button.disabled=true;try{await api.call('/engineering/releases/vote',{id,choice,request_id:crypto.randomUUID()});await render();}finally{if(button.isConnected)button.disabled=false;}return;}
    if(action==='propose-stable'){form('提交稳定版投票',[{name:'name',label:'发布名称',short:true,max:80},{name:'notes',label:'发布说明',min:10,max:3000}],async values=>{await api.call('/engineering/releases/propose',{...values,revision:developmentCloudRevision,request_id:crypto.randomUUID()});await render();},'提交投票');return;}
    if(d.moderateUser){await moderateMember({id:d.moderateUser,name:d.moderateName},d.moderateAction);return;}
    if(d.development){button.disabled=true;try{const result=await api.development(d.development);if(d.development!=='open-source')paintDevelopment(result);}finally{if(button.isConnected)button.disabled=false;}return;}
    if(action==='development-logs'||d.developmentLog!==undefined){
      const token=action==='development-logs'?dialog('运行日志','<div class="loading"></div>'):dialogEpoch;
      if(action==='development-logs'){developmentLogCursors=[0];developmentLogIndex=0;}
      else if(d.developmentLog==='previous')developmentLogIndex=Math.max(0,developmentLogIndex-1);
      else{developmentLogIndex++;developmentLogCursors[developmentLogIndex]=Number(d.developmentLog);}
      const value=await api.development('logs',developmentLogCursors[developmentLogIndex]);
      if(token===dialogEpoch&&$('dialog').open)project($('dialog-body'),developmentLogsHTML(value,developmentLogIndex>0));return;
    }
    if(action==='broadcast'){
      if(!state.access?.member)return;
      if(button.id==='broadcast-preview')$('broadcast-button').focus({preventScroll:true});
      hideBroadcastPreview();
      dialog('共创动态',broadcastHTML(broadcastItems,date));
      paintBroadcast();
      await readBroadcast();
      return;
    }
    if(action==='system-settings'){dialog('系统设置',appearance.html());return;}
    if(action==='background-menu'){appearance.toggleMenu();return;}
    if(d.backgroundMode){appearance.selectMode(d.backgroundMode);return;}
    if(d.wallpaper){appearance.save({mode:'fixed',selected:d.wallpaper});appearance.syncControls();return;}
    if(action==='background-next'){const wasRandom=appearance.settings.mode==='random';appearance.save({mode:'random'},true);if(wasRandom)void appearance.next(true);appearance.syncControls();return;}
    if(action==='appearance-reset'){appearance.save({...appearanceDefaults});appearance.syncControls();return;}
    if(d.readBody!==undefined){detailView.open(button);return;}
    if(d.window){await api.window(d.window);return;}if(d.tab){await navigate(d.tab);return;}
    if(d.workHome){home=d.workHome;await navigate('home');return;}
    if(d.stationBrief){
      if(d.stationBrief==='local'){const report=stationSnapshot?.snapshot?.agents?.[0]?.runtime?.work_report;dialog('当前任务简报',`<h3>${e(report?.task||'暂无当前任务')}</h3><p class="inbox-body">${e(report?.summary||'Agent 尚未汇报当前工作。')}</p>`);return;}
      const token=dialog('当前任务简报','<div class="loading" role="status" aria-label="读取任务简报"></div>');
      try{const value=await api.call('/engineering/brief?id='+d.stationBrief);if(token===dialogEpoch&&$('dialog').open)dialog('当前任务简报',briefHTML(value));}catch(error){if(token===dialogEpoch&&$('dialog').open)project($('dialog-body'),errorHTML(error));}return;
    }
    if(d.action==='activity-older'){activitySource='cloud';await activityHistory(0,stationSnapshot?.operations?.next_before||0);return;}
    if(d.activitySource){activitySource=d.activitySource;await activityHistory(0,0);return;}
    if(d.activityPage!==undefined){await activityHistory(Number(d.activityPage));return;}
    if(d.inboxPage!==undefined||d.inboxEvent){
      const event=Number(d.inboxEvent||0),after=Number(d.inboxPage||0);
      const token=dialog(event?'协作事件':'协作收件','<div class="loading" role="status" aria-label="读取收件"></div>');
      try{const value=await api.call('/engineering/events?view=inbox&state=all&'+(event?'seq='+event:'after='+after));
        if(token===dialogEpoch&&$('dialog').open)dialog(event?'协作事件':'协作收件',event?(value.events[0]?eventHTML(value.events[0]):'<p>事件已过期</p>'):inboxHTML(value));
      }catch(error){if(token===dialogEpoch&&$('dialog').open)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" ${event?`data-inbox-event="${event}"`:`data-inbox-page="${after}"`}>重试</button>`;}
      return;
    }
    if(d.task){const token=dialog('任务详情','<div class="loading" role="status" aria-label="读取任务"></div>');try{const value=await api.call('/engineering/task?id='+d.task);let extra='';try{extra=planHTML(await api.call('/engineering/live/plan?task_id='+d.task));}catch{}if(token===dialogEpoch&&$('dialog').open)dialog(value.task.title,taskHTML(value.task,value.task.owner===state.access.user.id)+extra+(value.task.owner===state.access.user.id?`<button class="secondary" data-live-context="${e(d.task)}">当前工作定义与恢复</button>`:''));}catch(error){if(token===dialogEpoch&&$('dialog').open)$('dialog-body').innerHTML=`<p class="error">${e(error.message)}</p><button class="secondary" data-task="${e(d.task)}">重试</button>`;}return;}
    if(d.taskBrief){const value=await api.call('/engineering/brief?id='+d.taskBrief);const text=JSON.stringify(value,null,2);if(text.length>6000){dialog('任务简报',`<pre class="engineering-guide">${e(text)}</pre>`);}else{await api.copy(text);notice('任务简报已复制');}return;}
    if(d.myTasks){await myTasksDialog(d.myTasks);return;}
    if(d.taskRecords){await taskRecordsDialog(d.taskRecords);return;}
    if(d.taskPage!==undefined){taskPage=Number(d.taskPage);await render();return;}
    if(d.snapshotPage!==undefined){snapshotPage=Number(d.snapshotPage);await render();return;}
    if(d.snapshot){await snapshotDialog(d.snapshot,0,d.fromTask,Number(d.taskOffset||0));return;}
    if(d.snapshotMore){await snapshotDialog(d.snapshotMore,Number(d.offset),d.fromTask,Number(d.taskOffset||0));return;}
    if(d.snapshotFile){await sourceDialog(d.snapshotFile,d.revision);return;}
    if(d.engineeringIntegrate){await engineeringDecision('engineering.integrate',{revision:d.engineeringIntegrate});return;}
    if(d.acceptGoal){await engineeringDecision('engineering.accept-goal',{goal_id:d.acceptGoal});return;}
    if(d.engineeringFreeze){await engineeringDecision('engineering.freeze');return;}
    if(d.engineeringRelease){await chooseRelease(d.engineeringRelease);return;}
    if(d.releaseBuild){const token=dialogEpoch,generation=state.generation,flow=await api.call('/engineering/workflow'),proofs=await releaseBuilds(flow.repository.cloud,Number(d.offset||0));if(token!==dialogEpoch||generation!==state.generation||!$('dialog').open)return;const r=proofs.reports.find(v=>v.id===d.releaseBuild);if(!r||!proofs.latest.includes(r.id))throw Error('构建记录已更新，请重新选择。');await engineeringDecision('engineering.release',{channel:d.channel,builder:r.reviewer,verification_id:r.id,artifacts:r.evidence.execution.artifacts});return;}
    if(d.verificationPage!==undefined){await workflowRecords('verifications',Number(d.verificationPage),d.revision||button.closest('[data-verification-revision]')?.dataset.verificationRevision||'');return;}
    if(d.releasesPage!==undefined){await workflowRecords('releases',Number(d.releasesPage));return;}
    if(d.handoffsPage!==undefined){await workflowRecords('handoffs',Number(d.handoffsPage));return;}
    if(d.buildsPage!==undefined){await chooseRelease(d.channel,Number(d.buildsPage));return;}
    if(d.artifactDownload){await api.releaseDownload(d.release,d.artifactDownload);return;}
    if(d.artifactCancel!==undefined){await api.cancelReleaseDownload();return;}
    if(d.artifactReveal){await api.revealReleaseDownload(d.release,d.artifactReveal);return;}
    if(action==='release-transfer'){if(releaseTransfer?.generation===state.generation)await openRelease(releaseTransfer.id);return;}
    if(d.engineeringReleaseId){await openRelease(d.engineeringReleaseId);return;}
    if(action==='live-overview'){await liveDialog();return;}
    if(d.liveRoom){await liveDialog('room',d.liveRoom,Number(d.after||0));return;}
    if(d.liveContext){await liveDialog('context',d.liveContext);return;}
    if(d.livePage){await liveDialog(d.livePage,'',Number(d.offset||0));return;}
    if(d.localRun){await localRunDialog(d.localRun);return;}
    if(d.localLog){await localRunDialog(d.localLog,Number(d.logOffset));return;}
    if(d.localPreview){await api.localPreviewOpen(d.localPreview);notice('本地预览已打开');return;}
    if(action==='local-engineering'){await localEngineeringDialog();return;}
    if(action==='engineering-handoffs'){await workflowRecords('handoffs');return;}
    if(d.promoteSnapshot){await managed(()=>form('整合到云代码',[{name:'reason',label:'审阅结论与整合理由',min:10,max:1000}],async values=>{await api.call('/admin/engineering/promote',{revision:d.promoteSnapshot,version:Number(d.repositoryVersion),reason:values.reason});await render();notice('候选已整合到云代码');},'确认整合'));return;}
    if(d.agentRevoke){dialog('撤销 Agent 接入',`<p>撤销后此 Agent 的提案凭据立即失效。</p><div class="actions"><button class="danger" data-agent-revoke-confirm="${d.agentRevoke}">确认撤销</button></div>`);return;}
    if(d.agentRevokeConfirm){await api.call('/agents/revoke',{id:d.agentRevokeConfirm});$('dialog').close();await render();return;}
    if(d.home){home=d.home;await render();return;}if(d.lane){lane=d.lane;await render();return;}if(d.repo){repo=d.repo;await render();return;}
    if(d.memberPage){memberPage=Math.max(0,memberPage+Number(d.memberPage));await render();return;}
    if(d.adminTab){adminTab=d.adminTab;adminPage=0;await render();return;}if(d.adminPage){adminPage=Math.max(0,adminPage+Number(d.adminPage));await render();return;}
    
    if(d.ballots){await ballots(...d.ballots.split(':'));return;}if(d.ballotPage){const [kind,id,choice,offset]=d.ballotPage.split(':');await ballots(kind,id,choice,Number(offset));return;}
    if(d.vote){const [kind,id,choice]=d.vote.split(':');form(choice==='support'?'支持 · 公开理由':'反对 · 公开理由',[{name:'reason',label:'理由（所有成员可见）',max:1000}],async values=>{await api.call(kind==='goal'?'/goals/vote':'/agendas/'+id+'/vote',{...values,choice,...(kind==='goal'?{cycle_id:board.cycle.id,candidate_id:id}:{})});await render();},'确认投票','vote:'+kind+':'+id+':'+choice);return;}
    if(d.goal){await goal(d.goal);return;}
    if(d.discussionBefore){const [kind,id,before]=d.discussionBefore.split(':');await discussion(kind,id,dialogEpoch,before);return;}
    if(d.like){const [kind,id,liked]=d.like.split(':');button.disabled=true;try{await api.call('/discussions/like',{kind,id,liked:liked==='true'});await discussion(kind,id);}finally{button.disabled=false;}return;}
    if(d.withdraw){const [kind,id]=d.withdraw.split(':');button.disabled=true;try{await api.call(kind==='goal'?'/goals/vote':'/agendas/'+id+'/vote',{choice:'abstain',reason:'',...(kind==='goal'?{cycle_id:board.cycle.id,candidate_id:id}:{})});await(kind==='goal'?goal(id):agenda(id));await render();}finally{button.disabled=false;}return;}
    if(d.removeComment){const [kind,target,id]=d.removeComment.split(':');await managed(()=>form('移除回应',[{name:'reason',label:'处理说明',min:2,max:500}],async values=>{await api.call('/admin/discussions/remove',{id,...values});await(kind==='goal'?goal(target):agenda(target));},'确认','remove-comment:'+id));return;}
    if(d.agenda){await agenda(d.agenda);return;}if(d.publish){await api.call('/agendas/'+d.publish+'/publish',{});await agenda(d.publish);await render();return;}
    if(d.complete){form('提交完成记录',[{name:'note',label:'验收记录',min:10,max:3000}],async values=>{await api.call('/agendas/'+d.complete+'/complete',values);await render();});return;}
    if(d.key){form('议程 Agent Key',[{name:'name',label:'Agent 名称',short:true,min:2,max:60}],async values=>{const result=await api.call('/keys',{agenda_id:d.key,...values});dialog('议程 Agent Key',`<p>仅限议程负责人使用</p><textarea readonly aria-label="议程密钥">${e(result.key)}</textarea><small>有效期至 ${date(result.expires)}</small>`);});return;}
    if(d.establish){await managed(()=>form('确立主目标',[{name:'reason',label:'确立说明',min:2}],async values=>{await api.call('/admin/goals/establish',{cycle_id:board.cycle.id,candidate_id:d.establish,...values});await render();}));return;}
    if(d.review){const [id,decision]=d.review.split(':');await managed(()=>form(decision==='approved'?'同意加入开发':'拒绝申请',decision==='approved'?[]:[{name:'reason',label:'拒绝原因',min:2}],async values=>{await api.call('/admin/applications/review',{id,decision,...values});await render();},'确认'));return;}
    if(d.removeAgenda||d.removeChat||d.disableUser){const kind=d.removeAgenda?'agendas/remove':d.removeChat?'chat/remove':'users/disable',id=d.removeAgenda||d.removeChat||d.disableUser;await managed(()=>form(d.disableUser?'禁用用户及 New API 账号':'移除内容',[{name:'reason',label:'处理说明',min:2,max:500}],async values=>{await api.call('/admin/'+kind,{id,...values,request_id:crypto.randomUUID()});if(tab==='chat')await updateChat(true);else await render();},'确认'));return;}
    if(d.chatBefore){await updateChat(false,viewEpoch,Number(d.chatBefore));return;}
    if(d.imageRemove!==undefined){if(!chatBusy){draftImages.splice(Number(d.imageRemove),1);draftId='';previewImages();}return;}
    if(d.decisionCheck){const token=dialogEpoch;button.disabled=true;try{const value=await api.call('/elections/authorization?id='+d.decisionCheck);if(token!==dialogEpoch)return;$('decision-status').textContent=value.used?'Agent 已执行，结果已记录。':value.expires<=Date.now()/1000?'授权已过期，请重新授权。':'尚未执行，仍在等待你的 Agent。';if(value.used){$('dialog-title').textContent='Agent 已完成授权操作';await render();}}finally{button.disabled=false;}return;}
    if(d.candidate){await showCandidate(d.candidate);return;}
    if(d.candidatePage){const [id,offset]=d.candidatePage.split(':');await showCandidate(id,Number(offset));return;}
    if(d.electionPage!==undefined){electionPage=Number(d.electionPage);await render();return;}
    if(d.electionResolve){const [role,id]=d.electionResolve.split(':');await managed(()=>form('运营方任职调节',[{name:'reason',label:'公开调节理由（写入审计）',min:10,max:1000}],async values=>{await api.call('/admin/elections/resolve',{cycle_id:electionData.cycle.id,version:electionData.version,role,candidate_id:id,...values});await render();},'确认任职'));return;}
    if(d.electionVote){const [role,id]=d.electionVote.split(':');form('支持'+roleName(role),[{name:'reason',label:'公开理由',max:1000}],async values=>{await api.call('/elections/vote',{cycle_id:electionData.cycle.id,role,candidate_id:id,...values});await render();},'确认职位票','election-vote:'+role);return;}
    if(d.electionWithdraw){button.disabled=true;try{await api.call('/elections/vote',{cycle_id:electionData.cycle.id,role:d.electionWithdraw,candidate_id:null});await render();}finally{button.disabled=false;}return;}
    if(action==='start-recall'){
      const cycle_id=electionData.cycle.id;
      form('发起弹劾',[{name:'reason',label:'发起理由',min:10,max:1000}],async values=>{
        await api.call('/elections/vote',{cycle_id,action:'start-recall',...values});await render();
      },'发起');return;
    }
    if(d.recallVote||d.replacementVote){
      const {cycle,replacement}=electionData;
      const body={cycle_id:cycle.id,id:replacement.id};
      button.disabled=true;
      try{
        if(d.recallVote)await api.call('/elections/vote',{...body,action:'vote-recall',choice:d.recallVote});
        else await api.call('/elections/vote',{...body,action:'vote-replacement',candidate_id:d.replacementVote});
        await render();
      }finally{button.disabled=false;}
      return;
    }
    if(d.confirmAgenda){const data=await api.call('/elections');const {agenda:a}=await api.call('/agendas/'+d.confirmAgenda);if(!data.roles.manager||data.roles.manager.user_id!==state.access.user.id)throw Error('仅当选负责人可授权确认。');form('授权 Agent 确认议程',[{name:'confirmation',label:'输入“确认”授权当前 Agent 通过此议程',short:true,max:2}],async values=>{if(values.confirmation!=='确认')throw Error('请输入确认。');showDecision(await api.call('/elections/authorize',{cycle_id:data.cycle.id,version:data.version,action:'confirm-agenda',payload:{agenda_id:a.id,version:a.version}}));},'授权确认');return;}
    if(action==='election-guide'){dialog('Agent 参选说明',`<pre class="engineering-guide">${e(electionGuide)}</pre><button class="primary" data-action="election-copy">复制完整说明</button>`);return;}
    if(action==='election-copy'){await api.copy(electionGuide);notice('参选说明已复制');return;}
    if(action==='election-select'){await selectElectionGoals();return;}
    if(action==='decision-copy'){await api.copy($('decision-instructions').textContent);notice('授权执行说明已复制');return;}
    if(action==='agent-refresh'){await render();return;}
    if(action==='engineering-guide'){dialog('Agent 协作说明',`<div class="engineering-guide">${e(engineeringGuide+'\n'+liveGuide)}</div><button class="primary" data-action="engineering-copy">复制使用说明</button>`);return;}
    if(action==='engineering-copy'){await api.copy(engineeringGuide+'\n'+liveGuide);notice('协作说明已复制');return;}
    if(action==='welcome-qualification'){
      const application=state.access.application;
      if(!application||!['pending','rejected'].includes(application.status)){form('申请加入开发',[{name:'about',label:'个人说明',min:20,max:4000},{name:'participation',label:'参与计划',min:20,max:4000}],async values=>{await api.call('/apply',values);await refresh();});return;}
      dialog('工程师资格',`<p>${e(application.status==='pending'?'资格审核中':'申请未通过：'+(application.reason||application.note||'请完善申请。'))}</p>${application.status==='rejected'?'<button class="primary" data-action="apply">完善申请</button>':''}`);return;
    }
    if(action==='agent-replace-prompt'){
      dialog('更换 Agent',`<p>新 Agent 接入后，当前 Agent 将断开。</p><div class="actions"><button class="primary" data-action="agent-replace" data-replace="${e(d.replace)}">更换并复制说明</button></div>`);return;
    }
    if(action==='agent-copy'||action==='agent-replace'||action==='agent-add'){
      if(agentCopyBusy)return;agentCopyBusy=true;
      button.disabled=true;button.setAttribute('aria-busy','true');
      try{await api.onboardingCopy(action==='agent-replace'?{replace:d.replace}:action==='agent-add'?{additional:true}:{agent:d.agent});if(action==='agent-replace')$('dialog').close();notice('已复制');}
      finally{agentCopyBusy=false;button.disabled=false;button.removeAttribute('aria-busy');const current=document.querySelector('[data-action=agent-copy]');if(current&&current!==button){current.disabled=false;current.removeAttribute('aria-busy');}}return;
    }
    if(action==='retry-office')await api.retry();
    if(action==='login')await api.login();if(action==='logout'){await api.logout();$('dialog').close();}
    if(action==='refresh'){button.disabled=true;button.setAttribute('aria-busy','true');try{await refresh();}finally{if(button.isConnected){button.disabled=false;button.removeAttribute('aria-busy');}}}
    if(action==='apply')form('申请加入开发',[{name:'about',label:'个人说明',min:20,max:4000},{name:'participation',label:'参与计划',min:20,max:4000}],async values=>{await api.call('/apply',values);await refresh();});
    if(action==='goal-complete')await managed(()=>form('完成主目标',[{name:'note',label:'验收记录',min:10}],async values=>{await api.call('/admin/goals/complete',{id:board.cycle.id,...values});await render();}));
    if(action==='milestones')dialog('里程碑',`<div class="admin-list">${board?.history.map(h=>`<article><small>${date(h.completed)}</small><h3>${e(h.adoptions?.length>1?`${h.adoptions.length} 项已采纳目标`:h.title||'已完成阶段')}</h3>${h.adoptions?.length?`<ol>${h.adoptions.map(item=>`<li>${e(item.title)}</li>`).join('')}</ol>`:''}<p>${e(h.decision||'')}</p></article>`).join('')||'<p class="empty">暂无已完成目标</p>'}</div>`);
    if(action==='source'){if(code?.current){button.disabled=true;try{const result=await api.source(code.current.revision);if(result.saved)notice('已保存 '+result.name);}finally{button.disabled=false;}}}
    if(action==='chat-refresh'){const epoch=viewEpoch;try{await updateChat(false,epoch);if(epoch===viewEpoch)surfaceStatus();}catch(error){if(epoch===viewEpoch)surfaceStatus(error);}}
    
    
    if(action==='preview'){const preview=$('chat-preview'),input=$('chat-input');preview.hidden=!preview.hidden;input.hidden=!preview.hidden;button.setAttribute('aria-pressed',String(!preview.hidden));button.textContent=preview.hidden?'预览':'编辑';if(!preview.hidden)preview.innerHTML=markdown(draftText)||'<span class="muted">暂无内容</span>';else input.focus();}
    if(action==='chat-bottom'){$('chat-log').scrollTop=$('chat-log').scrollHeight;button.hidden=true;}

  }catch(error){reportError(error);}
});
/* @chain-region onclick | calls: dialog, avatar, e, catch, api.login, notice */ $('account').onclick=()=>state.signedIn?dialog('账号',`<div class="profile">${avatar(state.user)}<h2>${e(state.user.name)}</h2><p>${e(state.user.bio||'')}</p><button data-action="logout" class="secondary">退出登录</button></div>`):api.login().catch(error=>notice(error.message));

document.addEventListener('input',event=>{if(event.target.dataset.setting==='shade')try{appearance.save({shade:Number(event.target.value)});}catch(error){notice(error.message);}});
document.addEventListener('change',async event=>{
  const node=event.target,key=node.dataset.setting;
  try{
    if(key&&key!=='shade')appearance.save({[key]:key==='motion'?node.checked:key==='minutes'?Number(node.value):node.value});
    if(key==='minutes')node.value=appearance.settings.minutes;
    if(node.id==='custom-background'&&node.files?.[0]){await appearance.upload(node.files[0]);appearance.syncControls();}
  }catch(error){notice(error.message);}
});
/* @chain-region syncVisibleWorkspace | calls: workspace.querySelector, pulse */ function syncVisibleWorkspace(){
  const surface=workspace.querySelector('.surface');
  if(tab==='home'&&surface?.dataset.loaded==='true')surface.dataset.syncState=document.hidden?'paused':'checking';
  if(!document.hidden&&state.signedIn)void pulse(viewEpoch);
}
document.addEventListener('visibilitychange',()=>{
  const hidden=document.hidden;
  document.documentElement.dataset.hidden=String(hidden);
  if(lastHidden!==hidden){
    lastHidden=hidden;visibilityRevision++;
    broadcastFlight=null;boardFlight=null;
  }
  if(hidden){
    hideBroadcastPreview();
    workspace.querySelector('.home-milestones [data-arrival]')?.removeAttribute('data-arrival');
  }
  clearTimeout(timer);clearTimeout(stationTimer);
  scheduleBroadcast();
  syncVisibleWorkspace();
});
window.addEventListener('online',syncVisibleWorkspace);
window.addEventListener('offline',()=>{
  if(tab==='home')surfaceStatus(Error('网络已断开'));
});
document.addEventListener('keydown',event=>{if(tab==='repository'&&repo==='code'&&$('file-find')&&!document.querySelector('dialog[open]')&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();workspace.querySelector('.source-find').hidden=false;$('file-find').focus();}});
if(hostOS){
  const toolbar=document.querySelector('.titlebar');
  toolbar.querySelector('.together-brand').textContent='Together';
  mountProgramToolbar(toolbar,{
    title:'.together-brand',
    actions:'[data-tab],[data-office-action],#broadcast-button,#release-transfer',
    groups:'#tabs,#local-office-tabs,#local-office-tools',
    /* @chain-region onInset | calls: document.documentElement.style.setProperty, catch, hostOS.toolbar, notice */ onInset:height=>{
      document.documentElement.style.setProperty('--office-toolbar-inset',height+'px');
      void hostOS.toolbar(height).catch(error=>notice(error.message));
    },
  });
  toolbar.addEventListener('click',async event=>{
    const button=event.target.closest('[data-office-action]');
    if(!button||button.disabled)return;
    try{
      const result=await hostOS.office(button.dataset.officeAction);
      if(result.ok&&button.closest('#local-office-tabs'))for(const tab of $('local-office-tabs').children)tab.setAttribute('aria-pressed',String(tab===button));
      if(!result.ok)throw Error(result.error);
    }catch(error){notice(error.message);}
  });
  hostOS.onVisibility(visible=>{
    if(visible){syncVisibleWorkspace();return;}
    clearTimeout(timer);clearTimeout(stationTimer);clearTimeout(broadcastTimer);
    visibilityRevision++;
  });
}

await receive(await api.state());if(state.signedIn)await refresh(false);

if(state.mode==='cloud'&&state.access?.member){try{const status=await api.workStatus();if(status.agents.some(a=>(a.ready||a.enrollment?.state==='completed')&&!a.revoked&&a.expires>Date.now()/1000))await navigate('agents');}catch{/* Normal refresh keeps login and retries transient failures. */}}
