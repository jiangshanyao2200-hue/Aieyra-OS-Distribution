/* @file-map:start
文件: link/desktop/startup-diagnostics.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/bootstrap.cjs, link/desktop/main.cjs
链路: startup
验证: AIDEBUG/portable.test.cjs, AIDEBUG/startup-review.py, AIDEBUG/test_aidebug_launch.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  clean | function
  errorData | function
  start | function
  start.option | function
  start.write | function
  start.event | function
  start.point | function
  start.error | method
  start.phase | method
  start.fail | method
  start.inside | function
  current | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=process.versions.electron?require('original-fs'):require('node:fs'),path=require('node:path'),os=require('node:os');
let active;
const /* @chain-region clean | calls: replace, value.replace */ clean=value=>typeof value==='string'?value.replace(/Bearer\s+[A-Za-z0-9_.-]+/g,'Bearer <redacted>').replace(/((?:token|password|secret|authorization)=)[^\s&]+/gi,'$1<redacted>'):value;
const /* @chain-region errorData | calls: Object.fromEntries, map, filter, clean, String */ errorData=error=>Object.fromEntries(['name','message','code','stack','syscall','path','dest'].filter(k=>error?.[k]!==undefined).map(k=>[k,clean(String(error[k]))]));
/* @chain-region start | calls: require, process.argv.slice, path.join, app.getPath, path.dirname, path.resolve, option, Boolean … */ function start(){
 if(active)return active;
 const {app,dialog,shell,crashReporter}=require('electron'),args=process.argv.slice(1),/* @chain-region start.option | calls: args.find, v.startsWith, assigned.slice, args.indexOf */ option=name=>{const assigned=args.find(v=>v.startsWith(name+'='));if(assigned)return assigned.slice(name.length+1);const index=args.indexOf(name);return index<0?'':args[index+1]||'';};
 const legacy=path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'Aieyra Together Link');
 const local=path.join(app.isPackaged?path.dirname(process.execPath):path.resolve(__dirname,'../..'),'Local');
 const explicit=option('--aidebug-startup-output'),testOutput=option('--aidebug-output'),scenario=option('--aidebug-startup-scenario');
 const isolated=Boolean(testOutput||scenario);
 const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
 let initializationError;
 let directory=explicit&&path.isAbsolute(explicit)?explicit:testOutput&&path.isAbsolute(testOutput)?path.join(testOutput,'startup'):isolated?path.join(os.tmpdir(),'Aieyra Together Link','startup',id):path.join(fs.existsSync(path.join(local,'layout.json'))?local:legacy,'diagnostics','startup',id);
 try{fs.mkdirSync(directory,{recursive:true});}catch(error){initializationError=error;directory=path.join(os.tmpdir(),'Aieyra Together Link','startup',id);fs.mkdirSync(directory,{recursive:true});}
 let version='unknown';try{version=JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8')).version;}catch{}
 const file=path.join(directory,'startup.json'),journal=path.join(directory,'startup-events.jsonl');
 const state={protocol:'aieyra-startup/1',id,pid:process.pid,parentPid:process.ppid,version,executable:process.execPath,application:__dirname,started_at:new Date().toISOString(),state:'starting',phase:'bootstrap',directory,versions:{electron:process.versions.electron,node:process.versions.node,arch:process.arch},events:0};
 const pointers=new Set(!explicit&&!isolated?[path.join(legacy,'runtime','startup.json')]:[]);
 const /* @chain-region start.write | calls: fs.writeFileSync, JSON.stringify, fs.renameSync */ write=()=>{try{const temp=file+'.next';fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(temp,file);}catch{}};
 const /* @chain-region start.event | calls: toISOString, Date, fs.appendFileSync, JSON.stringify, write */ event=(kind,data={})=>{state.events++;state.updated_at=new Date().toISOString();try{fs.appendFileSync(journal,JSON.stringify({at:state.updated_at,kind,...data})+'\n',{mode:0o600});}catch{}write();};
 const /* @chain-region start.point | calls: pointers.add, path.join, fs.mkdirSync, path.dirname, fs.writeFileSync, JSON.stringify */ point=runtime=>{if(runtime)pointers.add(path.join(runtime,'startup.json'));for(const target of pointers)try{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify({protocol:state.protocol,pid:process.pid,output:directory,file}),{mode:0o600});}catch{}};
 let failed=false;
 active={directory,file,state,event,/* @chain-region start.error | calls: errorData, event */ error(error,kind='error'){const data=errorData(error);state.last_error=data;event(kind,{error:data});},/* @chain-region start.phase | calls: toISOString, Date, event */ phase(name,data={}){state.phase=name;state.phase_detail=data;if(name==='ready'){state.state='ready';state.ready_at=new Date().toISOString();}if(name==='degraded')state.state='degraded';event('phase',{phase:name,...data});},point,
  /* @chain-region start.fail | calls: active.error, app.whenReady, dialog.showMessageBox, slice, clean, String, shell.openPath, event … */ async fail(error){
   if(failed)return;failed=true;state.state='failed';active.error(error,'fatal');
   if(!explicit&&!isolated){try{await app.whenReady();const answer=await dialog.showMessageBox({type:'error',title:'众创 Link 启动未完成',message:'众创 Link 未能启动',detail:'错误：'+clean(String(error.message||error)).slice(0,400)+'\n\n诊断记录：'+directory,buttons:['关闭','打开诊断目录'],defaultId:0,noLink:true});if(answer.response===1)await shell.openPath(directory);}catch{}}
   event('fatal-exit',{code:1});app.exit(1);
  },
  scope:null};
 process.on('uncaughtException',error=>{void active.fail(error);});
 process.on('unhandledRejection',error=>{void active.fail(error instanceof Error?error:new Error(String(error)));});
 process.on('exit',code=>{state.exit_code=code;state.exited_at=new Date().toISOString();if(state.state!=='failed')state.state='exited';event('process-exit',{code});});
 app.on('child-process-gone',(_event,details)=>event('child-process-gone',details));
 app.on('web-contents-created',(_event,wc)=>{wc.on('render-process-gone',(_e,details)=>event('render-process-gone',{contents:wc.id,...details}));wc.on('did-fail-load',(_e,code,message)=>event('load-failed',{contents:wc.id,code,message}));});
 point();event('bootstrap',{version});
 if(initializationError)throw initializationError;
 if(explicit&&!path.isAbsolute(explicit))throw Error('absolute_startup_output_required');
 if(scenario){
  const /* @chain-region start.inside | calls: path.relative, path.resolve, relative.startsWith, path.isAbsolute */ inside=value=>{const relative=path.relative(explicit,path.resolve(value));return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
  if(!explicit||!path.isAbsolute(scenario)||!inside(scenario))throw Error('isolated_startup_scenario_required');
  const scope=JSON.parse(fs.readFileSync(scenario,'utf8'));
  for(const key of ['base','legacyBase','legacyProfile'])if(typeof scope[key]!=='string'||!path.isAbsolute(scope[key])||!inside(scope[key]))throw Error('isolated_startup_paths_required');
  if(scope.cloud&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(scope.cloud))throw Error('isolated_startup_cloud_required');
  active.scope=scope;state.isolated_scenario=true;
 }
 try{const dumps=path.join(directory,'crash-dumps');fs.mkdirSync(dumps,{recursive:true});app.setPath('crashDumps',dumps);crashReporter.start({uploadToServer:false,compress:false});state.crash_dumps=dumps;event('crash-reporter',{upload:false});}catch(error){active.error(error,'crash-reporter-unavailable');}
 return active;
}
module.exports={start,/* @chain-region current */ get current(){return active;},errorData};
