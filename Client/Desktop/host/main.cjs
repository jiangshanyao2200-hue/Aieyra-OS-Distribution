// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; fs; crypto; decodeImage; initial; moduleEnv; root; installation; landCoreOnly; updatesEnabled; attachmentStore; imageLibrary; tipWindow; deskPark; runtimeReady; startupModule; mainHidden; composerDraft; prepareComposerClose; albumAttachments; conversationStores; conversationStore; conversationCall; readProgramProjection; descriptor; themeLibrary; canvasProgram; centerMonitor; workspaceProgram; codingService; codingDrafts; codingProgram; offscreen; hostTrace; profile; page; showWorkspaceWindow; linkWorking; core; nativeAdapters; nativeVerification; nativePrograms; closeServices; shutdown; quitPreparing; startShutdown; requestQuit; profileStore; haloStore; appearanceStore; promptEditor; trusted; exposedHandlers; previews; previewStore; previewSession; openPreview; dialogPages; pageDialogReady; allowPageDialog; askPageDialog; expose; startupFailed
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/main.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const { app, BrowserWindow, ipcMain, dialog, nativeImage, shell, session, safeStorage, protocol } = require('electron');
protocol.registerSchemesAsPrivileged([{scheme:'aieyra-resource',privileges:{standard:true,secure:true,supportFetchAPI:true}},{scheme:'aieyra-theme',privileges:{standard:true,secure:true,corsEnabled:true}},{scheme:'iiimage-asset',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { validateDescriptor, requestCore } = require('./bridge.cjs');
const { createAttachmentStore } = require('./attachments.cjs');
const {createImageLibrary,createImageCodec}=require('./image-library.cjs');
const decodeImage=createImageCodec(nativeImage);

const initial = validateDescriptor(
  JSON.parse(process.env.AIEYRA_WORKSPACE_BRIDGE || '{}'),
);
delete process.env.AIEYRA_WORKSPACE_BRIDGE;
// 仅模块子进程获得已验证 CORE 的生命周期证明，普通 Shell 不继承。
// 安装级开关在启动时加载；请求设置与提示词各自按请求边界加载。
const moduleEnv={...process.env};
for(const key of Object.keys(moduleEnv))if(key.startsWith('AIEYRA_OS_OWNER_'))delete moduleEnv[key];
if(initial.parent_owned){moduleEnv.AIEYRA_OS_OWNER_PORT=String(initial.parent_port);moduleEnv.AIEYRA_OS_OWNER_TOKEN=initial.parent_token;}
const root = path.resolve(initial.root),
  config = path.resolve(initial.config);
require('../../../Contracts/storage/profile.cjs').use(config);
const installation=require('./first-run.cjs').installationSettings(config);
// One release-stage authority; first-ring migration does not enable remote Link.
const landCoreOnly=!require('../src/resources.cjs').releaseStage().link_situation;
const updatesEnabled=installation.role!=='development'&&require('../src/resources.cjs').read('运行参数.json').official_updates_enabled===true;
const attachmentStore=createAttachmentStore(config,{managed:true,owner:initial.session_id,decodeImage});
const imageLibrary=createImageLibrary(config,{decode:decodeImage});
let tipWindow=null,moduleRuntime=null,homeContents=null,resolveRuntimeReady,eyraPresence=null,nativeModal=null,activeModulePage='home';
let deskPark=null;
const runtimeReady=new Promise(resolve=>{resolveRuntimeReady=resolve;});
const startupModule=process.env.AIEYRA_OS_OPEN_MODULE||'';
delete process.env.AIEYRA_OS_OPEN_MODULE;delete moduleEnv.AIEYRA_OS_OPEN_MODULE;
let mainHidden=!!startupModule;
let composerDraft=null,groupDraftStore=null,composerClose=null,preparedCloseID=null;
async function prepareComposerClose({keepAlive=false,resume=keepAlive}={}){
 await canvasProgram?.prepareClose();
 await codingDrafts.prepare();
 await Promise.all([...conversationDrafts.values()].map(store=>store.flush()));
 if(!composerDraft)return true;
 if(!win||win.isDestroyed()||homeContents?.isCrashed()){await (keepAlive?composerDraft.flush():composerDraft.close());return true;}
 if(composerClose)return composerClose.promise;
 const id=crypto.randomUUID();let settle;
 const promise=new Promise(resolve=>{settle=resolve;});
 const timer=setTimeout(()=>{composerClose=null;win?.webContents?.send('workspace:composerCloseResume',{id});win?.webContents?.send('workspace:notice','草稿保存尚未确认，窗口已保留，请稍后再关闭。');settle(false);},15000);
 composerClose={id,promise,resolve:ok=>{clearTimeout(timer);composerClose=null;settle(ok);}};
 win.webContents.send('workspace:composerPrepareClose',{id});
 const ready=await promise;
 try{if(ready){await groupDraftStore?.flush();await Promise.all([...conversationDrafts.values()].map(store=>store.flush()));await (keepAlive?composerDraft.flush():composerDraft.close());if(keepAlive&&resume)win.webContents.send('workspace:composerCloseResume',{id});else preparedCloseID=id;}return ready;}
 catch(error){win?.webContents?.send('workspace:composerCloseResume',{id});throw error;}
}
async function albumAttachments(result){
 if(result.attachments?.some(a=>a.kind==='image'))try{await imageLibrary.importFiles(result.attachments);}catch(e){result.warnings=[...(result.warnings||[]),'附件已保留，相册暂未收录：'+e.message];}
 return result;
}
const conversationStores=new Map(),conversationDrafts=new Map();
function conversationStore(id){if(!/^[a-f0-9]{32}$/.test(id||''))throw Error('智能体标识无效');if(!conversationStores.has(id))conversationStores.set(id,createAttachmentStore(config,{managed:true,owner:id,decodeImage}));return conversationStores.get(id);}
async function conversationCall(p){
  if(p.action==='program_projection')return readProgramProjection(p,true);
  if(p.action==='draft_load'||p.action==='draft_shared_load'){
    const status=await core('workspace.conversation',{action:'status',id:p.id});if(status?.ok===false)return status;
    if(!conversationDrafts.has(p.id))conversationDrafts.set(p.id,require('./composer-draft.cjs').createComposerDraft(config,path.dirname(config),{sessionID:p.id}));
    return p.action==='draft_shared_load'?conversationDrafts.get(p.id).sharedRead():conversationDrafts.get(p.id).open();
  }
  if(p.action==='draft_save'||p.action==='draft_shared_save'){
    const store=conversationDrafts.get(p.id);if(!store)throw Error('会话草稿尚未就绪。');
    return p.action==='draft_shared_save'?store.sharedSave(p):store.save(p);
  }
  if(p.action==='program_image_jobs'||p.action==='program_image_control'){
    const b=await core('workspace.conversation',{action:'program',program:'workspace'});
    if(b?.ok===false||b.session?.id!==p.id)throw Error('图片任务不属于此程序会话');
    return nativePrograms.run('workspace',()=>workspaceProgram().composerImages(p));
  }
  if(p.action==='program_references'||p.action==='send'&&(p.context||p.attachments?.some(a=>a.kind==='image'))){
    const b=await core('workspace.conversation',{action:'program',program:'workspace'});
    const canvas=b?.ok!==false&&b.session?.id===p.id;
    if(p.action==='program_references'){
      if(!canvas)throw Error('画布引用不属于此程序会话');
      return nativePrograms.run('workspace',()=>workspaceProgram().referenceOptions({projectId:p.projectId}));
    }
    if(p.context&&!canvas)throw Error('画布引用不属于此程序会话');
    if(canvas)try{
      // Verify bytes and ownership before any canvas side effect.
      const attachments=await conversationStore(p.id).verify(p.attachments||[]);
      p=await nativePrograms.run('workspace',()=>workspaceProgram().prepareSend({...p,attachments}));
    }catch(error){return {ok:false,error:error.message,send_rejection:true};}
  }
  if(p.action!=='send'){
    const result=await core('workspace.conversation',p);
    if(p.action==='session_delete'&&result?.ok!==false){extensions?.releasePage('conversation:'+p.id);conversationStores.delete(p.id);}
    if(p.action==='cancel'&&result?.ok!==false)await canvasProgram?.cancelWork(p.id);
    const decorate=contact=>contact?.program==='workspace'?{...contact,program_activity:canvasProgram?.activity()||{active:false}}:contact;
    // The stage controls program discovery. Contacts also supply identities for
    // already-open program views and must reflect the same roster as Core.
    if(p.action==='contacts'&&Array.isArray(result))return result.map(decorate);
    if(p.action==='programs'&&Array.isArray(result)){
      const firstRing=require('../src/resources.cjs').releaseStage().os_first_ring;
      return result.filter(c=>!firstRing||!c.program||['browser','contacts','settings'].includes(c.program)).map(decorate);
    }
    if(['program','program_open'].includes(p.action)&&result?.contact)return {...result,contact:decorate(result.contact)};
    return result;
  }
  const refs=conversationStore(p.id).references;await refs.pinSend(p.request_id,(p.attachments||[]).map(a=>a.sha256));
  let browserOwner=p.id;
  if(browser){
    const binding=await core('workspace.conversation',{action:'program',program:'browser'});
    if(binding?.ok!==false&&binding.session?.id===p.id){
      browserOwner='program/browser';
    }
  }
  const commit=()=>core('workspace.conversation',p);
  const result=browser?await browser.userMessage(browserOwner,commit,p.request_id):await commit();
  if(result?.ok!==false)await refs.settleSend(p.request_id);return result;
}
async function readProgramProjection(p,conversation=false){
  const receipt=conversation?await core('workspace.conversation',{action:'receipt',id:p.id,call_id:p.call_id,receipt_generation:p.receipt_generation}):await core('workspace.receipt',{task_id:p.task_id,agent_id:p.agent_id,generation:p.generation,core_epoch:p.core_epoch,id:p.call_id,receipt_generation:p.receipt_generation});
  if(receipt?.ok===false)return receipt;
  const parse=v=>{if(typeof v==='string'){try{return JSON.parse(v);}catch{return {};}}return v||{};};
  const input=parse(receipt.input),raw=parse(receipt.output),data=raw.result||raw.data||raw;
  const tool=receipt.tool||receipt.title||'',name=tool==='toolbox'?input.name:tool,args=tool==='toolbox'?parse(input.arguments):input;
  const browserCall=name==='browser'||name==='software_api'&&args.action==='program'&&args.arguments?.id==='aieyra.browser';
  if(browserCall){
    const tab=data.tab_id||data.result?.tab_id||args.tab_id||args.arguments?.arguments?.tab_id;
    if(typeof tab!=='string'||!tab)return {ok:true,program:'browser',available:false};
    const frame=await browser.projection(tab,{metadataOnly:p.metadata_only===true,owner:conversation&&p.metadata_only===true?p.id:undefined});
    // Revalidate the original source after capture; a retired session cannot publish it.
    const confirm=conversation?await core('workspace.conversation',{action:'receipt',id:p.id,call_id:p.call_id,receipt_generation:p.receipt_generation}):await core('workspace.receipt',{task_id:p.task_id,agent_id:p.agent_id,generation:p.generation,core_epoch:p.core_epoch,id:p.call_id,receipt_generation:p.receipt_generation});
    if(confirm?.ok===false)return confirm;return frame;
  }
  if(name==='agents'&&/^(contacts|contact|contact_create|contact_update|contact_delete|session_create|session_delete|sessions|program|programs)$/.test(args.action||'')){
    // The actual contact service is the source; projection cannot edit or execute.
    const rows=await core('workspace.conversation',{action:'contacts'});
    if(!Array.isArray(rows))return rows;
    const confirm=conversation?await core('workspace.conversation',{action:'receipt',id:p.id,call_id:p.call_id,receipt_generation:p.receipt_generation}):await core('workspace.receipt',{task_id:p.task_id,agent_id:p.agent_id,generation:p.generation,core_epoch:p.core_epoch,id:p.call_id,receipt_generation:p.receipt_generation});
    if(confirm?.ok===false)return confirm;
    return {ok:true,program:'contacts',available:true,contacts:rows.filter(c=>!require('../src/resources.cjs').releaseStage().os_first_ring||!c.program||['browser','settings','contacts'].includes(c.program)).map(c=>({id:c.id,name:c.name,description:c.description,program:c.program,model_id:c.model_id,active:c.active,sessions:(c.sessions||[]).map(s=>({id:s.id,title:s.title,state:s.state,generation:s.generation}))}))};
  }
  return {ok:true,available:false};
}
let descriptor = initial,
  modPackages, plugins, win, officialAccount, remoteLink, cloudUpdates, communityBridge, managedUpdates, forumSync, apps, browser, browserBridge, control, link, starting, surface, moduleDock, extensions,foldedOverlay,surfaceMenu,fileDrops,moduleDragPreview;
let themeLibrary=null;
let canvasProgram=null,canvasAccount=()=>({signedIn:false});
let centerMonitor=null, issueReports=null;
function workspaceProgram(){
 if(!canvasProgram)canvasProgram=require('../../../Program/official/workspace/service.cjs').createWorkspaceProgram({
  dataRoot:path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'programs','workspace'),runtimeRoot:path.join(root,'runtime','media'),electron:require('electron'),conversation:conversationCall,stageFiles:async(id,paths)=>albumAttachments(await conversationStore(id).chooseBatch(paths)),imageCall:args=>core('workspace.program_images',args),videoCall:args=>core('workspace.program_videos',args),
  broadcast:(channel,payload)=>{const wc=extensions?.contents('workspace');if(wc&&!wc.isDestroyed())wc.send('plugin:event',{type:'workspace',channel,payload});},
  ensureRenderer:async()=>{extensions.open({key:'workspace',deferSurface:true});await extensions.ready('workspace');return extensions.contents('workspace')?.id;},rendererContents:()=>extensions?.contents('workspace'),account:()=>canvasAccount(),updates:()=>managedUpdates?.status()||{phase:'disabled'},
  navigate:page=>surface.navigate(page),report:issue=>hostTrace('workspace-operation-failed',String(issue.code||'')),
 });
 canvasProgram.resume();return canvasProgram;
}
let codingService=null;
const codingDrafts=require('./program-drafts.cjs').createProgramDrafts({contents:()=>extensions?.contents('coding')});
// Coding is a view of Core's managed group; the page names an action and never a session.
function codingProgram(){
 if(!codingService)codingService=require('../../../Program/official/coding/service.cjs').createCodingProgram({conversation:conversationCall,profile:()=>profileStore.read(),attachment:p=>exposedHandlers.get('conversationAttachment')(p,extensions?.window('coding')?.host||win),
  chooseProject:async({kind,root:projectRoot})=>{if(kind==='new'){const result=await dialog.showSaveDialog(extensions?.window('coding')?.host||win,{title:'新建项目',buttonLabel:'新建项目',defaultPath:path.join(projectRoot||app.getPath('documents'),'新项目')});return result.canceled?null:result.filePath;}const result=await dialog.showOpenDialog(extensions?.window('coding')?.host||win,{title:kind==='directory'?'打开项目':'打开文件',defaultPath:projectRoot||undefined,properties:[kind==='directory'?'openDirectory':'openFile']});return result.canceled?null:result.filePaths[0];},
  projectFiles:require('./project-files.cjs').createProjectFiles({dataRoot:path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'programs','coding')}),
  openPage:()=>{const r=extensions.open({key:'coding'});if(r.placement!=='detached')surface.navigate('coding');return r;},releasePage:()=>extensions.releasePage('coding')});
 return codingService;
}
const offscreen = process.env.AIEYRA_WORKSPACE_OFFSCREEN === '1';
const hostTrace = (phase, detail = '') => {
  if (process.env.AIEYRA_HOST_LIFECYCLE_TRACE === '1')
    process.stderr.write(JSON.stringify({host_phase:phase,detail,time:Date.now()})+'\n');
};
app.on('before-quit',()=>hostTrace('before-quit'));
app.on('will-quit',()=>hostTrace('will-quit'));
app.on('child-process-gone',(_event,details)=>{
  hostTrace('child-process-gone',details.reason);
  if(['crashed','oom','abnormal-exit','launch-failed','integrity-failure'].includes(details.reason))issueReports?.system('child_crash');
});
app.on('render-process-gone',(_event,_contents,details)=>{
  if(['crashed','oom','abnormal-exit','integrity-failure'].includes(details.reason))issueReports?.system('renderer_crash');
});
// Chromium stores runtime window state apart from account preferences.
const profile = initial.mode === 'os'
  ? path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'os', initial.session_id, 'desktop')
  : require('../src/paths.cjs').privatePath(config,'desktop_profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
if (!app.requestSingleInstanceLock()) {
  // The Go parent will observe this child exit and release its own lease.
  // 锁只保护当前运行的 profile；新的 OS 启动使用独立 profile。
  app.exit(0);
}
const page = pathToFileURL(
  path.join(__dirname, '../ui/index.html'),
).href;
function showWorkspaceWindow(userRequested = false) {
  if (mainHidden&&!userRequested)return;
  if(userRequested)mainHidden=false;
  if (offscreen || shutdown.started || !win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
app.on('second-instance', () => showWorkspaceWindow(true));
if (initial.parent_owned) {
  if (
    !Number.isInteger(initial.parent_port) ||
    initial.parent_port < 1 ||
    initial.parent_port > 65535 ||
    !/^[a-f0-9]{64}$/.test(initial.parent_token || '')
  )
    throw Error('无效的核心生命周期连接');
  const lease = require('node:net').connect(initial.parent_port, '127.0.0.1');
  lease.once('connect', () => {hostTrace('parent-connected');lease.write(initial.parent_token + '\n');});
  lease.on('error', error => {hostTrace('parent-error',error.code);app.quit();});
  lease.on('close', () => {hostTrace('parent-closed');app.quit();});
}
let linkWorking=false;
const core = async (action, args) => {
  let result;
  try { result=await requestCore(descriptor,action,args); }
  catch(error){if(!shutdown.started && ['ECONNREFUSED','ECONNRESET','EPIPE','ETIMEDOUT'].includes(error.code))issueReports?.system('core_unavailable');throw error;}
  if(['workspace.snapshot','workspace.task_snapshot'].includes(action)&&Array.isArray(result.roles))
  {
    linkWorking=(result.tasks||result.roles).some(role=>['queued','running','cancelling'].includes(role.state));
    for(const task of result.tasks||result.roles){
      if(task.state==='failed' && typeof task.id==='string' && Number.isSafeInteger(task.generation))issueReports?.system('execution_error',task.id+':'+task.generation);
    }
    forumSync?.setWorking(linkWorking);
  }
  return result;
};
const nativeAdapters={};
const nativeVerification=require('./native-program-verification.cjs').createNativeProgramVerification();
const nativePrograms=require('../../../Program/runtime/native.cjs').createNativePrograms({
  onProgramError:()=>issueReports?.system('program_error'),
  resolve:async id=>{const out=await core('workspace.packages',{action:'resolve',id});if(out?.ok===false||!out?.item)throw Error(out?.error||'程序不可用');return out.item;},
  verify:item=>nativeVerification.verify(item),adapters:nativeAdapters,
  changed:()=>{link?.activateIfAdmitted();plugins?.changed();},onError:error=>{if(win&&!win.isDestroyed())win.webContents.send('workspace:notice','程序已停用，但草稿尚未保存，窗口已保留：'+error.message);},
});
async function closeServices() {
  // 等已经开始的初始化交回服务，避免晚到的桥接逃过本次释放。
  // 尚未 ready 时不等待 Electron；退出后 ready 回调不会再创建窗口。
  await starting?.catch(() => {});
  const {releaseServices}=require('./shutdown.cjs'),failures={};
  // 保持原释放顺序；一个程序或表面失败也不能跳过后续独立服务。
  for(const [name,service] of Object.entries({
    centerMonitor,
    nativePrograms:{close:()=>nativePrograms.shutdown()},nativeVerification,canvas:canvasProgram,
    moduleRuntime,remoteLink,moduleDragPreview,fileDrops,surfaceMenu,foldedOverlay,eyraPresence,nativeModal,extensions,
    // 外嵌模块是独立软件：只撤下 OS 的注册记录与连接，不结束它们。
    moduleDock,
  }))Object.assign(failures,(await releaseServices({[name]:service})).failures);
  Object.assign(failures,(await releaseServices({
    control, link, browser:browserBridge, cloud:cloudUpdates,
    updates:managedUpdates, community:communityBridge, account:officialAccount, packages:modPackages,
    theme:{close(){themeLibrary?.close();}},
  })).failures);
  return {failures};
}
const shutdown = require('./shutdown.cjs').createShutdown({
  request: () => requestCore(initial, 'workspace.shutdown', {}),
  release: closeServices,
  report: receipt => process.stderr.write(JSON.stringify({host_phase:'shutdown-incomplete',...receipt})+'\n'),
  exit: code => { hostTrace('shutdown-complete', String(code)); if (code) app.exit(code); else app.quit(); },
});
let quitPreparing=null,quitRetryUntil=0,quitCode=0;
// 不使用 shutdown.intercept 的内部 start 闭包；每个入口都从这里先过保存 gate。
function startShutdown(code=0,mode){
  if(code)quitCode=1;
  if(shutdown.started)return shutdown.start(quitCode);
  if(quitPreparing)return quitPreparing;
  quitPreparing=(async()=>{
    if(!await prepareComposerClose({keepAlive:true,resume:false}))return {ok:false,error:'草稿尚未保存，当前窗口已保留。'};
    if(mode)await moduleDock?.exit?.(mode);
    await composerDraft?.close();
    return shutdown.start(quitCode);
  })().catch(error=>{if(preparedCloseID)win?.webContents?.send('workspace:composerCloseResume',{id:preparedCloseID});preparedCloseID=null;win?.webContents?.send('workspace:notice','退出未完成，窗口已保留：'+error.message);return {ok:false,error:error.message};}).finally(()=>{quitPreparing=null;});
  return quitPreparing;
}
function requestQuit(event){
  if(shutdown.finished)return;
  event?.preventDefault();
  return startShutdown(0,'all');
}
app.on('before-quit',requestQuit);
const profileStore = require('./profile.cjs').createProfileStore(config);
const haloStore=require('../../../Halo/runtime/settings.cjs').createHaloStore(config,{changed:()=>{if(win&&!win.isDestroyed())win.webContents.send('workspace:settingsChanged',{method:'halo'});extensions?.broadcast('settingsChanged',{method:'halo'});eyraPresence?.refresh();foldedOverlay?.refreshHalo?.();}});
const appearanceStore = require('../src/os-appearance.cjs').createAppearanceStore(config);
require('../../../Theme/runtime/recovery.cjs').installThemeRecovery(app,appearanceStore);
const promptEditor = () => require('./prompts.cjs').createPromptEditor(initial.prompt_dir || require('../src/paths.cjs').resolvePromptDir(require('../src/config.cjs').load(config).settings.prompt_dir));
function trusted(event,method) {
  if (
    !win ||
    ![win.webContents,homeContents].includes(event.sender) ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== (event.sender===homeContents?page:page+'?container=1')
  )
    throw Error('无效的界面来源');
  return event.sender===homeContents?extensions?.window('home')?.host||win:win;
}
const exposedHandlers=new Map();
// 产物预览窗口（README.md 运行时 · 产物 B1）：网页和图片在独立窗口里打开。沙盒、不给 Node、独立且持久的会话（页面自己的 localStorage 跨重启保留）；预加载只补 prompt()；
// 页面里的外链交给系统浏览器，本地导航只允许留在这个文件所在的文件夹里。同一个文件只开一个窗口。
const previews=new Map();
// OS 的 userData 是每次启动的临时目录；预览会话放在数据目录下的固定位置，生成页面用 localStorage 存的进度重开后还在。
let previewStore=null;
const previewSession=()=>previewStore||(previewStore=session.fromPath(require('../src/paths.cjs').privatePath(config,'preview')));
function openPreview(file){
  const existing=previews.get(file.path);
  if(existing&&!existing.isDestroyed()){existing.webContents.reload();if(!offscreen){existing.show();existing.focus();}return;}
  const folder=require('node:path').dirname(file.path),{pathToFileURL,fileURLToPath}=require('node:url');
  const preview=new (require('./shell-window.cjs').ShellWindow)({electron:require('electron'),theme:require('./window-theme.cjs').createWindowTheme(config),title:'预览 · '+file.name,width:1100,height:760,minWidth:360,minHeight:320,offscreen,icon:require('node:path').join(root,'Client/Desktop/assets/os.ico'),
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,plugins:/\.pdf$/i.test(file.path),session:previewSession(),spellcheck:false,preload:require('node:path').join(__dirname,'preview-preload.cjs')}});
  allowPageDialog(preview);
  fileDrops?.register(preview.webContents,u=>u===pathToFileURL(file.path).href);
  previews.set(file.path,preview);preview.on('closed',()=>previews.delete(file.path));
  const outside=url=>{try{const u=new URL(url);if(u.protocol!=='file:')return true;const target=fileURLToPath(u);return require('node:path').relative(folder,target).startsWith('..');}catch{return true;}};
  preview.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/i.test(url))void shell.openExternal(url);return {action:'deny'};});
  preview.webContents.on('will-navigate',(event,url)=>{if(!outside(url))return;event.preventDefault();if(/^https?:/i.test(url))void shell.openExternal(url);});
  // 离屏测试不弹到用户屏幕上。
  if(!offscreen)preview.once('ready-to-show',()=>preview.show());
  void preview.loadURL(pathToFileURL(file.path).href);
}
// 外部页面的 alert/confirm/prompt：只接受登记过的页面；对话框是不带脚本能力外泄的本地页，结果经标题回传。
const dialogPages=new Map();
let pageDialogReady=false;
function allowPageDialog(owner){
  dialogPages.set(owner.webContents,owner);
  if(pageDialogReady)return;pageDialogReady=true;
  ipcMain.on('aieyra-page-dialog',(event,kind,message,value)=>{
    const owner=dialogPages.get(event.sender);
    if(!owner||owner.isDestroyed()||!['alert','confirm','prompt'].includes(kind)){event.returnValue=null;return;}
    askPageDialog(owner,kind,String(message).slice(0,2000),String(value).slice(0,10000)).then(v=>{event.returnValue=v;},()=>{event.returnValue=null;});
  });
}
function askPageDialog(parent,kind,message,value){
  return new Promise(resolve=>{
    const box=new BrowserWindow({parent:parent.host||parent,modal:!offscreen,width:440,height:kind==='prompt'?210:170,frame:false,resizable:false,minimizable:false,maximizable:false,title:'输入',backgroundColor:'#12151c',autoHideMenuBar:true,show:false,
      webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'aieyra-preview-prompt',spellcheck:false,offscreen}});
    let done=false;
    const finish=v=>{if(done)return;done=true;resolve(v);if(!box.isDestroyed())box.close();};
    box.on('page-title-updated',(event,title)=>{event.preventDefault();if(title==='aieyra:cancel')finish(null);else if(title.startsWith('aieyra:ok:'))finish(decodeURIComponent(title.slice(10)));});
    box.on('closed',()=>finish(null));
    box.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    box.webContents.on('will-navigate',event=>event.preventDefault());
    if(!offscreen)box.once('ready-to-show',()=>box.show());
    void box.loadFile(require('node:path').join(__dirname,'../ui/page-dialog.html'),{hash:encodeURIComponent(JSON.stringify({kind,message,value}))});
  });
}

function expose(method, handler) {
  exposedHandlers.set(method, handler);
  ipcMain.handle('workspace:' + method, async (event, args) => {
    const owner=trusted(event,method);
    if(method==='browserSurface'&&args?.work&&event.sender!==homeContents)return {ok:true,inactive_surface:true};
    if(!(method==='browserSurface'&&args?.work)&&['workspaceShift','browserSurface','controlSurface','extensionSurface','extensionContext','foldedSurface'].includes(method)){const containerActive=moduleRuntime?.state().modules.home.detached===true;if((event.sender===win.webContents)!==containerActive)return {ok:true,inactive_surface:true};}
    try {
      return await handler(args || {},owner);
    } catch (error) {
      return { ok: false, error: String(error.message), ...(error.code?{code:String(error.code)}:{}), ...(method==='send'&&error.send_rejection?{send_rejection:error.send_rejection}:{}) };
    }
  });
}

function startupFailed(error) {
  process.stderr.write('Aieyra 桌面启动失败：' + error.message + '\n');
  void startShutdown(1);
}
app
  .whenReady()
  .then(() => {
    if (shutdown.started) return;
    starting = (async () => {
    Object.assign(moduleEnv,await require('./runtime-env.cjs').prepareLinkEnvironment(moduleEnv,path.dirname(config)));
    if(shutdown.started)return;
    // 初始尺寸按工作区选择；用户可分别调整宽高。页面重排与界面字号由各自的布局/缩放机制负责。
    const available=require('electron').screen.getPrimaryDisplay().workAreaSize;
    const startWidth=Math.round(Math.min(available.width*.9,available.height*.9*16/9,Math.max(1280,available.width*.6)));
    const minWidth=Math.min(960,available.width),minHeight=Math.min(600,available.height);
    win = new BrowserWindow({
      width: Math.max(minWidth,startWidth),
      height: Math.max(minHeight,Math.round(startWidth*9/16)),
      minWidth,
      minHeight,
      resizable: true,
      show: false,
      title: 'Aieyra OS',
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      icon: path.join(root, 'Client/Desktop/assets/os.ico'),
      titleBarStyle: 'hidden',
      frame: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        offscreen,
      },
    });
    const nativeSend=win.webContents.send.bind(win.webContents);
    win.webContents.send=(channel,...args)=>{const split=moduleRuntime?.state().modules.home.detached===true;if(channel!=='workspace:exitAsk'||split)nativeSend(channel,...args);if(homeContents&&!homeContents.isDestroyed()&&(channel!=='workspace:exitAsk'||!split))homeContents.send(channel,...args);};
    win.aieyraOS=true;
    hostTrace('window-created');
    // Every independent module shares the same OS-only / all-windows exit.
    // An unavailable renderer hides the main window and preserves independent work.
    let exitChosen=false,exitAsk=null,unresponsive=false;
    win.on('unresponsive',()=>{unresponsive=true;});win.on('responsive',()=>{unresponsive=false;});
    win.on('close',event=>{
      if(exitChosen||shutdown.started||!moduleRuntime?.independent().length)return requestQuit(event);
      if(unresponsive||win.webContents.isCrashed?.()){event.preventDefault();void moduleRuntime.closeMain();return;}
      event.preventDefault();
      if(exitAsk)return;
      exitAsk={shown:false,timer:setTimeout(()=>{if(exitAsk&&!exitAsk.shown){exitAsk=null;void moduleRuntime.closeMain();}},2000)};
      win.webContents.send('workspace:exitAsk',{modules:moduleRuntime.independent()});
    });
    expose('moduleExit',async(p,owner)=>{
      const mode=String(p.mode||'');
      if(mode==='shown'){if(exitAsk)exitAsk.shown=true;return {ok:true};}
      clearTimeout(exitAsk?.timer);exitAsk=null;
      if(mode!=='os'&&mode!=='all')return {ok:true,cancelled:true};
      if(mode==='os'){if(!await prepareComposerClose({keepAlive:true}))return {ok:false,error:'草稿尚未保存，主窗口已保留。'};return moduleRuntime.closeMain();}
      const result=await startShutdown(0,mode);
      if(result?.ok===false)return result;
      exitChosen=true;
      return {ok:true,mode};
    });
    win.on('closed', () => {
      win = null;
      void startShutdown();
    });
    win.webContents.on('did-fail-load',(_event,code,message)=>hostTrace('load-failed',String(code)+': '+message));
    win.webContents.on('render-process-gone',(_event,details)=>hostTrace('renderer-gone',details.reason));
    require('../src/interface-zoom.cjs').forConfig(config).attach(win,{minimum:[720,480]});
    // 页面导航只发给主界面。Workspace 与 Editor 已移出 OS（DOCS/aieyra-os-desktop-plan-20261009.md）。
    surface={navigate(page){if(shutdown.started||!win||win.isDestroyed())throw Error('OS正在退出。');win.webContents.send('workspace:navigate',{page});return {ok:true,embedded:true,page};}};
    // 外嵌模块（DOCS/claude-module-detach-20261009.md）：Link 在独立窗口运行时，Link 页面请求转给它。
    // 拖出/独立打开的每一步记进 runtime/modules/os-dock.log（超过 256KB 换到 .old），供“独立打开卡死”这类问题事后查。
    const dockLog=path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'modules','os-dock.log');
    const dockTrace=(phase,detail='')=>{try{fs.mkdirSync(path.dirname(dockLog),{recursive:true});if((fs.statSync(dockLog,{throwIfNoEntry:false})?.size||0)>262144)fs.renameSync(dockLog,dockLog+'.old');fs.appendFileSync(dockLog,JSON.stringify({phase,detail:String(detail).slice(0,500),time:new Date().toISOString(),pid:process.pid})+'\n');}catch{}};
    moduleDock=require('./module-dock.cjs').createModuleDock({config,root,trace:dockTrace,version:initial.version,
      diagnostics:()=>require('./live-diagnostics.cjs').liveDiagnostics({electron:require('electron'),root,profile:profileStore,browser,control,descriptor:initial,observe:()=>core('workspace.snapshot',{}),modules:moduleRuntime?.state().modules}),
      identity:()=>require('./live-diagnostics.cjs').runtimeIdentity(root,initial),
      programCapture:async ({module})=>{
        await runtimeReady;
        const modules=moduleRuntime?.state().modules;
        if(!modules||!Object.hasOwn(modules,module))throw Error('未知的程序');
        const row=modules[module];
        const getView=()=>{
          if(module==='browser')return browser.captureTarget();
          const surface=module==='home'?win?.webContents:extensions.contents(module);
          const contents=module==='together'?together.captureContents()||surface:surface;
          return {surface,contents,owner:row.detached?extensions.window(module):win};
        };
        const view=getView();
        if(!row?.web_contents_id||row.starting||view?.surface?.id!==row.web_contents_id||
          view.surface.isDestroyed())throw Error('请先打开目标程序并等待页面就绪');
        await view.ready;
        const {contents,surface:programSurface,owner}=view;
        if(contents.isDestroyed()||contents.isLoadingMainFrame())throw Error('请先打开目标程序并等待页面就绪');
        const url=contents.getURL();
        if(!url)throw Error('目标程序页面尚未就绪');
        const image=await contents.capturePage(undefined,{stayHidden:true,stayAwake:true});
        const current=getView();
        if(contents.isDestroyed()||programSurface!==current?.surface||contents!==current.contents||
          view.identity!==current.identity||owner!==current.owner||contents.getURL()!==url||image.isEmpty()){
          throw Error('截图期间程序页面已变化或没有可用画面');
        }
        const maximum=require('./modules/registry.cjs').CAPTURE_BYTES;
        let capture=image,png=image.toPNG();
        if(png.length>maximum){
          const scale=Math.min(.9,Math.sqrt(maximum/png.length)*.85);
          capture=image.resize({width:Math.max(1,Math.floor(image.getSize().width*scale)),quality:'best'});
          png=capture.toPNG();
        }
        if(png.length>maximum)throw Error('程序截图超过大小上限');
        return {ok:true,module,build:initial.build?.build_id,contents_id:contents.id,surface_contents_id:programSurface.id,detached:(view.detached??row.detached)===true,
          focused:owner?.isFocused()===true,capturedAt:new Date().toISOString(),...capture.getSize(),png:png.toString('base64')};
      },
      programCheck:async ({module,operation,action,neuron})=>{
        await runtimeReady;
        if(module==='center'&&operation==='surface'){
          return nativePrograms.run('center',async()=>{
            const row=moduleRuntime?.state().modules.center,contents=extensions.contents('center');
            if(!contents||!row?.visible||contents.id!==row.web_contents_id||contents.isDestroyed()||contents.isLoadingMainFrame()){
              throw Error('请先打开中枢并等待页面就绪');
            }
            const url=contents.getURL();
            const view=await require('./center-diagnostics.cjs').readCenterSurface(contents,{action,neuron});
            if(contents.isDestroyed()||contents!==extensions.contents('center')||contents.getURL()!==url){
              throw Error('界面检查期间中枢页面已变化');
            }
            return {ok:true,module,build:initial.build?.build_id,contents_id:contents.id,detached:row.detached===true,...view};
          });
        }
        if(module==='center'&&operation==='health'){
          const [result,learning]=await nativePrograms.run('center',()=>Promise.all([
            centerService.user({action:'health'}),centerService.user({action:'learning_data'}),
          ]));
          if(result?.ok!==true||!Array.isArray(result.items))throw Error('中枢健康回执无效');
          return {ok:true,observedAt:result.observedAt,items:result.items.map(({id,state})=>({id,state})),
            situation:{tone:result.situation.tone,score:result.situation.score,observedChecks:result.situation.observedChecks,incidents:result.situation.incidents},
            learning:{local:learning.local,allowed:learning.allowed,sync:learning.sync,coverage:learning.coverage,summary:learning.summary}};
        }
        if(module==='servers'&&operation==='list'){
          const result=await nativePrograms.run('servers',()=>servers.call({action:'list'}));
          if(result?.ok!==true||!Array.isArray(result.servers))throw Error('服务器列表回执无效');
          return {ok:true,count:result.servers.length};
        }
        if(module==='together'&&operation==='status'){
          const result=await nativePrograms.run('together',()=>together.status());
          if(result?.protocol!=='aieyra-office/1'||!Number.isSafeInteger(result.stations))throw Error('Together 办公室回执无效');
          return {ok:true,protocol:result.protocol,stations:result.stations,cloudOnline:result.cloud?.online===true};
        }
        if(module==='together'&&operation==='aidebug'){
          return nativePrograms.run('together',()=>together.inspect());
        }
        if(module==='internal-link'&&operation==='status'){
          const result=await core('workspace.snapshot',{view:'internal_link'});
          if(!result?.mother||!Array.isArray(result.seats))throw Error('内部 Link 工位回执无效');
          return {ok:true,state:result.mother.state,generation:result.mother.generation,
            seats:result.total,active:result.active,briefsAvailable:result.briefs_available};
        }
        throw Error('未知程序检查操作');
      },
      control:{release:()=>control?.release?.()},
      notify:()=>moduleRuntime?.changed(),
      runtimeAction:async p=>{await runtimeReady;return p.module?moduleRuntime.action(p):moduleRuntime.reopen();},
      runtimeState:()=>moduleRuntime&&moduleRuntime.state(),presence:()=>eyraPresence?.read(),
      navigate:page=>{try{surface.navigate(page);}catch{}},
    });
    surface=moduleDock.wrapSurface(surface);
    fileDrops=require('./file-drop-router.cjs').createFileDropRouter({ipcMain,send:p=>win?.webContents.send('workspace:attachmentDrop',p)});
    const registerDrop=(wc,allowed)=>fileDrops.register(wc,allowed);
    const observation=await require('./observation.cjs').createDefaultObservationHub({read:p=>core('workspace.task_snapshot',p)});
    if(shutdown.started){observation.close();return;}hostTrace('observation-ready');
    nativeModal=require('./native-modal.cjs').createNativeModal({ipcMain,onChange:()=>{eyraPresence?.refresh();foldedOverlay?.refreshHalo();}});
    eyraPresence=require('./eyra-presence.cjs').createEyraPresence({enabled:false,blocked:target=>nativeModal.blocked(target),halo:haloStore,electron:require('electron'),theme:require('./window-theme.cjs').createWindowTheme(config),initial:require('./eyra-presence.cjs').profileFrame(require('./profile.cjs').createProfileStore(config).read()),onHome:async()=>{await moduleRuntime.reopen();surface.navigate('home');},onInput:(target,options)=>{if(moduleRuntime?.mainOpen===false||target!==win)throw Error('独立窗口不提供快捷输入');if(!composerDraft)throw Error('会话尚未准备好');eyraPresence.suppress(target);foldedOverlay.target(target,options);}});
    // 桌面模式已退役：desk-park 只保留程序悬停预览，停放永不启用。
    deskPark=require('./desk-park.cjs').createDeskPark({active:()=>false,owner:()=>win,motion:()=>!offscreen,notify:()=>moduleRuntime?.changed()});
    const legacyOffice=require('./runtime-env.cjs').togetherLegacyOffice(config);
    const openDesktopLink=({detached,x,y}={})=>{
      const module='together';
      return nativePrograms.run(module,()=>detached
        ?moduleRuntime.action({module,action:'detach',x:Number(x),y:Number(y)})
        :surface.navigate(module));
    };
    const together=require('../../../Program/official/together/service.cjs').createTogetherProgram({
      privateBase:path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'programs','together'),
      legacyOffice,
      account:{
        read:()=>officialAccount?.status().remoteAccount,
        refresh:()=>officialAccount?.refresh(),
        authorize:(binding,url,signal)=>officialAccount.authorizeTogether(binding,url,signal),
      },
      theme:require('./together-theme.cjs').createTogetherTheme(config),
    });
    extensions=require('./extensions.cjs').createExtensions({nativeModal,authorize:key=>nativePrograms.assert(key),config,electron:require('electron'),presence:eyraPresence,owner:()=>win,hub:observation,core,registerDrop,desk:deskPark,
      surfaceAdapter:key=>key==='together'?together.surface:null,
      browserWorkSurface:(p,source,sessionID)=>browser?.workSurface(p,source,false,sessionID),
      prepareRelease:key=>key==='together'?together.surface.release():key==='workspace'?canvasProgram?.prepareClose():key==='coding'?codingDrafts.prepare():undefined,onReleaseError:error=>win?.webContents?.send('workspace:notice',error.message),
      onPageEvent:event=>{if(event.key==='workspace')canvasProgram?.rendererEvent(event);},
      mainAvailable:()=>moduleRuntime?.mainOpen!==false,wakeOwner:()=>{if(moduleRuntime&&!moduleRuntime.mainOpen)void moduleRuntime.reopen();},onChange:()=>{nativeModal?.refresh();moduleRuntime?.changed();},
      invoke:(method,args,owner)=>{const handler=exposedHandlers.get(method);if(!handler)throw Error('设置尚未准备好');return handler(args,owner);},
      openLink:openDesktopLink,
      navigate:page=>surface.navigate(page),
      onWindow:portal=>require('../src/interface-zoom.cjs').forConfig(config).attach(portal,{minimum:[520,380],zoomParent:()=>portal.placement==='attached'?portal.owner:null,changed:()=>{if(portal.host){portal.host.webContents.setZoomFactor(portal.webContents.getZoomFactor());portal.layout();}}}),
      offscreen,options:require('../src/resources.cjs').read('运行参数.json').desktop_extensions,trace:hostTrace});
    foldedOverlay=require('./folded-overlay.cjs').createFoldedOverlay({onRead:require('./program-agent-overlay.cjs').createProgramOverlayBridge({conversation:conversationCall,attachment:p=>exposedHandlers.get('conversationAttachment')(p),homeRead:p=>{if(p.action==='retry_chat')return core('workspace.retry_chat',{id:p.id,session_id:p.task_id,generation:p.generation,attempt:p.attempt});if(p.action==='document_read')return exposedHandlers.get('document')({task_id:p.task_id,id:p.id});if(p.action==='document_state')return exposedHandlers.get('documentState')({task_id:p.task_id,id:p.id,action:p.operation,expected_revision:p.expected_revision});if(p.action==='attachment'&&['imageLibrary','attachmentMedia'].includes(p.method))return exposedHandlers.get(p.method)({...p.args,task_id:p.task_id});throw Error('首页浮层不支持此读取');},emit:p=>win.webContents.send('workspace:foldedAction',p)}),blocked:target=>nativeModal.blocked(target),halo:haloStore,electron:require('electron'),win,config,theme:require('./window-theme.cjs').createWindowTheme(config),registerDrop,onAction:async p=>{if(p.action==='reference_reveal')return exposedHandlers.get('browserReference')({action:'reveal',reference:JSON.parse(p.text)});win.webContents.send('workspace:foldedAction',p);return {ok:true};}});
    surfaceMenu=require('./surface-menu.cjs').createSurfaceMenu({electron:require('electron'),win,offscreen,theme:require('./window-theme.cjs').createWindowTheme(config)});
    tipWindow=require('./tip-window.cjs').createTipWindow({electron:require('electron'),win,offscreen,theme:require('./window-theme.cjs').createWindowTheme(config)});
    require('./tip-window.cjs').listenTips({electron:require('electron'),offscreen,theme:require('./window-theme.cjs').createWindowTheme(config)});
    expose('tip',p=>tipWindow.call(p));
    const stopSettingsWatch=require('./settings-watch.cjs').watchSettings(config,event=>{
      if(!win||win.isDestroyed())return;
      win.webContents.send('workspace:settingsChanged',event);extensions?.broadcast('settingsChanged',event);
    });
    win.once('closed',stopSettingsWatch);
    moduleDragPreview=require('./module-drag-preview.cjs').createModuleDragPreview({electron:require('electron'),win,offscreen});
    expose('moduleDragPreview',p=>moduleDragPreview.call(p));
    const dockConfig=path.join(path.dirname(config),'os-dock.json');
    const moduleOrder=require('./module-order.cjs').createModuleOrder(dockConfig,require('../src/paths.cjs').privatePath(config,'module_order'));
    expose('moduleOrder',p=>{const order=moduleOrder.write(p.order);win.webContents.send('workspace:moduleState',{modules:{},order});return {ok:true,order};});
    expose('systemNoticeSurface',p=>{
      if(!Array.isArray(p.rows)||p.rows.length>200||Buffer.byteLength(JSON.stringify(p.rows))>2*1024*1024)throw Error('系统信息过多，请逐条查看');
      const rows=p.rows.map(row=>({id:String(row.id),title:String(row.title).slice(0,240),content:row.content==null?null:String(row.content).slice(0,16000),read:row.read===true,at:String(row.at||'').slice(0,40)}));
      if(p.action==='update')return surfaceMenu.update({request_id:p.request_id,rows});
      return surfaceMenu.open({request_id:p.request_id,x:p.x,y:p.y,attachment:p.attachment,rows,items:[{id:'clear',label:'全部清除'},...rows.map(row=>({id:'read:'+row.id,label:'标为已读'}))]});
    });
    expose('moduleMenu',p=>{if(require('./module-catalog.cjs').moduleSpec(p.page).detachable===false)return '';const detached=moduleRuntime.state().modules[p.page].detached;return surfaceMenu.open({x:p.x,y:p.y,items:detached?[{id:'open',label:'打开独立窗口'},{id:'dock',label:'放回 OS'},{id:'close',label:'关闭独立窗口'}]:[{id:'detach',label:'在独立窗口中打开'}]});});
    expose('sessionModel',async p=>{
      if(p.kind==='home'){if(p.id!==descriptor.session_id)throw Error('会话已经切换，请重新选择模型');return core('workspace.configure',{action:'model',role:'matrix',model_id:p.model_id,expected_model:p.expected_model,task_id:p.id,session_id:p.id});}
      return conversationCall({action:'session_model',id:p.target||p.id,model_id:p.model_id,revision:p.revision});
    });
    expose('conversation',conversationCall);
    expose('conversationAttachment',async(p,owner=win)=>{
      const store=conversationStore(p.id);
      if(p.method==='attachmentState')return {ok:true,token:store.references.begin()};
      if(p.method==='attachmentReferences')return store.references.sync(p.args);
      if(p.method==='stageAttachmentPaths')return albumAttachments(await store.chooseBatch(p.args.paths));
      if(p.method==='stageFileBytes')return albumAttachments(await store.chooseFileBytes(p.args));
      if(p.method==='attachmentMedia')return require('./media-preview.cjs').previewAttachmentMedia(store,p.args.attachment);
      if(p.method==='imageLibrary'){if(p.args.action!=='attachment')throw Error('此会话只读取自己的图片附件');const a=(await store.verify([p.args.attachment]))[0];return imageLibrary.previewFile(a.asset,{size:p.args.size,thumbnail:p.args.thumbnail===true,sha256:a.sha256});}
      if(p.method==='stageAttachmentBytes')return albumAttachments(await store.chooseBytes(p.args));
      if(p.method==='chooseAttachments'){const result=await dialog.showOpenDialog(owner,{title:'添加附件',properties:['openFile','multiSelections']});return result.canceled?{ok:true,cancelled:true}:await albumAttachments(await store.chooseBatch(result.filePaths));}
      throw Error('未知的附件操作');
    });
    expose('conversationOpen',async p=>{
      const row=await core('workspace.conversation',{action:'status',id:String(p.id||'')});if(row?.ok===false)return row;
      const key=extensions.registerConversation(row);
      const result=p.detached?extensions.detach({key,x:p.x,y:p.y}):extensions.open({key});
      if(!p.detached&&result.placement==='attached')surface.navigate(key);return result;
    });
    expose('conversationMenu',p=>surfaceMenu.open({x:p.x,y:p.y,items:[{id:'detach',label:'在独立窗口中打开'},...(p.canDelete===true?[{id:'delete',label:'删除会话'}]:[])]}));
    expose('sessionModelMenu',(p,owner)=>{
      if(p.action==='dismiss')return surfaceMenu.dismiss(p.request_id,owner);
      const {modelCardData}=require('../ui/model-card.mjs');
      const items=Array.isArray(p.items)?p.items.map(item=>({id:String(item.id),label:String(item.label||'').slice(0,180),selected:item.selected===true,model:modelCardData(item.model)})):[];
      return surfaceMenu.open({request_id:String(p.request_id||''),x:p.x,y:p.y,attachment:p.attachment,models:{title:String(p.title||'选择模型').slice(0,180)},items,owner});
    });
    expose('openModelSettings',()=>moduleRuntime.action({module:'settings',action:'detach'}));
    expose('workspaceShift',p=>{
      const x=Number(p.x),z=win.webContents.getZoomFactor(),[width]=win.getContentSize();
      if(!Number.isFinite(x)||x<0||x>width/z*.5)throw Error('工作区位移无效');
      const offset=Math.round(x*z);
      extensions?.setInset(offset);browser?.setInset(offset);control?.setInset(offset);
      foldedOverlay?.setOffset(offset);eyraPresence?.setOffset(win,offset);
      return {ok:true};
    });
    expose('foldedSurface',p=>{if(p.presence){eyraPresence.setFrame(p.presence);control?.refreshPresence?.();}if(moduleRuntime?.mainOpen===false)p={...p,visible:false};if(!p.quick)eyraPresence.suppress(p.takesPresence===true?win:null);const result=foldedOverlay.surface(p);return result;});
    expose('extensionOpen',p=>nativePrograms.run(p.key,()=>{
      if(p.key==='coding'&&p.chatToggle===true){const wc=extensions.contents('coding');if(!wc||wc.isDestroyed()||activeModulePage!=='coding')throw Error('Coding 页面已切换');wc.send('plugin:event',{type:'chat-layer',action:'toggle'});return {ok:true};}
      return extensions.open(p);
    }));
    expose('extensionDetach',p=>nativePrograms.run(p.key,()=>extensions.detach(p)));
    expose('extensionDock',p=>extensions.dock(p));
    expose('extensionState',()=>extensions.state());
    expose('extensionCatalog',p=>extensions.publish(p.entries));
    expose('extensionSurface',p=>p.visible?nativePrograms.run(p.key,()=>{const result=extensions.surface(p);foldedOverlay.raise();return result;}):extensions.surface(p));
    expose('extensionContext',p=>{activeModulePage=String(p.page||'home');return extensions.context(p);});
    expose('moduleState',()=>({...moduleRuntime.state(),order:moduleOrder.read()}));
    expose('moduleAction',p=>moduleRuntime.action(p));
    const chatLayerPreferences=require('./chat-layer-preferences.cjs').createChatLayerPreferences(path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'ui','chat-layers.json'));
    expose('chatLayerPreference',p=>chatLayerPreferences.call(p));
    expose('moduleDetach',p=>moduleRuntime.action({...p,action:'detach'}));
    expose('openHome',()=>surface.navigate('home'));
    expose('openEyra',()=>surface.navigate('eyra'));
    expose('collapseEyra',()=>surface.navigate('collapse-eyra'));
    expose('desktopMode',()=>({ok:true,mode:'home',embedded:true}));
    expose('openLinkApp',()=>openDesktopLink());
    let openControlAtReady=process.env.AIEYRA_OS_OPEN_CONTROL==='1';
    expose('pagesReady',async()=>{if(openControlAtReady){openControlAtReady=false;await openDesktopLink();}return {ok:true};});
    win.once('ready-to-show', () => showWorkspaceWindow());
    win.webContents.once('did-finish-load', () => showWorkspaceWindow());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    const referencePending=new Map();
    expose('browserReference',async p=>{
      if(p.action==='accepted'){const pending=referencePending.get(p.id);if(pending){referencePending.delete(p.id);clearTimeout(pending.timer);p.ok?pending.resolve():pending.reject(Error(p.error||'未能加入草稿'));}return {ok:true};}
      if(p.action!=='reveal')throw Error('未知网页引用操作');
      const state=await core('workspace.snapshot',{});return browser.revealReference(state.session_id,p.reference);
    });
    browser=require('./browser.cjs').createEmbeddedBrowser({attachAgentShell:p=>extensions.attachShell(p),nativeModal,registerDrop,authorize:()=>nativePrograms.assert('browser'),win,config,secretExecutable:initial.executable,offscreen,presence:eyraPresence,deskPark:()=>deskPark,accountSession:()=>officialAccount?.browserSession(),
      canReference:()=>!!composerDraft&&!shutdown.started&&moduleRuntime?.mainOpen!==false,
      onReference:async(reference,{detached,window:target,bottomInset})=>{
        const state=await core('workspace.snapshot',{});
        const result=await attachmentStore.chooseFileBytes({name:('网页区域 · '+(reference.title||reference.tag)).replace(/[\\/\x00-\x1f]/g,' ').slice(0,180)+'.json',bytes:Buffer.from(JSON.stringify(reference))});
        for(const a of result.attachments)a.web_reference=reference;
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{referencePending.delete(reference.id);reject(Error('草稿保存尚未确认，请重试'));},15000);referencePending.set(reference.id,{resolve,reject,timer});win.webContents.send('workspace:browserReference',{id:reference.id,session_id:state.session_id,result,detached});});
        if(!detached){eyraPresence.suppress(target);foldedOverlay.target(target,{bottomInset});}
      },mainAvailable:()=>moduleRuntime?.mainOpen!==false,onDock:()=>{if(moduleRuntime?.mainOpen!==false)surface.navigate('browser');},onEyra:()=>{void moduleRuntime.reopen().then(()=>surface.navigate('home'));},onChange:state=>{if(win&&!win.isDestroyed())win.webContents.send('workspace:browserChanged',state);moduleRuntime?.changed();}});
    browserBridge=await require('./browser-bridge.cjs').startBrowserBridge({execute:(...args)=>nativePrograms.run('browser',()=>browser.execute(...args)),close:()=>browser.close()});
    if (shutdown.started) return;
    await core('workspace.browser_bridge',{url:browserBridge.url});hostTrace('browser-bridge');
    if (shutdown.started) return;
    expose('browserStatus',()=>browser.status());
    expose('browserSurface',(p,owner)=>{const result=p.work?browser.workSurface(p,extensions.window('home')||owner,true):browser.surface(p);foldedOverlay.raise();return result;});
    expose('browserUser',p=>nativePrograms.run('browser',()=>browser.user('program/browser',p)));
    const community=require('./community.cjs').createCommunityClient();
    canvasAccount=()=>community.status();
    apps=require('./apps.cjs').createApps({root});
    // A headless office can outlive every window. Display its existing page;
    // only the confirmed owner may shut down the service.
    control=require('./control.cjs').createControl({nativeModal,modalWindow:()=>extensions.window('link')?.host||win,apps,win,config,registerDrop,allowExternalView:true,attachOnly:!!legacyOffice,createPage:p=>extensions.nativePage(p),presence:()=>eyraPresence.read(),electron:require('electron'),env:moduleEnv,onRequest:request=>{if(win&&!win.isDestroyed())win.webContents.send('workspace:linkRequest',request);}});
    link=require('../../../Program/official/link/desktop.cjs').createLinkProgram({apps,env:moduleEnv,
      agentOptions:{dataDir:require('../src/paths.cjs').dataDir(config),port:()=>Number(moduleEnv.AIEYRA_CONTROL_PORT),working:()=>linkWorking,wake:args=>core('workspace.link_notice',args)},
      run:fn=>nativePrograms.run('link',fn),assert:()=>nativePrograms.assert('link'),
      autoJoin:!landCoreOnly&&initial.mode==='os'&&process.env.AIEYRA_CONTROL_DISABLED!=='1',
      release:async()=>{if(moduleDock?.detached('link'))await moduleDock.command('link','quit');await control.release();extensions.releasePage('link');},
    });
    expose('linkStatus',()=>link.status());
    expose('linkDeviceCode',()=>link.deviceCode());
    const controlStatus=()=>link.run(async()=>{
      if(moduleDock?.detached('link')){
        try{return {ok:true,...(await moduleDock.readStatus('link'))?.control};}
        catch{return {ok:true,cloud_available:false};}
      }
      return control.status();
    });
    expose('controlStatus',controlStatus);
    expose('controlSurface',p=>{if(p.visible===true)nativePrograms.assert('link');const result=control.surface(p);foldedOverlay.raise();return result;});
    const authorizeProgramService=require('./program-service-authority.cjs').createProgramServiceAuthority(p=>core('workspace.conversation',p));
    const softwareAPI=require('./software-api.cjs').createSoftwareAPI({sessionId:descriptor.session_id,authorizeSession:authorizeProgramService,
      file:path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'software-api',descriptor.session_id+'.json'),
      runtime:()=>moduleRuntime,order:{read:()=>moduleOrder.read(),write:value=>{const saved=moduleOrder.write(value);moduleRuntime.changed();win.webContents.send('workspace:moduleState',{modules:{},order:saved});return saved;}},navigate:page=>surface.navigate(page),
      observe:async()=>{
        const modules={},state=moduleRuntime?.state(),mainVisible=state?.main_open&&(!win.isMinimized())&&(offscreen||win.isVisible());
        for(const id of require('./module-catalog.cjs').MODULES.filter(s=>s.host==='surface').map(s=>s.id)){const row=extensions.state().windows.find(w=>w.key===id),wc=extensions.contents(id);modules[id]={exists:!!row,ready:!!wc&&!wc.isDestroyed()&&!wc.isLoadingMainFrame(),visible:!!row?.visible&&(row.placement==='detached'||mainVisible&&(id==='home'?activeModulePage==='home':activeModulePage===id))};}
        const browsing=browser.status();modules.browser={exists:browsing.count>0,ready:browsing.count>0,visible:browsing.groups.some(g=>g.visible),error:null};
        if(moduleDock.detached('link')){try{const result=await moduleDock.readStatus('link'),c=result?.control;modules.link={exists:true,ready:c?.page_ready===true,visible:c?.shown===true,error:c?.page_error||null};}catch{modules.link={exists:true,ready:false,visible:false,error:'独立Link状态尚未确认'};}}
        else {const c=control.peek(),detached=state?.modules.link.detached;modules.link={exists:c.page_ready===true,ready:c.page_ready===true,visible:c.shown===true&&(detached||mainVisible&&activeModulePage==='link'),error:c.page_error||null};}
        return {active_page:activeModulePage,modules};
      }});
    modPackages=require('./mod-packages.cjs').createModPackages({nativePrograms,onError:error=>{if(win&&!win.isDestroyed())win.webContents.send('workspace:notice','程序包状态同步未完成，未释放的窗口已保留：'+error.message);},legacyProgramStorageRoot:path.join(require('../src/paths.cjs').privatePath(config,'resources'),'program-storage'),halo:haloStore,core,dataDir:require('../src/paths.cjs').dataDir(config),appearance:appearanceStore,BrowserWindow,session,offscreen,programWindow:options=>new (require('./shell-window.cjs').ShellWindow)({electron:require('electron'),...options,offscreen,theme:require('./window-theme.cjs').createWindowTheme(config),icon:path.join(root,'Client/Desktop/assets/os.ico')})});
    const desktopTools=require('./desktop-tools.cjs').createDesktopTools({surface,link,control:{status:controlStatus},authorizeLink:fn=>nativePrograms.run('link',fn),softwareAPI,modPackages,sessionId:descriptor.session_id,authorizeSession:authorizeProgramService});
    const resources=require('./resources.cjs').createResources({client:community,directory:require('../src/paths.cjs').privatePath(config,'resources'),core,modPackages});
    const {createOfficialLibrary}=require('../../../Theme/runtime/official-library.cjs');
    themeLibrary=createOfficialLibrary({client:community,profile:profileStore,contactMedia:{
      async list(){const result=await core('workspace.conversation',{action:'contacts'});if(result?.ok===false)throw Error(result.error||'联系人列表暂不可用');if(!Array.isArray(result))throw Error('联系人列表暂不可用');return result;},
      async update(id,patch){const result=await core('workspace.conversation',{action:'contact_update',id,...patch});if(result?.ok===false)throw Error(result.error||'头像更新未完成');return result;}
    },directory:path.join(require('../src/paths.cjs').privatePath(config,'resources'),'theme-images'),decode:require('./theme-image-decoder.cjs').createThemeImageDecoder({nativeImage,BrowserWindow,session}),active:()=>!shutdown.started&&moduleRuntime?.mainOpen===true,changed:()=>{browser?.refreshProfile();if(win&&!win.isDestroyed())win.webContents.send('workspace:settingsChanged',{method:'saveProfile'});extensions?.broadcast('settingsChanged',{method:'saveProfile'});}});
    await themeLibrary.initialize().catch(error=>console.warn('Bundled image initialization:',error));
    themeLibrary.start();
    expose('themeLibrary',async p=>{
      if(p.action==='manager_open')return nativePrograms.run('browser',async()=>{
        const result=await browser.user(descriptor.session_id,{action:'open',url:require('../../../Contracts/official-services.json').os});
        surface.navigate('browser');return result;
      });
      return themeLibrary.call(p);
    });
    const pluginData=require('../src/paths.cjs').dataDir(config),pluginTheme=require('./window-theme.cjs').createWindowTheme(config);
    const pluginOwners=new Map();
    const servers=require('../../../Program/official/servers/desktop.cjs').createServersProgram({randomAvatar:async()=>(await themeLibrary.call({action:'prepare',target:'avatar',mode:'random',intervalSeconds:3600})).value,dataDir:pluginData,safeStorage,Client:()=>new (require('ssh2').Client)(),pickImage:()=>dialog.showOpenDialog(extensions.window('servers')?.host||win,{title:'选择服务器的图',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]}),changed:event=>{if(event.catalog)plugins?.changed();const wc=extensions.contents('servers');if(wc&&!wc.isDestroyed())wc.send('plugin:event',{type:event.type});},emit:(owner,event)=>{if(owner&&!owner.isDestroyed())owner.send('plugin:event',event);}});
    // 保留既有 Aieyra 文档入口；便签程序已退出，不启动其服务。
    const notesRoot=process.env.AIEYRA_NOTES_DIR||(offscreen?require('../src/paths.cjs').privatePath(config,'notes'):path.join(app.getPath('documents'),'Aieyra'));
    const modules=require('./module-catalog.cjs').MODULES;
    plugins=require('./plugins.cjs').createPlugins({dataDir:pluginData,configFile:dockConfig,
      modules:modules.filter(module=>module.id!=='link'),resources,modPackages});
    const appPages=require('./module-catalog.cjs').MODULES.filter(s=>s.page).map(s=>s.id);
    const stopPluginTheme=pluginTheme.watch(value=>{for(const id of appPages){const wc=extensions.contents(id);if(wc&&!wc.isDestroyed())wc.send('plugin:event',{type:'theme',theme:value});}});
    const pluginCall=async(event,p={})=>{
      const app=appPages.find(id=>extensions.contents(id)===event.sender);if(!app)throw Error('只能由程序页面调用');
      if(app==='coding'&&p.action==='drafts_saved')return codingDrafts.acknowledge(event.sender,p);
      if(app==='coding'&&codingDrafts.preparing(event.sender)&&['project_draft','draft_save'].includes(p.action))return codingProgram().user(p);
      if(p.scope==='theme')return pluginTheme.read();
      // 程序页请求开关自己的统一侧栏（第109轮 R15，如 Workspace 里「交给 Agent」）：只能开关发起页面所属程序的侧栏。
      if(p.scope==='os'&&p.action==='chat_layer'){
        if(app!=='coding'||!String(p.key||'').startsWith('coding:'))throw Error('对话显示偏好不属于此程序');
        return exposedHandlers.get('chatLayerPreference')({key:p.key,open:p.open,position:p.position});
      }
      if(p.scope==='os'&&p.action==='sidebar'){if(!win.isDestroyed())win.webContents.send('workspace:programSidebar',{program:app,open:p.open!==false});return {ok:true};}
      if(app==='workspace'){
        const channel=String(p.channel||'');
        // Once retired, only the exact current page's outstanding save may finish.
        if(canvasProgram?.closingCall(channel,p.payload,event.sender))return canvasProgram.call(channel,p.payload,event.sender);
        return nativePrograms.run('workspace',()=>workspaceProgram().call(channel,p.payload,event.sender));
      }
      // 程序把一句话交给 Eyra：回到首页，放进输入框，由用户决定发不发。
      if(p.scope==='eyra'&&p.action==='compose'){
        const text=String(p.text||'').slice(0,2000);if(!text.trim())throw Error('内容为空');
        if(win.isMinimized())win.restore();if(!offscreen){win.show();win.focus();}win.webContents.send('workspace:composeDraft',{text});return {ok:true};
      }
      if(app==='coding')return nativePrograms.run('coding',()=>p.action==='browser_surface'?browser.workSurface(p,extensions.window('coding')):codingProgram().user(p));
      if(app==='center')return nativePrograms.run('center',()=>centerService.user(p));
      if(app==='servers')return nativePrograms.run('servers',()=>servers.user(p,event.sender));
      throw Error('未知的应用');
    };
    ipcMain.handle('plugin:invoke',(event,p)=>pluginCall(event,p).catch(error=>({ok:false,error:String(error.message||error)})));
    ipcMain.handle('plugin:project-drop',async(event,paths)=>{try{if(event.sender!==extensions.contents('coding')||event.senderFrame!==event.sender.mainFrame||!Array.isArray(paths)||paths.length!==1||!paths[0])throw Error('请拖入一个本地项目文件夹');return await nativePrograms.run('coding',()=>codingProgram().dropProject(paths[0]));}catch(error){return {ok:false,error:String(error.message||error)};}});
    protocol.handle('iiimage-asset',request=>nativePrograms.run('workspace',()=>workspaceProgram().asset(request)).catch(()=>new Response('Asset unavailable',{status:404})));
    expose('apps',async p=>{
      const result=await plugins.call(p);
      return p?.action==='list'?{...result,legacyLinkRetired:true}:result;
    });
    expose('appsMenu',async p=>{
      const rows=(await plugins.call({action:'list'})).apps;
      const choice=await surfaceMenu.open({x:p.x,y:p.y,apps:rows,items:rows.map(row=>({id:row.id,label:row.title})),onToggle:async id=>{const row=(await plugins.call({action:'list'})).apps.find(a=>a.id===id);return row?(await plugins.call({action:'pin',id,pinned:!row.pinned})).apps:null;}});
      return {ok:true,choice:choice||''};
    });
    plugins.subscribe(()=>{if(win&&!win.isDestroyed())win.webContents.send('workspace:appsChanged');});
    void plugins.changed();
    forumSync=require('./forum-sync.cjs').createForumSync({client:community,directory:require('../src/paths.cjs').privatePath(config,'forum')});
    managedUpdates=updatesEnabled?require('../src/managed-updates.cjs').createManagedUpdates({root,fetchImpl:community.authorizedFetch,signedIn:()=>community.status().signedIn,subscribe:community.subscribe,storePath:process.platform==='darwin'?require('../src/paths.cjs').privatePath(config,'updates'):undefined}):null;
    officialAccount = require('./official-account.cjs').createOfficialAccount({BrowserWindow,session,owner:()=>win,core,community,config,offscreen,openInBrowser:args=>nativePrograms.run('browser',async()=>{const opened=await browser.user('program/browser',{action:'open',...args});if(opened.ok!==false)surface.navigate('browser');return opened;}),onWindow:portal=>require('../src/interface-zoom.cjs').forConfig(config).attach(portal,{minimum:[360,360]}),onChange:state=>{issueReports?.accountChanged();surfaceMenu?.accountChanged?.(state);remoteLink?.accountChanged(state);together.accountChanged();if(win&&!win.isDestroyed())win.webContents.send('workspace:accountChanged',state);extensions?.broadcast('accountChanged',state);}});
    remoteLink=require('./remote-link.cjs').createRemoteLink({win,electron:require('electron'),account:officialAccount,onChange:state=>{if(win&&!win.isDestroyed())win.webContents.send('workspace:remoteLinkChanged',state);}});
    expose('remoteLink',p=>remoteLink.call(p));
    communityBridge=await require('./community.cjs').startCommunityBridge({close:()=>{ipcMain.removeHandler('plugin:invoke');ipcMain.removeHandler('plugin:project-drop');stopPluginTheme();tipWindow?.close();plugins.close();servers.close();resources.close();apps.close();forumSync.close();community.close();},call:async (p,signal)=>{
      if(p.action==='_desktop')return desktopTools.call(p.arguments,p.session_id,signal);
      if(p.action==='_link')return link.agentCall(p.arguments);
      if(p.action==='_server')return nativePrograms.run('servers',()=>servers.agentCall(p.arguments));
      if(p.action==='_feedback')return {ok:false,error:'私密反馈已停用；请由 Eyra 发布公开问题帖子'};
      if(p.action==='_updates')return updatesEnabled?managedUpdates.call(p.arguments):{ok:false,error:'当前安装未启用官方更新'};
      if(p.action==='_apps'){if(!community.status().signedIn&&!['status','list'].includes(p.arguments?.action))await officialAccount.refresh();return apps.call(p.arguments);}
      // Request preparation reads this local, account-scoped snapshot. It must
      // not wait for the account server or retry login on every model request.
      if(p.action==='home_digest')return forumSync.digest();
      if(p.action==='home_preferences')return forumSync.preferences(p);
      if(!community.status().signedIn&&!['center_local','center_migrate','center_open','center_remove'].includes(p.action))await officialAccount.refresh();
      if(p.action==='home_refresh')return forumSync.refresh();
      if(['center_local','center_acquire','center_publish_file','center_install','center_migrate','center_apply','center_restore_theme','center_open','center_remove'].includes(p.action)){const out=await resources.call(p);if(['center_install','center_migrate','center_remove'].includes(p.action))plugins.changed();return out;}
      forumSync.authorize(p);return community.call(p);
    }});
    if (shutdown.started) return;
    await core('workspace.community_bridge',{url:communityBridge.url});hostTrace('community-bridge');
    if (shutdown.started) return;
    const accountCard=()=>{
      const state=officialAccount.status(),u=state.user||{},money=n=>n!=null&&Number.isFinite(Number(n))?'$'+(Number(n)/500000).toFixed(2):'—';
      return {name:u.name||'Aieyra',avatar:profileStore.read().avatar||'',meta:[u.username&&u.username!==u.name?'@'+u.username:'',u.email,u.group].filter(Boolean).join(' · '),balance:money(u.quota),used:money(u.usedQuota),requests:u.requestCount==null?'—':Number(u.requestCount).toLocaleString('zh-CN'),updated:state.refreshError?'更新暂不可用 · 显示上次记录':state.verifiedAt?'更新于 '+new Date(state.verifiedAt).toLocaleTimeString('zh-CN'):'正在验证账号'};
    };
    expose('account', async (p,owner) => {
      if(p.action==='menu'){
        if(!officialAccount.status().signedIn)return {ok:true};
        const request_id=require('node:crypto').randomUUID(),result=surfaceMenu.open({x:p.x,y:p.y,passive:p.passive===true,request_id,account:accountCard(),items:[{id:'profile',label:'个人资料'},{id:'sync',label:'同步 API'},{id:'home',label:'官网'}],owner});
        void officialAccount.refresh().then(state=>{if(state.signedIn)surfaceMenu.update({request_id,account:accountCard()});else surfaceMenu.accountChanged(state);}).catch(()=>{});
        const choice=await result;
        if(choice==='sync')return officialAccount.keys({refresh:true});
        if(choice==='profile'||choice==='home')return officialAccount.openSite(choice);
        return {ok:true};
      }
      if(p.action==='profile'||p.action==='website')return officialAccount.openSite(p.action==='profile'?'profile':'home');
      if(p.action==='status')return officialAccount.status();
      if(p.action==='refresh')return officialAccount.refresh();
      if(p.action==='login')return officialAccount.login();
      if(p.action==='select')return officialAccount.select(p.id);
      if(p.action==='keys')return officialAccount.keys({token_id:p.token_id});
      if(p.action==='sync')return officialAccount.keys({refresh:true});
      if(p.action==='connect')return officialAccount.connect(p);
      if(['catalog','parameters','test','save'].includes(p.action))return officialAccount[p.action](p);
      // 设置 · 请求记录：官网日志、本地账本，以及右上角本会话统计（官网线路换成账号站数据）。
      if(p.action==='requests_official')return officialAccount.logs(p);
      if(p.action==='requests_local')return require('./request-records.cjs').local(require('../src/paths.cjs').dataDir(config),p);
      if(p.action==='requests_sessions'){const [catalog,current]=await Promise.all([core('workspace.conversation',{action:'session_usage',all:true}),core('workspace.snapshot',{})]);if(catalog?.ok===false)return catalog;return require('./request-records.cjs').forWorkspace(require('../src/paths.cjs').dataDir(config),p,catalog.sessions,current);}
      if(p.action==='requests_session')return require('./request-records.cjs').session(require('../src/paths.cjs').dataDir(config),p);
      if(p.action==='logout')return officialAccount.logout();
      throw Error('未知账号操作');
    });
    expose('feedback',async()=>({ok:false,error:'私密反馈已停用；旧本地记录不会上传，请由 Eyra 发布公开问题帖子'}));
    cloudUpdates=require('./cloud-updates.cjs').createCloudUpdates({app,window:()=>win,root,config,initial,descriptor:()=>descriptor,core,canHandoff:()=>community.status().signedIn&&officialAccount.canHandoff(),onUpdateError:()=>issueReports?.system('update_error')});
    // 本地编译默认关闭官方更新和安装补全，避免历史签名基线覆盖当前安装。
    expose('updateReady',()=>updatesEnabled?cloudUpdates.ready():{ok:true});
    expose('updateAcknowledge',p=>cloudUpdates.acknowledge(p));
    if(updatesEnabled)cloudUpdates.start();
    void officialAccount.refresh();
    expose('bootstrap', async () => {
      await core('workspace.activate');
      const current=await core('workspace.snapshot',{cursor:0});
      let savedDraft=null,draftError='';
      if(initial.mode==='os')try{
        composerDraft||=require('./composer-draft.cjs').createComposerDraft(config,current.workdir);
        savedDraft=await composerDraft.open();
      }catch(error){draftError='上次草稿暂未恢复，原记录已保留：'+error.message;}
      return {
      features: require('../src/resources.cjs').releaseStage(),
      identityPalette: require('./profile.cjs').identityPalette(),
      snapshot: current,
      composer_draft:savedDraft,composer_draft_error:draftError,
      onboarding: await core('settings', { action: 'onboarding_status' }),
      profile: profileStore.read(),
      appearance: appearanceStore.read(),
      attachment_reference_token: attachmentStore.references.begin(),
      account: officialAccount.status(),
      };
    });
    expose('saveComposerDraft',p=>{if(!composerDraft||p.session_id!==initial.session_id)throw Error('草稿不属于当前主会话');return composerDraft.save(p);});
    expose('groupDraft',async p=>{
      groupDraftStore||=require('./group-draft.cjs').createGroupDraftStore(config);
      if(p?.action==='load')return groupDraftStore.load(p.id);
      if(p?.action==='save')return groupDraftStore.save(p);
      throw Error('群聊草稿操作无效。');
    });
    expose('composerCloseReady',p=>{const accepted=composerClose?.id===p.id;if(accepted)composerClose.resolve(p.ok===true);return {ok:true,accepted};});
    expose('context',async p=>{
      if(['new','switch','reset','edit','restore','memory','provider'].includes(p.action)){
        if(composerDraft){const draft=await composerDraft.inspect();if(draft.outbox?.length)throw Error('输入框仍有待发消息，请先发送或移除后再切换上下文。');}
      }
      return core('workspace.context',p);
    });
    let runtimePromptEditor;
    expose('runtimePrompts',p=>{
      runtimePromptEditor||=require('./runtime-prompts.cjs').createRuntimePromptEditor(require('../src/resources.cjs').root());
      return runtimePromptEditor.call(p);
    });
    const updateIntegrity=require('../src/update-integrity.cjs').createIntegrity({root});app.once('will-quit',()=>updateIntegrity.close());
    const settingsUpdates=require('./settings-updates.cjs').createSettingsUpdates({updates:managedUpdates,version:initial.version,home:()=>descriptor,send:(target,args)=>requestCore(target,'workspace.send',args),community,integrity:updateIntegrity,onApproved:()=>cloudUpdates?.kick?.()});
    const centerData=require('../src/paths.cjs').dataDir(config);
    const sampleCenterHost=require('./center-telemetry.cjs').createCenterTelemetry({app,screen:require('electron').screen,dataDir:centerData});
    const {inspectJson,atomicWriteBytesAsync}=require('./json-storage.cjs');
    const {featureSpecs,createLearningSettings}=require('../../../Program/official/center/learning.cjs');
    const writeCenterJson=(file,value)=>atomicWriteBytesAsync(file,JSON.stringify(value)+'\n');
    const model=require('../../../Program/official/center/health-model.cjs').createHealthModel({
      file:path.join(centerData,'center','health-model.json'),readJson:inspectJson,
      writeJson:writeCenterJson,features:featureSpecs,
    });
    const learningSettings=createLearningSettings({
      file:path.join(centerData,'center','learning-settings.json'),readJson:inspectJson,writeJson:writeCenterJson,
    });
    const statusLog=require('../../../Program/official/center/status-log.cjs').createStatusLog({
      file:path.join(centerData,'center','status-log.json'),readJson:inspectJson,writeJson:writeCenterJson,
    });
    issueReports=require('../../../Program/official/center/issue-reports.cjs').createIssueReports({directory:path.join(centerData,'center'),root,version:initial.version,client:community,accountStatus:()=>officialAccount.status(),
      confirm:async details=>(await dialog.showMessageBox(win,{type:'question',title:'提交到众创讨论',message:'以 Eyra 名义公开以下说明？',detail:details,buttons:['取消','确认公开'],defaultId:0,cancelId:0})).response===1});
    const centerService=require('../../../Program/official/center/service.cjs').createCenterProgram({
      updates:settingsUpdates,community,conversation:conversationCall,sampleHost:sampleCenterHost,model,
      learningSettings,statusLog,issueReports,buildId:initial.build?.build_id,appVersion:initial.version,
      readCore:()=>core('workspace.snapshot',{include_activity:false}),readPrograms:()=>core('workspace.conversation',{action:'programs'}),
      readLinkBoard:()=>core('workspace.snapshot',{view:'internal_link'}),
      readBrowser:()=>browser.status(),readLink:()=>control.peek(),
      readDiagnostics:async()=>{
        const [apiProbe,stateProbe]=await Promise.allSettled([
          softwareAPI.call({action:'describe'},descriptor.session_id),
          softwareAPI.call({action:'modules'},descriptor.session_id),
        ]);
        const api=apiProbe.status==='fulfilled'&&apiProbe.value?.ok===true?apiProbe.value:null;
        const state=stateProbe.status==='fulfilled'&&stateProbe.value?.ok===true?stateProbe.value:null;
        const programs=require('../../../Program/official/catalog.cjs').programs.map(p=>({
          id:p.packageID,name:p.title,version:p.manifest.version,operations:p.definition.operations,
        }));
        const build=initial.build?.build_id;
        const verification={};
        if(/^[a-f0-9]{30,64}$/.test(build||'')){
          for(const lane of ['foreground','background']){
            const file=path.join(root,'..','AIDEBUG','verification',lane,build+'.json');
            try{
              const stat=fs.lstatSync(file);
              if(!stat.isFile()||stat.size>4096)continue;
              const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
              if(receipt.schema!=='aieyra.aidebug-result/2'||receipt.lane!==lane||receipt.build!==build||
                !/^[A-Za-z0-9-]{1,160}$/.test(receipt.run)||!['passed','partial','failed','stopped'].includes(receipt.status)||
                !Number.isFinite(Date.parse(receipt.completed))||!Number.isSafeInteger(receipt.passed)||!Number.isSafeInteger(receipt.total)||
                receipt.passed<0||receipt.total<receipt.passed)continue;
              const {scene,run,completed,status,passed,total,images,actions,frames,framesRequested}=receipt;
              verification[lane]={scene,run,completed,status,passed,total,images,actions,frames,framesRequested};
            }catch(error){if(error.code!=='ENOENT')hostTrace('aidebug-verification-read','invalid receipt');}
          }
        }
        return {ok:true,build:initial.build,observedAt:state?.observed_at||new Date().toISOString(),
          api:api?{protocol:api.protocol,actions:api.actions}:null,
          desktop:state?{activePage:state.active_page,foreground:win.isFocused(),modules:state.modules.map(({id,title,placement,visible,starting,ready,error})=>
            ({id,title,placement,visible,starting,ready,attention:!!error}))}:null,programs,verification};
      },
      openManagement:id=>adapters[id].open(),openPage:()=>adapters.center.open(),releasePage:()=>extensions.releasePage('center'),
      download:()=>exposedHandlers.get('openLink')({url:require('../../../Contracts/official-services.json').download}),
    });
    centerMonitor={close:async()=>{const reports=issueReports;issueReports=null;await Promise.all([reports?.close(),centerService.shutdown()]);}};
    const extensionPackages=require('./extension-settings.cjs').createExtensionSettings({core,packages:modPackages,resources,dialog,changed:()=>plugins.changed(),exportAgent:p=>require('./agent-template-export.cjs').exportAgentTemplate({core,dialog,...p}),selectTask:id=>{surface.navigate('home');win.webContents.send('workspace:selectTask',{id});},appearance:()=>appearanceStore.read()});
    expose('extensionPackages',(p,owner)=>extensionPackages.call(p,{parent:owner||win,sender:extensions.contents('settings')}));
    expose('settingsBootstrap',async()=>({ok:true,features:require('../src/resources.cjs').releaseStage(),identityPalette:require('./profile.cjs').identityPalette(),onboarding:await core('settings',{action:'onboarding_status'}),profile:profileStore.read(),appearance:await core('settings',{action:'os_appearance_read'}),account:officialAccount.status()}));
    expose('halo',p=>{if(p?.action==='read')return haloStore.public();if(p?.action==='reset'){const current=haloStore.read();return haloStore.update(null,current.version);}throw Error('无效光圈操作');});
    expose('profile', () => ({ ok: true, profile: profileStore.read() }));
    let roleProfiles;
    expose('builtinRole',p=>{roleProfiles||=require('../src/role-profile.cjs').createRoleProfile(config);const result=roleProfiles.call(p);if(p.action==='save'){win?.webContents.send('workspace:settingsChanged',{method:'saveProfile'});extensions?.broadcast('settingsChanged',{method:'saveProfile'});}return result;});
    expose('settingsObserved',(p,owner)=>require('../src/settings-observation.cjs').acknowledge(config,p.scope,p.version,(owner||win).id));
    expose('appearance',(p,owner)=>{
      if(['os_theme_preset_export','os_theme_preset_import'].includes(p.action))return require('./theme-preset-files.cjs').themePresetFile({core,dialog,parent:owner||win},p);
      if(!['os_appearance_read','os_appearance_update'].includes(p.action))throw Error('无效外观操作');
      return core('settings',p);
    });
    expose('saveProfile', (p) => {
      const profile=profileStore.save(p);
      browser?.refreshProfile();
      win?.webContents.send('workspace:settingsChanged',{method:'saveProfile'});
      extensions?.broadcast('settingsChanged',{method:'saveProfile'});
      return {ok:true,profile};
    });
    expose('programProjection',p=>readProgramProjection(p));
    expose('deskPreview',p=>p?.module==='browser'?browser.preview():extensions.preview(p?.module));
    expose('chooseAttachments',async(p={})=>{
      const media=p?.kind==='media';
      const result=await dialog.showOpenDialog(win,{title:media?'添加图片或视频':'添加文件',properties:['openFile','multiSelections'],...(media?{filters:[{name:'图片与视频',extensions:['png','jpg','jpeg','gif','webp','bmp','mp4','mov','webm','mkv','avi','mp3','wav','m4a']},{name:'所有文件',extensions:['*']}]}:{})});
      if(result.canceled)return {ok:true,cancelled:true};
      return {ok:true,...await albumAttachments(await attachmentStore.chooseBatch(result.filePaths))};
    });
    expose('attachmentReferences',p=>attachmentStore.references.sync(p));
    // 双击消息复制：写系统剪贴板，不依赖页面焦点。
    expose('copyText',p=>{const text=typeof p?.text==='string'?p.text.slice(0,2000000):'';require('electron').clipboard.writeText(text);return {ok:true};});
    expose('stageAttachmentPaths',async p=>albumAttachments(await attachmentStore.chooseBatch(p.paths)));
    expose('stageAttachmentBytes',async p=>albumAttachments(await attachmentStore.chooseBytes(p)));
    expose('stageFileBytes',async p=>albumAttachments(await attachmentStore.chooseFileBytes(p)));
    expose('attachmentMedia',p=>require('./media-preview.cjs').previewAttachmentMedia(attachmentStore,p.attachment));
    expose('imageLibrary',async(p={})=>{
      if(p.action==='list')return imageLibrary.list(p);
      if(p.action==='hide'||p.action==='restore')return imageLibrary.setHidden(p.ids,p.action==='hide');
      if(p.action==='preview')return imageLibrary.preview(p.id,{size:p.size,thumbnail:p.thumbnail===true});
      if(p.action==='attachment'){
        const [a]=await attachmentStore.verify([p.attachment]);
        if(a.kind!=='image')throw Error('这个附件是普通文件');
        return imageLibrary.previewFile(a.asset,{size:p.size,thumbnail:p.thumbnail===true,sha256:a.sha256});
      }
      if(p.action==='folder_create')return imageLibrary.createFolder(p.name);
      if(p.action==='folder_rename')return imageLibrary.renameFolder(p.id,p.name);
      if(p.action==='folder_delete')return imageLibrary.deleteFolder(p.id);
      if(p.action==='move')return imageLibrary.move(p.ids,typeof p.folder==='string'?p.folder:'');
      if(p.action==='attach'){
        // A folder is referenced as the images in it.
        if(p.folder)p={...p,ids:await imageLibrary.folderItems(p.folder)};
        if(!Array.isArray(p.ids)||!p.ids.length)throw Error('这里还没有图片');
        if(p.ids.length>10)throw Error('一条消息最多引用 10 张图片');
        const items=[];for(const id of p.ids)items.push(await imageLibrary.resolve(id));
        const result=await attachmentStore.chooseBatch(items.map(x=>x.path));for(const a of result.attachments){const item=items.find(x=>x.id===a.sha256);if(item){const ext=path.extname(item.path),base=(item.name||'图片').replace(/[\\/]/g,' ').slice(0,190);a.name=path.extname(base).toLowerCase()===ext.toLowerCase()?base:base+ext;}}
        return albumAttachments(result);
      }
      if(p.action==='reveal'){shell.showItemInFolder((await imageLibrary.resolve(p.id)).path);return {ok:true};}
      if(p.action==='export'){
        if(!Array.isArray(p.ids)||!p.ids.length||p.ids.length>100)throw Error('每次请选择 1–100 张图片');
        const files=[];for(const id of p.ids)files.push(await imageLibrary.resolve(id));
        const picked=await dialog.showOpenDialog(win,{title:'导出图片到文件夹',properties:['openDirectory','createDirectory']});
        if(picked.canceled)return {ok:true,cancelled:true};
        let count=0;const failed=[];for(const file of files){const target=path.join(picked.filePaths[0],'Aieyra-'+file.id.slice(0,16)+path.extname(file.path));try{await fs.promises.copyFile(file.path,target,fs.constants.COPYFILE_EXCL);count++;}catch(e){failed.push(e.code==='EEXIST'?'已存在同名图片':file.name+'：导出失败');}}
        return {ok:true,count,failed};
      }
      throw Error('未知相册操作');
    });
    const chooseImage=async (background=false,owner=win) => {
      const result = await dialog.showOpenDialog(owner, { title: background?'选择空间背景':'选择头像', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png','jpg','jpeg','webp'] }] });
      if (result.canceled || !result.filePaths[0]) return { ok: true, cancelled: true };
      const file = result.filePaths[0];
      if (fs.statSync(file).size > 8 * 1024 * 1024) throw Error('请选择8MB以内的图片');
      const source = nativeImage.createFromPath(file);
      if (source.isEmpty()) throw Error('无法读取这张图片');
      const { width, height } = source.getSize();
      if (width * height > 32000000) throw Error('这张图片尺寸过大');
      const ratio=Math.min(1,(background?1920:1600)/Math.max(width,height));
      const image = source.resize({width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio)),quality:'best'});
      if(background){const data='data:image/jpeg;base64,'+image.toJPEG(82).toString('base64');if(data.length>2800000)throw Error('这张图片过于复杂，请选择较小的背景');return {ok:true,background:data};}
      return { ok: true, avatar: image.toDataURL() };
    };
    expose('chooseAvatar',(_p,owner)=>chooseImage(false,owner));
    expose('chooseBackground',(_p,owner)=>chooseImage(true,owner));
    const taskScope=p=>({task_id:String(p.task_id||descriptor.session_id)});
    expose('greet', (p) => core('workspace.greet', { ...taskScope(p), name: profileStore.read().name, retry: p.retry === true, skip: p.skip === true || !!startupModule&&!p.retry }));
    expose('document', (p) => core('workspace.document', { ...taskScope(p), id: String(p.id || '') }));
    expose('diary', (p) => {
      if(!['read','done'].includes(p.action))throw Error('Unknown diary action');
      return core('workspace.diary', { ...taskScope(p), action: p.action, diary_id: Number(p.id) || 0 });
    });
    expose('notice', (p) => core('workspace.notice', { ...taskScope(p), id: String(p.id || ''), text: String(p.text || ''), error:p.error===true }));
    expose('documentState', (p) => {
      if(!['pin','dismiss','close','read'].includes(p.action))throw Error('Unknown document action');
      return core('workspace.document_state', {...taskScope(p),id:String(p.id||''),action:p.action,pinned:p.pinned,expected_revision:p.expected_revision});
    });
    expose('snapshot', (p) =>
      core('workspace.task_snapshot', {
        task_id: String(p.task_id || descriptor.session_id),
        cursor: Number.isSafeInteger(p.cursor) && p.cursor >= 0 ? p.cursor : 0,
        revision: p.revision || 0,
        activity_cursors: p.activity_cursors || {},
        live_cursors: p.live_cursors || {},
      }),
    );
    expose('messages', (p) =>
      core('workspace.messages', { ...taskScope(p), before: Number(p.before) || 0 }),
    );
    expose('history', (p) => core('workspace.history', {...taskScope(p),segment:String(p.segment||''),all_history:p.all_history===true,before:String(p.before||''),limit:30,...(Number.isSafeInteger(p.page)&&p.page>0?{page:p.page}:{}),...(typeof p.query==='string'&&p.query.trim()?{query:p.query.trim().slice(0,200)}:{})}));
    expose('receipt', (p) => core('workspace.receipt', {...taskScope(p),agent_id:String(p.agent_id||''),id:String(p.id||''),entry_id:String(p.entry_id||''),segment:String(p.segment||''),all_history:p.all_history===true,generation:Number(p.generation)||0,core_epoch:String(p.core_epoch||''),receipt_generation:Number(p.receipt_generation)||0,receipt_version:String(p.receipt_version||''),member_id:String(p.member_id||''),input_offset:Number(p.input_offset)||0,output_offset:Number(p.output_offset)||0}));
    const terminalScope=p=>({task_id:String(p.task_id||''),agent_id:String(p.agent_id||''),generation:Number(p.generation),session_generation:Number(p.session_generation)||0});
    expose('terminals',p=>core('workspace.terminals',terminalScope(p)));
    expose('terminalRead',p=>core('workspace.terminal_read',{...terminalScope(p),session_id:Number(p.session_id),offset:Number(p.offset)||0,terminal:p.terminal===true}));
    expose('terminalInput',p=>core('workspace.terminal_input',{...terminalScope(p),session_id:Number(p.session_id),request_id:String(p.request_id||''),chars:String(p.chars||''),press_enter:p.press_enter===true,private:p.private===true,terminate:p.terminate===true,input_client:String(p.input_client||''),input_sequence:Number(p.input_sequence)||0}));
    // 展示台显示 Eyra 实际看过的图（UI设计知识库 形态 §15.11 V1）：只按图片指纹读本任务的快照。
    expose('toolImage',p=>core('workspace.tool_image',{...terminalScope(p),image_id:String(p.image_id||'')}));
    // 回复里的产物卡片（README.md 运行时 · 产物 B1）：CORE 把相对路径换成工作目录里的绝对路径并核对，宿主只负责打开、在文件夹中显示和预览。
    expose('artifact',async p=>{
      const action=['open','reveal','preview','image_read'].includes(p.action)?p.action:'open';
      const file=await core('workspace.artifact',{...taskScope(p),path:String(p.path||'')});
      if(action==='image_read'){if(file.kind!=='image')throw Error('此产物不是图片');return {ok:true,image:await imageLibrary.previewFile(file.path,{size:1280,thumbnail:true}),name:file.name};}
      if(action==='reveal'){shell.showItemInFolder(file.path);return {ok:true};}
      if(action==='preview'&&file.kind==='image')return {ok:true,image:await imageLibrary.previewFile(file.path,{size:2400}),name:file.name};
      if(action==='preview'&&file.kind==='html')return nativePrograms.run('browser',()=>browser.openArtifact(String(p.session_id||descriptor.session_id),file.path));
      if(action==='preview'&&file.kind==='image'){openPreview(file);return {ok:true};}
      const error=await shell.openPath(file.path);if(error)throw Error(error);
      return {ok:true};
    });
    expose('terminalResize',p=>core('workspace.terminal_resize',{...terminalScope(p),session_id:Number(p.session_id),columns:Number(p.columns),rows:Number(p.rows)}));
    expose('humanReply', (p) =>
      core('humans.reply', {
        task_id: String(p.task_id || p.session_id || descriptor.session_id),
        request_id: String(p.request_id || crypto.randomUUID()),
        session_id: String(p.session_id || ''),
        agent_id: String(p.agent_id || ''),
        generation: Number(p.generation),
        human_id: String(p.human_id || ''),
        expected_request_version: Number(p.expected_request_version),
        request_token_sha256: String(p.request_token_sha256 || ''),
        decision: {
          option_id: String(p.decision?.option_id || ''),
          text: String(p.decision?.text || ''),
        },
      }),
    );
    expose('askReply',p=>core('workspace.ask_reply',{...taskScope(p),id:String(p.id||''),request_id:String(p.request_id||''),action:String(p.action||''),option:Number(p.option)||0,text:String(p.text||'')}));
    expose('withdraw',p=>core('workspace.withdraw',{...taskScope(p),request_id:String(p.request_id||'')}));
    expose('sendReceipt',p=>core('workspace.send_receipt',{request_id:String(p.request_id||''),message:String(p.message||''),attachments:p.attachments||[]}));
    expose('retryChat',p=>core('workspace.retry_chat',p));
    expose('send', async (p) => {
      const request_id=typeof p.request_id==='string'?p.request_id:crypto.randomUUID();
      const reference_id=String(p.session_id||descriptor.session_id)+'/'+request_id;
      const hashes=Array.isArray(p.attachments)?p.attachments.map(a=>a?.sha256).filter(h=>/^[a-f0-9]{64}$/u.test(h)):[];
      if(hashes.length)await attachmentStore.references.pinSend(reference_id,hashes);
      try {
      const commit=()=>core('workspace.task_send', {
        task_id: String(p.session_id || descriptor.session_id),
        generation: Number(p.generation) || 0,
        request_id,
        message: String(p.message || ''),
        // CORE deduplicates before validating snapshots. Host-side revalidation
        // here would block a previously accepted request after a lost reply.
        attachments: p.attachments||[],
      });
      const result=browser?await browser.userMessage(String(p.session_id||descriptor.session_id),commit,request_id):await commit();
      if(hashes.length)await attachmentStore.references.settleSend(reference_id).catch(()=>{});
      return result;
      } catch(error) {
        if(error.send_rejection&&hashes.length)await attachmentStore.references.settleSend(reference_id).catch(()=>{});
        throw error;
      }
    });
    expose('cancel', (p) => core('workspace.task_cancel', {task_id:String(p.task_id||descriptor.session_id),generation:Number(p.generation)||0}));
    expose('prompts', () => promptEditor().list());
    expose('savePrompt', (p) => promptEditor().save(p));
    expose('restorePrompt', (p) => promptEditor().restore(p));
    expose('restoreAllPrompts', (p) => promptEditor().restoreAll(p));
    expose('undoPrompt', (p) => promptEditor().undo(p));
    expose('onboard', (p) => {
      if (
        ![
          'onboarding_catalog',
          'onboarding_connect',
          'onboarding_status',
          'onboarding_draft',
          'onboarding_parameters',
          'onboarding_test',
          'onboarding_save',
          'onboarding_recovery',
          'onboarding_restore',
          'onboarding_preferences',
          // 设置 · 模型三页（src/model-setup.cjs）：池、供应商 Key、模型连接；Key 只进不出。
          'pool',
        ].includes(p.action)
      )
        throw Error('无效接入步骤');
      return core('settings', p);
    });
    expose('selfcheck', (p) =>
      core('workspace.selfcheck', {
        ...taskScope(p),
        request_id: String(p.request_id || crypto.randomUUID()),
      }),
    );
    expose('sessions', () => core('workspace.tasks'));
    expose('openSession', async (p) => {
      return core('workspace.task_snapshot', {task_id:String(p.id||descriptor.session_id)});
    });
    expose('pickProject', async () => {
      const result = await dialog.showOpenDialog(win, {
        title: '选择项目目录',
        properties: ['openDirectory'],
      });
      return { cancelled: result.canceled, path: result.filePaths[0] || '' };
    });
    expose('activity', (p) =>
      core('agents.activity', {
        ...taskScope(p),
        id: String(p.id || ''),
        before: Number(p.before) || 0,
        limit: 120,
      }),
    );
    expose('acknowledge', (p) =>
      core('workspace.acknowledge', { ...taskScope(p), id: String(p.role || '') }),
    );
    expose('control', () => link.run(()=>control.open()));
    expose('openLink', async (p) => {
      const url=new URL(String(p.url||''));
      if(!['https:','http:','mailto:'].includes(url.protocol)||url.username||url.password||url.href.length>4096)throw Error('无法打开此链接');
      await shell.openExternal(url.href);return {ok:true};
    });
    expose('reload', async (_p,owner) => {
      owner.webContents.reload();
      return { ok: true };
    });
    expose('minimizeWindow', (_p,owner) => {
      owner.minimize();
      return { ok: true };
    });
    expose('toggleMaximize', (_p,owner) => {
      if (owner.isMaximized()) owner.unmaximize();
      else owner.maximize();
      return { ok: true, maximized: owner.isMaximized() };
    });
    expose('closeWindow', (_p,owner) => {
      owner.close();
      return { ok: true };
    });
    const surfaceState=id=>{const row=extensions.state().windows.find(w=>w.key===id);return {detached:row?.placement==='detached',visible:row?.visible||false,parked:row?.parked||false,web_contents_id:row?.web_contents_id};};
    const adapters=Object.fromEntries(require('./module-catalog.cjs').MODULES.filter(s=>s.host==='surface').map(s=>s.id).map(id=>[id,{
      state:()=>surfaceState(id),open:()=>{const r=extensions.open({key:id});if(r.placement!=='detached')surface.navigate(id);return r;},
      detach:args=>{if(id==='home')win.webContents.send('workspace:navigate',{page:'home'});return extensions.detach({key:id,...args});},
      dock:()=>extensions.dock({key:id}),close:()=>extensions.closePage(id),
    }]));
    adapters.browser={state:()=>{
      const target=browser.captureTarget();
      return {detached:browser.status().groups.some(g=>g.detached),visible:!!target,web_contents_id:target?.surface.id,parked:deskPark.parked('browser')};
    },open:async()=>{deskPark.restore('browser');if(browser.status().groups.some(g=>g.detached))return browser.placeModule(descriptor.session_id,true);surface.navigate('browser');},detach:args=>browser.placeModule(descriptor.session_id,true,args),dock:()=>browser.placeModule(descriptor.session_id,false),close:()=>browser.closeModule()};
    adapters.link=adapters.together;
    Object.assign(nativeAdapters,{
      center:{open:()=>centerService.open(),snapshot:()=>centerService.snapshot(),invoke:(...args)=>centerService.invoke(...args),close:()=>centerService.close()},
      together:{open:()=>adapters.together.open(),snapshot:()=>together.status(),invoke:(...args)=>together.invoke(...args),close:()=>extensions.releasePage('together')},
      link:{open:()=>adapters.link.open(),snapshot:()=>link.snapshot(),invoke:(...args)=>link.invoke(...args),close:()=>link.close()},
      browser:{open:()=>adapters.browser.open(),snapshot:args=>args.tab_id?browser.execute(descriptor.session_id,{...args,action:'snapshot'}):browser.status(),invoke:(operation,args)=>browser.execute(descriptor.session_id,{...args,action:operation}),close:()=>browser.suspend()},
      coding:{open:()=>codingProgram().open(),snapshot:()=>codingProgram().snapshot(),invoke:(operation,args,meta)=>codingProgram().invoke(operation,args,meta),close:()=>extensions.releasePage('coding')},
      servers:{open:()=>adapters.servers.open(),snapshot:()=>servers.agentCall({action:'list'}),invoke:(operation,args)=>servers.agentCall({...args,action:operation}),close:()=>{extensions.releasePage('servers');servers.suspend();}},
      workspace:{open:()=>adapters.workspace.open(),snapshot:()=>workspaceProgram().snapshot(),invoke:(operation,args,meta)=>workspaceProgram().invoke(operation,args,meta),close:async()=>{await extensions.releasePage('workspace');await canvasProgram?.close();}},
    });
    for(const key of Object.keys(nativeAdapters))for(const action of ['open','detach','dock']){const perform=adapters[key][action];adapters[key][action]=(...args)=>nativePrograms.run(key,()=>perform(...args));}
    hostTrace('handlers-ready');await modPackages.reconcile();hostTrace('mods-reconciled');
    moduleRuntime=require('./module-runtime.cjs').createModuleRuntime({adapters,mainOpen:true,auxiliary:()=>extensions.state().windows.filter(w=>w.placement==='detached'&&!require('./module-catalog.cjs').MODULES.some(s=>s.id===w.key)).map(w=>w.key),notify:s=>win.webContents.send('workspace:moduleState',s),
      showMain:()=>{mainHidden=false;showWorkspaceWindow(true);},hideMain:()=>{deskPark.restoreAll();mainHidden=true;win.hide();},shutdown:()=>startShutdown()});
    try{await moduleDock.start();}catch(error){hostTrace('module-dock-failed',error.message);}hostTrace('module-dock-started');
    if (shutdown.started) return;
    hostTrace('load-start');
    extensions.open({key:'home'});homeContents=extensions.contents('home');
    await Promise.all([win.loadURL(page+'?container=1'),extensions.ready('home')]);
    moduleRuntime.changed();
    if(startupModule){
      const open={module:startupModule,action:'detach'};
      try{await moduleRuntime.action(open);}
      catch(error){
        if(error.code!=='PROGRAM_ADMISSION_CHANGED'||shutdown.started)throw error;
        await modPackages.reconcile();
        await moduleRuntime.action(open);
      }
      await moduleRuntime.closeMain();
    }
    if (shutdown.started) return;
    resolveRuntimeReady();
    hostTrace('load-complete');
    if(process.platform==='win32'&&initial.mode==='os'&&!startupModule&&!offscreen){
      try{require('./first-run.cjs').ensureDesktopShortcut({root,config,desktop:app.getPath('desktop'),shell});}
      catch(error){win.webContents.send('workspace:notice','桌面快捷方式未能创建，可运行 Install.bat 重试：'+error.message);}
    }
    // Keep an explicit post-load fallback. On Windows a child launched with
    // a hidden console can otherwise retain a hidden top-level window even
    // after loadURL has resolved.
    showWorkspaceWindow();
    })().catch(startupFailed);
    return starting;
  })
  .catch(startupFailed);
app.on('window-all-closed', () => { void startShutdown(); });
