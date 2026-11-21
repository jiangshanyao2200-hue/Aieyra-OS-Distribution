'use strict';
// The Program owns connection/presence lifetime. The host supplies the original
// office, native page and package admission; credentials and cursors stay put.
const {createLink}=require('./service.cjs');
const {createLinkAgent}=require('./agent.cjs');
function createLinkProgram({apps,env,agentOptions,run,assert,release,autoJoin=true,createAgent=createLinkAgent,createConnection=createLink}){
 const agent=createAgent(agentOptions),pending=new Set();
 let connection=null,active=false,closing=null,retiring=false;
 function activateIfAdmitted(){
  try{assert();}catch{return false;}
  if(retiring)return false;
  if(active)return true;
  connection=createConnection({apps,env});active=true;if(autoJoin)agent.start();
  return true;
 }
 function execute(fn){return run(()=>{
  if(!activateIfAdmitted())throw Error('Link 已停用或上一次释放尚未完成');
  const work=Promise.resolve().then(()=>{assert();if(retiring)throw Error('Link 正在释放');return fn();});
  pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
 });}
 function close(){
  if(closing)return closing;
  active=false;retiring=true;
  closing=(async()=>{
   // Finish already accepted writes before disconnecting this station. Never
   // lose the office owner while a request's result is still being recorded.
   await Promise.allSettled([...pending]);
   await agent.close();
   await connection?.close();
   await release();
   connection=null;retiring=false;
  })().finally(()=>{closing=null;});
  return closing;
 }
 return {activateIfAdmitted,close,run:execute,status:()=>execute(()=>connection.status()),deviceCode:()=>execute(()=>connection.deviceCode()),
  agentCall:p=>execute(()=>agent.call(p)),snapshot:()=>execute(()=>agent.call({action:'status'})),
  invoke:(operation,args={},context={})=>execute(()=>{
   if(args.request_id!==undefined&&context.request_id&&args.request_id!==context.request_id)throw Error('Link 请求身份与程序回执不一致');
   return agent.call({...args,action:operation,...(context.request_id?{request_id:context.request_id}:{})});
  })};
}
module.exports={createLinkProgram};
