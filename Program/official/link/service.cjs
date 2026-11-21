'use strict';
// 复用OS 内置 Link CLI；只显示原身份，不另行配对或接管会话。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');

function dataDirectory(env,platform=process.platform){
 const base=platform==='win32'?env.APPDATA:platform==='darwin'?path.join(env.HOME||os.homedir(),'Library/Application Support'):env.XDG_CONFIG_HOME||path.join(env.HOME||os.homedir(),'.config');
 const directory=env.AIEYRA_LINK_DATA_DIR||base&&path.join(base,'AieyraLink');
 if(!directory||!path.isAbsolute(directory))throw Error('Link 数据目录无效');
 return path.resolve(directory);
}
function childEnvironment(env){
 const result={};for(const key of Object.keys(env))if(/^(path|systemroot|windir|temp|tmp|home|userprofile|appdata|localappdata|xdg_config_home|lang|lc_all|ssl_cert_file|ssl_cert_dir|aieyra_os_owner_port|aieyra_os_owner_token)$/i.test(key))result[key]=env[key];return result;
}
function runCommand(file,args,options={}){
 return new Promise((resolve,reject)=>{
  if(options.signal?.aborted){reject(Object.assign(Error('Link 查询已关闭'),{kind:'closed'}));return;}
  let stdout='',stderr='',size=0,failure=null;
  const child=spawn(file,args,{env:{...options.env,AIEYRA_OS_OWNER_STDIN:'1'},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  function cancel(kind){failure ||= Object.assign(Error('Link 查询未完成'),{kind});try{child.stdin.end();}catch{}}
  const abort=()=>cancel('closed');options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>cancel('timeout'),options.timeout||22000);
  function collect(chunk,diagnostic){size+=chunk.length;if(size>9*1024*1024){cancel('output_limit');return;}if(diagnostic)stderr+=String(chunk);else stdout+=String(chunk);}
  child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>collect(chunk,false));child.stderr.on('data',chunk=>collect(chunk,true));
  child.once('error',()=>{failure ||= Object.assign(Error('Link 未能启动'),{kind:'query_failed'});});
  child.once('close',(code,signal)=>{
   clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
   if(failure)reject(failure);
   else if(code!==0||signal)reject(Object.assign(Error('Link 查询失败'),{kind:stderr.trim()==='Link hub unavailable'?'offline':'query_failed'}));
   else resolve(stdout);
  });
 });
}
const text=(v,max=240)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max):'';
function object(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function rows(v){if(!Array.isArray(v)||v.length>10000||v.some(x=>!object(x)))throw Error('invalid_catalog');return v;}
function observedState(row,now){
 const time=Date.parse(row.updated_at);
 if(!Number.isFinite(time)||time>now+5000)return 'unknown';
 if(now-time>45000)return 'offline';
 return ['online','idle','busy','waiting_user','offline'].includes(row.state)?row.state:'unknown';
}
function projectCatalog(value,now){
 if(!object(value)||!Number.isSafeInteger(value.cursor)||value.cursor<0)throw Error('invalid_catalog');
 const devices=rows(value.devices).map(d=>({device_id:text(d.device_id,160),name:text(d.name,120),admin:typeof d.admin==='boolean'?d.admin:null,revoked:typeof d.revoked==='boolean'?d.revoked:null}));
 const revoked=new Set(devices.filter(d=>d.revoked).map(d=>d.device_id));
 const sessions=rows(value.sessions).map(s=>({id:text(s.id,160),device_id:text(s.device_id,160),local_id:text(s.local_id,160),title:text(s.title),mode:text(s.mode,40),updated_at:text(s.updated_at,60),state:revoked.has(s.device_id)?'offline':observedState(s,now)}));
 if(devices.some(d=>!d.device_id)||sessions.some(s=>!s.id||!s.device_id))throw Error('invalid_catalog');
 return {devices,sessions,cursor:value.cursor,observed_at:new Date(now).toISOString(),stale:false};
}
function projectControl(value,now){
 if(!object(value)||value.protocol!=='aieyra-control-relay/1')throw Error('invalid_catalog');
 const services=rows(value.services).map(s=>({id:text(s.id,160),device_id:text(s.device_id,160),name:text(s.name,120),updated_at:text(s.updated_at,60),state:observedState(s,now)}));
 if(services.some(s=>!s.id||!s.device_id))throw Error('invalid_catalog');
 return {services,protocol:value.protocol,observed_at:new Date(now).toISOString(),stale:false};
}
function stale(value){
 if(!value)return null;
 return {...value,stale:true,...(value.sessions?{sessions:value.sessions.map(s=>({...s,state:'unknown'}))}:{}),...(value.services?{services:value.services.map(s=>({...s,state:'unknown'}))}:{})};
}
function identityStamp(directory){
 for(const name of ['device.json','owner.json']){
  try{const s=fs.statSync(path.join(directory,name));if(!s.isFile()||s.size>65536)throw Error('invalid_identity_file');return name+':'+s.size+':'+s.mtimeMs+':'+s.ctimeMs+':'+s.ino;}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return null;
}
function createLink({apps,env=process.env,platform=process.platform,run=runCommand,now=Date.now,timeout=22000,cacheMs=4000,closeTimeout=10000}={}){
 let closed=false,closing=null,pending=null,last=-Infinity,identityKey='',versionKey='',version=null;
 let codePending=null,codeCache=null;
 let state={ok:true,installed:false,identity_state:'unknown',hub_state:'unknown',catalog:null,control:null,error:null,control_error:null};
 const abort=new AbortController(),safeEnv=childEnvironment(env);
 async function refresh(){
  let installation,directory,key;
  try{installation=await apps.call({action:'status',app_id:'aieyra.link'});}catch{return state={...state,installed:null,identity_state:'unknown',hub_state:'unknown',catalog:stale(state.catalog),control:stale(state.control),error:'Link 安装入口无法确认，请修复 OS 安装。'};}
  if(closed)return snapshot();
  if(!installation.installed)return state={ok:true,installed:false,supported:installation.installationSupported!==false,identity_state:'unknown',hub_state:'unknown',catalog:null,control:null,error:null,control_error:null};
  state={...state,installed:true,error:null,control_error:null};
  try{directory=dataDirectory(env,platform);key=identityStamp(directory);}catch{return state={...state,identity_state:'unreadable',hub_state:'unknown',catalog:null,control:null,error:'无法读取 Link 身份配置，请使用 Link 检查原有配置。'};}
  const nextKey=installation.executable+'|'+directory+'|'+key;
  if(nextKey!==identityKey){identityKey=nextKey;codeCache=null;state={...state,catalog:null,control:null};}
  const invoke=(command)=>run(installation.executable,[command,...(command==='version'?[]:['--data',directory])],{env:safeEnv,timeout,signal:abort.signal});
  if(versionKey!==installation.executable){
   try{const raw=await invoke('version');const match=/^Aieyra Link (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\s*$/.exec(raw);version=match?match[1]:null;}catch{version=null;}
   versionKey=installation.executable;
  }
  if(closed)return snapshot();
  state={...state,version,identity_state:key?'configured':'missing'};
  if(!key)return state={...state,hub_state:'unknown',catalog:null,control:null,error:'尚未配置 Link 设备身份。请先在 OS 的 Link 页面连接自己的设备。'};
  const results=await Promise.allSettled([invoke('status'),invoke('control-status')]);
  if(closed)return snapshot();
  // An identity changed during a query must not display the previous account's catalog.
  try{if(identityStamp(directory)!==key){identityKey='';return state={...state,identity_state:'unknown',hub_state:'unknown',catalog:null,control:null,error:'Link 身份配置已变化，正在等待重新查询。'};}}catch{identityKey='';return state={...state,identity_state:'unreadable',hub_state:'unknown',catalog:null,control:null,error:'Link 身份配置无法确认。'};}
  let successes=0;
  for(let index=0;index<2;index++){
   const result=results[index],field=index?'control':'catalog',errorField=index?'control_error':'error';
   try{if(result.status==='rejected')throw result.reason;state[field]=(index?projectControl:projectCatalog)(JSON.parse(result.value),now());state[errorField]=null;successes++;}
   catch(e){state[field]=stale(state[field]);state[errorField]=e.kind==='offline'?'Link Hub 当前不可达。':e.kind==='timeout'?'Link 查询超时。':'Link 查询未成功，请在 Link 中核对身份与连接。';}
  }
  state.hub_state=successes?'online':results.every(r=>r.status==='rejected'&&r.reason.kind==='offline')?'offline':'unknown';
  if(successes)state.identity_state='verified';
  state.checked_at=new Date(now()).toISOString();return snapshot();
 }
 function snapshot(){return closed?{...state,hub_state:'closed',catalog:stale(state.catalog),control:stale(state.control)}:structuredClone(state);}
 function status(){if(closed)return Promise.resolve(snapshot());if(pending)return pending;if(now()-last<cacheMs)return Promise.resolve(snapshot());pending=refresh().then(()=>snapshot()).finally(()=>{last=now();pending=null;});return pending;}
 async function readCode(){
  const unavailable=()=>({ok:false,device_code:'',expires_unix:0});
  try{
   const installation=await apps.call({action:'status',app_id:'aieyra.link'});
   if(closed||!installation.installed)return unavailable();
   const directory=dataDirectory(env,platform),key=identityStamp(directory);
   if(!key){codeCache=null;return unavailable();}
   const stamp=installation.executable+'|'+directory+'|'+key;
   // code 创建一次性邀请。仅页面消费，状态轮询和模型工具不触发它。
   if(codeCache?.stamp===stamp&&codeCache.expires_unix*1000>now()+5000)return {...codeCache.value};
   codeCache=null;
   const raw=await run(installation.executable,['code','--data',directory],{env:safeEnv,timeout,signal:abort.signal});
   if(closed||identityStamp(directory)!==key)return unavailable();
   const value=JSON.parse(raw);
   if(!object(value)||typeof value.device_code!=='string'||!value.device_code.length||value.device_code.length>8192||/[\s\u0000-\u001f\u007f]/.test(value.device_code)||!Number.isSafeInteger(value.expires_unix)||value.expires_unix*1000<=now()+5000)return unavailable();
   const result={ok:true,device_code:value.device_code,expires_unix:value.expires_unix};
   codeCache={stamp,expires_unix:value.expires_unix,value:result};return {...result};
  }catch{codeCache=null;return unavailable();}
 }
 function deviceCode(){
  if(closed)return Promise.resolve({ok:false,device_code:'',expires_unix:0});
  if(codePending)return codePending;
  codePending=readCode().finally(()=>{codePending=null;});return codePending;
 }
 function close(){
  if(closing)return closing;
  let resolve,reject;closing=new Promise((ok,fail)=>{resolve=ok;reject=fail;});
  closed=true;codeCache=null;const waiting=Promise.all([pending,codePending]);abort.abort();
  const unconfirmed=()=>Object.assign(Error('Link 释放尚未确认'),{code:'link_release_unconfirmed'});
  const timer=setTimeout(()=>reject(unconfirmed()),closeTimeout);
  Promise.resolve(waiting).then(()=>{clearTimeout(timer);resolve();},()=>{clearTimeout(timer);reject(unconfirmed());});
  return closing;
 }
 return {status,deviceCode,close};
}
module.exports={createLink,projectCatalog,projectControl,dataDirectory,childEnvironment,runCommand};
