// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: native-chat
// Regions: createProgramOverlayBridge; programShellCall
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/program-agent-overlay.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Native overlay requests are already authenticated against the visible frame.
// Resolve the persistent program binding again before reading private originals.
function createProgramOverlayBridge({conversation,attachment,emit,homeRead}){
 const check=r=>{if(r?.ok===false)throw Error(r.error||'程序操作未完成');return r;};
 return async p=>{
  if(p.program==='home'){if(!homeRead)throw Error('此窗口没有首页会话');return homeRead(p);}
  const binding=check(await conversation({action:'program',program:p.program}));
  if(!binding.session||binding.session.id!==p.task_id)throw Error('程序会话所属身份已变化');
  const id=p.task_id;
  if(p.action==='retry_chat')return conversation({action:'retry_chat',id,generation:p.generation,attempt:p.attempt});
  if(p.action==='document_read'||p.action==='document_state')return conversation({action:p.action,id,document_id:p.id,operation:p.operation,expected_revision:p.expected_revision});
  if(p.program==='workspace'&&p.action==='jobs')return conversation({action:'program_image_jobs',id});
  if(p.program==='workspace'&&p.action==='job_control')return conversation({action:'program_image_control',id,jobId:p.jobId,operation:p.operation});
  if(p.action==='attachment'){
   if(!['imageLibrary','attachmentMedia'].includes(p.method))throw Error('此侧栏只允许预览所属附件');
   return attachment({id,method:p.method,args:p.args||{}});
  }
  if(p.action==='references')return conversation({action:'program_references',id,projectId:p.projectId});if(p.action==='chat_page')return conversation({action:'chat_page',id,kind:'conversation',before:String(p.before||''),limit_rounds:20});
  if(p.action==='history')return conversation({action:'history',id,before:String(p.before||''),limit:30,query:String(p.query||'')});
  if(p.action==='receipt')return p.entry_id?conversation({action:'history_receipt',id,entry_id:p.entry_id,input_offset:p.input_offset,output_offset:p.output_offset}):conversation({action:'receipt',id,call_id:p.id,receipt_generation:p.receipt_generation,receipt_version:p.receipt_version,input_offset:p.input_offset,output_offset:p.output_offset});
  if(p.action==='terminal_read')return conversation({action:'terminal_read',id,call_id:p.call_id,receipt_generation:p.receipt_generation,offset:p.offset});
  if(p.action==='image')return conversation({action:'image',id,image_id:p.image_id});
  if(p.action==='program_projection')return conversation({...p,action:'program_projection',id});
  if(p.action==='files'){
   if(!binding.configured)throw Error('请从右上角选择此程序的模型');
   const paths=p.paths||[],files=p.files||[];
   if(!Array.isArray(paths)||!Array.isArray(files)||paths.length+files.length>10)throw Error('每次最多添加 10 个附件');
   const attachments=[],receipts=[];let total=0;
   const collect=result=>{check(result);attachments.push(...result.attachments||[]);receipts.push(...result.receipts||[result.receipt].filter(Boolean));};
   if(paths.length)collect(await attachment({id,method:'stageAttachmentPaths',args:{paths}}));
   for(const file of files){total+=file.bytes?.byteLength||0;if(total>64*1024*1024)throw Error('附件合计最多 64 MiB');collect(await attachment({id,method:'stageFileBytes',args:file}));}
   emit({action:'files',task_id:id,core_epoch:p.core_epoch,text:JSON.stringify({attachments,receipts})});return {ok:true};
  }
  throw Error('未知程序浮层操作');
 };
}
// The shell cannot select another program/contact/session. Resolve ownership on
// every call, including delayed attachment and model-menu submissions.
async function programShellCall({record,args,invoke,electron,config,registerDrop}){
 const target=record.window.host;
 if(!target||target.isDestroyed()||record.placement!=='detached')throw Error('程序窗口已放回 OS');
 if(record.kind==='coding'&&args.method==='chat_toggle'){record.window.webContents.send('plugin:event',{type:'chat-layer',action:'toggle'});return {ok:true};}
 const check=r=>{if(r?.ok===false)throw Error(r.error||'程序操作失败');return r;};
 const p=args.args||{};
 if(args.method==='sessionModelMenu'||args.method==='openModelSettings')return invoke(args.method,p,target);
 if(args.method==='account'&&['status','menu'].includes(p.action))return invoke('account',p,target);
 const call=p=>invoke('conversation',p,target).then(check);
 const b=await call({action:'program',program:record.kind});
 const alive=()=>{if(record.window.host!==target||target.isDestroyed())throw Error('程序窗口已关闭');};alive();
 const id=b.session?.id;
 const owns=()=>{if(!id||p.id&&p.id!==id)throw Error('会话不属于此程序');};
 if(args.method==='chatLayerPreference'){
  if(p.key!=='program:'+record.kind+':'+(id||b.contact.id))throw Error('对话显示偏好不属于此程序');
  return invoke('chatLayerPreference',{key:p.key,open:p.open,position:p.position},target);
 }
 if(args.method==='conversation'){
  if(['program','program_open'].includes(p.action))return call({action:p.action,program:record.kind});
  if(p.action==='contacts')return [b.contact];
  if(p.action==='groups')return [];
  if(p.action==='models')return call({action:'models'});
  if(record.kind==='coding'&&p.action==='session_usage'&&p.id===b.binding?.scope_id)return call({action:'session_usage',id:p.id});
  if(p.action==='contact_avatar')return call({action:p.action,id:b.contact.id});
  if(p.action==='contact_update'&&p.id===b.contact.id&&Number.isInteger(p.expected_model_revision)&&p.expected_model_revision>=0&&Object.keys(p).every(key=>['action','id','model_id','model_unconfigured','expected_model_revision'].includes(key)))return call(p);
  if(!['snapshot','send','retry_chat','cancel','compact','draft_shared_load','draft_shared_save','session_usage','history','history_receipt','receipt','chat_page','human_reply','terminal_read','image','program_projection'].includes(p.action))throw Error('程序窗口不支持此会话操作');
  owns();return call({...p,id});
 }
 if(args.method==='conversationAttachment'){owns();return invoke('conversationAttachment',{...p,id},target);}
 if(args.method==='sessionModel'){
  if(record.kind==='coding'&&p.id===b.binding?.scope_id){if(!id||p.target!==id)throw Error('模型目标不属于此程序');return invoke('sessionModel',{...p,kind:'group'},target);}
  owns();if(p.target&&p.target!==id)throw Error('模型目标不属于此程序');return invoke('sessionModel',{...p,id,target:id,kind:'program'},target);
 }
 if(args.method==='builtinRole'&&record.kind==='coding'&&p.builtin==='cota'&&['read','save'].includes(p.action)&&Object.keys(p).every(key=>['action','builtin','profile_version','model_version','model_id'].includes(key)))return invoke('builtinRole',p,target);
 if(args.method==='onboard'&&p.action==='pool'&&p.op==='view')return invoke('onboard',p,target);
 if(args.method==='foldedSurface'){
  if(p.visible&&(p.content?.program!==record.kind||p.content?.task_id!==(id||b.contact.id)))throw Error('浮层不属于此程序');
  if(!record.programOverlay){
   const emit=value=>{if(record.window.host===target&&!target.isDestroyed())target.webContents.send('extension:foldedAction',value);};
   record.programOverlay=require('./folded-overlay.cjs').createFoldedOverlay({electron,win:target,registerDrop,blocked:()=>record.modal===true,
    theme:require('./window-theme.cjs').createWindowTheme(config),halo:require('../../../Halo/runtime/settings.cjs').createHaloStore(config),
    onAction:value=>{emit(value);return {ok:true};},
    onRead:createProgramOverlayBridge({conversation:call,attachment:value=>invoke('conversationAttachment',value,target),emit})});
  }
  alive();return record.programOverlay.surface(p);
 }
 throw Error('程序窗口不支持此操作');
}
module.exports={createProgramOverlayBridge,programShellCall};
