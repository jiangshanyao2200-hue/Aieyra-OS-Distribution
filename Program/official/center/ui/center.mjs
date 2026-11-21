import {$,app,call,el,setupShell} from '../../../../Client/Desktop/ui/app-shell.mjs';
import {setupUpdateSettings} from '../../../../Client/Desktop/ui/update-settings.mjs';
import {setupTooltips} from '../../../../Client/Desktop/ui/tooltip.mjs';
setupShell();setupTooltips(document);
const panel=$('release-feedback'),form=$('feedback-form'),input=$('feedback-text');
const feedbackStatus=$('feedback-status'),items=$('feedback-items'),more=$('feedback-more'),send=$('feedback-send');
const drafts=new Map();
let topic=null,cursor=null,readGeneration=0,accountGeneration=0;
async function loadFeedback(append=false){
 if(!topic)return;
 const generation=++readGeneration;
 feedbackStatus.textContent='正在读取反馈…';
 try{
  const result=await call({action:'feedback',release_topic:topic.id,...append&&cursor?{cursor}:{}});
  if(generation!==readGeneration)return;
  if(!append)items.replaceChildren();
  for(const row of result.items){
   const item=el('li'),author=el('strong','',row.author?.name||'论坛成员');
   item.append(author,el('p','',row.content||''));items.append(item);
  }
  cursor=result.nextCursor;more.hidden=!cursor;
  feedbackStatus.textContent=items.children.length?'':'暂无反馈';
 }catch(error){if(generation===readGeneration)feedbackStatus.textContent=error.message;}
}
function selectTopic(item){
 topic=item;panel.hidden=false;items.replaceChildren();cursor=null;more.hidden=true;
 $('feedback-title').textContent=item.title;
 input.value=drafts.get(item.id)?.content||'';
 send.disabled=false;send.textContent='提交反馈';$('feedback-confirm').checked=false;
 panel.scrollIntoView({block:'nearest'});void loadFeedback();
}
$('feedback-refresh').onclick=()=>loadFeedback();
more.onclick=()=>loadFeedback(true);
form.onsubmit=async event=>{
 event.preventDefault();
 if(!topic||send.disabled||!form.reportValidity())return;
 const selected=topic,account=accountGeneration,content=input.value.trim();
 if(!content)return;
 let draft=drafts.get(selected.id);
 if(draft?.content!==content){draft={content,request_id:crypto.randomUUID()};drafts.set(selected.id,draft);}
 send.disabled=true;feedbackStatus.textContent='正在提交反馈…';
 try{
  await call({action:'report_issue',release_topic:selected.id,confirmed:true,...draft});
  if(account!==accountGeneration)return;
  if(drafts.get(selected.id)===draft)drafts.delete(selected.id);
  if(topic===selected){form.reset();await loadFeedback();if(topic===selected&&account===accountGeneration)feedbackStatus.textContent='反馈已提交';}
 }catch(error){if(topic===selected&&account===accountGeneration){feedbackStatus.textContent=error.message;send.textContent='重试提交';}}
 finally{if(topic===selected&&account===accountGeneration)send.disabled=false;}
};
const updateDock=$('center-update-dock'),updateToggle=$('center-update-toggle'),updateMenu=$('update-settings');
updateDock.prepend(updateMenu);
const view=setupUpdateSettings({updates:call,openLink:()=>call({action:'download'}),onAccountChanged:app.onAccountChanged},{assistant:'Nova',assistWhenUnmanaged:true,requestKey:'aieyra.center.update-request',onReleaseThread:selectTopic,reviewOnCheck:true});
const stopAccount=app.onAccountChanged?.(()=>{accountGeneration++;readGeneration++;topic=null;drafts.clear();items.replaceChildren();form.reset();panel.hidden=true;});
const observed=$('center-observed');
function reportFrame(value){void call({action:'frame_sample',...value}).catch(()=>{});}
async function openManagement(module){
 try{await call({action:'open_management',module});}
 catch(error){observed.textContent=error.message;observed.hidden=false;}
}
const labels={online:'就绪',attention:'有异常',idle:'空闲',unknown:'待核实',unopened:'未启动',running:'运行中',waiting:'等待响应',waiting_user:'等待用户',queued:'排队中',completed:'已完成',failed:'失败',timed_out:'超时',interrupted:'中断',persistence_failed:'保存失败',cancelling:'正在停止',cancelled:'已停止'};
const nodePanel=$('center-nodes'),nodeLayer=$('center-neurons'),nodeButtons=new Map(),canvas=$('center-topology');
const situationMessage=$('center-situation-message');
const healthToggle=$('center-health-toggle'),healthPoints=$('center-health-points'),scoreValue=$('center-score-value');
const incidencePanel=$('center-incidents'),incidenceItems=$('center-incident-items');
const selectedName=$('center-active-name'),selectedState=$('center-active-state'),selectedDetail=$('center-active-detail');
const actionButton=$('center-node-action'),panels=$('center-panels');
const stateNames={online:'正常',attention:'需处理',idle:'空闲',unknown:'待观测',running:'运行中'};
const categories=[
 ['运行',[['nova','Nova'],['core','执行服务'],['agents','Agent'],['internal_link','内部协作'],['external_link','Link 连接']]],
 ['程序',[['browser','浏览器'],['integrity','文件完整性'],['updates','更新服务'],['verification','AIDEBUG']]],
 ['系统',[['cpu','处理器'],['memory','内存'],['disk','存储'],['processes','OS 进程'],['resident','程序内存']]],
 ['性能与学习',[['render','绘制帧率'],['raf','帧调度'],['latency','帧耗时'],['baseline','本地基线']]],
];
let topology,latestHealth={},selected='',automatic='',activePanel='',closed=false;

for(const [label,definitions] of categories){
 const group=el('section','center-health-category');
 const title=el('h2','center-category-title',label),rate=el('span');
 title.append(rate);group.append(title);nodePanel.append(group);
 for(const [id,name] of definitions){
  const button=el('button','center-state-row'),point=el('span','center-point');
  const neuron=el('button','center-neuron'),segment=el('span','center-health-point');
  for(const control of [button,neuron]){
   control.type='button';control.dataset.neuron=id;control.onclick=()=>selectNode(id);
  }
  segment.dataset.neuron=id;point.setAttribute('aria-hidden','true');
  button.append(point,el('span','',name));neuron.append(el('span','',name));
  group.append(button);nodeLayer.append(neuron);healthPoints.append(segment);
  nodeButtons.set(id,{button,neuron,segment,rate,name,category:label});
 }
}
healthToggle.onclick=()=>{
 nodePanel.hidden=!nodePanel.hidden;
 healthToggle.setAttribute('aria-expanded',String(!nodePanel.hidden));
};

function selectNode(id){
 if(!nodeButtons.has(id))return;
 selected=selected===id?'':id;
 paintHub(latestHealth);
}
function neuralSignals(health){
 const {checks=[],tone='unknown',message,dimensions=[],observation={}}=health.situation||{};
 const items=new Map(checks.map(item=>[item.id,{...item,scored:true}]));
 for(const row of dimensions){
  if(!['cpu','memory','disk','verification'].includes(row.id))continue;
  const check=items.get(row.id);
  items.set(row.id,{...check,state:row.tone,detail:row.value===null?row.status:row.value+'% · '+row.status});
 }
 items.set('nova',{state:tone,detail:message});
 const active=(health.agents||[]).filter(({state})=>['running','queued','waiting','waiting_user','cancelling'].includes(state)).length;
 items.set('agents',{
  state:health.agentsObserved?(active?'running':'idle'):'unknown',
  detail:health.agentsObserved?`${active} 个活动中 · ${health.agents.length} 个已观测`:'等待 Agent 观测',
 });
 const {frames,baseline,processes,residentMiB}=observation;
 for(const [id,key,unit] of [['render','renderHz',' FPS'],['raf','rafHz',' Hz'],['latency','frameP95Ms',' ms · P95']]){
  const live=frames?.mode==='live'&&Number.isFinite(frames[key]);
  const idle=['paused','reduced-motion'].includes(frames?.mode);
  items.set(id,{state:live?'online':idle?'idle':'unknown',detail:live?frames[key]+unit:idle?'拓扑绘制采样已暂停':'等待本机帧采样'});
 }
 for(const [id,value,unit] of [['processes',processes,' 个操作系统进程'],['resident',residentMiB,' MiB 工作集']]){
  const available=Number.isFinite(value);
  items.set(id,{state:available?'online':'unknown',detail:available?Math.round(value)+unit:'等待本机资源采样'});
 }
 items.set('baseline',{
  state:baseline?.fresh>0?'running':'unknown',
  detail:baseline?.fresh>0?`${localLearningLabels[baseline.state]||'观测中'} · ${baseline.ready}/${baseline.fresh} 项已建立基线`:'等待本机环境与运行采样',
 });
 return items;
}
function showUpdates(open){
 updateMenu.hidden=!open;
 updateToggle.setAttribute('aria-expanded',String(open));
 view.visibility(open&&visible&&!document.hidden);
 if(open)void view.check();
}
updateToggle.onclick=()=>showUpdates(updateMenu.hidden);
function dismissUpdates(event){
 if(updateMenu.hidden)return;
 if(event.type==='keydown'){
  if(event.key==='Escape'){showUpdates(false);updateToggle.focus();}
 }else if(!updateDock.contains(event.target))showUpdates(false);
}
document.addEventListener('pointerdown',dismissUpdates);
document.addEventListener('keydown',dismissUpdates);
function showPanel(panel=''){
 if(panel==='updates'){showUpdates(true);updateToggle.focus();return;}
 activePanel=panel;
 panels.hidden=!panel;
 incidencePanel.hidden=panel!=='incidents';
 $('center-learning').hidden=panel!=='learning';
 if(panel==='learning'&&!learningBusy)void readLearning();
 if(panel){panels.scrollIntoView({block:'nearest'});$('center-close-panel').focus({preventScroll:true});}
 else actionButton.focus({preventScroll:true});
}
$('center-close-panel').onclick=()=>showPanel();
function paintHub(health){
 const {incidents=[],tone='unknown',focus}=health.situation||{};
 const issue=focus||incidents.find(item=>!item.awaitingCheck)?.id||incidents[0]?.id||'';
 if(issue!==automatic){
  if(issue||selected===automatic)selected=issue;
  automatic=issue;
 }
 nodeLayer.dataset.attention=automatic;
 const signals=neuralSignals(health),items=[],rates=new Map();
 for(const [id,entry] of nodeButtons){
  const signal=signals.get(id),incident=incidents.find(item=>item.id===id);
  const state=incident?(incident.awaitingCheck?'unknown':'attention'):signal?.state||'unknown';
  const detail=incident?.detail||signal?.detail||'等待观测';
  const current=selected===id;
  for(const control of [entry.button,entry.neuron]){
   control.dataset.tone=state;
   control.setAttribute('aria-pressed',String(current));
   control.setAttribute('aria-label',entry.name+'，'+(stateNames[state]||stateNames.unknown));
   control.title=detail;
  }
  entry.segment.dataset.tone=state;
  entry.segment.dataset.selected=String(current);
  items.push({id,state,detail,management:signal?.management,incident});
  if(signal?.scored&&state!=='unknown'){
   const rate=rates.get(entry.rate)||{passed:0,total:0};
   rate.total++;if(state!=='attention')rate.passed++;
   rates.set(entry.rate,rate);
  }
 }
 for(const {rate} of nodeButtons.values()){
  const observed=rates.get(rate);
  rate.textContent=observed?Math.round(observed.passed*100/observed.total)+'%':'—';
 }
 const current=items.find(item=>item.id===selected);
 $('center-selection').hidden=!current;
 if(current){
  selectedName.textContent=nodeButtons.get(selected).name;
  selectedState.dataset.tone=current.state;
  selectedState.textContent=stateNames[current.state]||stateNames.unknown;
  selectedDetail.textContent=current.detail;
 }
 const action=current?.incident?['感知日志',()=>showPanel('incidents')]:
  current?.id==='updates'||current?.id==='integrity'?['版本与更新',()=>showPanel('updates')]:
  current?.id==='baseline'?['数据与学习',()=>showPanel('learning')]:
  current?.management?['查看程序',()=>openManagement(current.management)]:null;
 actionButton.hidden=!action;
 if(action){actionButton.textContent=action[0];actionButton.onclick=action[1];}
 topology?.update(items,selected,tone,automatic);
}
function paintBands(chart,bands,empty){
 const track=el('div','center-band-track'),key=el('div','center-state-key');
 const active=bands.filter(band=>band.count>0);
 for(const {label,tone,count} of active){
  const segment=el('span');segment.dataset.tone=tone;segment.style.flexGrow=String(count);
  const caption=el('span','',label+' '+count);caption.dataset.tone=tone;
  track.append(segment);key.append(caption);
 }
 if(!active.length){track.dataset.empty='true';key.append(el('span','',empty));}
 const description=active.map(({label,count})=>label+' '+count).join('，')||empty;
 track.setAttribute('aria-hidden','true');key.setAttribute('aria-hidden','true');
 chart.setAttribute('aria-label',description);
 chart.replaceChildren(track,key);
}
function paintSituation({tone='unknown',message,score,observedChecks=0,incidents=[]}={}){
 situationMessage.closest('.center-situation').dataset.tone=tone;
 const title=message||(incidents.length?'等待复验':'正在感知');
 if(situationMessage.textContent!==title)situationMessage.textContent=title;
 scoreValue.textContent=Number.isFinite(score)?score+'%':'—';
 healthToggle.title=observedChecks?'按已观测的 '+observedChecks+' 项运行检查计算':'等待运行检查';
 incidenceItems.replaceChildren(...incidents.map(({name,detail,since,management,awaitingCheck})=>{
  const item=el('li','center-incident');
  const mark=el('span','center-incident-mark');
  mark.dataset.tone=awaitingCheck?'unknown':'attention';mark.setAttribute('aria-hidden','true');
  const body=el('div'),heading=el('strong','',name),description=el('p','',awaitingCheck?'待复验 · '+detail:detail);
  body.append(heading,description);item.append(mark,body);
  if(since){
   const time=el('time','',new Date(since).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));time.dateTime=since;item.append(time);
  }
  if(management){
   const button=el('button','quiet','查看');button.type='button';button.setAttribute('aria-label','查看'+name);
   button.onclick=()=>openManagement(management);body.append(button);
  }
  if(['文件完整性','签名更新'].includes(name)){
   const button=el('button','quiet','版本与更新');button.type='button';
   button.onclick=()=>showPanel('updates');body.append(button);
  }
  return item;
 }));
}
let visible=true,healthTimer=0,healthEpoch=0,healthPending=false;
async function refreshHealth(){
 if(!visible||document.hidden||healthPending)return;
 const epoch=healthEpoch;healthPending=true;
 try{
  const health=await call({action:'health'});if(epoch!==healthEpoch)return;
  latestHealth=health;paintSituation(health.situation);paintHub(health);
  if(activePanel==='learning'&&!learningBusy&&Date.now()-learningReadAt>=15000)void readLearning();
  observed.textContent=[health.version,'观测于 '+new Date(health.observedAt).toLocaleTimeString()].filter(Boolean).join(' · ');
  observed.hidden=true;
 }catch(error){if(epoch===healthEpoch){latestHealth={};paintSituation();paintHub(latestHealth);observed.textContent='健康状态读取失败。'+error.message;observed.hidden=false;}}
 finally{healthPending=false;if(epoch!==healthEpoch&&visible&&!document.hidden)void refreshHealth();}
}
const learningSync=$('center-learning-sync');
const learningStatus=$('center-learning-status'),learningState=$('center-learning-state'),learningSummary=$('center-learning-summary');
const learningChart=$('center-learning-chart');
const localLearningLabels={learning:'持续学习',warming_up:'基线形成中',attention:'发现偏离',observing:'观测中 · 基线暂缓更新',unobserved:'等待采样'};
const summaryHealthLabels={core:'Core',browser:'浏览器',integrity:'完整性',updates:'更新'};
const platformLabels={win32:'Windows',darwin:'macOS',linux:'Linux',freebsd:'FreeBSD'};
function paintLearningSummary(summary){
 if(!summary){learningSummary.replaceChildren(el('p','link-hint','等待运行数据'));return;}
 const {environment,measurements,health}=summary;
 const tier=(value,unit='')=>typeof value==='number'?'≤ '+value+unit:typeof value==='string'?'> '+value.split('_').at(-1)+unit:'';
 const values=[
  ['系统',[platformLabels[environment.platform],environment.os_version,environment.architecture].filter(Boolean).join(' ')],
  ['处理器',tier(environment.cpu_threads_tier,' 线程')],['内存',tier(environment.memory_gib_tier,' GiB')],
  ['屏幕',tier(environment.display_refresh_hz_tier,' Hz')],
  ['版本',summary.app_version],['构建',summary.build_id?.slice(0,8),summary.build_id],
  ['应用内存',Number.isFinite(measurements.app_resident_mib)?measurements.app_resident_mib+' MiB':''],
  ['帧耗时',Number.isFinite(measurements.center_frame_p95_ms)?measurements.center_frame_p95_ms+' ms':''],
  ['帧频',Number.isFinite(measurements.center_raf_hz)?measurements.center_raf_hz+' Hz':''],
 ];
 const tiles=el('div','center-summary-tiles');
 for(const [label,value,title] of values){
  if(!value)continue;
  const tile=el('div'),reading=el('strong','',value);
  if(title)reading.title=title;
  tile.append(el('span','',label),reading);tiles.append(tile);
 }
 const bars=el('div','center-summary-bars');
 for(const [key,label] of [['cpu_percent','处理器使用'],['memory_percent','内存使用'],['disk_free_percent','存储余量']]){
  const value=measurements[key];
  if(!Number.isFinite(value))continue;
  const row=el('div'),meter=el('meter');meter.min=0;meter.max=100;meter.value=value;meter.setAttribute('aria-label',label);
  row.append(el('span','',label),meter,el('strong','',value+'%'));bars.append(row);
 }
 const states=el('div','center-state-key');
 for(const [id,state] of Object.entries(health)){
  const name=summaryHealthLabels[id];if(!name)continue;
  const item=el('span','',name+' · '+(labels[state]||labels.unknown));item.dataset.tone=state;states.append(item);
 }
 learningSummary.replaceChildren(tiles,bars,states);
}
let learningEpoch=0,savedSync=false,learningBusy=false,learningReadAt=0;
async function readLearning(allowed){
 const epoch=++learningEpoch;
 const saving=typeof allowed==='boolean';
 learningBusy=true;learningReadAt=Date.now();
 if(saving)learningSync.disabled=true;
 if(saving)learningStatus.textContent='正在保存…';
 try{
  const result=await call(saving?{action:'learning_sync',allowed}:{action:'learning_data'});
  if(closed||epoch!==learningEpoch)return;
  savedSync=result.allowed;
  learningSync.checked=savedSync;
  learningState.textContent=localLearningLabels[result.local]||localLearningLabels.unobserved;
  learningStatus.textContent=(saving?'选择已保存 · ':'')+(result.sync==='pending_endpoint'?'官网接收待接入，数据保存在本机':'');
  const {ready=0,fresh=0,expected=0}=result.coverage||{};
  paintBands(learningChart,[
   {label:'已建立',tone:'online',count:ready},
   {label:'积累中',tone:'running',count:fresh-ready},
   {label:'待观测',tone:'unknown',count:expected-fresh},
  ],'等待本地采样');
  paintLearningSummary(result.summary);
  learningSync.disabled=false;
 }catch(error){
  if(closed||epoch!==learningEpoch)return;
  learningSync.checked=savedSync;
  learningStatus.textContent=error.message;
  learningSync.disabled=!saving;
 }finally{if(epoch===learningEpoch)learningBusy=false;}
}
learningSync.onchange=()=>readLearning(learningSync.checked);
const paint=()=>{
 const active=visible&&!document.hidden;view.visibility(active&&!updateMenu.hidden);
 topology?.visibility(active);
 if(active&&!healthTimer){void refreshHealth();healthTimer=window.setInterval(refreshHealth,5000);}
 else if(!active&&healthTimer){clearInterval(healthTimer);healthTimer=0;healthEpoch++;}
};
const stop=app.onVisibility?.(value=>{visible=value?.visible===true;paint();});
document.addEventListener('visibilitychange',paint);paint();
paintHub(latestHealth);
import('./topology.mjs').then(({mountTopology})=>{
 if(closed)return;
 topology=mountTopology(canvas,nodeLayer,reportFrame);
 paintHub(latestHealth);
 topology.visibility(visible&&!document.hidden);
}).catch(error=>{
 canvas.dataset.rendering='unavailable';
 reportFrame({mode:'unavailable'});
 console.warn('中心拓扑不可用',error.message);
});
window.addEventListener('pagehide',()=>{closed=true;visible=false;paint();topology?.close();stop?.();stopAccount?.();readGeneration++;accountGeneration++;document.removeEventListener('visibilitychange',paint);document.removeEventListener('pointerdown',dismissUpdates);document.removeEventListener('keydown',dismissUpdates);view.close();},{once:true});
