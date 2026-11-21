// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: http; situationOf; runtimeOptions; assertOfficeScope; requestJSON; recent; projectOffice; pageTimeout; withDeadline; createControl
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/control.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Control owns its service, office registry and UI. OS only hosts its page and
// reads its public local projection; the Agent Bearer never enters this module.
const http=require('node:http'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {spawn}=require('node:child_process');
// 态势感知（用户 2026-10-16 夜）：与 Link 页面共用 Control/app/web/situation.js（纯函数 ES 模块，Node 可直接 require）。
// OS 顶栏的 Link 按钮、独立 Link 的标题栏都用这里算好的条目；读不到这个文件时不显示态势，不影响其他功能。
let situationOf=null;
try{situationOf=require('../../../Control/app/web/situation.js').situation;}catch{}

function runtimeOptions(env=process.env){
 const port=env.AIEYRA_CONTROL_PORT===undefined?17910:Number(env.AIEYRA_CONTROL_PORT);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('指挥中心端口必须为1024至65535');
 const args=['--port='+port];
 for(const [key,option] of [['AIEYRA_CONTROL_DATA_DIR','data-dir'],['AIEYRA_CONTROL_CONFIG','config']]){
  if(!env[key])continue;if(!path.isAbsolute(env[key]))throw Error('指挥中心'+option+'必须为绝对路径');args.push('--'+option+'='+path.resolve(env[key]));
 }
 return {args,url:'http://127.0.0.1:'+port};
}
function assertOfficeScope(health,env){
 // A free port can be taken between probing and launch. Never read another
 // profile's snapshot/registry merely because its service is healthy.
 if(env.AIEYRA_CONTROL_SCOPE&&health?.profile_scope!==env.AIEYRA_CONTROL_SCOPE)throw Error('Link 端口属于另一份资料，已拒绝连接；请重新打开以分配独立端口');
}
function requestJSON(base,endpoint,{timeout=2500,limit=2*1024*1024}={}){
 return new Promise((resolve,reject)=>{
  const url=new URL(base+endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||!endpoint.startsWith('/api/'))throw Error('指挥中心仅使用本机接口');
  let settled=false,req,timer;
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);}
  function fail(message,code){const error=Object.assign(Error(message),{code});finish(error);req?.destroy();}
  timer=setTimeout(()=>fail('指挥中心连接超时','ETIMEDOUT'),timeout);
  try{req=http.get(url,{headers:{Accept:'application/json'}},res=>{
   let size=0;const chunks=[];
   if(res.statusCode!==200){res.resume();fail('指挥中心暂未返回有效状态','INVALID_RESPONSE');return;}
   res.on('data',chunk=>{size+=chunk.length;if(size>limit)fail('指挥中心响应过大','INVALID_RESPONSE');else chunks.push(chunk);});
   res.on('error',error=>finish(error));res.on('aborted',()=>fail('指挥中心响应中断','ECONNRESET'));
   res.on('end',()=>{try{if(!res.complete)throw Error('指挥中心响应不完整');finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){finish(error);}});
  });req.on('error',error=>finish(error));}catch(error){finish(error);}
 });
}
function recent(stamp,now){const time=Date.parse(stamp||'');return Number.isFinite(time)&&time<=now+5000&&now-time<=180000;}
function projectOffice(snapshot,registry,now=Date.now()){
 if(!snapshot||!Array.isArray(snapshot.agents)||!registry||!Array.isArray(registry.seats))throw Error('指挥中心状态结构无效');
 const snapshotFresh=recent(snapshot.observed_at,now),registryFresh=recent(registry.observed_at,now)&&registry.connection?.state==='online';
 const heartbeatFresh=snapshotFresh&&snapshot.connection?.state==='online';
 const agents=new Map(snapshot.agents.map(a=>[a.id,a]));
 const seats=registry.seats.filter(s=>s.membership_state!=='removed').map(s=>{
  const a=agents.get(s.actor_id),r=a?.runtime||{};
  // The local runtime can still be observed when the coordination hub is offline.
  const fresh=snapshotFresh&&r.bound===true&&r.stale===false&&recent(r.last_activity_at||r.observed_at,now);
  const state=fresh&&['running','idle','waiting','waiting_user','blocked','failed','cancelling','completed'].includes(r.state)?r.state:'unknown';
  return {id:String(s.id||''),name:String(s.name||s.id||''),project:String(s.project||''),online:heartbeatFresh&&typeof a?.online==='boolean'?a.online:null,execution_state:state,observed_at:r.observed_at||null};
 });
 return {observed_at:snapshot.observed_at||null,registry_observed_at:registry.observed_at||null,connection:snapshot.connection?.state||'unknown',registry_connection:registry.connection?.state||'unknown',stale:!heartbeatFresh||!registryFresh,count_stale:!registryFresh,seats,count:seats.length,os_count:seats.filter(s=>s.project==='os').length,running:seats.filter(s=>s.execution_state==='running').length};
}
// ownerKind：本宿主以哪种身份持有 Control（os = Aieyra OS，link = 独立 Aieyra Link）。
// 另一方持有时只读取公开状态，不启动第二个服务。
// 页面载入的截止时间（用户 2026-10-13 第 L 项）：loadURL 只等主文档，子资源卡住时它可能一直不落，
// 界面就会永远停在“正在连接指挥中心…”。到点就当作载入失败，让用户看到可重试的提示，而不是无休止的等待。
const pageTimeout=20000;
function withDeadline(promise,ms,message){
 let timer;
 return Promise.race([promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(message),{code:'control_page_timeout'})),ms);})]).finally(()=>clearTimeout(timer));
}
function createControl({apps,win,electron,config,env=process.env,launch=spawn,read=requestJSON,now=Date.now,platform=process.platform,createServer=net.createServer,closeTimeout=45000,ownerKind='os',allowExternalView=false,attachOnly=false,pageLoadTimeout=pageTimeout,startupTimeout=20000,startupPollMs=300,onRequest=()=>{},registerDrop,presence=()=>null,createPage=null,nativeModal=null,modalWindow=()=>win}={}){
 if(!['os','link'].includes(ownerKind))throw Error('指挥中心持有者无效');
 let options,configError='';try{options=runtimeOptions(env);}catch(e){configError=e.message;}
 let closed=false,closing=null,owner=null,starting=null,ensuring=null,polling=null,view=null,loading=null,shown=false,rect=null,loaded=false,last=null,workspaceInset=0;
 const children=new Set();
 let state={available:false,service_state:'unobserved',installed:false,ownership:'none',error:configError,page_error:null,checked_at:null};
 let situation=null,lan=null,lanAt=0,cloudOf=()=>null,pushed='',portal=null,modalSource=null;
 function summarize(){
  if(!require('../src/resources.cjs').releaseStage().link_situation||!situationOf||!last){situation=null;return;}
  try{
   const live=state.available===true&&last.snapshot?.connection?.state==='online';
   const v=situationOf({registry:last.registry,snapshot:last.snapshot,live,lan,cloud:cloudOf(),now:now()});
   situation={items:v.items.slice(0,12).map(({key,kind,tone,text})=>({key,kind,tone,text})),platforms:v.platforms,cloud:v.cloud,at:new Date(now()).toISOString()};
  }catch{situation=null;}
 }
 // 云号池状态推给 Link 页面（页面没有 preload，只认 window 事件 aieyra-host；内容只有云号池编号和是否就绪）。
 function pushHost(){
  if(!view||!loaded||closed||view.webContents.isDestroyed?.())return;
  const key=JSON.stringify({cloud:cloudOf()||null,features:require('../src/resources.cjs').releaseStage()});if(key===pushed)return;pushed=key;
  const wc=view.webContents;if(typeof wc.executeJavaScript!=='function')return;
  try{Promise.resolve(wc.executeJavaScript("(()=>{document.getElementById('aieyra-presence-clearance')?.remove();window.dispatchEvent(new CustomEvent('aieyra-host',{detail:"+key+"}));})()",false)).catch(()=>{pushed='';});}catch{pushed='';}
 }
 const pagePartition='control-in-os-'+crypto.randomBytes(12).toString('hex');
 function value(){
  const office=last?projectOffice(last.snapshot,last.registry,now()):null;
  if(office&&!state.available){office.stale=true;office.count_stale=true;office.running=null;office.seats=office.seats.map(s=>({...s,online:null,execution_state:'unknown'}));}
  return {ok:true,...state,office,situation,page_ready:loaded&&!closed,shown:!!view&&loaded&&!closed&&(portal?portal.shown():shown&&!!rect)};
 }
 async function installation(){try{return await apps.call({action:'status',app_id:'aieyra.control'});}catch(e){return {installed:false,error:e.message};}}
 function checkOffice(health){
  const migrated=attachOnly&&env.AIEYRA_CONTROL_SCOPE&&health?.service==='aieyra-together-link';
  if(health?.service!=='aieyra-control'&&!migrated)throw Error('指挥中心端口被其他服务占用');
  if(health.os_managed!==true)throw Error('旧版独立 Control 仍在运行，请先完成迁移');
  assertOfficeScope(health,env);
 }
 async function poll(){
  if(closed)return value();if(polling)return polling;
  polling=(async()=>{
   if(env.AIEYRA_CONTROL_DISABLED==='1'){state={...state,available:false,service_state:'disabled'};return value();}
   const found=await installation();if(closed)return value();state.installed=found.installed===true;state.installation_error=found.error||null;state.checked_at=new Date(now()).toISOString();
   if(!options){state={...state,available:false,service_state:'unavailable',error:configError};return value();}
   try{
    const health=await read(options.url,'/api/health',{limit:8192});checkOffice(health);
    const heldBy=health.owner_kind==='link'?'link':'os';
    const [snapshot,registry]=await Promise.all([read(options.url,'/api/snapshot'),read(options.url,'/api/registry')]);
    projectOffice(snapshot,registry,now());if(closed)return value();last={snapshot,registry};
    if(now()-lanAt>30000){lanAt=now();lan=await read(options.url,'/api/link').then(v=>v?.auto_lan||null,()=>lan);}
    state={...state,available:true,service_state:'ready',version:health.version||null,ownership:owner?.confirmed?'owned':'external',owner_kind:heldBy,detached:!allowExternalView&&heldBy!==ownerKind&&!owner?.confirmed,error:null};
   }catch(e){if(!closed)state={...state,available:false,service_state:e.code==='ECONNREFUSED'?'offline':'unavailable',error:e.code==='ECONNREFUSED'?'指挥中心未运行':e.message};}
   summarize();pushHost();
   return value();
  })().finally(()=>{polling=null;});return polling;
 }
 function layout(){if(!view||view.webContents.isDestroyed())return;const visible=shown&&!!rect&&loaded&&!closed;if(portal)portal.layout({visible,bounds:rect});else{view.setVisible(visible);if(visible)view.setBounds({...rect,x:rect.x+workspaceInset,width:Math.max(1,rect.width-workspaceInset)});}modalSource?.refresh();if(visible){if(config)view.webContents.setZoomFactor(win.webContents.getZoomFactor());pushHost();}}
 function hide(){shown=false;layout();}
 const ownerContents=win.webContents;ownerContents.on('did-start-navigation',hide);
 function mount(){
  if(view||closed)return;const {WebContentsView,session}=electron;
  const ses=session.fromPartition(pagePartition);ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);
  const webPreferences={...((registerDrop||nativeModal)?{preload:path.join(__dirname,'file-drop-preload.cjs')}:{preload:undefined}),session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:true};
  if(createPage){portal=createPage({key:'link',title:'Link',url:options.url+'/',webPreferences});view=portal.view;}
  else view=new WebContentsView({webPreferences});
  // 透明：Link 网页底色透明，背景由 OS 或 Link 窗口提供（Aieyra OS 统一风格）。
  view.setBackgroundColor?.('#00000000');
  view.setVisible(false);if(!portal)win.contentView.addChildView(view);const mounted=view,wc=view.webContents;
  // The shared native host can close a standalone page before this service.
  // Forget that page immediately so shutdown and a later open never touch a
  // destroyed native View. Moving between containers does not destroy it.
  wc.once('destroyed',()=>{if(view===mounted){modalSource?.release();modalSource=null;view=null;portal=null;loaded=false;shown=false;pushed='';}});
  if(config){require('./view-theme.cjs').followViewAppearance(wc,config);require('../src/interface-zoom.cjs').forConfig(config).input(wc,win);}
  const allowed=url=>{try{const u=new URL(url);return u.origin===options.url&&!u.username&&!u.password;}catch{return false;}};
  modalSource=nativeModal?.register(wc,{window:modalWindow,visible:()=>view===mounted&&loaded&&!closed&&(portal?portal.shown():shown&&!!rect),allowed,receive:true});
  registerDrop?.(wc,allowed);
  function external(url){try{const u=new URL(url);if(['https:','http:','mailto:'].includes(u.protocol)&&!u.username&&!u.password&&u.href.length<=4096&&env.AIEYRA_WORKSPACE_OFFSCREEN!=='1')Promise.resolve(electron.shell.openExternal(u.href)).catch(()=>{if(!closed)state.error='外部链接未能打开';});}catch{}}
  wc.setWindowOpenHandler(({url})=>{if(!allowed(url))external(url);return {action:'deny'};});
  wc.on('will-navigate',(event,url)=>{if(!allowed(url)){event.preventDefault();external(url);}});
  wc.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
  wc.on('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace){loaded=false;layout();}});
  // Link 页面没有 preload：要宿主做的事（打开远程服务器）用同页锚点 #os-<动作> 表达，只认白名单。
  wc.on('did-navigate-in-page',(_event,url,isMainFrame)=>{
   if(!isMainFrame||!allowed(url))return;
   const hit=/^#os-(remote)(?:=([1-9]\d{0,9}))?$/.exec(new URL(url).hash);
   if(hit)try{onRequest({action:hit[1],instance:hit[2]?Number(hit[2]):null});}catch{}
  });
  wc.on('did-finish-load',()=>{if(!closed){loaded=true;state.page_error=null;layout();pushed='';pushHost();}});
  wc.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(!closed&&isMainFrame&&code!==-3){loaded=false;state.page_error='指挥中心页面未能载入，可重新打开';layout();}});
  wc.on('render-process-gone',()=>{if(!closed){loaded=false;state.page_error='指挥中心页面已退出，可重新打开';layout();}});
 }
 function loadPage(){
  if(loading)return loading;if(loaded)return Promise.resolve();
  const current=view;
  loading=withDeadline(current.webContents.loadURL(options.url+'/'),pageLoadTimeout,'指挥中心页面载入超时').then(()=>{if(!closed&&view===current){loaded=true;state.page_error=null;layout();}}).catch(error=>{if(!closed&&view===current){loaded=false;state.page_error=error?.code==='control_page_timeout'?'指挥中心页面载入超时，可重试':'指挥中心页面未能载入，可重新打开';layout();}throw error;}).finally(()=>{loading=null;});
  return loading;
 }
 function endOwner(record,shutdown=false){
  if(!record||record.ended)return;record.ended=true;clearTimeout(record.timer);
  try{record.server?.close();}catch{}
  if(record.input&&!record.input.destroyed){
   try{if(shutdown&&record.confirmed)record.input.write(JSON.stringify({type:'owner.shutdown',owner_id:record.id})+'\n');}catch{}
   try{record.input.end();}catch{}
  }
 }
 async function waitForChild(record){
  let timer;
  try{
   const result=await Promise.race([record.exited,new Promise((_resolve,reject)=>{
    timer=setTimeout(()=>reject(Object.assign(Error('指挥中心退出尚未确认'),{code:'control_shutdown_unconfirmed'})),closeTimeout);
   })]);
   if(result.failedToStart)throw Object.assign(Error('指挥中心启动未完成'),{code:'control_start_failed'});
   if(result.code!==0||result.signal!==null)throw Object.assign(Error('指挥中心未正常退出'),{code:'control_exit_failed'});
  }finally{clearTimeout(timer);}
 }
 async function startOwned(found){
  if(owner?.ended)throw Object.assign(Error('上次指挥中心启动的退出尚未确认，请稍后重试'),{code:'control_start_exit_pending'});
  if(owner||closed)return;
  const record={id:crypto.randomBytes(16).toString('hex'),confirmed:false,ended:false,proc:null,input:null,server:null,timer:null};owner=record;
  const clean={...env};for(const key of Object.keys(clean))if(key==='ELECTRON_RUN_AS_NODE'||key==='AIEYRA_WORKSPACE_BRIDGE'||key.startsWith('AIEYRA_RUNTIME_'))delete clean[key];
  function receiver(channel){let buffer='';return chunk=>{
   if(closed||owner!==record||record.ended)return;buffer+=String(chunk);
   if(Buffer.byteLength(buffer)>16384){buffer='';endOwner(record);return;}
   while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);let msg;try{msg=JSON.parse(line);}catch{continue;}
    if(channel&&msg?.type==='control.ready'&&msg.owned===true&&msg.owner_id===record.id&&msg.pid===record.proc?.pid){record.confirmed=true;clearTimeout(record.timer);state.ownership='owned';}
    else if(msg?.type==='control.attached'&&msg.owned===false){state.ownership='external';endOwner(record);}
    else if(msg?.type==='control.error'){state.error='指挥中心所有权握手失败';endOwner(record);}
   }
  };}
  function attach(input,output){
   record.input=input;input.on('error',()=>{});output.on('data',receiver(true));
   output.once('end',()=>{record.confirmed=false;endOwner(record);if(!closed&&owner===record)state.ownership='external';});
   input.write(JSON.stringify({type:'owner.hello',owner_id:record.id})+'\n');
  }
  try{
   if(closed||record.ended){try{record.server?.close();}catch{}endOwner(record);throw Error('指挥中心宿主已关闭');}
   const proc=launch(found.executable,[...(found.args||[]),'--os-managed','--os-owner-stdin','--owner-kind='+ownerKind,...options.args],{cwd:found.directory,windowsHide:true,stdio:['pipe','pipe','ignore'],env:clean,shell:false});record.proc=proc;
   children.add(record);let exited;record.exited=new Promise(resolve=>{exited=resolve;});
   proc.once('close',(code,signal)=>exited({code,signal}));
   record.timer=setTimeout(()=>{if(!closed&&owner===record&&!record.confirmed){state.error='指挥中心所有权握手未完成';endOwner(record);}},10000);record.timer.unref?.();
   proc.once('error',()=>{if(!proc.pid)exited({failedToStart:true});endOwner(record);if(owner===record){owner=null;if(!closed)state.error='指挥中心未能启动';}});
   proc.once('exit',()=>{endOwner(record);if(owner===record){owner=null;if(!closed)state.ownership='external';}});
   attach(proc.stdin,proc.stdout);
  }catch(error){endOwner(record);if(owner===record)owner=null;throw error;}
 }
 // 只保证本地指挥中心「在跑」，不挂载本地页面。
 // 用户 2026-10-13：云办公室（cloud-office.json mode=cloud）接管 Link 视图以后，本地指挥中心就不再启动，
 // 于是四个工位档案指向的 17930 无人服务，工位全部显示离线。云视图与本地工位服务是两回事：
 // 云视图可以接管「看什么」，但本地 17930 必须照常服务工位。
 async function ensure({requireOwner=false}={}){
  if(closed)throw Error('指挥中心宿主已关闭');
  if(ensuring){
   const health=await ensuring;
   if(requireOwner&&(health.owner_kind==='link'?'link':'os')!==ownerKind)return ensure({requireOwner});
   return health;
  }
  ensuring=(async()=>{
   if(env.AIEYRA_CONTROL_DISABLED==='1')throw Error('此会话未启用指挥中心');
   if(!options)throw Error(configError);
   const deadline=Date.now()+startupTimeout;
   let health,launched=false,record=null;
   try{
    while(!closed&&Date.now()<deadline){
     try{health=await read(options.url,'/api/health',{limit:8192,timeout:Math.max(1,Math.min(2500,deadline-Date.now()))});}
     catch(e){if(e.code!=='ECONNREFUSED')throw Error('指挥中心连接结果尚未确认，请稍后重试');health=null;}
     if(closed)throw Error('指挥中心宿主已关闭');
     if(health){
      checkOffice(health);
      if(!requireOwner||(health.owner_kind==='link'?'link':'os')===ownerKind)return health;
     }else if(!launched){
      if(attachOnly)throw Error('本地办公室已交给 Together，请打开 Together');
      const found=await installation();if(closed)throw Error('指挥中心宿主已关闭');
      if(!found.installed)throw Error(found.error||'尚未安装 Aieyra Control');
      await startOwned(found);record=owner;launched=true;
     }
     if(Date.now()>=deadline)break;
     await new Promise(resolve=>setTimeout(resolve,Math.min(startupPollMs,Math.max(1,deadline-Date.now()))));
    }
    if(closed)throw Error('指挥中心宿主已关闭');
    if(health&&requireOwner)throw Object.assign(Error(ownerKind==='link'?'Aieyra OS 尚未交出指挥中心，请稍后重试':'指挥中心正在独立的 Aieyra Link 中运行'),{code:'control_held_elsewhere'});
    throw Object.assign(Error('指挥中心启动未能确认健康状态，请重试'),{code:'control_start_timeout'});
   }catch(error){
    // 只结束本次启动的 owner 通道；未知或他方服务绝不发送退出命令。
    if(record&&owner===record)endOwner(record,true);
    throw error;
   }
  })().finally(()=>{ensuring=null;});return ensuring;
 }
 async function open(){
  if(closed)throw Error('指挥中心宿主已关闭');if(starting)return starting;
  starting=(async()=>{
   const health=await ensure();
   // A standalone Link may show the healthy shared office without owning its
   // process. Only a confirmed owner ever receives shutdown in release/close.
   if(!allowExternalView&&(health.owner_kind==='link'?'link':'os')!==ownerKind&&!owner?.confirmed)throw Object.assign(Error(ownerKind==='os'?'指挥中心正在独立的 Aieyra Link 中运行':'指挥中心正由 Aieyra OS 使用'),{code:'control_held_elsewhere'});
   mount();await loadPage();if(closed)throw Error('指挥中心宿主已关闭');await poll();return value();
  })().finally(()=>{starting=null;});return starting;
 }
 function surface(p={}){
  if(closed)return value();
  if(p.visible===true){const b=p.bounds,z=ownerContents.getZoomFactor(),[w,h]=win.getContentSize();
   if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.width<=0||b.height<=0||!Number.isFinite(z)||z<=0){hide();throw Error('指挥中心显示区域无效');}
   const x=Math.max(0,Math.ceil(b.x*z)),y=Math.max(0,Math.ceil(b.y*z)),right=Math.min(w,Math.floor((b.x+b.width)*z)),bottom=Math.min(h,Math.floor((b.y+b.height)*z));rect=right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null;
  }shown=p.visible===true;layout();return value();
 }
 function close(){
  if(closing)return closing;
  let resolve,reject;closing=new Promise((ok,fail)=>{resolve=ok;reject=fail;});
  closed=true;state={...state,available:false,service_state:'closed'};
  modalSource?.release();modalSource=null;
  let viewFailed=false;
  try{
   hide();ownerContents.removeListener('did-start-navigation',hide);
   if(view){if(!view.webContents.isDestroyed()){const ses=view.webContents.session;ses.setPermissionRequestHandler(null);ses.setPermissionCheckHandler(null);}if(portal)portal.destroy();else{if(!win.isDestroyed())win.contentView.removeChildView(view);if(!view.webContents.isDestroyed())view.webContents.close();}}
  }catch{viewFailed=true;}finally{view=null;}
  // EOF is the documented owner shutdown contract. Never kill by name/PID/port.
  endOwner(owner,true);
  Promise.allSettled([...children].map(waitForChild)).then(results=>{
   const failed=results.find(r=>r.status==='rejected');
   if(failed)reject(failed.reason);
   else if(viewFailed)reject(Object.assign(Error('指挥中心页面释放尚未确认'),{code:'control_view_release_unconfirmed'}));
   else resolve();
  });
  return closing;
 }
 // 交出所有权但保留宿主：页面卸载，本侧 Control 子进程按 EOF 合同退出；之后仍可再次 open()。
 async function release(){
  if(closed)return value();
  await Promise.allSettled([starting,ensuring]);
  hide();
  modalSource?.release();modalSource=null;
  if(view){const current=view;view=null;loaded=false;try{if(portal){portal.destroy();portal=null;}else{if(!win.isDestroyed())win.contentView.removeChildView(current);if(!current.webContents.isDestroyed())current.webContents.close();}}catch{}}
  const record=owner;
  if(record){endOwner(record,true);try{await waitForChild(record);}finally{children.delete(record);if(owner===record)owner=null;}}
  state={...state,available:false,service_state:'released',ownership:'none'};last=null;
  return value();
 }
 // ensure 一并交给云模式：云视图接管的是「看什么」，本地 17930 必须照常服务工位（见 ensure 注释）。
 // setCloud：云办公室挂上后告诉本宿主怎么读云号池状态（{id, ready}），态势与 Link 页面右上角都用它。
 return require('./cloud-control.cjs').attachCloudControl({setInset(x){
  if(x===workspaceInset)return;
  workspaceInset=x;
  // Registered Link pages receive their bounds through the extension host.
  if(!portal&&shown&&rect&&loaded&&view&&!view.webContents.isDestroyed())view.setBounds({...rect,x:rect.x+x,width:Math.max(1,rect.width-x)});
 },status:poll,peek:value,open,surface,close,release,ensure,refreshPresence:pushHost,setCloud(fn){cloudOf=typeof fn==='function'?fn:()=>null;}},{win,electron,env,launch});
}
module.exports={createControl,projectOffice,runtimeOptions,requestJSON};
