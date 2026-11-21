'use strict';
const {describeEnvironment,createHealthSummary}=require('./learning.cjs');
const ID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const UPDATE_ACTIONS=new Set(['status','check','review_update','integrity','posts','post','defer','quick']);
const agentStates=new Set(['idle','running','waiting','waiting_user','queued','completed','failed','timed_out','interrupted','persistence_failed','cancelling','cancelled']);
const OBSERVATION_MAX_AGE_MS=90000;
const FRAME_OBSERVATION_MAX_AGE_MS=18000;
const nonnegativeInteger=value=>Number.isSafeInteger(value)&&value>=0;
const count=value=>nonnegativeInteger(value)?value:0;

function isFresh(observedAt,now,maxAge=OBSERVATION_MAX_AGE_MS){
 const age=now-Date.parse(observedAt);
 return age>=0&&age<=maxAge;
}

function dimension(id,label,value,status,{warning='',unknown=value===null}={}){
 return {id,label,value,status,tone:warning?'attention':unknown?'unknown':'online',warning};
}

function capacity(id,label,reading,used){
 const last=reading?.last;
 if(!Number.isFinite(last)||last<0||last>100||reading.state==='unobserved'){
  return dimension(id,label,null,'等待资源采样');
 }
 const available=used?100-last:last;
 const low=available<=10;
 const unusual=reading.state==='attention'&&Number.isFinite(reading.score);
 const subject={cpu:'处理器',memory:'内存',disk:'存储'}[id];
 const warning=low?`我的${subject}余量偏低`:unusual?`我的${subject}余量低于基线`:'';
 return dimension(id,label,Math.floor(available),`未使用容量占总容量的比例${low?' · 余量偏低':unusual?' · 偏离本机基线':''}`,{warning});
}

function linkDimension(board,link,now){
 const internal=Array.isArray(board?.seats)&&typeof board.briefs_available==='boolean'?board.briefs_available:null;
 const observed=link&&(!Object.hasOwn(link,'checked_at')||isFresh(link.checked_at,now));
 const external=link?.page_error?false:observed&&link.available===true?true:
  observed&&link.installed===true&&['offline','unavailable'].includes(link.service_state)?false:null;
 const warning=internal===false?'我的 Link 协作摘要暂不可用':external===false?'我的 Link 对外连接异常':'';
 const value=internal===null||external===null?null:50*(Number(internal)+Number(external));
 const state=value=>value===true?'已连通':value===false?'异常':'待确认';
 return dimension('link','Link 连通',value,`对内 ${state(internal)} · 本机对外桥接 ${state(external)}`,{warning});
}

function integrityDimension(integrity){
 const checked=integrity?.phase==='checked';
 const totals=[integrity?.consistent,integrity?.different,integrity?.unknown];
 const readable=checked&&totals.every(nonnegativeInteger);
 const total=readable?totals.reduce((sum,value)=>sum+value,0):0;
 const value=total?Math.floor(100*integrity.consistent/total):null;
 const warning=integrity?.phase==='error'?'我的文件校验失败':
  checked&&count(integrity.different)>0?'我的文件存在校验差异':'';
 const status=readable?`上次校验 ${integrity.consistent}/${total} 个模块一致${integrity.unknown?` · ${integrity.unknown} 个待核实`:''}`:
  integrity?.phase==='unavailable'?'当前安装没有校验基线':warning?'校验失败':'等待文件校验';
 return dimension('integrity','文件完整性',value,status,{warning,unknown:value===null||integrity.unknown>0});
}

function verificationDimension(verification){
 const lanes=[['后台',verification?.background],['前台',verification?.foreground]];
 const complete=lanes.every(([,lane])=>['passed','failed'].includes(lane?.status)&&
  nonnegativeInteger(lane.total)&&nonnegativeInteger(lane.passed)&&lane.total>0&&lane.passed<=lane.total&&
  (lane.status==='failed'||lane.passed===lane.total));
 const failed=lanes.find(([,lane])=>lane?.status==='failed');
 const results=lanes.map(([name,lane])=>`${name} ${({passed:'通过',failed:'失败',partial:'部分核验',stopped:'已停止'})[lane?.status]||'待核验'}`).join(' · ');
 const passed=complete?lanes.reduce((sum,[,lane])=>sum+lane.passed,0):0;
 const total=complete?lanes.reduce((sum,[,lane])=>sum+lane.total,0):0;
 const value=total?Math.floor(100*passed/total):null;
 const status=total?`${passed}/${total} 项通过 · ${results}`:results;
 return dimension('verification','AIDEBUG 验证',value,status,{warning:failed?`我的${failed[0]}验证发现问题`:''});
}

function projectSituation({system,coreReady,board,link,integrity},report,telemetry){
 const now=Date.now();
 const features=report?.features;
 const cpu=capacity('cpu','处理器余量',features?.cpu_percent,true);
 const memory=capacity('memory','内存余量',features?.memory_percent,true);
 const disk=capacity('disk','存储余量',features?.disk_free_percent,false);
 const links=linkDimension(board,link,now);
 const files=integrityDimension(integrity);
 const verification=verificationDimension(isFresh(telemetry?.observedAt,now)?telemetry.runtime?.verification:null);
 const rows=[cpu,memory,disk,links,files,verification];
 const resources=[cpu,memory,disk];
 const checks=system.items.map(({id,name,state,detail,management})=>({
  id,name,management,
  state:id==='core'&&coreReady===false?'attention':state,
  detail:id==='core'&&coreReady===false?'执行服务已响应，模型尚未就绪':detail,
 }));
 for(const {id,label,tone,status,warning:problem} of [...resources,verification]){
  checks.push({id,name:label,state:tone,detail:problem||status});
 }
 const checked=checks.filter(row=>row.state!=='unknown');
 const score=checked.some(row=>row.id==='core')
  ?Math.round(100*checked.filter(row=>row.state!=='attention').length/checked.length):null;
 const attention=id=>system.items.some(item=>item.id===id&&item.state==='attention');
 const [focus,warning]=[
  [files.id,files.warning],[verification.id,verification.warning],[disk.id,disk.warning],
  [memory.id,memory.warning],[cpu.id,cpu.warning],
  [attention('internal_link')?'internal_link':'external_link',links.warning],
  ['updates',attention('updates')?'我的签名更新遇到问题':''],
  ['browser',attention('browser')?'我的浏览器出现异常':''],
  ['core',coreReady===false?'我的执行模型还未就绪':''],
 ].find(([,message])=>message)||[];
 const unknown=[cpu,memory,disk].some(row=>row.tone==='unknown')||!system.items.some(item=>item.id==='core'&&item.state==='online');
 const tone=warning?'attention':unknown?'unknown':'online';
 const message=warning||(tone==='online'?'我当前运行平稳':rows.every(row=>row.value===null)?'我正在等待运行数据':'我的部分状态待确认');
 return {tone,message,focus,score,observedChecks:checked.length,checks,dimensions:rows.map(({warning,...row})=>row)};
}

function createCenterProgram({updates,community,conversation,openPage,releasePage,download,readCore,readPrograms,readBrowser,readLink,readLinkBoard,readDiagnostics,openManagement,sampleHost,model,learningSettings,statusLog,buildId,appVersion}){
 const check=r=>{if(r?.ok===false)throw Error(r.error||'更新操作未完成');return r;};
 let healthRequest;
 async function readHealthSnapshot(){
  const sources=await Promise.allSettled([
   Promise.resolve().then(()=>readCore()),
   Promise.resolve().then(()=>readPrograms()),
   Promise.resolve().then(()=>readBrowser()),
   Promise.resolve().then(()=>readLink()),
   Promise.resolve().then(()=>updates({action:'status'})),
   Promise.resolve().then(()=>readLinkBoard()),
  ]);
  const [core,programs,browser,link,update,board]=sources.map(item=>item.status==='fulfilled'&&item.value?.ok!==false?item.value:null);
  const integrity=update?.integrity;
  const internal=Array.isArray(board?.seats);
  const browserFaults=count(browser?.faults);
  const externalFault=Boolean(link?.page_error||link?.installed===true&&
   ['offline','unavailable'].includes(link.service_state)&&
   (!link.checked_at||isFresh(link.checked_at,Date.now())));
  const items=[
   {id:'core',name:'Core',state:core?'online':'unknown',detail:core?.ready===true?'执行服务已就绪':core?'执行服务响应，模型待就绪':'暂未取得执行状态'},
   {id:'internal_link',name:'Link 对内',state:internal?(board.briefs_available?'online':'attention'):'unknown',detail:internal?count(board.total)+' 个协作工位 · '+count(board.active)+' 个工作中':'暂未取得协作工位状态'},
   {id:'external_link',name:'Link 对外',state:externalFault?'attention':link?.available===true?'online':link?'idle':'unknown',detail:externalFault?'Link 外部连接异常':link?.available===true?(link.cloud_available===true?'本机服务就绪，云端已连通':'本机服务就绪，云端未确认'):link?'服务尚未连通':'暂未取得外部连接状态'},
   {id:'browser',name:'浏览器',state:browserFaults?'attention':browser?browser.count>0?'online':'idle':'unknown',detail:browser?[count(browser.count)+' 个标签页',count(browser.groups?.length)+' 个实例',browserFaults?browserFaults+' 个异常标签':''].filter(Boolean).join(' · '):'暂未取得浏览器状态',management:'browser'},
   {id:'integrity',name:'文件完整性',state:integrity?.phase==='checked'?(integrity.different?'attention':integrity.unknown?'unknown':'online'):integrity?.phase==='error'?'attention':'unknown',detail:integrity?.phase==='checked'?count(integrity.consistent)+' 个模块一致 · '+count(integrity.different)+' 个有差异 · '+count(integrity.unknown)+' 个未核实':integrity?.phase==='unavailable'?'此安装没有官方校验基线':integrity?.phase==='checking'?'正在检查':'待检查'},
   {id:'updates',name:'签名更新',state:!update?'unknown':update.quick?.step==='failed'?'attention':update.enabled?'online':'idle',detail:update?.enabled?'受管更新已启用':update?'当前安装未启用受管更新':'暂未取得更新状态'},
  ];
  const agents=[],seen=new Set();
  const add=(name,scope,row)=>{
   if(row?.id&&seen.has(row.id))return;
   if(row?.id)seen.add(row.id);
   agents.push({name:String(name||'Agent').slice(0,80),scope:String(scope||'').slice(0,60),state:agentStates.has(row?.state)?row.state:row?'unknown':'unopened',generation:count(row?.generation)});
  };
  if(internal&&board.mother)add(board.mother.name,'OS',board.mother);
  for(const row of core?.roles||[])if(!internal||row.role!=='matrix')add({matrix:'Eyra',execution:'Cota',project:'Vaya',subconscious:'潜意识'}[row.role]||row.role,'OS',row);
  for(const row of board?.seats||[])add(row.name,row.current?'当前会话':'其他会话',row);
  if(Array.isArray(programs))for(const p of programs.slice(0,80))add(p.name,p.program,p.program_session);
  const learningHeld=!core||browserFaults>0||integrity?.phase==='error'||count(integrity?.different)>0||
   ['waiting_idle','handoff'].includes(update?.phase);
  return {coreReady:core?.ready,board,link,integrity,learningHeld,system:{
   ok:true,observedAt:new Date().toISOString(),version:update?.currentVersion||'',items,agents,agentsObserved:internal||!!core||Array.isArray(programs)
  }};
 }
 function healthSnapshot(){
  if(!healthRequest)healthRequest=readHealthSnapshot().finally(()=>{healthRequest=null;});
  return healthRequest;
 }
 let frame=null,telemetry=null,sampleRequest,stopping=false;
 function healthProjection(snapshot,report){
  const {checks,...situation}=projectSituation(snapshot,report,telemetry);
  const active=new Map((statusLog?.active()||[]).map(row=>[row.id,row]));
  const incidents=checks.flatMap(({id,name,state,detail,management})=>{
   const recorded=active.get(id);
   if(state==='attention')return [{id,name,detail,management,since:recorded?.since||snapshot.system.observedAt}];
   return state==='unknown'&&recorded?[{...recorded,management,awaitingCheck:true}]:[];
  });
  const tone=incidents.length&&situation.tone==='online'?'unknown':situation.tone;
  const frames=frame&&isFresh(frame.observedAt,Date.now(),FRAME_OBSERVATION_MAX_AGE_MS)?frame:null;
  const features=report?.features;
  const observation={
   frames,
   processes:features?.app_processes?.last??null,
   residentMiB:features?.app_resident_mib?.last??null,
   baseline:{
    state:telemetry?.learningHeld?'observing':report?.state||'unobserved',
    ready:report?.quality?.ready||0,
    fresh:report?.quality?.fresh||0,
   },
  };
  return {...snapshot.system,situation:{...situation,tone,checks,incidents,observation}};
 }
 async function health(){
  return healthProjection(await healthSnapshot(),model?.report());
 }
 function ingestFrame(p){
  if(!['live','paused','reduced-motion','unavailable'].includes(p.mode))throw Error('Invalid frame observation');
  if(p.mode!=='live'){
   frame={mode:p.mode,observedAt:new Date().toISOString()};
   return {ok:true};
  }
  const values=[p.windowMs,p.rafHz,p.renderHz,p.frameP95Ms];
  if(values.some(value=>!Number.isFinite(value)||value<0)||p.windowMs<2000||p.windowMs>20000||
     p.rafHz>1000||p.renderHz>p.rafHz+1||p.frameP95Ms>p.windowMs)throw Error('Invalid frame metrics');
  frame={mode:'live',observedAt:new Date().toISOString(),windowMs:p.windowMs,
   rafHz:p.rafHz,renderHz:p.renderHz,frameP95Ms:p.frameP95Ms};
  return {ok:true};
 }
 async function sample(){
  const observations=await Promise.allSettled([healthSnapshot(),sampleHost(),readDiagnostics()]);
  if(stopping)return;
  const [snapshot,host,runtime]=observations.map(result=>result.status==='fulfilled'&&result.value?.ok!==false?result.value:null);
  const system=snapshot?.system||null;
  const {cpu,memory,disk}=host?.hardware||{};
  const known=system?.items.filter(item=>item.state!=='unknown')||[];
  const displayFrame=frame&&isFresh(frame.observedAt,Date.now(),FRAME_OBSERVATION_MAX_AGE_MS)?frame:null;
  const workingSets=host?.processes?.filter(process=>Number.isFinite(process.residentBytes));
  const learningHeld=snapshot?.learningHeld!==false;
  const features={
   cpu_percent:cpu?.utilizationPercent,memory_percent:memory?.usedPercent,
   disk_free_percent:disk?.totalBytes>0?100*disk.availableBytes/disk.totalBytes:undefined,
   app_processes:host?.processCount,
   app_resident_mib:workingSets?.length?workingSets.reduce((sum,process)=>sum+process.residentBytes,0)/1048576:undefined,
   link_attention:known.length?known.filter(item=>item.state==='attention').length:undefined,
   debug_background_failures:runtime?.verification?.background
    ?runtime.verification.background.total-runtime.verification.background.passed:undefined,
   debug_foreground_failures:runtime?.verification?.foreground
    ?runtime.verification.foreground.total-runtime.verification.foreground.passed:undefined,
   center_frame_p95_ms:displayFrame?.mode==='live'?displayFrame.frameP95Ms:undefined,
   center_raf_hz:displayFrame?.mode==='live'?displayFrame.rafHz:undefined,
  };
  model.observe(features,{build_id:buildId||runtime?.build?.build_id,source:'eyra.center',learn:!learningHeld});
  telemetry={ok:true,schema:'aieyra.center-telemetry/1',observedAt:new Date().toISOString(),
   host,system,runtime,environment:describeEnvironment(host),learningHeld,
   unavailable:['system','host','runtime'].filter((_name,index)=>![system,host,runtime][index])};
  if(snapshot&&statusLog)statusLog.observe(projectSituation(snapshot,model.report(),telemetry).checks,telemetry.observedAt);
 }
 function sampleOnce(){
  if(!sampleRequest&&!stopping)sampleRequest=sample().finally(()=>{sampleRequest=null;});
  return sampleRequest;
 }
 const timer=sampleHost&&model?setInterval(()=>{void sampleOnce()?.catch(()=>{});},20000):null;
 timer?.unref?.();
 if(timer)void sampleOnce()?.catch(()=>{});
 async function agentTelemetry(){
  if(!telemetry)await sampleRequest;
  if(!telemetry)throw Error('中枢遥测暂不可用');
  const current=await Promise.allSettled([healthSnapshot(),readDiagnostics()]);
  const [snapshot,runtime]=current.map(result=>result.status==='fulfilled'&&result.value?.ok!==false?result.value:null);
  const report=model.report();
  const system=snapshot?healthProjection(snapshot,report):null;
  const freshFrame=frame&&isFresh(frame.observedAt,Date.now(),FRAME_OBSERVATION_MAX_AGE_MS)?frame:null;
  const host=telemetry.host;
  return {...telemetry,system,runtime,unavailable:['system','host','runtime'].filter((_name,index)=>![system,host,runtime][index]),
   frames:{center:freshFrame,others:null},model:report};
 }
 async function shutdown(){
  stopping=true;
  clearInterval(timer);
  await sampleRequest?.catch(()=>{});
  await Promise.all([model?.close(),learningSettings?.flush(),statusLog?.flush()]);
 }
 function learningData(){
  const report=model?.report();
  const {ready=0,fresh=0,expected=0}=report?.quality||{};
  return {
   ok:true,
   allowed:learningSettings.read(),
   sync:'pending_endpoint',
   local:telemetry?.learningHeld?'observing':report?.state||'unobserved',
   coverage:{ready,fresh,expected},
   summary:createHealthSummary({telemetry,report,buildId,appVersion}),
  };
 }
 async function feedback(p,source){
  const account=community.status().user?.id;
  if(!account)throw Error('请先登录 Aieyra');
  const ensureAccount=()=>{if(community.status().user?.id!==account)throw Error('账号已切换，请重新打开版本反馈');};
  const topic=check(await updates({action:'post',id:p.release_topic}));
  ensureAccount();
  if(p.action==='feedback'){
   const cursor=typeof p.cursor==='string'&&p.cursor.length<256?p.cursor:undefined;
   const result=await community.call({action:'replies',id:topic.id,cursor});
   if(!Array.isArray(result.items))throw Error('反馈响应无效');
   return {ok:true,items:result.items.slice(0,20),nextCursor:result.nextCursor||null};
  }
  if(p.action==='feedback_events'){
   const after=p.after??0;
   if(!Number.isSafeInteger(after)||after<0)throw Error('反馈游标无效');
   const result=await community.call({action:'sync',after});
   if(!Array.isArray(result.events)||!Number.isSafeInteger(result.nextCursor))throw Error('反馈事件响应无效');
   return {ok:true,events:result.events.filter(event=>event.topic===topic.id&&event.kind==='reply'),nextCursor:result.nextCursor,hasMore:result.hasMore===true};
  }
  if(!ID.test(p.request_id||''))throw Error('反馈编号无效');
  if(p.action==='feedback_receipt'){
   const receipt=await community.call({action:'receipt',request_id:p.request_id});
   if(!receipt.item?.content?.startsWith('[Aieyra OS 更新反馈] '))throw Error('该回执不属于更新反馈');
   return receipt;
  }
  if(p.confirmed!==true)throw Error('请先确认向官方论坛公开提交');
  const details=typeof p.content==='string'?p.content.trim():'';
  if(!details||details.length>1800||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(details))throw Error('请输入 1–1800 字的公开问题说明');
  const status=await updates({action:'status'});
  ensureAccount();
  const version=status.currentVersion||'未知';
  return community.call({action:'reply',id:topic.id,request_id:p.request_id,
   content:`[Aieyra OS 更新反馈] ${source==='agent'?'Agent':'用户'} · ${version}\n\n${details}`});
 }
 async function call(p={},source='user'){
  if(p.action==='download')return download();
  if(p.action==='health')return health();
  if(p.action==='telemetry'&&source==='agent')return agentTelemetry();
  if(p.action==='learning_data'&&source==='user'&&learningSettings)return learningData();
  if(p.action==='learning_sync'&&source==='user'&&learningSettings){
   if(stopping)throw Error('中枢正在退出，请稍后重试');
   await learningSettings.set(p.allowed);
   return learningData();
  }
  if(p.action==='frame_sample'&&source==='user')return ingestFrame(p);
  if(p.action==='diagnostics')return readDiagnostics();
  if(p.action==='open_management'&&source==='user'&&p.module==='browser'){
   await openManagement(p.module);return {ok:true};
  }
  if(['feedback','feedback_events','feedback_receipt','report_issue'].includes(p.action))return feedback(p,source);
 if(['quick','defer','review_update'].includes(p.action)&&source==='agent')throw Error('请由用户决定何时核对或应用更新');
  if(UPDATE_ACTIONS.has(p.action))return updates(p);
  if(p.action!=='assist'||source==='agent')throw Error('更新程序不支持此操作');
  const state=await updates({action:'status'});
  if(!/^[a-f0-9-]{36}$/i.test(p.request_id||''))throw Error('维护任务编号无效');
  if(p.session_id!==state.homeSession)throw Object.assign(Error('会话已切换，请重新提交维护任务'),{code:'update_session_changed'});
  const binding=check(await conversation({action:'program_open',program:'center'}));
  if(!binding.session?.id)throw Error('请先为 Nova 配置可用模型');
  check(await conversation({action:'send',id:binding.session.id,generation:binding.session.generation||0,request_id:'center-update-'+p.request_id,message:'请先读取中心的健康报告，再检查当前版本、完整性和官方更新。按实际异常核对原始回执、选择可执行的修复或委派，并复查结果。保留私人资料和本地修改。需要我决定时说明具体事项。'}));
  return {...await updates({action:'status'}),accepted:true,request_id:p.request_id,session_id:p.session_id};
 }
 return {open:openPage,snapshot:()=>updates({action:'status'}),user:call,invoke:(operation,args)=>call({...args,action:operation},'agent'),close:releasePage,shutdown};
}
module.exports={createCenterProgram};
