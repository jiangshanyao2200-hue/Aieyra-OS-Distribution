'use strict';
const path=require('node:path'),fs=require('node:fs'),{Readable}=require('node:stream'),crypto=require('node:crypto');
const createCanvasStorage=require('./desktop/canvas-storage.cjs');
const checked=value=>{if(value?.ok===false)throw Error(value.error||'操作未完成');return value;};
// One service per OS profile; the renderer is a projection of its stored canvas
// and the common Core program conversation. Loading it never starts a model.
function createWorkspaceProgram({dataRoot,runtimeRoot,electron,conversation,broadcast=()=>{},activity=()=>{},navigate=()=>{},report=()=>{},images,imageCall,videoCall,ensureRenderer,rendererContents=()=>null,stageFiles,account=()=>({signedIn:false}),updates=()=>({phase:"unavailable"})}){
 let storage=null,closed=false,epoch=0;const pending=new Set(),rendererRequests=new Map();let rendererReady=false,rendererID=0,rendererEpoch=0;
 const diagnostics=require('./diagnostics.cjs').createCanvasDiagnostics({root:dataRoot,report});
 const closing=require('./close.cjs').createCanvasClose({contents:rendererContents,broadcast});
 const assertActive=()=>{if(closed)throw Error('Workspace 已停止');};
 function rendererEvent(event){
  diagnostics.record(event.type,event);
  if(!['navigating','gone','load-failed','closed'].includes(event.type))return;
  rendererEpoch++;rendererReady=false;rendererID=0;closing.invalidate(event.senderID);
  for(const request of rendererRequests.values()){clearTimeout(request.timer);request.reject(Error('画布页面已中断，操作结果尚未确认，请先读取原状态。'));}
  rendererRequests.clear();
 }
 let videoMedia,videoProgram;
 function videos(){
  if(!videoProgram){
   videoMedia=require('./video-media.cjs').createCanvasVideoMedia({root:dataRoot,runtimeRoot,assertActive,broadcast:(channel,event)=>{
    broadcast(channel,event);
    if(event.job?.state==='completed'&&rendererReady&&!closed)void videoProgram.invoke('status',{projectId:event.projectId,requestId:event.job.id}).catch(error=>report({code:'video-placement-pending',message:error.message}));
   }});
   videoProgram=require('./video-program.cjs').createCanvasVideoProgram({media:videoMedia,scope:p=>projectBinding({canvasProjectId:p.projectId}),renderer,electron,videoCall,assertActive});
  }
  return videoProgram;
 }
 function store(){assertActive();if(!storage){const started=performance.now();storage=createCanvasStorage({dataRoot,electron,assertActive,broadcast,report,images,diagnostic:(stage,metrics)=>diagnostics.record(stage,{metrics})});diagnostics.record('storage-created',{metrics:{durationMs:performance.now()-started}});}return storage;}
 if(!images&&imageCall)images=require('./images.cjs').createCanvasImages({root:dataRoot,call:imageCall,storage:store,broadcast});
 let jobs;
 function imageJobs(){
  if(!jobs&&images){
   const list=images.list?.bind(images)||(()=>[]);
   jobs=require('./image-jobs.cjs').createCanvasImageJobs({root:dataRoot,images,broadcast,activity,inspect:scope=>renderer('images.context',{projectId:scope.canvasProjectId}),
    prepare:require('./image-context.cjs').createImageContext({storage:store,renderer,models:()=>images.models()}),
    commit:(job,partial)=>renderer('images.commit',{projectId:job.projectId,job,partial})});
   images.list=()=>[...list().filter(j=>!j.input?.managedJob),...jobs.list()];
  }
  return jobs;
 }
 const binding=async(open=false)=>checked(await conversation({action:open?'program_open':'program',program:'workspace'}));
 let avatarKey='',avatar='';
 async function contactAvatar(contact){const key=contact.id+':'+(contact.avatar_rev||0);if(key!==avatarKey){avatar=contact.avatar_rev?checked(await conversation({action:'contact_avatar',id:contact.id})).avatar||'':'';avatarKey=key;}return avatar;}
 async function effectiveModel(b){
  if(b.session?.id){const usage=checked(await conversation({action:'session_usage',id:b.session.id}));const row=usage.sessions?.find(r=>r.id===b.session.id);if(row)return row.model_name||row.model_id||'';}
  return b.contact.model_name||b.contact.model_id||'';
 }
 const library=require('./library.cjs').createCanvasLibrary({root:dataRoot,conversation,binding});
 let transferService,studioService,canvasTools;
 const referencesFile=path.join(dataRoot,'references.json');
 const references=()=>fs.existsSync(referencesFile)?JSON.parse(fs.readFileSync(referencesFile,'utf8')):[];
 const sharedReferences=require('./references.cjs').createCanvasReferences({root:dataRoot,context,projectList:()=>legacy('aieyra:project:list'),saved:references,flush:projectId=>renderer('projects.flush',{projectId}),asset:file=>store().resolveReadableImageAsset(file)});
 async function transfer(p){
  const s=store();
  if(p.sourceProjectId===p.targetProjectId){
   const reference=await sharedReferences.create(p.sourceProjectId,p.nodeIds);
   fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(referencesFile+'.tmp',JSON.stringify([...references(),reference]));fs.renameSync(referencesFile+'.tmp',referencesFile);return {ok:true,reference};
  }
  transferService ||= require('./desktop/matrix/matrix-transfer.cjs').createMatrixTransfer({projectById:id=>{const p=s.getProjectById(id,s.readProjectList());if(!p||p.kind!=='image'||p.quarantine?.readOnly)throw Error('请选择可写画布项目');return p;},readSession:s.projectSessionFromDisk,assetUrl:s.assetUrlFor,saveImage:s.saveTransferredImage,removeSource:(project,session,ids)=>s.saveTransferredImage(project,require('./desktop/matrix/matrix-transfer.cjs').removeTransferredNodes(session,ids),session.sessionRevision)});
  const result=await transferService.transfer(p);if(result.copied)notify('projects',{projectIds:[p.sourceProjectId,p.targetProjectId],reload:true});return result;
 }
 const eventFor=sender=>({sender:sender||{id:0,isDestroyed:()=>false,getURL:()=>'',send(){}}});
 async function legacy(channel,payload,sender){const fn=store().handlers.get(channel);if(!fn)throw Error('画布操作未登记：'+channel);return fn(eventFor(sender),payload);}
 function notify(kind,details={}){broadcast('aieyra:matrix:changed',{kind,...details});}
 async function projectBinding(p={}){
  const [list,b]=await Promise.all([legacy('aieyra:project:list'),binding(true)]);checked(list);
  const project=list.projects.find(x=>x.id===(p.canvasProjectId||list.activeProjectId)&&x.kind==='image'&&!x.quarantine?.readOnly);
  if(!project)throw Error('请选择可用的画布项目');
  return {ok:true,projectId:project.id,canvasProjectId:project.id,conversationId:b.session?.id||b.contact.id,projects:list.projects,configured:b.configured};
 }
 async function coding(p={}){
  const b=await binding(true),session=b.session;
  if(p.operation==='conversations')return {ok:true,conversations:[{id:session?.id||b.contact.id,label:b.contact.name,createdAt:0}]};
  if(p.operation==='draft_load')return session?checked(await conversation({action:'draft_shared_load',id:session.id})):{ok:true,revision:'unconfigured',draft:{value:'',pastes:'',attachments:[]}};
  if(p.operation==='draft_save'){
   if(!b.configured||!session)throw Error('请先在联系人中配置画布 Agent 的模型');
   const current=checked(await conversation({action:'draft_shared_load',id:session.id}));
   if(p.revision!==current.revision)throw Error('另一个入口已修改草稿，当前输入保留，请先核对最新草稿。');
   const known=new Map(current.draft.attachments.map(a=>[a.sha256,a])),attachments=[];
   for(const file of p.files||[]){
    if(file.contentHash&&known.has(file.contentHash)){attachments.push(known.get(file.contentHash));continue;}
    if(!file.path||!store().isAllowedAssetPath(file.path))throw Error('附件不属于当前画布');
    attachments.push(...checked(await stageFiles(session.id,[file.path])).attachments);
   }
   return checked(await conversation({action:'draft_shared_save',id:session.id,revision:p.revision,draft:{value:String(p.prompt||''),pastes:'',attachments,context:p.context===undefined?current.draft.context:p.context,outbox:current.draft.outbox||[]}}));
  }
  if(p.operation==='send'){
   if(!b.configured||!session)throw Error('请先在联系人中配置画布 Agent 的模型');
   if(!p.submissionId)throw Error('发送需要稳定的 submissionId');
   const draft=checked(await conversation({action:'draft_shared_load',id:session.id}));
   const saved=new Map(draft.draft.attachments.map(a=>[a.sha256,a]));
   const attachments=[];for(const file of p.fileAttachments||[]){let a=saved.get(file.contentHash);if(!a){if(!file.path||!store().isAllowedAssetPath(file.path))throw Error('附件已变化或不属于画布');a=checked(await stageFiles(session.id,[file.path])).attachments?.[0];}if(!a)throw Error('附件暂不可用');attachments.push(a);}
   const send={action:'send',id:session.id,request_id:p.submissionId,message:String(p.prompt||''),attachments,context:p.context===undefined?(p.referenceIds!==undefined?null:draft.draft.context):p.context,referenceIds:p.referenceIds,projectId:p.projectId};
   checked(await conversation(await sharedReferences.prepare(send)));
  }else if(p.operation==='interrupt'&&session)checked(await conversation({action:'cancel',id:session.id}));
  else if(p.operation==='compact'&&session)checked(await conversation({action:'compact',id:session.id,request_id:p.submissionId||crypto.randomUUID(),reason:'用户整理画布上下文'}));
  else if(!['status','history',undefined].includes(p.operation))throw Error('此操作请通过 OS 程序 Agent 管理入口执行');
  if(!session)return {ok:true,status:'idle',configured:false,items:[],conversations:[{id:b.contact.id,label:b.contact.name,createdAt:0}],avatar:await contactAvatar(b.contact),model:'',runtimeId:b.contact.id,revision:0};
  const snap=checked(await conversation({action:'snapshot',id:session.id}));
  const a=snap.agent||session,working=['queued','running','cancelling'].includes(a.state);
  const items=(snap.messages||[]).map((m,i)=>({id:m.id||String(i),type:m.from==='user'?'userMessage':'agentMessage',text:m.text||m.content||'',status:'completed'}));
  if(working&&snap.live?.thought)items.push({id:'thought:'+a.generation,type:'reasoning',text:snap.live.thought,status:'inProgress'});
  if(working&&snap.live?.text)items.push({id:'live:'+a.generation,type:'agentMessage',text:snap.live.text,status:'inProgress'});
  items.push(...imageJobs()?.timeline(p.projectId)||[]);
  const accounting=checked(await conversation({action:'session_usage',id:session.id})).sessions?.find(r=>r.id===session.id),u=accounting?.usage,c=accounting?.context;
  const tokenUsage=u?{total:{inputTokens:u.input_tokens||0,cachedInputTokens:u.cached_tokens||0,outputTokens:u.output_tokens||0},last:{totalTokens:c?.tokens||0,inputTokens:0,cachedInputTokens:0,outputTokens:0},modelContextWindow:c?.window||null}:null;
  return {ok:true,configured:b.configured,name:b.contact.name,avatar:await contactAvatar(b.contact),status:working?'running':a.state==='failed'?'error':'idle',items,hasMessages:!!items.length,model:accounting?.model_name||accounting?.model_id||b.contact.model_name||b.contact.model_id||'',tokenUsage,cacheReported:u?.cached_known===true,threadId:a.id,turnId:working?String(a.generation):undefined,runtimeId:a.id,revision:a.generation||0,error:a.error||'',conversations:[{id:a.id,label:b.contact.name,createdAt:0}]};
 }

 async function context(p={}){
  const list=checked(await legacy('aieyra:project:list'));
  const id=p.projectId||list.activeProjectId;
  const value=checked(await legacy('aieyra:config:load-session',{projectId:id}));
  const selected=new Set(p.nodeIds||[]);if(selected.size>40)throw Error('一次最多引用 40 个画布对象');
  const nodes=(value.session.nodes||[]).filter(n=>p.all===true||selected.has(n.id)||selected.has(n.displayCode));
  if(nodes.length<selected.size)throw Error('引用对象已删除或不属于当前画布，请重新选择');
  return {projectId:id,revision:value.session.sessionRevision||0,nodes:nodes.map(n=>({id:n.id,displayCode:n.displayCode,type:n.type,title:n.title,prompt:n.prompt,requirement:n.requirement,assets:n.assets,video:n.video}))};
 }
 async function run(channel,p={},sender){
  assertActive();
  // The first canvas frame needs only local preferences and the active session.
  // Agent binding and durable job recovery belong to their own consumers.
  if(channel==='aieyra:canvas:load'){
   const started=performance.now();diagnostics.record('restore-start');
   const settings=checked(await legacy('aieyra:config:load-settings',undefined,sender));
   diagnostics.record('settings-loaded',{metrics:{durationMs:performance.now()-started}});
   const sessionStarted=performance.now();
   const canvas=checked(await legacy('aieyra:config:load-session',undefined,sender));
   diagnostics.record('session-loaded',{metrics:{durationMs:performance.now()-sessionStarted,nodeCount:canvas.session?.nodes?.length||0}});
   return {...canvas,settings:settings.settings};
  }
  if(channel==='aieyra:canvas:diagnostic'){diagnostics.record(p.stage,{error:p.error,metrics:p.metrics});return {ok:true};}
  if(channel==='aieyra:workspace:status'||channel==='aieyra:workspace:retry'){store();return {ok:true,status:{state:'ready',workspaceReady:true,workspaceSuspended:false,runtimeStage:'ready',revision:epoch,distribution:'free-open-source'}};}
  if(channel==='aieyra:canvas:ready'){
   if(rendererReady&&rendererID===sender?.id)return {ok:true};
   rendererReady=true;rendererID=sender?.id||0;diagnostics.record('ready');
   return {ok:true};
  }
  if(channel==='aieyra:matrix:reply'){
   const pending=rendererRequests.get(p.id);if(!pending||pending.epoch!==rendererEpoch||pending.senderID!==sender?.id||sender?.id!==rendererID)throw Error('画布操作已过期');rendererRequests.delete(p.id);clearTimeout(pending.timer);
   p.error?pending.reject(Error(p.error)):pending.resolve(p.result);return {ok:true};
  }
  if(channel==='aieyra:matrix:styles')return {ok:true,css:''};
  if(channel==='aieyra:os:configure'){navigate(p.section==='images'?'settings':'contacts');return {ok:true};}
  if(channel==='aieyra:matrix:welcome'){const b=await binding();return {ok:true,status:b.configured?'ready':'offline',text:'告诉我你的创作想法，或选中画布对象后引用给我。',model:await effectiveModel(b)};}
  if(channel==='aieyra:matrix:tools'){
   const all=require('./program.json').operations.map(op=>({name:op.id,description:op.description})),offset=Math.max(0,Number(p.offset)||0),limit=Math.min(30,Math.max(1,Number(p.limit)||30));
   return {ok:true,tools:all.slice(offset,offset+limit),nextOffset:offset+limit<all.length?offset+limit:undefined};
  }
  if(channel==='aieyra:matrix:execute'&&p.name==='development.library')return {ok:true,tools:[]};
  if(channel==='aieyra:server:models'){const choice=await images.models();return {ok:true,models:choice.configured?[choice.model]:[],agentModels:[],imageModels:choice.configured?[choice.model]:[]};}
  if(channel==='aieyra:connection:refresh-models')return run('aieyra:connection:status',p,sender);
  if(channel==='aieyra:connection:select-models'){
   const choice=await images.models();if(p.imageModel&&p.imageModel!==choice.model)throw Error('请在 OS 设置的 Image Gen 中选择图像模型');
   return run('aieyra:connection:status',p,sender);
  }
  if(channel==='aieyra:server:generate-image')return images.generate(p);
  if(channel==='aieyra:agent:cancel-run'){
   const id=String(p.runId||'');if(id.startsWith('matrix-')){const job=imageJobs().list().find(j=>j.id===id&&(!p.projectId||j.projectId===p.projectId));if(!job)throw Error('图片任务不存在');const scope=await projectBinding({canvasProjectId:job.projectId});return imageJobs().control({operation:'cancel',jobId:id},scopeForImages(scope));}
   return images.cancel(p.runId,p.projectId);
  }
  if(channel==='aieyra:agent:image-jobs'){
   void Promise.resolve().then(()=>videos().invoke('list')).catch(error=>{diagnostics.record('video-recovery',error);report({code:'video-recovery-pending',message:error.message});});
   try{imageJobs();return {ok:true,jobs:images?.list(sender?.id)||[]};}catch(error){diagnostics.record('image-recovery',error);throw error;}
  }
  if(channel==='aieyra:agent:clear-conversation'){
   const project=store().getProjectById(p.projectId,store().readProjectList());if(!project)throw Error('项目已不存在');
   if(images?.list().some(j=>j.projectId===project.id&&j.status==='running'))throw Error('请先停止该项目图片任务');
   fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(referencesFile+'.tmp',JSON.stringify(references().filter(r=>r.sourceProjectId!==project.id)));fs.renameSync(referencesFile+'.tmp',referencesFile);
   notify('projects',{projectIds:[project.id]});return {ok:true,historyRetained:true,message:'本项目引用已清理；画布 Agent 的跨项目聊天历史保留。'};
  }
  if(channel==='aieyra:update:status'||channel==='aieyra:update:renderer-ready')return {ok:true,...await updates()};
  if(channel==='aieyra:server:me')return {ok:true,...await account()};
  if(channel==='aieyra:matrix:references')return sharedReferences.options(p);
  if(channel==='aieyra:matrix:execute')return invoke(p.name,{...p.arguments,projectId:p.arguments?.projectId||p.projectId},{request_id:p.request_id||crypto.randomUUID(),human:!!sender&&sender.id===rendererID});
  if(channel==='aieyra:matrix:workspace')return projectBinding(p);
  if(channel==='aieyra:matrix:transfer')return transfer(p);
  if(channel==='aieyra:agent:prompt-library:get')return library.get();
  if(channel==='aieyra:agent:prompt-library:update')return library.update(p);
  if(channel==='aieyra:agent:knowledge-document:read')return library.read(p.id);
  if(channel==='aieyra:coding:execute')return coding(p);
  if(channel==='aieyra:connection:status'){
   const [b,choice]=await Promise.all([binding(),images?.models?.()||{}]);const model=await effectiveModel(b);return {ok:true,connection:{version:2,mode:b.configured?'custom':'local',phase:b.configured?'ready':'local-ready',aiReady:!!b.configured,profileId:b.contact.id,profileName:b.contact.name,displayBaseUrl:'',credential:{configured:!!b.configured,persisted:!!b.configured,storage:'os',epoch:0},models:[],agentModels:[],imageModels:choice.configured?[choice.model]:[],agentModel:model,agentModelPool:model?[model]:[],imageModel:choice.configured?choice.model:'',imageModelPool:choice.configured?[choice.model]:[],imageModelNotes:{},agentProvider:'OPENAI',reasoningEffort:'low',serviceTier:'standard',fastMode:false}};
  }
  // Restoring canvas preferences must not wait for model/account probes.
  // The connection snapshot supplies the authoritative OS model after mount.
  if(channel==='aieyra:config:load-settings')return legacy(channel,p,sender);
  if(channel==='aieyra:config:save-settings'){
   // Visual/canvas preferences stay local. Agent/model authority stays in Core.
   p={...p};for(const k of Object.keys(p))if(/^(agent|model|imageModel|imageApi|imageBase|server|petAgent|baseUrl|apiKey)/.test(k))delete p[k];
   return legacy(channel,p,sender);
  }
  if(channel==='aieyra:window:control'||channel==='aieyra:window:new')throw Error('请使用 OS 顶栏管理程序窗口');
  if(channel==='aieyra:window:draft-guard')return closing.register(sender,p===true);
  if(channel==='aieyra:window:drafts-saved')return closing.acknowledge(sender,p);
  if(channel==='aieyra:server:open-portal'){navigate('settings');return {ok:true};}
  if(channel==='aieyra:agent:canvas-observation')return context(p);
  if(store().handlers.has(channel)){
   const result=await legacy(channel,p,sender);
   if(result?.ok!==false&&/:(save-session|create|switch|rename|import|delete|reset-data|mutate)$/.test(channel))notify('canvas',{projectId:p.projectId});
   return result;
  }
  throw Error('此功能尚未接入 OS：'+channel);
 }
 function call(channel,p,sender){assertActive();const promise=Promise.resolve().then(()=>run(channel,p,sender)).catch(error=>{if(['aieyra:canvas:load','aieyra:config:load-session','aieyra:config:load-settings'].includes(channel))diagnostics.record('restore',error);throw error;});pending.add(promise);return promise.finally(()=>pending.delete(promise));}
 async function asset(request){
  assertActive();const s=store(),url=new URL(request.url),pathname=url.pathname.replace(/^\/+/, '');
  if(url.hostname==='local'&&request.method==='GET'&&pathname.startsWith('media/')){videos();return videoMedia.response(pathname.slice(6),request);}
  const file=pathname.startsWith('abs/')?path.resolve(decodeURIComponent(pathname.slice(4))):path.resolve(__dirname,decodeURIComponent(pathname));
  const resolved=s.resolveReadableImageAsset(file);if(url.hostname!=='local'||request.method!=='GET'||!resolved)return new Response('Not found',{status:404});
  let target=resolved;
  if(url.searchParams.get('preview')==='thumbnail'){
   const cache=await s.currentImageThumbnailCache(),cacheRoot=s.thumbnailCacheRootForAsset(resolved);
   if(cacheRoot){const thumbnail=await cache.ensure({sourcePath:resolved,cacheRoot,maxEdge:Math.max(128,Math.min(1024,Number(url.searchParams.get('max'))||512))});target=thumbnail.path;}
  }
  assertActive();
  // Chromium file URLs reject some Windows paths beyond MAX_PATH even when
  // the original and thumbnail are readable. Stream the admitted file through
  // Node, as the local video protocol already does, without buffering it all.
  const handle=await fs.promises.open(target,'r');let stream;
  try{
   const stat=await handle.stat();assertActive();if(!stat.isFile())throw Error('图片素材不是普通文件');
   const type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.bmp':'image/bmp','.tif':'image/tiff','.tiff':'image/tiff','.svg':'image/svg+xml'}[path.extname(target).toLowerCase()]||'application/octet-stream';
   stream=handle.createReadStream({signal:request.signal});
   return new Response(Readable.toWeb(stream),{headers:{'Content-Type':type,'Content-Length':String(stat.size)}});
  }catch(error){stream?.destroy();await handle.close().catch(()=>{});throw error;}
 }
 async function renderer(action,args={}){
  const currentRenderer=await ensureRenderer?.();if(currentRenderer&&currentRenderer!==rendererID)rendererReady=false;
  const documentEpoch=rendererEpoch,deadline=Date.now()+15000;
  const assertDocument=()=>{assertActive();if(documentEpoch!==rendererEpoch)throw Error('画布页面已重新载入，请先读取原状态。');};
  while(!rendererReady){assertDocument();if(Date.now()>deadline)throw Error('画布页面尚未准备好');await new Promise(r=>setTimeout(r,25));}
  const b=await projectBinding({canvasProjectId:args.projectId});
  assertDocument();
  const id=crypto.randomUUID();return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{rendererRequests.delete(id);reject(Error('画布操作结果未确认，请先读取原状态'));},30000);
   rendererRequests.set(id,{resolve,reject,timer,senderID:rendererID,epoch:documentEpoch});broadcast('aieyra:matrix:request',{id,action,args,scope:{projectId:b.projectId,canvasProjectId:b.canvasProjectId,conversationId:b.conversationId}});
  });
 }
 const rendererOperations=new Set(['observe','open_panel','projects.create','projects.flush','nodes.create','nodes.update','nodes.style','images.context','images.actions','images.import','images.locate','annotations.read','annotations.preview','database.use','documents.mount']);
 const scopeForImages=b=>({projectId:b.projectId,canvasProjectId:b.canvasProjectId,conversationId:b.conversationId});
 async function invoke(operation,args={},meta={}){
  // 第109轮 R15：Workspace 只有一个画布，工具传入的画布 ID 必须是当前画布。
  if(typeof args?.projectId==='string'&&args.projectId&&!operation.startsWith('knowledge.')){const list=checked(await legacy('aieyra:project:list'));if(args.projectId!==list.activeProjectId)throw Error('Workspace 只有一个画布，请先用 workspace.observe 读取当前画布的 projectId');}
  if(operation==='help'){const all=require('./program.json').operations;if(!args.name)return {ok:true,operations:all};const op=all.find(o=>o.id===args.name);if(!op)throw Error('未知画布工具');return {ok:true,...op,...require('./operations.json')[args.name]};}
  if(operation.startsWith('videos.'))return videos().invoke(operation.slice(7),args,meta);
  if(operation==='images.batch'||operation==='images.generate'&&args.input||['images.status','images.wait'].includes(operation)||operation==='images.cancel'&&args.jobId){
   const scope=scopeForImages(await projectBinding({canvasProjectId:args.projectId}));
   if(operation==='images.generate'||operation==='images.batch'&&args.operation==='start')return imageJobs().start(args,scope,meta.request_id||args.runId,operation==='images.batch');
   return imageJobs().control({...args,operation:operation==='images.batch'?args.operation:operation.slice(7)},scope);
  }
  if(operation==='images.generate'||operation==='images.recover'){
   const result=await (operation==='images.generate'?images.generate(args):images.recover(args));
   const job=images.list().find(j=>j.id===(args.placementRunId||args.runId)&&j.projectId===args.projectId);
   if(!job)throw Error('图片已保存，成果状态尚未读取');
   const scope=await projectBinding({canvasProjectId:args.projectId});job.reviewContext={matrixProjectId:scope.projectId,matrixConversationId:scope.conversationId};
   const committed=checked(await renderer('images.commit',{projectId:args.projectId,job}));return {...result,outputs:committed.outputs};
  }
  if(operation==='images.cancel')return images.cancel(args.runId||args.jobId,args.projectId);
  if(operation==='images.receipts')return {ok:true,receipts:images.receipts()};
  if(operation==='knowledge.list')return library.get();
  if(operation==='knowledge.read')return library.read(args.id);
  if(operation==='knowledge.update')return library.update(args);
  // 第109轮 R15：Workspace 只有一个画布。目录只给出当前画布；旧项目原位保留，不再经工具访问。
  if(operation==='projects'||operation==='projects.list'){const list=checked(await legacy('aieyra:project:list'));return {...list,projects:list.projects.filter(p=>p.id===list.activeProjectId)};}
  if(operation==='context'||operation==='projects.inspect')return context(args);
  const aliases={'workspace.observe':'observe','workspace.open_panel':'open_panel'};operation=aliases[operation]||operation;
  let execute=()=>renderer(operation,args),readOnly=['observe','images.context','annotations.read','annotations.preview'].includes(operation);
  if(['canvas.workflow','canvas.experience','images.view','images.view_many'].includes(operation)){
   canvasTools ||= require('./canvas-tools.cjs').createCanvasTools({storage:store,renderer});
   if(operation==='canvas.workflow'){execute=()=>canvasTools.workflow(args,meta.request_id);readOnly=['list_nodes','describe_node'].includes((args.input||args).operation);}
   else if(operation==='canvas.experience'){execute=()=>canvasTools.experience(args);readOnly=((args.input||args).action||'read')==='read';}
   else{execute=()=>canvasTools.view(args,operation==='images.view_many');readOnly=true;}
  }else if(operation==='annotations.preview'){
   execute=async()=>{const result=checked(await renderer(operation,args));if(!result.dataUrl)throw Error('标记图未生成');const scope=await projectBinding({canvasProjectId:args.projectId});const asset=store().writeDataUrlOutput(result.dataUrl,'annotations-'+crypto.randomUUID(),'preview',scope.projectId,{subdir:'_agent-review'});return {ok:true,annotations:result.annotations,model_image:{path:asset.path,detail:'high'}};};readOnly=true;
  }else if(operation==='goals.manage'){
   execute=async()=>{const current=checked(await renderer('images.context',{projectId:args.projectId}));return legacy('aieyra:goals',{projectId:current.projectId,conversationId:current.conversationId,input:args.input});};readOnly=['list','read','resume'].includes(args.input?.operation);
  }else if(['documents.manage','documents.export','documents.analyze','database.manage'].includes(operation)){
   studioService ||= require('./studio.cjs')({...store(),renderer,notify});
   const input={...args,...(operation==='documents.export'?{action:'export'}:operation==='documents.analyze'?{action:'analyze'}:operation==='database.manage'?{domain:'database'}:{})};
   execute=()=>studioService(input);readOnly=['read','list'].includes(input.action)||input.action==='analyze'&&!input.saveAs;
  }else if(operation==='settings.read'){execute=()=>run('aieyra:config:load-settings');readOnly=true;}
  else if(operation==='settings.update'){execute=()=>run('aieyra:config:save-settings',args.patch||{});}
  else if(operation==='storage.status'){execute=()=>legacy('aieyra:project:storage-status');readOnly=true;}
  else if(operation==='images.import'&&args.paths){execute=async()=>{
   if(!Array.isArray(args.paths)||!args.paths.length||args.paths.length>40)throw Error('请提供 1–40 个图片路径');
   const current=checked(await renderer('images.context',{projectId:args.projectId}));
   const imported=checked(await legacy('aieyra:asset:import-local-images',{projectId:current.projectId,paths:args.paths,maxFiles:args.paths.length}));
   if(imported.assets?.length!==args.paths.length)throw Error('部分图片未导入，请检查原素材');
   return renderer('images.import',{projectId:current.projectId,canvasRevision:current.canvasRevision,assets:imported.assets,title:args.title});
  };}
  else if(!rendererOperations.has(operation))throw Error('画布未声明操作：'+operation);
  if(readOnly)return execute();
  const requestID=String(meta.request_id||'');if(!/^[a-zA-Z0-9_-]{1,96}$/.test(requestID))throw Error('修改画布需要稳定的 request_id');
  const dir=path.join(dataRoot,'receipts');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,requestID+'.json');
  const digest=crypto.createHash('sha256').update(JSON.stringify({operation,args})).digest('hex');
  if(fs.existsSync(file)){
   const receipt=JSON.parse(fs.readFileSync(file,'utf8'));if(receipt.digest!==digest)throw Error('request_id 已被其他画布操作使用');
   if(receipt.state==='completed')return receipt.result;
   throw Error('原画布操作结果未确认；请检查画布后使用新的 request_id');
  }
  const write=receipt=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(receipt));fs.renameSync(temp,file);};
  write({state:'pending',digest,operation});
  try{const result=checked(await execute());write({state:'completed',digest,operation,result});return result;}
  catch(error){write({state:'unknown',digest,operation,error:error.message});throw error;}
 }
 // Both the original canvas composer and the OS sidebar enter this pipeline.
 // The canvas mutation receipt reuses the message request; a transport retry
 // cannot silently insert the same images twice.
 async function prepareSend(p){
  const prepared=await sharedReferences.prepare(p),pictures=(p.attachments||[]).filter(a=>a.kind==='image');
  if(pictures.length){
   if(!p.request_id)throw Error('图片发送需要稳定的请求编号');
   const list=checked(await legacy('aieyra:project:list')),projectId=p.projectId||list.activeProjectId;
   if(!projectId)throw Error('请先创建画布后再发送图片');
   const request_id='composer-'+crypto.createHash('sha256').update(p.id+':'+p.request_id).digest('hex');
   await invoke('images.import',{projectId,paths:pictures.map(a=>a.asset),title:'对话图片'},{request_id});
  }
  return prepared;
 }
 async function composerImages(p){
  const scope=scopeForImages(await projectBinding({})),manager=imageJobs();
  if(scope.conversationId!==p.id)throw Error('图片任务所属会话已变化');
  if(p.action==='program_image_jobs'){
   const result=await manager.control({operation:'list'},scope);
   return {ok:true,jobs:(result.tasks||[]).slice(-6).map(j=>({id:j.jobId,status:j.status,completed:j.batch?.completed,total:j.batch?.total,unknown:j.batch?.unknown,error:j.error||'',summary:j.summary||''}))};
  }
  if(!['pause','resume','cancel'].includes(p.operation))throw Error('未知图片任务操作');
  return manager.control({operation:p.operation,jobId:String(p.jobId||'')},scope);
 }
 return {call,asset,context,invoke,composerImages,rendererEvent,referenceOptions:sharedReferences.options,prepareSend,async cancelWork(sessionId){if(videoMedia&&(await binding()).session?.id===sessionId)for(const job of videoMedia.jobs())if(['queued','running','cancelling'].includes(job.state))await videoMedia.call(job.projectId,'cancel',{requestId:job.id});for(const job of imageJobs()?.list()||[])if(job.reviewContext?.matrixConversationId===sessionId&&job.status==='running')await imageJobs().control({operation:'cancel',jobId:job.id},{projectId:job.projectId,canvasProjectId:job.projectId,conversationId:sessionId});},activity:()=>({program:'workspace',active:!!jobs?.active()||!!videoMedia?.active(),jobs:[...(jobs?.list().filter(j=>j.status==='running').map(j=>({id:j.id,status:j.status}))||[]),...(videoMedia?.jobs().filter(j=>['queued','running','cancelling'].includes(j.state)).map(j=>({id:j.id,status:j.state,kind:'video'}))||[])]}),prepareClose:closing.prepare,closingCall(channel,p,sender){return closing.preparing(sender?.id)&&(channel==='aieyra:window:drafts-saved'||channel==='aieyra:config:save-session'||channel==='aieyra:coding:execute'&&['draft_save','draft_load'].includes(p?.operation));},snapshot:()=>legacy('aieyra:project:list'),async close(){if(closed)return;await videoMedia?.close();await jobs?.close();await images?.close?.();closed=true;epoch++;rendererEpoch++;rendererReady=false;for(const p of rendererRequests.values()){clearTimeout(p.timer);p.reject(Error('Workspace 已停止'));}rendererRequests.clear();await Promise.allSettled([...pending]);await storage?.close();storage=null;},resume(){if(closed){closed=false;epoch++;images?.resume?.();jobs?.resume();videoMedia?.resume();}}};
}
module.exports={createWorkspaceProgram};
