// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: validBinding; bindingKey; matches; scopedArguments; createObservationHub; createDefaultObservationHub
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/observation.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// The Core owns execution. This hub owns only shared, scoped observations.
// No activation, greeting, sending, cancellation or input operation exists here.
const validBinding=b=>b&&typeof b.task_id==='string'&&b.task_id&&typeof b.agent_id==='string'&&b.agent_id&&typeof b.core_epoch==='string'&&b.core_epoch&&typeof b.role==='string'&&Number.isSafeInteger(b.generation)&&b.generation>0;
const bindingKey=b=>JSON.stringify([b.core_epoch,b.task_id,b.agent_id,b.role,b.generation]);
const matches=(snapshot,b)=>snapshot?.core_epoch===b.core_epoch&&snapshot?.session_id===b.task_id&&snapshot.roles?.some(r=>r.id===b.agent_id&&r.role===b.role&&r.generation===b.generation);
function scopedArguments(binding,args={}){
 if(!validBinding(binding))throw Error('观察窗口没有有效任务');
 for(const key of ['task_id','agent_id','generation','core_epoch'])if(args[key]!=null&&args[key]!==binding[key])throw Error('观察窗口的任务范围已改变');
 return {task_id:binding.task_id,agent_id:binding.agent_id,generation:binding.generation};
}
function createObservationHub({read,createPresentation,interval=300,setTimer=setTimeout,clearTimer=clearTimeout}){
 const tasks=new Map(),listeners=new Map();let timer=null,closed=false,busy=false;
 const wanted=()=>[...listeners.values()].filter(v=>v.visible&&!v.settled);
 function schedule(){if(!closed&&timer===null&&wanted().length)timer=setTimer(()=>{timer=null;void poll();},interval);}
 function packet(state,binding){
  if(!state?.snapshot)return {status:state?.error?'error':'loading',error:state?.error||''};
  if(!matches(state.snapshot,binding))return {status:'stale',error:'这个观察窗口所属的任务轮次已结束；可从当前光圈打开新的进展。'};
  const p=state.presentation,role=binding.role;
  return {status:state.error?'error':'ready',error:state.error||'',binding,snapshot:state.snapshot,projection:{activities:p.liveActivities(role,{process:true,plan:true}),terminal:role==='matrix'?p.terminal():p.liveActivities(role),current:p.current(),plan:role==='matrix'?p.plan():null,planFeedback:p.planFeedback()}};
 }
 async function poll(){
  if(closed||busy)return;busy=true;
  try{
   for(const task of new Set(wanted().map(v=>v.binding.task_id))){
    if(closed)break;
    let state=tasks.get(task);if(!state){state={presentation:createPresentation(),activity:{},live:{},snapshot:null};tasks.set(task,state);}
    try{
     const next=await read({task_id:task,cursor:0,revision:state.snapshot?.revision||0,activity_cursors:state.activity,live_cursors:state.live});
     if(next?.ok===false||next?.version!==1)throw Error(next?.error||'无法读取任务进展');
     if(next.session_id!==task)throw Error('核心返回了其他任务的进展');
     if(state.snapshot?.core_epoch!==next.core_epoch){state.presentation=createPresentation();state.activity={};state.live={};}
     else if(state.snapshot){if(next.messages_unchanged)next.messages=state.snapshot.messages;next.live={...state.snapshot.live,...next.live};}
     for(const role of next.roles||[])if(next.live?.[role.role]?.generation!=null&&next.live[role.role].generation!==role.generation)delete next.live[role.role];
     state.snapshot=next;state.error='';state.presentation.ingest(next);state.presentation.tick();
     for(const role of next.roles||[])if(role.activity)state.activity[role.role]=role.activity.cursor;
     for(const [role,value]of Object.entries(next.live||{}))state.live[role]=value.revision;
    }catch(error){state.error=String(error.message);}
    if(closed)break;
    for(const value of wanted().filter(v=>v.binding.task_id===task)){
     const frame=packet(state,value.binding);value.notify(frame);
     if(frame.status==='stale'||frame.status==='ready'&&!['queued','running','waiting_user','cancelling'].includes(frame.snapshot.roles.find(r=>r.id===value.binding.agent_id)?.state))value.settled=true;
    }
   }
  }finally{busy=false;schedule();}
 }
 return {
  subscribe(id,binding,notify){if(closed||!validBinding(binding))throw Error('无效观察窗口任务');listeners.set(id,{binding:{...binding},notify,visible:false});},
  visible(id,value){const item=listeners.get(id);if(!item||closed)return;item.visible=!!value;item.settled=false;if(value){item.notify(packet(tasks.get(item.binding.task_id),item.binding));void poll();}else if(!wanted().length&&timer!==null){clearTimer(timer);timer=null;}},
  unsubscribe(id){listeners.delete(id);if(!wanted().length&&timer!==null){clearTimer(timer);timer=null;}for(const task of tasks.keys())if(![...listeners.values()].some(v=>v.binding.task_id===task))tasks.delete(task);},
  frame(id){const value=listeners.get(id);return value?packet(tasks.get(value.binding.task_id),value.binding):{status:'loading'};},
  assertScope(id,args){const value=listeners.get(id);if(!value||!value.visible||!matches(tasks.get(value.binding.task_id)?.snapshot,value.binding))throw Error('观察窗口的任务当前不可读取');return scopedArguments(value.binding,args);},
  close(){closed=true;if(timer!==null)clearTimer(timer);timer=null;listeners.clear();tasks.clear();},
  get counts(){return {tasks:tasks.size,subscribers:listeners.size,visible:[...listeners.values()].filter(v=>v.visible).length,polling:wanted().length,timer:timer!==null};},
 };
}
async function createDefaultObservationHub(options){const {WorkspacePresentation}=await import('../ui/model.mjs');return createObservationHub({...options,createPresentation:()=>new WorkspacePresentation()});}
module.exports={createObservationHub,createDefaultObservationHub,validBinding,bindingKey,matches,scopedArguments};
