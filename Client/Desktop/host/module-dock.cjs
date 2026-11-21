// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; registry; DETACHABLE; PAGES; moduleEnvironment; createModuleDock
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/module-dock.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// OS 侧模块停靠：发现独立运行的 Link，拖出时交出 OS 持有的指挥中心并启动独立窗口，
// 放回时恢复标签。外嵌期间 OS 内的 Link 页面请求转给独立窗口。
// Workspace 与 Editor 已移出 OS。
const path=require('node:path');
const {spawn}=require('node:child_process');
const registry=require('./modules/registry.cjs');

const DETACHABLE=Object.freeze(['link']);
const PAGES=Object.freeze({link:['link','control']});

function moduleEnvironment(env){
 const clean={};
 for(const [key,value] of Object.entries(env||{})){
  // 独立软件不继承 OS 的生命周期凭据、桥接描述、预加载脚本与调试观察器。
  if(key==='ELECTRON_RUN_AS_NODE'||key==='NODE_OPTIONS'||key==='AIEYRA_WORKSPACE_BRIDGE'||key.startsWith('AIEYRA_OS_OWNER_')||key.startsWith('AIEYRA_RUNTIME_')||key.startsWith('AIEYRA_EXPERIENCE_OBSERVER_')||['AIEYRA_WORKSPACE_TEST_CDP_PORT','AIEYRA_WORKSPACE_OFFSCREEN','AIEYRA_MODULE_TEST_CDP_PORT','AIEYRA_MODULE_OFFSCREEN'].includes(key))continue;
  clean[key]=value;
 }
 return clean;
}

function createModuleDock({
 config,root,control,notify=()=>{},version='',
 // 放回后切到对应页面。
 navigate=()=>{},
 env=process.env,electronPath=process.execPath,launch=spawn,pollMs=2000,startTimeout=20000,quitTimeout=20000,
 trace=()=>{},runtimeAction=null,runtimeState=null,presence=()=>null,diagnostics=()=>({available:false}),
 identity=()=>null,programCheck=null,programCapture=null,
}={}){
 const configDir=require('../src/paths.cjs').dataDir(path.resolve(config));
 const state=Object.fromEntries(DETACHABLE.map(id=>[id,{detached:false,client:null,starting:null,error:''}]));
 let published=null,closed=false,timer=null;
 const releasing=new Map();
 const snapshot=()=>({ok:true,modules:Object.fromEntries(DETACHABLE.map(id=>[id,{detached:state[id].detached,starting:!!state[id].starting,error:state[id].error||null}]))});
 const changed=()=>{if(!closed)notify(snapshot());};
 function check(id){if(!DETACHABLE.includes(id))throw Error('该页面不能独立打开');return id;}
 // 交出本侧所有权：OS 按 EOF 合同释放自己持有的指挥中心。
 async function release(id){
  if(releasing.has(id))return releasing.get(id);
  const at=Date.now();trace('release-start',id);
  const work=Promise.resolve(control?.release?.()).then(()=>trace('release-done',id+' '+(Date.now()-at)+'ms'),error=>{trace('release-failed',id+' '+(Date.now()-at)+'ms '+error?.message);throw error;}).finally(()=>releasing.delete(id));
  releasing.set(id,work);return work;
 }
 function attachClient(id,client){
  const row=state[id];
  row.client=client;row.detached=true;row.error='';changed();
  client.on('close',()=>{
   if(row.client!==client)return;
   row.client=null;row.detached=false;
   changed();
  });
 }
 async function probe(id){
  const row=state[id];
  if(closed||row.client||row.starting)return;
  const client=await registry.connect(configDir,id);
  if(!client)return;
  if(closed||row.client){client.close();return;}
  // 先于 OS 启动的模块：OS 不再持有同一模块。
  if(!row.detached){try{await release(id);}catch(error){row.error=error.message;}}
  attachClient(id,client);
 }
 function schedule(){
  if(closed)return;
  timer=setTimeout(async()=>{for(const id of DETACHABLE)await probe(id).catch(()=>{});schedule();},pollMs);
  timer.unref?.();
 }

 async function detach({module:id,x,y,page}={}){
  check(id);
  const row=state[id];
  if(row.client){await row.client.request('focus',{page:page||''}).catch(()=>{});return snapshot();}
  if(row.starting)return row.starting;
  row.starting=(async()=>{
   row.error='';changed();const at=Date.now();trace('detach-start',id+' '+(page||''));
   // 不等 OS 交出指挥中心就启动独立窗口（2026-10-10 用户报“独立打开卡死”：真实环境交出要等设备连接逐个退出，
   // 期间什么都不出现）。独立窗口启动后自己也会请 OS 交出，并等交出完成再启动自己的指挥中心。
   void release(id).catch(error=>{row.error=error.message;});
   const args=[path.join(root,'Client/Desktop','host','modules','main.cjs'),'--module='+id,'--config='+path.resolve(config)];
   if(Number.isFinite(x)&&Number.isFinite(y))args.push('--at='+Math.round(x)+','+Math.round(y));
   if(page&&PAGES[id].includes(page))args.push('--page='+page);
   // 独立软件：脱离 OS 进程树，OS 退出后继续运行；不继承 OS 生命周期凭据。
   const child=launch(electronPath,args,{detached:true,stdio:'ignore',windowsHide:false,env:moduleEnvironment(env),shell:false});
   let failed=null;child.once?.('error',error=>{failed=error;trace('spawn-error',error.message);});child.unref?.();trace('spawned',String(child.pid||''));
   const deadline=Date.now()+startTimeout;
   while(Date.now()<deadline&&!closed){
    if(failed)throw Error('独立窗口未能启动：'+failed.message);
    const client=await registry.connect(configDir,id,{timeout:800});
    if(client){trace('connected',id+' '+(Date.now()-at)+'ms');attachClient(id,client);return snapshot();}
    await new Promise(resolve=>setTimeout(resolve,250));
   }
   throw Error('独立窗口没有在 '+Math.round(startTimeout/1000)+' 秒内就绪');
  })().catch(error=>{row.error=error.message;trace('detach-failed',id+' '+error.message);throw error;}).finally(()=>{row.starting=null;changed();});
  return row.starting;
 }

 // 外嵌期间，OS 内的 Link/指挥中心页面请求转给独立窗口并聚焦它。
 const detached=id=>!!state[id].client;
 function wrapSurface(inner){
 return {
   ...inner,
   navigate(page){
    for(const id of DETACHABLE)if(PAGES[id].includes(page)&&detached(id)){void state[id].client.request('focus',{page}).catch(()=>{});return {ok:true,embedded:false,page};}
    return inner.navigate(page);
   },
  };
 }

 async function start(){
  published=await registry.publish({id:'os',configDir,version,handlers:{
   release:async p=>{const id=check(p.module);await release(id);return {ok:true};},
   dock:async p=>{const id=check(p.module);const page=PAGES[id].includes(p.page)?p.page:id;if(runtimeState?.()?.main_open===false)await runtimeAction?.({module:'home',action:'open'});return {ok:true,page};},
   state:()=>runtimeState?.()||snapshot(),
   diagnostics:()=>diagnostics(),
   identity:()=>identity(),
   program_check:p=>{if(!programCheck)throw Error('程序接口尚未就绪');return programCheck(p);},
   program_capture:p=>{if(!programCapture)throw Error('程序截图尚未就绪');return programCapture(p);},
   presence:()=>({main_open:runtimeState?.()?.main_open!==false,frame:presence()}),
   module_action:p=>{if(!runtimeAction)throw Error('运行时尚未就绪');return runtimeAction(p);},
   settings:()=>{if(closed)throw Error('OS正在退出。');navigate('settings');return {ok:true};},
  }});
  for(const id of DETACHABLE)await probe(id).catch(()=>{});
  schedule();
  return snapshot();
 }
 // 退出 OS 时用户的选择（docs/UI设计知识库.md 形态 §15.11 L1）：'os' 让独立窗口从此单独运行、不再放回；
 // 'all' 等待保存并真正退出；失败保留 OS，允许重试。
 async function waitForRelease(id,client,message){
  const deadline=Date.now()+quitTimeout;
  while(state[id].client===client&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  if(state[id].client===client)throw Error(message);
 }
 async function exit(mode){
  const method=mode==='all'?'quit':'standalone';
  await Promise.all(DETACHABLE.map(async id=>{const client=state[id].client;if(!client)return;
   try{const result=await client.request(method,{},{timeout:5000});if(result?.ok===false)throw Error(result.error||'独立窗口拒绝退出');}
   catch(error){if(mode!=='all'||state[id].client!==client)return;throw error;}
   if(mode==='all')await waitForRelease(id,client,'Link 尚未确认退出，OS 已保留，请稍后重试。');
  }));
  return snapshot();
 }
 async function close(){
  if(closed)return;closed=true;clearTimeout(timer);
  for(const id of DETACHABLE){state[id].client?.close();state[id].client=null;}
  await published?.close();
 }
 async function readStatus(id){const client=state[id]?.client;return client?client.request('status',{},{timeout:5000}):null;}
 async function command(id,method){
  check(id);const client=state[id].client;if(!client)return snapshot();
  const result=await client.request(method,{}, {timeout:20000});
  if(result?.ok===false)throw Error(result.error||'Link 操作未完成');
  // The module acknowledges before its async save/shutdown finishes. Keep the
  // runtime action pending so a following detach cannot focus a closing client.
  if(['dock','close','quit'].includes(method))await waitForRelease(id,client,'Link 尚未确认放回或关闭，请核对当前窗口后重试。');
  return result;
 }
 return {start,close,command,state:snapshot,detach,detached,wrapSurface,exit,readStatus};
}
module.exports={createModuleDock,moduleEnvironment,DETACHABLE};
