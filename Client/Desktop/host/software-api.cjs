// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; operations; copy; createSoftwareAPI
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/software-api.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {MODULES}=require('./module-catalog.cjs');
const fs=require('node:fs'),path=require('node:path');
const {createToolOperations,digest,error}=require('./tool-operations.cjs');
const operations=['open','detach','dock','close'];
const copy=value=>structuredClone(value);
function createSoftwareAPI({sessionId,file,runtime,observe,order,navigate,authorizeSession=()=>false,timeout=25000,pollMs=60}){
 const receipts=createToolOperations({file,scope:sessionId}),stores=new Map([[sessionId,receipts]]);let chain=Promise.resolve(),knownSessions=null;
 const fail=(code,message)=>{throw error(code,message);};
 function operationStore(scope=sessionId,allowCreate=false){
  if(typeof scope!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(scope))fail('INVALID_OPERATION_SESSION','操作来源会话无效。');
  if(scope===sessionId)return receipts;
  if(stores.has(scope))return stores.get(scope);
  const prior=path.join(path.dirname(file),scope+'.json');if(!allowCreate&&!fs.existsSync(prior))fail('UNKNOWN_OPERATION_SESSION','未找到此来源会话的回执。');
  const store=createToolOperations({file:prior,scope});stores.set(scope,store);knownSessions=null;return store;
 }
 function receiptSessions(){
  if(knownSessions)return [...knownSessions];
  const dir=path.dirname(file);if(!fs.existsSync(dir))return [sessionId];
  knownSessions=[...new Set([sessionId,...fs.readdirSync(dir).filter(n=>/^[A-Za-z0-9_-]{1,128}\.json$/.test(n)).map(n=>({id:n.slice(0,-5),at:fs.statSync(path.join(dir,n)).mtimeMs})).sort((a,b)=>b.at-a.at).slice(0,31).map(r=>r.id)])];return [...knownSessions];
 }
 function request(p,keys){if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!keys.includes(k)))fail('INVALID_REQUEST','软件操作参数无效或含未知字段。');}
 async function snapshot(scope=sessionId){
  const host=runtime();if(!host)fail('HOST_NOT_READY','模块运行时尚未就绪。');
  const state=host.state(),visual=await observe();
  const modules=MODULES.map(spec=>{const row=state.modules[spec.id]||{},view=visual.modules?.[spec.id]||{};return {id:spec.id,title:spec.title,detachable:spec.detachable!==false,placement:row.detached?'detached':view.exists?'attached':'closed',starting:row.starting===true,visible:view.visible===true,ready:view.ready===true,...(view.error?{error:String(view.error).slice(0,400)}:{})};});
  const data={main_open:state.main_open,active_page:visual.active_page||'home',order:order.read(),modules};
  return {ok:true,...data,operation_session:scope,receipt_sessions:receiptSessions(),version:digest(data),observed_at:new Date().toISOString()};
 }
 async function settle(test,scope=sessionId){const end=Date.now()+timeout;let value;do{value=await snapshot(scope);if(test(value))return value;await new Promise(r=>setTimeout(r,pollMs));}while(Date.now()<end);return {ok:false,state:'unknown',code:'STATE_UNCONFIRMED',error:'操作已发出，但未在期限内观察到目标状态；请查询回执和模块状态。',current:value};}
 function serialize(fn){const next=chain.catch(()=>{}).then(fn);chain=next.catch(()=>{});return next;}
 async function call(p,caller,signal){
  if(caller!==sessionId&&!await authorizeSession(caller))fail('SESSION_CONFLICT','软件操作需要当前 OS 或已绑定的程序会话。');
  if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.action!=='string')fail('INVALID_REQUEST','软件操作需要 action。');
  if(p.action==='describe'){
   request(p,['action']);return {ok:true,protocol:'aieyra-software/1',actions:{describe:{},package:{operation:['capabilities','list','inspect','install','enable','disable','rollback','remove'],arguments:'Core package request; exact revision, digest and grants required for mutations'},program:{operation:['describe','open','close','snapshot','invoke'],arguments:'id; invoke also operation, arguments, stable request_id'},modules:{},module:{module:MODULES.map(s=>s.id),operation:operations,request_id:'required',expected_version:'optional',operation_session:'optional original receipt session for replay'},order:{order:'all module IDs, home first',expected_version:'required',request_id:'required',operation_session:'optional original receipt session for replay'},receipt:{request_id:'required',operation_session:'optional; required for prior OS sessions'},settings:{arguments:'existing settings tool arguments; same schemas, versions and recovery'}},catalog:MODULES.map(({id,title,detachable=true})=>({id,title,detachable})),close_behavior:'OS主窗口存在时按X规则放回并收起页面，保留内存草稿；主窗口关闭时退出模块。首页不可独立或关闭。',receipt_scope:'current OS session; completed replay never re-executes; interrupted receipt is unknown',limits:{external_software:false,arbitrary_script:false,exit_os:false}};
  }
  if(p.action==='modules'){request(p,['action']);return snapshot(caller);}
  if(p.action==='receipt'){request(p,['action','request_id','operation_session']);return {...operationStore(p.operation_session||caller,(p.operation_session||caller)===caller).query(p.request_id),operation_session:p.operation_session||caller,current:await snapshot(caller)};}
  if(!['module','order'].includes(p.action))fail('UNKNOWN_ACTION','未知软件操作。请先使用 describe。');
  request(p,p.action==='module'?['action','module','operation','request_id','expected_version','operation_session']:['action','order','request_id','expected_version','operation_session']);
  if(p.expected_version!==undefined&&(typeof p.expected_version!=='string'||!/^[a-f0-9]{64}$/.test(p.expected_version)))fail('INVALID_VERSION','expected_version 无效。');
  if(p.action==='module'){
   const spec=MODULES.find(s=>s.id===p.module);if(!spec)fail('UNKNOWN_MODULE','未知模块。请读取 modules。');
   if(!operations.includes(p.operation))fail('UNKNOWN_OPERATION','未知模块操作。');
   if(spec.detachable===false&&['detach','close'].includes(p.operation))fail('FIXED_MODULE','首页固定在 OS 主窗口，不能独立或关闭。');
  }else if(!p.expected_version||!Array.isArray(p.order)||p.order.length!==MODULES.length||p.order[0]!=='home'||new Set(p.order).size!==MODULES.length||p.order.some(id=>!MODULES.some(s=>s.id===id)))fail('INVALID_ORDER','排序需要当前版本和全部模块ID，首页保持首位。');
  const args=copy(p);delete args.request_id;delete args.operation_session;
  return operationStore(p.operation_session||caller,(p.operation_session||caller)===caller).execute(p.request_id,args,()=>serialize(async()=>{
   if(signal?.aborted)fail('CANCELLED','排队操作在执行前已取消。');
   const before=await snapshot(caller);
   if(p.expected_version&&p.expected_version!==before.version)return {ok:false,code:'VERSION_CONFLICT',error:'模块状态已变化，未执行操作；请重新读取后决定。',current:before};
   if(signal?.aborted)fail('CANCELLED','操作在状态检查后、执行前已取消。');
   try{
   if(p.action==='order'){order.write(p.order);return {ok:true,current:await snapshot(caller)};}
   const host=runtime(),previous=before.modules.find(m=>m.id===p.module);
   // Docking a never-opened page first opens its existing adapter.
   if(p.operation==='dock'&&previous.placement==='closed')await host.action({module:p.module,action:'open'});
   await host.action({module:p.module,action:p.operation});
   if(p.operation==='close'&&host.mainOpen)await navigate('home');
   const result=await settle(s=>{const m=s.modules.find(x=>x.id===p.module);if(m.starting)return false;
    if(p.operation==='close')return s.main_open?!m.visible&&m.placement!=='detached':m.placement==='closed';
    if(p.operation==='detach')return m.placement==='detached'&&m.ready&&m.visible;
    // Dock restores the existing page to the host without changing the user's
    // active page. A loaded background page is a completed dock too.
    if(p.operation==='dock')return s.main_open&&m.placement==='attached'&&m.ready;
    return m.ready&&m.visible;
   },caller);
   return result.ok?{ok:true,current:result}:{...result};
   }catch(e){return {ok:false,state:'unknown',code:'OPERATION_UNCONFIRMED',error:'模块操作开始后未能确认结果；请查询原回执和当前状态。',cause:{code:e.code||'HOST_ERROR',message:String(e.message||e).slice(0,400)}};}
  }),{signal,replayOnly:p.operation_session!==undefined&&p.operation_session!==caller});
 }
 return {call,snapshot};
}
module.exports={createSoftwareAPI};
