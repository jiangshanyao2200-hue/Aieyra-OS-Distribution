'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createImageBatchRuntime,normalizeBatchPlan}=require('./desktop/images/image-batch-runtime.cjs');
const {atomicWriteJson}=require('./desktop/core/json-storage.cjs');
const {imageBatchPlan,normalizeImageInput}=require('./image-plan.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checked=r=>{if(r?.ok===false)throw Error(r.error||'图片操作未完成');return r;};

// The original durable scheduler owns slots. OS image receipts own paid calls.
// This adapter retains ownership, progress and canvas commits across restarts.
function createCanvasImageJobs({root,images,prepare,inspect,commit,broadcast=()=>{},activity=()=>{}}){
 const directory=path.join(root,'image-jobs'),batches=createImageBatchRuntime({directory:path.join(root,'image-batches')}),records=new Map(),running=new Map(),committing=new Map(),starting=new Map();
 let closed=false;
 if(fs.existsSync(directory))for(const name of fs.readdirSync(directory).filter(n=>/^matrix-(?:batch|image)-[a-f0-9-]{36}\.json$/.test(n))){
  const record=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
  if(name!==record.id+'.json'||!record.scope||!record.input)throw Error('图片任务记录不完整，原文件已保留');
  if(record.status==='running'){record.status='interrupted';record.error='任务中断；请核对已保存成果后恢复，不会自动重发。';if(record.batch)record.batch={...record.batch,status:'interrupted',running:0};}
  records.set(record.id,record);
 }
 const save=r=>{fs.mkdirSync(directory,{recursive:true});atomicWriteJson(path.join(directory,r.id+'.json'),r);};
 const job=r=>({id:r.id,parentRunId:r.id,projectId:r.scope.canvasProjectId,conversationId:r.canvasConversationId,prompt:r.input.prompt,input:r.input,
  reviewContext:{matrixProjectId:r.scope.projectId,matrixConversationId:r.scope.conversationId,goalId:r.goalId},status:r.status==='interrupted'?'error':r.status,startedAt:r.startedAt,
  actions:r.actions||[],delivered:!!r.outputs?.length&&!running.has(r.id),result:{actions:r.actions||[],envelope:{ok:r.status==='completed',summary:r.error||r.batch?.summary||'图片已保存'}}});
 const active=()=>[...records.values()].some(r=>running.has(r.id)&&!['paused','interrupted'].includes(r.batch?.status));
 const notify=(r,progress={})=>{broadcast('aieyra:agent:progress',{phase:r.status==='running'?'image-progress':'background-image-result',...progress,backgroundJobId:r.id,runId:r.id,projectId:r.scope.canvasProjectId,conversationId:r.canvasConversationId,imageJob:job(r)});broadcast('aieyra:matrix:changed',{kind:'images',projectId:r.scope.canvasProjectId});activity({program:'workspace',active:active(),jobs:[...records.values()].filter(v=>running.has(v.id)).map(v=>({id:v.id,status:v.batch?.status||v.status}))});};
 function owned(scope,id){const r=records.get(id);if(!r||hash(r.scope)!==hash(scope))throw Error('图片任务不属于当前画布与程序会话');return r;}
 const result=r=>({ok:true,jobId:r.id,status:running.has(r.id)&&r.status==='completed'?'saving':r.batch?.status||r.status,batch:r.batch,outputs:r.outputs||[],error:r.error||'',summary:r.error||r.batch?.summary|| (r.status==='running'?'正在后台生成，可继续聊天。':'图片任务已结束。')});
 async function persistCanvas(r,partial=false,actions){
  const previous=committing.get(r.id)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
   const value=checked(await commit({...job(r),...(actions?{actions}: {})},partial));
   r.outputs=[...new Map([...(r.outputs||[]),...(value.outputs||[])].map(o=>[o.nodeId,o])).values()];save(r);return value;
  });committing.set(r.id,next);try{return await next;}finally{if(committing.get(r.id)===next)committing.delete(r.id);}
 }
 function startRun(r,prepared){
  if(running.has(r.id))return;
  const controller=new AbortController(),state={controller,slots:new Set(),promise:null};running.set(r.id,state);r.status='running';r.error='';save(r);notify(r);
  const generate=async(input,runId)=>{
   if(controller.signal.aborted||closed)throw Error('图片任务已停止');
   // Validate the same model, original references and goal revision before each
   // unsent slot. A later model or canvas edit cannot silently change this job.
   const current=await prepare(r.arguments,r.scope);if(current.identity!==r.identity)throw Error('模型、目标或参考资料已变化，请核对原任务');
   state.slots.add(runId);
   try{
    const generated=await images.generate({...current.input,...input,projectId:r.scope.canvasProjectId,runId,placementRunId:r.id,managedJob:r.id,reviewContext:job(r).reviewContext,conversationId:r.canvasConversationId});
    return {actions:[{type:'workflow.node.create',toolRunId:runId,node:{nodeType:'image',title:r.title||'图片成果',prompt:input.prompt,assets:generated.assets,imageState:'done',parentId:input.parentId,imageParams:input}}],envelope:{ok:true}};
   }finally{state.slots.delete(runId);}
  };
  state.promise=Promise.resolve().then(async()=>{
   if(r.batch){
    const completed=await batches.run(r.scope,r.id,{identity:r.identity,signal:controller.signal,generate,progress:p=>{
     if(p.batch)r.batch=p.batch;
     if(p.workflowAction){const key=p.workflowAction.toolRunId;const old=r.actions.findIndex(a=>a.toolRunId===key);if(old<0)r.actions.push(p.workflowAction);else r.actions[old]=p.workflowAction;if(p.retainActionLimit===2)r.actions=r.actions.slice(-2);}
     save(r);notify(r,p);
     if(p.batchPage)return persistCanvas(r,true,p.pageActions);
    }});
    r.actions=completed.actions;r.batch=completed.batch;r.status=completed.batch.status==='cancelled'?'cancelled':completed.envelope.ok?'completed':'error';
   }else{
    const completed=await generate(prepared.input,r.id);r.actions=completed.actions;r.status='completed';
   }
   save(r);await persistCanvas(r);
  }).catch(async error=>{
   r.status=controller.signal.aborted?'cancelled':'error';r.error=String(error.message||error);save(r);
   if(r.actions.length)try{await persistCanvas(r);}catch(commitError){r.error+='；成果待保存：'+commitError.message;save(r);}
  }).finally(()=>{running.delete(r.id);notify(r);});
 }
 async function startOnce(args,scope,requestID,batch=false){
  if(closed)throw Error('画布图片服务已停止');
  if(!requestID)throw Error('图片任务需要稳定请求编号');
  const multi=batch||(args.input?.count||args.input?.items?.length||1)>1;
  const digest=hash([scope,args]),uuid=hash([scope,requestID]).slice(0,32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5'),id=`matrix-${multi?'batch':'image'}-${uuid}`;
  if(records.has(`matrix-${multi?'image':'batch'}-${uuid}`))throw Error('同一图片请求的参数已变化');
  if(records.has(id)){const old=owned(scope,id);if(old.digest!==digest)throw Error('同一图片请求的参数已变化');return result(old);}
  const prepared=await prepare(args,scope),singlePlan=batch?null:imageBatchPlan(prepared.input,args);
  const plan=batch?normalizeBatchPlan({...args,input:prepared.input,variants:(args.variants||[]).map(v=>({...v,...normalizeImageInput({...args.input,model:prepared.input.model,...v})}))}):singlePlan?normalizeBatchPlan(singlePlan):null;
  const r={id,scope,digest,arguments:structuredClone(args),input:prepared.input,identity:prepared.identity,canvasConversationId:prepared.conversationId,goalId:args.goalId,title:args.title,startedAt:Date.now(),status:'running',actions:[],outputs:[]};
  if(plan)r.batch=await batches.create(scope,id,{...plan,count:plan.count??undefined},r.identity,args.nodeIds||[]);
  save(r);records.set(id,r);startRun(r,prepared);return result(r);
 }
 async function start(args,scope,requestID,batch=false){
  const key=hash([scope,requestID,batch]),digest=hash(args),old=starting.get(key);
  if(old){if(old.digest!==digest)throw Error('同一图片请求的参数已变化');return old.promise;}
  const promise=Promise.resolve().then(()=>startOnce(args,scope,requestID,batch));starting.set(key,{digest,promise});
  try{return await promise;}finally{starting.delete(key);}
 }
 async function control(args,scope){
  if(args.operation==='list')return {ok:true,tasks:[...records.values()].filter(r=>hash(r.scope)===hash(scope)).map(result)};
  const r=owned(scope,args.jobId);
  if(args.operation==='status'||args.operation==='wait'){
   if(args.operation==='wait'&&running.has(r.id)){let timer;try{await Promise.race([running.get(r.id).promise,new Promise(resolve=>{timer=setTimeout(resolve,Math.min(25000,Math.max(0,args.waitMs??25000)));})]);}finally{clearTimeout(timer);}}
   if(!running.has(r.id)&&r.status==='completed'&&(!r.outputs.length||r.error)){await persistCanvas(r);r.error='';save(r);}
   return result(r);
  }
  if(args.operation==='recover'){
   if(running.has(r.id))throw Error('原图片任务仍在执行，请先暂停');
   const current=inspect?await inspect(r.scope):await prepare(r.arguments,r.scope);
   if(r.batch){
    const before=await batches.status(scope,r.id),nodes=[...(current.nodes||[])];
    // Reconcile only original OS receipts. No create/run is issued here.
    if(images.recover)for(const slot of before.unknownSlots||[])try{
     const paid=await images.recover({projectId:scope.canvasProjectId,runId:`${r.id}-slot-${slot-1}`});
     if(paid.assets?.length)nodes.push({generationRunId:`${r.id}-page-${before.continuous?Math.floor((slot-1)/100):0}`,assets:paid.assets,imageCollection:{items:[{id:`slot-${slot-1}`,status:'done',assetIndex:1}]}});
    }catch{/* Unknown receipts remain unknown until explicitly skipped. */}
    r.batch=await batches.recover(scope,r.id,nodes);r.actions=await batches.actions(scope,r.id);save(r);if(r.actions.some(a=>a.node.assets.length))await persistCanvas(r,true);return result(r);
   }
   const recovered=await images.recover({projectId:scope.canvasProjectId,runId:r.id});
   r.actions=[{type:'workflow.node.create',toolRunId:r.id,node:{nodeType:'image',title:r.title||'图片成果',prompt:r.input.prompt,assets:recovered.assets,imageState:'done',parentId:r.input.parentId,imageParams:r.input}}];r.status='completed';r.error='';save(r);await persistCanvas(r);notify(r);return result(r);
  }
  if(args.operation==='resume'){
   if(!r.batch)throw Error('单次图片请求请查询或恢复原回执');
   const prepared=await prepare(r.arguments,r.scope);if(prepared.identity!==r.identity)throw Error('模型、目标或参考资料已变化，请核对原任务');
   r.batch=await batches.control(scope,r.id,'resume',{identity:r.identity});save(r);if(r.batch.status==='running')startRun(r,prepared);notify(r);return result(r);
  }
  if(!['pause','cancel','skip'].includes(args.operation))throw Error('未知图片任务操作');
  if(r.batch)r.batch=await batches.control(scope,r.id,args.operation,args);else if(args.operation!=='cancel')throw Error('单次图片请求只支持停止');
  if(args.operation==='cancel'){
   const state=running.get(r.id);state?.controller.abort();await Promise.allSettled([...(state?.slots||[])].map(id=>images.cancel(id,scope.canvasProjectId)));if(state)await state.promise;else r.status='cancelled';
  }
  save(r);notify(r);return result(r);
 }
 return {start,control,list:()=>[...records.values()].map(job),active,
  timeline:projectId=>[...records.values()].filter(r=>r.scope.canvasProjectId===projectId).slice(-80).map(r=>({id:r.id,type:'imageGeneration',status:r.status==='running'&&!['paused','interrupted'].includes(r.batch?.status)?'inProgress':r.status==='completed'?'completed':r.status==='cancelled'?'interrupted':'failed',startedAt:r.startedAt,image:{...result(r),id:r.id,canvasProjectId:r.scope.canvasProjectId,input:r.input,startedAt:r.startedAt}})),
  async close(){closed=true;await Promise.allSettled([...running].map(async([id,state])=>{const r=records.get(id);if(r.batch)await batches.control(r.scope,id,'cancel');state.controller.abort();await Promise.allSettled([...state.slots].map(runId=>images.cancel(runId,r.scope.canvasProjectId)));await state.promise;}));},resume(){closed=false;}};
}
module.exports={createCanvasImageJobs};
