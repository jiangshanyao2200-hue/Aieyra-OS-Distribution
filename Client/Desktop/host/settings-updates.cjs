// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: QUICK_STEPS; createSettingsUpdates
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/settings-updates.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

// Installation and handoff belong to the managed update service and idle transaction.
// 一键更新（quick）只是把同一套签名下载、三方核对、候选验证和确认按顺序跑完；
// 文件替换与重启仍由空闲交接完成（onApproved 立即触发，不等轮询）。
const QUICK_STEPS={check:'正在检查更新',review:'正在下载并核对',prepare:'正在准备新版文件',verify:'正在验证新版',decide:'验证通过，等待空闲后自动重启',done:'即将自动重启到新版'};
function createSettingsUpdates({updates,version,home,send,community,integrity,onApproved=()=>{}}){
 let quick=null;
 const status=()=>({...(updates?updates.status():{ok:true,phase:'disabled',reason:'当前安装未启用官方更新'}),enabled:!!updates,currentVersion:version||'',homeSession:home().session_id,integrity:integrity?.status()||{phase:'unavailable',reason:'完整性检查不可用'},quick:quick?{...quick}:null});
 const failure=(error,code)=>Object.assign(Error(error),{code});
 const READY=new Set(['waiting_idle','handoff']);
 async function runQuick(){
  const step=async(name,args)=>{quick={...quick,step:name,text:QUICK_STEPS[name]};const result=await updates.call(args);if(result?.ok===false)throw Error(result.error||'更新没有完成');return result;};
  try{
   let state=await step('check',{action:'check'});
   if(!state.release||state.phase==='idle'||state.phase==='committed'){quick={running:false,step:'latest',text:'已是最新版本'};return;}
   if(READY.has(state.phase)){quick={running:false,step:'done',text:QUICK_STEPS.done};onApproved();return;}
   if(!['validated'].includes(state.phase)){
    state=await step('review',{action:'review'});
    if(state.conflicts)throw failure('本地有 '+state.conflicts+' 个文件和新版冲突，请点“让 Eyra 处理”核对后更新','update_conflicts');
    state=await step('prepare',{action:'prepare'});
    if(state.phase==='needs_build')throw failure('本地保留了原生源码改动，需要重新编译，请点“让 Eyra 处理”','update_needs_build');
    state=await step('verify',{action:'verify'});
   }
   if(state.phase!=='validated'||!state.candidateDigest)throw Error('新版验证没有通过：'+(state.reason||state.phase));
   await step('decide',{action:'decide',decision:'apply',candidate_digest:state.candidateDigest,reason:'用户在更新程序中一键更新'});
   quick={running:false,step:'done',text:QUICK_STEPS.decide};onApproved();
  }catch(error){quick={running:false,step:'failed',text:error.message||'更新没有完成',code:error.code||''};}
 }
 return async function call(p={}){
  if(p.action==='status')return status();
  if(p.action==='integrity'){if(integrity)await integrity.check();return status();}
  if(p.action==='posts'){
   if(!community?.status().signedIn)return {ok:true,signedIn:false,items:[],reason:'登录后同步 OS 发布帖子'};
   const result=await community.call({action:'topics',type:'update',sort:'latest',...(typeof p.cursor==='string'&&p.cursor.length<256?{cursor:p.cursor}:{})});
   if(!Array.isArray(result.items))throw Error('发布帖子响应无效');
   return {ok:true,signedIn:true,items:result.items.filter(row=>row.type==='update'&&row.official===true).slice(0,30).map(row=>({id:String(row.id||''),title:String(row.title||'').slice(0,200),summary:String(row.summary||'').slice(0,4000),created:row.created,revision:row.revision})),nextCursor:result.nextCursor||null};
  }
  if(p.action==='post'){
   if(!/^[a-f0-9-]{36}$/i.test(p.id||''))throw Error('发布帖编号无效');
   const result=await community?.call({action:'topic_read',id:p.id}),row=result?.item||result?.topic;
   if(!row||row.type!=='update'||row.official!==true)throw Error('该条目不是官方 OS 发布帖');
   return {ok:true,id:row.id,title:String(row.title||'').slice(0,200),content:String(row.content||'').slice(0,100000)};
  }
  if(p.action==='review_update'){
   const current=status();
   if(!current.enabled||current.phase==='login_required'||quick?.running||READY.has(current.phase))return current;
   const review=()=>updates.call({action:current.manual?'check':'review'});
   const inspected=await (updates.withManualChecks?updates.withManualChecks(review):review());
   if(inspected?.ok===false)throw Error(inspected.error||'更新核对没有完成');
   return status();
  }
  if(!['check','assist','defer','quick'].includes(p.action))throw Error('更新程序不支持此操作');
  if(!updates)throw Error('当前安装未启用官方更新');
  if(p.action==='check'){await updates.call({action:'check'});return status();}
  const state=status();
  if(state.phase==='login_required')throw Error('请先登录 Aieyra 后接收更新');
  if(p.action==='quick'){
   if(state.manual)throw Error('此平台请从官网下载新版');
   if(quick?.running)return status();
   // 后台按序执行，设置页靠 status 轮询显示每一步；长下载不占住这次调用。
   quick={running:true,step:'check',text:QUICK_STEPS.check,startedAt:new Date().toISOString()};
   if(updates.withManualChecks)void updates.withManualChecks(runQuick);
   else void runQuick();
   return status();
  }
  if(p.action==='defer'){
   if(!state.release||p.release_id!==state.release.id)throw Error('待更新版本已变化，请刷新后重试');
   if(!['available','reviewed','needs_build','prepared','validated','waiting_idle'].includes(state.phase))throw Error('当前更新阶段不能延期');
   await updates.call({action:'decide',decision:'defer',reason:'用户在更新程序中暂缓更新'});return status();
  }
  if(!/^[a-f0-9-]{36}$/i.test(p.request_id||''))throw Error('更新任务编号无效');
  const target={...home()};
  if(p.session_id!==target.session_id)throw failure('Eyra 会话已切换，请重新提交更新任务','update_session_changed');
  const result=await send(target,{
   request_id:'settings-update-'+p.request_id,
   message:'请检查 Aieyra OS 的官方更新并处理当前待办：保留我的私人资料和本地修改，核对冲突与验证结果；验证通过后在所有任务空闲时安全更新，遇到无法确定的冲突或失败请保留现场并说明。',
  });
  if(result?.ok===false)throw Error(result.error||'更新任务没有被接收');
  return {...status(),accepted:true,request_id:p.request_id,session_id:target.session_id};
 };
}
module.exports={createSettingsUpdates};
