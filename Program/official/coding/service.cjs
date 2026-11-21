'use strict';
const {createHash}=require('node:crypto');

// Coding is a view of Core's managed group, not another agent runtime. Every
// operation resolves the current binding; renderer-supplied session IDs cannot
// select a different conversation. The terminal has no input operation.
const BUSY=new Set(['queued','running','cancelling']),TERMINAL_ITEMS=400,PAGE_ROUNDS=20,MESSAGE_LIMIT=20000,PREVIEW_LIMIT=4000;
const clip=(text,max)=>{const value=String(text||'');return value.length>max?value.slice(0,max)+'…':value;};
// The terminal needs the label, the command and a bounded preview, never whole receipts.
function slim(item,member){
 const preview=item.preview!==undefined&&JSON.stringify(item.preview).length<=PREVIEW_LIMIT?item.preview:undefined;
 const input_preview=item.input_preview!==undefined&&JSON.stringify(item.input_preview).length<=PREVIEW_LIMIT?item.input_preview:undefined;
 return {id:member.role+':'+item.id,member:member.role,name:member.name||member.role,call_id:item.id,revision:item.revision,receipt_version:item.receipt_version,generation:item.generation,tool:item.tool,action:item.action,title:item.title,brief:item.brief,targets:item.targets,state:item.state,detail:item.detail,exit_code:item.exit_code,started_at:item.started_at||0,sequence:item.sequence||0,preview,preview_truncated:item.preview_truncated||item.preview!==undefined&&preview===undefined,input_preview,command:clip(item.command,4000),text:item.command?'$ '+clip(item.command,400):''};
}
function createCodingProgram({conversation,openPage,releasePage,profile=()=>({}),attachment,projectFiles,chooseProject}){
 const projects=new Map(),documentOwners=new Map(),observedChanges=new Set();
 const check=value=>{
  if(value?.ok===false)throw Error(value.error||'Coding 操作未完成');
  return value;
 };
 const call=async args=>check(await conversation(args));
 async function binding(open=false){
  const value=await call({action:open?'program_open':'program',program:'coding'});
  if(value.binding?.kind!=='group'||value.binding.program!=='coding')throw Error('Coding 会话绑定不可用');
  const scope=value.binding,root=scope.project?.root||'';
  const project_key=root?createHash('sha256').update(JSON.stringify([scope.scope_id,scope.host_session_id,root])).digest('hex'):'';
  if(project_key){projects.set(project_key,root);while(projects.size>16)projects.delete(projects.keys().next().value);}
  return {...value,binding:{...scope,project_key}};
 }
 // Agent-facing snapshot keeps the full group view.
 async function snapshot(){
  const value=await binding();
  return {...value,group:value.binding.host_session_id?await call({action:'group',id:value.binding.scope_id}):null};
 }
 // The page needs only the sequence and members here; messages come from chat_page.
 async function status(after,open){
  const value=await binding(open===true),scope=value.binding;
  if(!scope.host_session_id)return {...value,group:null};
  const group=await call({action:'group',id:scope.scope_id,after:Math.max(0,Number(after)||0)});
  return {...value,group:{seq:group.seq,members:group.members}};
 }
 // One merged, read-only operation stream. A member that cannot be read does not hide the others.
 async function terminal(){
  const scope=(await binding()).binding,rows=[],failed=[],artifacts=[],documents=[];let core_epoch='';
  for(const member of scope.members){
   if(!member.session_id)continue;
   try{
    const snap=await call({action:'snapshot',id:member.session_id});core_epoch=snap.core_epoch||core_epoch;
    for(const document of snap.documents||[])if(document.kind==='report'){documents.push(document);documentOwners.set(document.id,{scope:scope.scope_id,session:member.session_id});}
    for(const m of snap.messages||[])for(const a of m.artifacts||[])artifacts.push({...a,role:member.role,name:member.name});
    const floor=scope.project?.generation_floor?.[member.session_id];
    for(const item of snap.activity?.items||[])if(!item.hidden&&item.id&&(!Number.isInteger(floor)||Number(item.generation)>floor)){
     rows.push(slim(item,member));
     if(projectFiles?.observe&&item.tool==='apply_patch'&&item.state==='completed'){
      const key=JSON.stringify([scope.project_key,member.session_id,item.generation,item.id,item.receipt_version]);
      if(!observedChanges.has(key))try{
       const receipt=await call({action:'group_receipt',group_id:scope.scope_id,member_id:member.session_id,call_id:item.id,receipt_generation:item.generation,receipt_version:item.receipt_version,input_offset:0,output_offset:0});
       // A bounded, complete receipt with matching file bytes establishes the
       // attribution. Commands and path guesses never establish authorship.
       if(!receipt.pending&&!receipt.next_output&&typeof receipt.output==='string'){
        const {activityData}=await import('../../../Tool/presentation/receipt.mjs'),patch=activityData({preview:receipt.output});
        if(patch.ok===true&&patch.state==='applied')for(const file of patch.files||[])if(file.operation!=='delete'&&file.after_sha256){
         try{projectFiles.observe(scope.members.find(m=>m.role==='cota')?.workdir,file.new_path||file.path,{source:'agent',member:member.name||member.role,call_id:item.id,generation:item.generation,receipt_version:receipt.receipt_version,after_sha256:file.after_sha256});}catch{/* Removed, changed or unavailable files remain external observations. */}
        }
        observedChanges.add(key);while(observedChanges.size>800)observedChanges.delete(observedChanges.values().next().value);
       }
      }catch{/* Receipt availability must not hide the operation stream. */}
     }
    }
   }catch(error){failed.push((member.name||member.role)+'：'+error.message);}
  }
  if(failed.length&&!rows.length)throw Error(failed.join('；'));
  rows.sort((a,b)=>a.started_at-b.started_at||a.sequence-b.sequence||(a.id<b.id?-1:1));
  return {scope_id:scope.scope_id,project_key:scope.project_key,core_epoch,documents,items:rows.slice(-TERMINAL_ITEMS),artifacts:artifacts.slice(-100),warning:failed.join('；')};
 }
 // Context failures never turn a successful file write into a reported failure.
 async function context(scope,operation,p={}){
  const root=scope.project?.root||scope.members.find(m=>m.role==='cota')?.workdir;
  if(!scope.project?.root)await call({action:'coding_project',operation:'open',root,expected_revision:scope.project?.revision||0});
  return call({action:'coding_project',operation,root,...p});
 }
 async function annotate(value,scope,operation,p){
  try{await context(scope,operation,p);return value;}catch(e){return {...value,context_warning:'文件操作已完成，工作区状态同步失败：'+e.message};}
 }
 let choosing=false;
 async function selectProject(kind,dropped){
  if(!chooseProject||!projectFiles?.selection)throw Error('文件选择器暂不可用');
  if(choosing)throw Error('请先完成当前文件选择');
  choosing=true;
  try{
   const scope=(await binding()).binding,root=scope.project?.root||scope.members.find(m=>m.role==='cota')?.workdir;
   const selected=dropped??await chooseProject({kind,root});if(!selected)return {cancelled:true};
   const next=kind==='new'?projectFiles.create(selected):projectFiles.selection(root,selected,kind);
   await call({action:'coding_project',operation:'open',root:next.root,expected_revision:scope.project?.revision||0});
   const value=await binding();return {...value,path:next.path||''};
  }finally{choosing=false;}
 }
 async function invoke(operation,args={},meta={}){
  if(operation==='status')return snapshot();
  if(!['send','cancel'].includes(operation))throw Error('Coding 没有这项操作');
  const value=await binding(operation==='send'),scope=value.binding;
  if(operation==='send'){
   if(!value.configured||!scope.host_session_id)throw Error('请在右上角选择模型');
   const request=String(meta.request_id||args.request_id||''),text=String(args.message||'');
   if(!request||request.length>96)throw Error('发送需要稳定的请求编号');
   if(!text.trim()&&!args.attachments?.length||text.length>MESSAGE_LIMIT)throw Error('消息不能为空，且不超过 '+MESSAGE_LIMIT+' 字');
   return call({action:'group_post',id:scope.scope_id,text,request_id:request,...(args.attachments?.length?{attachments:args.attachments}:{})});
  }
  const member=scope.members.find(row=>row.role===(args.role||'cota'));
  if(!member?.session_id)throw Error('该成员尚无 Coding 会话');
  if(!Number.isInteger(args.generation)||args.generation<0)throw Error('停止需要当前任务代次');
  return call({action:'group_stop',id:scope.scope_id,member:member.role==='cota'?'host':member.contact_id,generation:args.generation});
 }
 return {
  snapshot,invoke,dropProject:selected=>selectProject('directory',selected),
  // Page entry: the renderer names an action, never a session.
  async user(p={}){
   switch(p.action){
    case 'document_read':case 'document_state':{
     const scope=(await binding()).binding,owner=documentOwners.get(p.id);
     if(!owner||p.task_id!==scope.scope_id||owner.scope!==scope.scope_id||!scope.members.some(m=>m.session_id===owner.session))throw Error('报告不属于当前 Coding 会话');
     return call({action:p.action,id:owner.session,document_id:p.id,operation:p.operation,expected_revision:p.expected_revision});
    }
    case 'project_new':return selectProject('new');
    case 'project_open':return selectProject('directory');
    case 'file_open':return selectProject('file');
    case 'project_list':case 'project_read':case 'project_save':case 'project_history':case 'project_draft':{
     const scope=(await binding()).binding,member=scope.members.find(m=>m.role==='cota'),root=scope.project?.root||member?.workdir;
     if(!projectFiles||!root)throw Error('当前项目尚未就绪');
     // Drafts may finish flushing to a previously issued project capability.
     // Every read/save must still match the current Core binding.
     if(p.action==='project_draft'&&projects.has(p.project_key)){
      const value=projectFiles.draft(projects.get(p.project_key),p.path,p.draft);
      return p.project_key===scope.project_key?annotate(value,scope,'draft',{path:p.path,unsaved:!!p.draft}):value;
     }
     if(!p.project_key||p.project_key!==scope.project_key)throw Object.assign(Error('项目已切换，请重新读取；原编辑草稿保留'),{code:'project_changed'});
     if(p.action==='project_save'){
      if(scope.members.some(m=>BUSY.has(m.state)||m.state==='waiting_user'))throw Error('Agent 正在使用项目，编辑草稿已保留，请待当前任务结束后保存');
      const file=projectFiles.save(root,p.path,p.text,p.version);return annotate(file,scope,'saved',{path:file.path,version:file.version,unsaved:false});
     }
     if(p.action==='project_list')return projectFiles.list(root,p.path||'');
     if(p.action==='project_history')return projectFiles.history(root,p.path,p.version_id);
     const file=projectFiles.read(root,p.path);return p.user===true?annotate(file,scope,'focus',{path:file.path,unsaved:!!file.draft}):file;
    }
    case 'status':return {...await status(p.after,p.open),profile:profile()};
    case 'avatar':{
     const scope=(await binding()).binding,member=scope.members.find(m=>m.role===p.role);
     if(!member)throw Error('Coding 成员不存在');return call({action:'contact_avatar',id:member.contact_id});
    }
    case 'draft_load':case 'draft_save':{
     const scope=(await binding()).binding;if(!scope.host_session_id)throw Error('请先配置 Cota');
     return call({action:p.action==='draft_load'?'draft_shared_load':'draft_shared_save',id:scope.host_session_id,...(p.action==='draft_save'?{revision:p.revision,draft:p.draft}:{})});
    }
    case 'attachment':{
     const scope=(await binding()).binding;if(!scope.host_session_id||!attachment)throw Error('附件暂不可用');
     if(!['chooseAttachments','stageFileBytes','stageAttachmentPaths','stageAttachmentBytes','imageLibrary','attachmentMedia','attachmentState','attachmentReferences'].includes(p.method))throw Error('未知附件操作');
     return attachment({id:scope.host_session_id,method:p.method,args:p.args||{}});
    }
    case 'terminal_output':case 'receipt':{
     const scope=(await binding()).binding,member=scope.members.find(m=>m.role===p.role);if(!member?.session_id)throw Error('工作记录不属于 Coding 成员');
     return conversation({action:p.action==='terminal_output'?'group_terminal_read':'group_receipt',group_id:scope.scope_id,member_id:member.session_id,call_id:String(p.call_id||''),receipt_generation:p.generation,...(p.action==='terminal_output'?{offset:p.offset}:{receipt_version:p.receipt_version,input_offset:p.input_offset,output_offset:p.output_offset})});
    }
    case 'work_image':case 'work_program':{
     const scope=(await binding()).binding,member=scope.members.find(m=>m.role===p.role);
     if(!member?.session_id)throw Error('工作记录不属于 Coding 成员');
     const call_id=String(p.call_id||''),receipt_generation=p.generation;
     const receipt=await call({action:'group_receipt',group_id:scope.scope_id,member_id:member.session_id,call_id,receipt_generation});
     if(receipt?.ok===false)return receipt;
     return conversation({action:p.action==='work_image'?'image':'program_projection',id:member.session_id,call_id,receipt_generation,...(p.action==='work_image'?{image_id:p.image_id}:{})});
    }
    case 'terminal':return terminal();
    case 'chat_page':{
     const scope=(await binding()).binding;
     if(!scope.host_session_id)throw Error('请在右上角选择模型');
     return call({action:'chat_page',id:scope.scope_id,kind:'group',before:String(p.before||''),limit_rounds:PAGE_ROUNDS});
    }
    case 'send':return invoke('send',{message:p.message,attachments:p.attachments},{request_id:p.request_id});
    case 'retry':{
     const scope=(await binding()).binding,member=scope.members.find(m=>m.role===p.role);
     if(p.project_key!==scope.project_key||!member?.session_id||member.session_id!==p.session_id)throw Error('编程任务已切换');
     return call({action:'coding_member_retry',id:scope.scope_id,project_root:scope.project?.root||'',member:member.role==='cota'?'host':member.contact_id,session_id:member.session_id,generation:p.generation,attempt:p.attempt});
    }
    case 'cancel':return invoke('cancel',{role:p.role,generation:p.generation});
    default:throw Error('Coding 没有这项操作');
   }
  },
  async open(){await binding(true);return openPage();},
  // Used on package revocation. Closing only the page uses releasePage at the
  // host lifecycle, preserving ongoing work and all persistent conversations.
  async close(){
   const value=await binding();
   for(const row of value.binding.members){
    if(row.session_id&&BUSY.has(row.state)){
     await invoke('cancel',{role:row.role,generation:row.generation});
    }
   }
   return releasePage();
  },
 };
}
module.exports={createCodingProgram};
