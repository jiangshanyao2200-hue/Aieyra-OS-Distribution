// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; createCloudUpdates
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/cloud-updates.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
function createCloudUpdates({app,window,root,config,initial,descriptor,core,canHandoff=()=>true}){
 let timer,bootstrapTimer,closed=false,busy=false,handoff=false,uiReady=false,reply,bootstrapDone=false,bootstrapBusy=false,bootstrapFailures=0;
 async function bootstrap(){
  if(closed||handoff||!uiReady||bootstrapDone||bootstrapBusy)return;
  bootstrapBusy=true;
  try{
   const result=await require('../src/managed-update-bootstrap.cjs').promoteBootstrap({root});
   bootstrapDone=result.phase!=='deferred';bootstrapFailures=0;
   if(result.phase==='conflict'&&window()&&!window().isDestroyed())window().webContents.send('workspace:notice','CLI 安装保留了本地同名文件，请在更新核对中处理冲突：'+result.conflicts.join('、'));
  }catch(error){
   if(++bootstrapFailures>=3){bootstrapDone=true;if(window()&&!window().isDestroyed())window().webContents.send('workspace:notice','CLI 安装补全未完成：'+error.message);}
  }finally{bootstrapBusy=false;}
 }
 const call=async args=>{const result=await core('workspace.updates',args);if(result.ok===false)throw Error(result.error);return result;};
 async function quiesce(){
  if(!uiReady||!window()||!canHandoff())return false;
  const id=crypto.randomUUID();return new Promise(resolve=>{const timeout=setTimeout(()=>{reply=null;resolve(false);},5000);reply={id,resolve:value=>{clearTimeout(timeout);reply=null;resolve(value)}};window().webContents.send('workspace:updatePrepare',{id});});
 }
 function acknowledge(p){if(reply&&p.id===reply.id)reply.resolve(p.ready===true);return {ok:true};}
 function ready(){uiReady=true;const health=process.env.AIEYRA_UPDATE_HEALTH;delete process.env.AIEYRA_UPDATE_HEALTH;
  if(health){const url=new URL(health);if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&/^\/[a-f0-9]{64}$/.test(url.pathname))void fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>{});}
  if(!bootstrapTimer){bootstrapTimer=setTimeout(()=>{bootstrapTimer=null;void bootstrap();},750);bootstrapTimer.unref();}
  return {ok:true};
 }
 async function tick(){
  if(closed||busy||handoff||!uiReady)return;busy=true;let frozen=false;
  try{
   // 补全写入结束后才核对和交接下一次更新，避免同一宿主同时替换文件。
   await bootstrap();if(closed||bootstrapBusy)return;
   const state=await call({action:'status'});if(state.phase==='available'&&!state.notified)await core('workspace.update_notice',{});
   if(state.phase!=='waiting_idle'||!canHandoff())return;
   const freeze=await core('workspace.update_freeze',{});if(!freeze.frozen)return;frozen=true;
   if(!await quiesce())return;
   const snapshot=await core('workspace.snapshot',{}),plan=await call({action:'handoff',config,session_id:descriptor().session_id,workdir:snapshot.workdir||root});
   const readyFile=path.join(path.dirname(plan.plan),'helper-ready.json');if(fs.existsSync(readyFile))fs.unlinkSync(readyFile);
   const helper=spawn(plan.helper,['-apply-update',plan.plan,'-update-parent',String(initial.parent_pid)],{cwd:root,windowsHide:true,detached:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:''}});let failure;helper.once('error',error=>{failure=error});
   const deadline=Date.now()+10000;while(!fs.existsSync(readyFile)&&!failure&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
   if(failure||!fs.existsSync(readyFile))throw failure||Error('更新助手没有确认交接');const receipt=JSON.parse(fs.readFileSync(readyFile,'utf8'));if(receipt.pid!==helper.pid||receipt.parent!==initial.parent_pid)throw Error('交接身份不匹配');
   helper.unref();handoff=true;app.quit();
  }catch(error){await call({action:'handoff_failed'}).catch(()=>{});if(window()&&!window().isDestroyed())window().webContents.send('workspace:notice','更新已暂缓：'+error.message);}
  finally{if(frozen&&!handoff){await core('workspace.update_unfreeze',{}).catch(()=>{});window()?.webContents.send('workspace:updateResume',{});}busy=false;}
 }
 function start(){if(timer||closed||(!fs.existsSync(path.join(root,'Config/official-baseline.json'))&&!fs.existsSync(path.join(root,'Config/release.json'))))return;void call({action:'start'}).catch(()=>{});timer=setInterval(()=>void tick(),15000);timer.unref();}
 // 用户确认一键更新后立刻尝试空闲交接；忙时由原 15 秒轮询继续。
 return {start,ready,acknowledge,kick(){if(timer)void tick();},close(){closed=true;clearInterval(timer);clearTimeout(bootstrapTimer);reply?.resolve(false);}};
}
module.exports={createCloudUpdates};
