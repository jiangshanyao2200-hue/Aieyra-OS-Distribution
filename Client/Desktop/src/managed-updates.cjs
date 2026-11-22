// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: path; f; fs; OFFICIAL; createManagedUpdates; bounded; run
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/managed-updates.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const path=require('node:path'),{spawn}=require('node:child_process');
const {downloadArtifact}=require('./managed-update-download.cjs');
const f=require('./managed-update-files.cjs');
const fs=f.diskFS;
const OFFICIAL=require('../../../Contracts/official-services.json'),ORIGIN=OFFICIAL.updates;
function createManagedUpdates({root,fetchImpl=fetch,origin=ORIGIN,publicKey,notify=async()=>{},now=Date.now,signedIn=()=>false,subscribe=()=>()=>{},platform=process.platform,arch=process.arch,storePath}){
 root=path.resolve(root);const store=storePath||path.join(root,'.aieyra-updates'),stateFile=path.join(store,'state.json');
 const key=publicKey||fs.readFileSync(path.join(root,'Config/release.pub.pem'),'utf8');
 let state;try{state=JSON.parse(f.read(stateFile).toString());}catch{state={schema:1,phase:'idle',sequence:0};}
 let operation=null,busy=false,closed=false,started=false,pendingCheck=false,eventController,operationController,pollTimer,eventTimer,lifecycle=0;
 let backgroundCheck=null,manualChecks=0;
 const inventoryCache=new Map();
 const requireLogin=()=>{if(closed)throw Error('更新服务已关闭');if(operationController?.signal.aborted)throw Error('更新操作已中断，请重新检查');if(!signedIn())throw Error('请先登录 Aieyra 后接收更新');};
 const requestSignal=timeout=>AbortSignal.any([AbortSignal.timeout(timeout),...(operationController?[operationController.signal]:[])]);
 const receiptFile=path.join(store,'transaction.json');
 const persist=()=>f.atomicJSON(stateFile,state);
 // The restarted UI can precede the helper's final receipt. Observe it again
 // before displaying state or deciding whether a newer release must queue.
 function refreshReceipt(){
  let receipt;try{receipt=JSON.parse(f.read(receiptFile));}catch{return;}
  if(!state.release?.id||!receipt||typeof receipt!=='object'||Array.isArray(receipt)||receipt.release!==state.release.id||!['committed','rolled_back'].includes(receipt.phase))return;
  const reason=typeof receipt.reason==='string'?receipt.reason:'',id=f.hash(JSON.stringify([receipt.release,receipt.phase,reason,receipt.at||'']));
  if(state.appliedReceipt===id)return;
  state.appliedReceipt=id;state.phase=receipt.phase;state.reason=reason;
  state.lastResult={version:state.release.version,phase:receipt.phase,reason};
  // transaction.json is already durable; subsequent actions persist this
  // observed identity so an old rollback cannot undo a deliberate retry.
 }
 refreshReceipt();
 // 重启后重新核对磁盘内容；临时事务不形成另一个运行版本。
 if(['waiting_idle','handoff'].includes(state.phase)){state.phase='prepared';state.reason='上次替换未完成，需重新核对临时文件后继续更新';state.candidateDigest='';state.evidence=null;persist();}
 const publication=release=>release?{id:release.id,version:release.version,sequence:release.sequence,sourceCommit:release.sourceCommit}:null;
 const status=()=>{refreshReceipt();return !signedIn()?({ok:true,phase:'login_required',release:null,notified:true,reason:'登录后接收更新'}):({ok:true,operation:operation?{...operation}:null,checkedAt:state.checkedAt||'',lastResult:state.lastResult||null,platform,arch,manual:platform!=='win32',downloadUrl:platform!=='win32'?OFFICIAL.download:'',phase:state.phase,release:publication(state.release),nextRelease:publication(state.nextRelease?.release),notified:state.notified===state.release?.id,reason:state.reason||'',conflicts:state.rows?.filter(r=>r.choice==='conflict'&&!state.resolutions?.[r.name]).length||0,localChanges:state.rows?.filter(r=>!f.same(r.base,r.local)).length||0,reviewDigest:state.reviewDigest||'',candidateDigest:state.candidateDigest||'',evidence:state.evidence||null});};
 function baseline(){return f.verifySigned(JSON.parse(f.read(path.join(root,'Config/official-baseline.json')).toString()),key,'baseline');}
 function notifyPending(){if(!closed&&signedIn()&&state.release&&state.phase==='available'&&state.notified!==state.release.id){const release=state.release,epoch=lifecycle;return Promise.resolve().then(()=>{if(!closed&&signedIn()&&epoch===lifecycle)return notify(release);}).then(ok=>{if(ok&&!closed&&signedIn()&&epoch===lifecycle&&state.release===release&&state.phase==='available'){state.notified=release.id;persist();}}).catch(()=>{});}return Promise.resolve();}
 async function json(url){const r=await fetchImpl(url,{redirect:'error',credentials:'omit',signal:requestSignal(20000)});if(!r.ok)throw Error('云服务暂时不可用（'+r.status+'）');const bytes=await bounded(r,6*1024*1024);requireLogin();return JSON.parse(bytes);}
 async function check(){
  requireLogin();refreshReceipt();const envelope=await json(origin+'/api/v1/releases/stable'),release=f.verifySigned(envelope,key,'release');let installed=0;try{installed=baseline().sequence;}catch{try{installed=JSON.parse(fs.readFileSync(path.join(root,'Config/release.json'),'utf8')).sequence||0;}catch{}}requireLogin();refreshReceipt();
  if(release.sequence<Math.max(installed,state.sequence||0))throw Error('拒绝旧序列版本');
  for(const saved of [{release:state.release,envelope:state.envelope},state.nextRelease])if(saved?.release?.sequence===release.sequence&&saved.envelope?.payload!==envelope.payload)throw Error('发布标识内容发生变化');
  if(release.sequence>installed&&state.release?.id!==release.id){
   // A notification cannot replace an in-progress review, its resolutions or
   // the exact bytes already approved for handoff. Keep only the newest next
   // release; it becomes current after this transaction is completed/deferred.
   if(state.release&&['reviewed','needs_build','prepared','validated','waiting_idle','handoff'].includes(state.phase)){
    state.nextRelease={release,envelope};state.sequence=release.sequence;
   }else {const lastResult=state.release&&['committed','rolled_back','deferred','rejected'].includes(state.phase)?{version:state.release.version,phase:state.phase,reason:state.reason||''}:state.lastResult;state={schema:1,phase:'available',sequence:release.sequence,release,envelope,lastResult,reason:platform==='win32'?'发现新版，等待 Eyra 核对':'发现新版，请从官网下载与此 Mac 匹配的应用包；保留用户配置与历史'};}
   persist();
  }
  if(state.phase==='deferred'&&now()>=(state.reconsiderAt||0)){state.phase='available';state.notified='';state.reason='延期已到复核时间，等待 Matrix 重新判断';persist();}
  state.checkedAt=new Date(now()).toISOString();persist();await notifyPending();requireLogin();return status();
 }
 async function download(artifact,dest){
  return downloadArtifact(artifact,dest,headers=>fetchImpl(origin+'/downloads/'+artifact.name,{
   headers,redirect:'error',credentials:'omit',signal:requestSignal(20*60*1000)
  }),requireLogin,(received,total)=>{if(operation)Object.assign(operation,{received,total});});
 }
 function incomingDir(kind){return kind==='patch'?'incoming-patch':kind==='delta'?'incoming-delta':'incoming';}
 function paths(){if(!state.release)throw Error('尚无待核对版本');const dir=path.join(store,state.release.id);return {dir,incoming:path.join(dir,incomingDir(state.transfer?.kind)),candidate:path.join(dir,'candidate')};}
 async function inventory(dir,names,{fresh=false}={}){
  if(inventoryCache.size>20000)inventoryCache.clear();
  const files=await f.inventoryAsync(dir,names,{cache:inventoryCache,fresh,signal:operationController?.signal});
  requireLogin();return files;
 }
 function localInventory(base,incoming){return inventory(root,[...Object.keys(base.files),...Object.keys(incoming.files),...f.sourceNames(root)]);}
 function requireReview(){if(!state.reviewDigest||!state.rows)throw Error('请先 review 核对三方变化');}
 async function verifyLocal(){requireReview();const {incoming}=paths(),base=baseline(),next=f.verifySigned(JSON.parse(f.read(path.join(incoming,'Config/official-baseline.json')).toString()),key,'baseline');const current=await localInventory(base,next);if(f.hash(JSON.stringify(current))!==state.localDigest){state.phase='available';state.reviewDigest='';state.candidateDigest='';persist();throw Error('本地内容已变化，需要重新核对');}return {base,next,current};}
 const reviewStatus=()=>({...status(),transfer:state.transfer||null,files:(state.rows||[]).map(r=>({path:r.name,choice:r.choice,localChanged:!f.same(r.base,r.local),incomingChanged:!f.same(r.base,r.incoming)}))});
 async function receive(artifact,base,dir,kind){
  const delta=kind!=='full',incoming=path.join(dir,incomingDir(kind));
  const archive=path.join(dir,delta?kind+'.zip':'download.zip'),marker=path.join(dir,delta?'extracted-'+kind+'.json':'extracted.json');
  await download(artifact,archive);
  if(!fs.existsSync(marker)){
   if(fs.existsSync(incoming)){if(fs.lstatSync(incoming).isSymbolicLink())throw Error('候选目录不能是链接');fs.rmSync(incoming,{recursive:true});}
   let names;
   if(kind==='patch'){
    const decoder='Aieyra OS.exe',installed=await inventory(root,[decoder],{fresh:true});
    if(!base.files[decoder]||!f.same(base.files[decoder],installed[decoder]))return null;
    const result=await run(path.join(root,'Aieyra OS.exe'),['-extract-release-patch','-archive',archive,'-base',root,
     '-output',incoming,'-version',state.release.version,'-from',String(base.sequence),'-to',String(state.release.sequence)],{},operationController.signal,10*60*1000);
    requireLogin();
    if(result.code!==0)return null;
    names=fs.readdirSync(incoming,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>path.relative(incoming,path.join(e.parentPath,e.name)).split(path.sep).join('/'));
   }else names=await require('./managed-update-archive.cjs').extractArchive(archive,incoming);
   requireLogin();f.atomicJSON(marker,{names,sha256:artifact.sha256});
  }
  const extracted=JSON.parse(f.read(marker));if(extracted.sha256!==artifact.sha256)throw Error('解压记录不匹配');
  const envelope=JSON.parse(f.read(path.join(incoming,'Config/official-baseline.json')).toString()),next=f.verifySigned(envelope,key,'baseline');
  if(next.sequence!==state.release.sequence||next.version!==state.release.version)throw Error('包与发布清单不匹配');
  const names=Object.keys(next.files),delivered=delta?names.filter(n=>!f.same(base.files[n],next.files[n])):names;
  const expected=new Set([...delivered,'Config/official-baseline.json']);
  if(!Array.isArray(extracted.names)||extracted.names.length!==expected.size||!extracted.names.every(n=>expected.delete(n)))throw Error('包含未签名文件或缺少签名文件');
  const incomingFiles=await inventory(incoming,delivered,{fresh:true});if(!delivered.every(n=>f.same(next.files[n],incomingFiles[n])))throw Error('候选包文件校验失败');
  const local=await localInventory(base,next);
  if(delta&&names.some(n=>!Object.hasOwn(incomingFiles,n)&&!f.same(next.files[n],local[n])))return null;
  state.transfer={kind,bytes:artifact.size,sparse:delta};
  return {next,local};
 }
 async function review(){
  await check();
  if(state.reviewDigest&&['reviewed','needs_build','prepared','validated','waiting_idle','handoff'].includes(state.phase)){await verifyLocal();return reviewStatus();}
  const base=baseline();if(!state.release||state.release.sequence<=base.sequence)return status();const {dir}=paths();fs.mkdirSync(dir,{recursive:true});
  const artifacts=state.release.artifacts.filter(a=>(!a.platform||a.platform===platform)&&(!a.arch||a.arch===arch));
  const matches=artifacts.filter(a=>a.kind==='portable');
  const full=matches.find(a=>a.purpose==='full')||matches.find(a=>a.name===`AieyraOS-${state.release.version}-windows-x64.zip`)||matches[0];
  const delta=artifacts.filter(a=>a.kind==='delta'&&a.fromSequence===base.sequence&&(!full||a.size<full.size)).sort((a,b)=>a.size-b.size)[0];
  const patch=artifacts.filter(a=>a.kind==='patch'&&a.fromSequence===base.sequence&&a.size<(delta||full)?.size).sort((a,b)=>a.size-b.size)[0];
  let received;
  if(patch){
   try{received=await receive(patch,base,dir,'patch');}
   catch(error){requireLogin();if(error.code!=='artifact_digest')throw error;}
  }
  if(!received&&delta)received=await receive(delta,base,dir,'delta');
  if(!received)received=await receive(full,base,dir,'full');
  const {next,local}=received;state.rows=f.compare(base.files,local,next.files);state.localDigest=f.hash(JSON.stringify(local));state.reviewDigest=f.hash(JSON.stringify({base:base.sequence,next:next.sequence,local:state.localDigest,rows:state.rows}));state.resolutions={};state.phase='reviewed';state.reason='三方变化已核对';state.candidateDigest='';state.evidence=null;persist();return reviewStatus();
 }
 const incomingRoot=row=>state.transfer?.sparse&&f.same(row.base,row.incoming)?root:paths().incoming;
 async function readFile(p){requireReview();const row=state.rows.find(r=>r.name===p.path);if(!row)throw Error('不在核对清单');const side=p.side||'local';if(!['base','local','incoming'].includes(side))throw Error('读取支持 base/local/incoming');if(!row[side])return {ok:true,path:row.name,side,deleted:true};if(side==='base'){const base=baseline(),text=base.texts?.[row.name];if(typeof text!=='string'||f.hash(Buffer.from(text))!==row.base.sha256)throw Error('旧版基线未附带此文本，请延期并保留本地文件');return {ok:true,path:row.name,side,sha256:row.base.sha256,text};}const dir=side==='local'?root:incomingRoot(row);const bytes=f.read(f.plainPath(dir,row.name),1024*1024);if(f.hash(bytes)!==row[side].sha256)throw Error('核对文件已变化，请重新核对');if(bytes.includes(0))throw Error('二进制文件不能作为文本合并');return {ok:true,path:row.name,side,sha256:row[side].sha256,text:bytes.toString('utf8')};}
 async function resolve(p){await verifyLocal();if(p.review_digest!==state.reviewDigest)throw Error('核对修订已失效');const row=state.rows.find(r=>r.name===p.path);if(!row||row.choice!=='conflict')throw Error('路径不是待解决冲突');if(!['local','incoming','merged','delete'].includes(p.choice)||typeof p.reason!=='string'||!p.reason.trim())throw Error('需要选择与合并理由');const resolution={choice:p.choice,reason:p.reason.slice(0,2000)};if(p.choice==='merged'){if(typeof p.text!=='string'||Buffer.byteLength(p.text)>1024*1024||p.text.includes('\0'))throw Error('合并内容无效');resolution.text=p.text;}
  state.resolutions[row.name]=resolution;state.candidateDigest='';state.evidence=null;state.phase='reviewed';persist();return status();
 }
 async function prepare(){
  const {next}=await verifyLocal();if(status().conflicts)throw Error('仍有未解决冲突');const {candidate,incoming}=paths();
  let preparedBytes=fs.statSync(path.join(incoming,'Config/official-baseline.json')).size;
  for(const row of state.rows){const resolved=state.resolutions[row.name],choice=resolved?.choice||row.choice;preparedBytes+=choice==='delete'?0:choice==='merged'?Buffer.byteLength(resolved.text):(choice==='local'?row.local:row.incoming)?.size||0;}
  f.requireSpace(path.dirname(candidate),preparedBytes);
  if(fs.existsSync(candidate)){if(fs.lstatSync(candidate).isSymbolicLink())throw Error('候选目录不能是链接');await fs.promises.rm(candidate,{recursive:true});}
  await fs.promises.mkdir(candidate,{recursive:true});
  const expected={},directories=new Set([candidate]);
  for(const row of state.rows){const resolved=state.resolutions[row.name],choice=resolved?.choice||row.choice;
   requireLogin();
   if(choice==='delete'||choice!=='merged'&&!(choice==='local'?row.local:row.incoming))continue;
   const dest=path.join(candidate,...row.name.split('/')),parent=path.dirname(dest);
   if(!directories.has(parent)){await fs.promises.mkdir(parent,{recursive:true});directories.add(parent);}
   if(choice==='merged'){
    await fs.promises.writeFile(dest,resolved.text,{flag:'wx'});
    expected[row.name]={sha256:f.hash(resolved.text),size:Buffer.byteLength(resolved.text)};
   }else{
    await fs.promises.copyFile(f.plainPath(choice==='local'?root:incomingRoot(row),row.name),dest,fs.constants.COPYFILE_EXCL);
    expected[row.name]=choice==='local'?row.local:row.incoming;
   }
  }
  await fs.promises.mkdir(path.join(candidate,'Config'),{recursive:true});
  await fs.promises.copyFile(path.join(incoming,'Config/official-baseline.json'),path.join(candidate,'Config/official-baseline.json'),fs.constants.COPYFILE_EXCL);
  await verifyLocal();
  const files=await candidateInventory({fresh:true});
  if(Object.keys(expected).length!==Object.keys(files).length||Object.keys(expected).some(n=>!f.same(expected[n],files[n])))throw Error('准备期间候选文件已变化');
  const checks=[];const changed=state.rows.filter(r=>r.choice!=='local'||state.resolutions[r.name]);
  for(const row of changed){if(/\.(cjs|mjs|js)$/.test(row.name)&&fs.existsSync(path.join(candidate,row.name))){const result=await run(process.execPath,['--check',path.join(candidate,row.name)],{ELECTRON_RUN_AS_NODE:'1'},operationController.signal);requireLogin();checks.push({path:row.name,exitCode:result.code});if(result.code!==0)throw Error('候选语法检查失败：'+row.name);}}
  const localGo=state.rows.some(r=>{if(!/\.(go|mod|sum|work)$/.test(r.name))return false;const choice=state.resolutions[r.name]?.choice||r.choice;return choice==='merged'||choice==='local'&&!f.same(r.local,r.incoming)||choice==='delete'&&!!r.incoming;});
  if(localGo){state.phase='needs_build';state.reason='保留了本地原生源码，需要 Cota 编译四个入口并由 Eyra 验证更新事务';state.candidatePath=candidate;persist();return {...status(),candidatePath:candidate,requiredBuild:'powershell -NoProfile -ExecutionPolicy Bypass -File ./Core/build.ps1 -Version '+state.release.version,requiredArtifacts:['Aieyra OS.exe','Aieyra CLI.exe','Aieyra Link.exe','Aieyra Browser.exe'],checks};}
  if(checks.length){
   await verifyLocal();
   if(f.hash(JSON.stringify(await candidateInventory()))!==f.hash(JSON.stringify(files)))throw Error('候选文件在语法检查期间发生变化');
  }
  finishPrepare(files,checks,next);
  return {...status(),candidatePath:candidate};
 }
 function candidateInventory(options){const {candidate,incoming}=paths();if(f.fileHash(path.join(candidate,'Config/official-baseline.json'))!==f.fileHash(path.join(incoming,'Config/official-baseline.json')))throw Error('候选官方基线发生变化');return inventory(candidate,[...state.rows.map(r=>r.name),...f.sourceNames(candidate)],options);}
 function finishPrepare(files,checks,next){f.validateFiles(files);state.candidateFiles=files;state.candidateDigest=f.hash(JSON.stringify(files));state.phase='prepared';state.evidence={syntax:checks,baseline:next.sequence,at:new Date(now()).toISOString()};state.reason='候选已准备，需要实际验证';persist();}
 async function verifyCandidate(){
  const {next}=await verifyLocal(),{candidate}=paths();if(!fs.existsSync(candidate))throw Error('候选不存在');
  if(!['prepared','needs_build','validated'].includes(state.phase))throw Error('请先准备候选');
  const files=await candidateInventory({fresh:true}),digest=f.hash(JSON.stringify(files));
  if(state.phase!=='needs_build'&&(!state.candidateFiles||digest!==f.hash(JSON.stringify(state.candidateFiles))))throw Error('临时文件已变化，请重新准备和验证');
  const executable=path.join(candidate,'Aieyra OS.exe');const ver=await run(executable,['-version'],{},operationController.signal);requireLogin();if(ver.code!==0||ver.output.trim()!==`Aieyra OS ${state.release.version}`)throw Error('候选程序版本验证失败');
  const health=await run(executable,['-update-probe',candidate],{AIEYRA_ROOT:candidate},operationController.signal);requireLogin();if(health.code!==0)throw Error('候选本地运行验证失败：'+health.output.slice(0,600));
  await verifyLocal();
  if(f.hash(JSON.stringify(await candidateInventory({fresh:true})))!==digest)throw Error('候选文件在启动验证期间发生变化');
  const checks=state.evidence?.syntax||[];finishPrepare(files,checks,next);state.evidence.health={exitCode:health.code,output:health.output.trim()};state.evidence.version={exitCode:ver.code,output:ver.output.trim()};state.phase='validated';state.reason='临时文件的版本与启动检查通过，可在空闲时替换当前安装';persist();return status();
 }
 async function decide(p){if(!['defer','reject','apply'].includes(p.decision))throw Error('需要明确更新操作');if(p.decision==='apply'){
   await verifyLocal();
   if(state.phase!=='validated'||!state.candidateDigest||p.candidate_digest!==state.candidateDigest)throw Error('需要当前已验证的文件摘要');
   const files=await candidateInventory();if(f.hash(JSON.stringify(files))!==state.candidateDigest)throw Error('临时文件已变化，请重新验证');state.phase='waiting_idle';if(typeof p.evidence==='string'&&p.evidence.trim())state.evidence.functional=p.evidence.slice(0,6000);
  }else{state.phase=p.decision==='defer'?'deferred':'rejected';state.reconsiderAt=now()+24*3600000;state.candidateDigest='';}state.reason=typeof p.reason==='string'?p.reason.slice(0,2000):({apply:'等待空闲后替换当前安装',defer:'本次暂缓更新',reject:'本次不采用此更新'})[p.decision];persist();return status();}
 async function handoff(p){
  if(state.phase!=='waiting_idle'||!p.session_id)throw Error('尚未授权交接');const {current}=await verifyLocal(),{dir,candidate}=paths();
  const files=await candidateInventory();if(f.hash(JSON.stringify(files))!==state.candidateDigest)throw Error('候选摘要已变化');
  const baselineFile='Config/official-baseline.json';files[baselineFile]={sha256:f.fileHash(path.join(candidate,baselineFile)),size:fs.statSync(path.join(candidate,baselineFile)).size};current[baselineFile]={sha256:f.fileHash(path.join(root,baselineFile)),size:fs.statSync(path.join(root,baselineFile)).size};
  let backupBytes=0,largestChange=0;
  for(const name of new Set([...Object.keys(current),...Object.keys(files)]))if(!f.same(current[name],files[name])){backupBytes+=current[name]?.size||0;largestChange=Math.max(largestChange,files[name]?.size||0);}
  f.requireSpace(root,backupBytes+largestChange+fs.statSync(path.join(root,'Aieyra OS.exe')).size);
  const plan={schema:1,root,candidate,release:state.release.id,version:state.release.version,sequence:state.release.sequence,files,previous:current,candidateDigest:state.candidateDigest,config:p.config,session:p.session_id,workdir:p.workdir,phase:'ready'};
  const planFile=path.join(dir,'apply.json');f.atomicJSON(planFile,plan);const helper=path.join(dir,'update-helper.exe');fs.copyFileSync(path.join(root,'Aieyra OS.exe'),helper);state.phase='handoff';persist();return {ok:true,plan:planFile,helper};
 }
 async function call(p={}){if(p.action==='status')return status();if(p.action==='start'){start();return status();}requireLogin();if(platform!=='win32'&&!['check','notice_ack'].includes(p.action))return {...status(),reason:'请在官网下载本机版本并替换应用；配置与历史保存在用户目录。'};if(busy)throw Error('已有更新操作进行中');busy=true;operation={action:p.action};operationController=new AbortController();try{switch(p.action){case 'check':return await check();case 'review':return await review();case 'read_file':return await readFile(p);case 'resolve_file':return await resolve(p);case 'prepare':return await prepare();case 'verify':return await verifyCandidate();case 'decide':return await decide(p);case 'handoff':return await handoff(p);case 'handoff_failed':if(state.phase==='handoff'){state.phase='validated';state.reason='交接没有完成，请重新确认更新';persist();}return status();case 'notice_ack':if(state.release?.id===p.id){state.notified=p.id;persist();}return status();default:throw Error('未知更新操作');}}finally{busy=false;operation=null;operationController=null;flushPendingCheck();}}
 function flushPendingCheck(){
  if(!pendingCheck||busy||manualChecks||backgroundCheck)return;
  pendingCheck=false;queueMicrotask(requestCheck);
 }
 function requestCheck(){
  if(closed||!signedIn())return;
  if(busy||manualChecks||backgroundCheck){pendingCheck=true;return;}
  backgroundCheck=call({action:'check'}).catch(()=>{}).finally(()=>{backgroundCheck=null;flushPendingCheck();});
 }
 async function watch(){if(closed||!signedIn())return;const controller=new AbortController();eventController=controller;const current=()=>eventController===controller&&!controller.signal.aborted&&!closed&&signedIn();try{const r=await fetchImpl(origin+'/api/v1/releases/events',{redirect:'error',credentials:'omit',signal:controller.signal});if(!r.ok)throw Error();let buffer='';for await(const chunk of r.body){if(!current())break;buffer+=Buffer.from(chunk).toString();if(buffer.length>16384)throw Error('事件过大');let separator;while((separator=/\r?\n\r?\n/.exec(buffer))){const event=buffer.slice(0,separator.index);buffer=buffer.slice(separator.index+separator[0].length);if(/^event:[ \t]*release[ \t\r]*$/m.test(event))requestCheck();}}}catch{}finally{if(current()){eventTimer=setTimeout(()=>{eventTimer=null;if(current())void watch();},15000+Math.random()*15000);eventTimer.unref();}}}
 function pause(){lifecycle++;pendingCheck=false;operationController?.abort();eventController?.abort();eventController=null;clearInterval(pollTimer);clearTimeout(eventTimer);pollTimer=null;eventTimer=null;if(['waiting_idle','handoff'].includes(state.phase)){state.phase='prepared';state.candidateDigest='';state.reason='登录状态改变，请重新验证并确认更新';persist();}}
 function reconcile(){if(closed)return;if(!signedIn()){pause();return;}if(!started||pollTimer)return;void watch();requestCheck();pollTimer=setInterval(()=>{if(!signedIn()){pause();return;}requestCheck();},300000);pollTimer.unref();}
 async function withManualChecks(run){
  manualChecks++;
  try{await backgroundCheck;return await run();}
  finally{manualChecks--;flushPendingCheck();}
 }
 const unsubscribe=subscribe(()=>reconcile());
 function start(){if(closed)return;started=true;reconcile();}
 return {call,status,start,notifyPending,withManualChecks,close(){if(closed)return;closed=true;unsubscribe();pause();}};
}
async function bounded(response,limit){let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)throw Error('响应过大');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
async function run(executable,args,env,signal,timeout=60000){return new Promise((resolve,reject)=>{let output='',failure;const child=spawn(executable,args,{signal,windowsHide:true,env:Object.fromEntries(Object.entries({...process.env,...env}).filter(([k])=>!k.startsWith('NODE_TEST_')&&k!=='NODE_OPTIONS')),stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>{failure=Error('验证超时');child.kill();},timeout);for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{if(output.length<32000)output+=b.toString();});child.once('error',e=>{clearTimeout(timer);failure=e;});child.once('close',code=>{clearTimeout(timer);if(failure)reject(failure);else resolve({code,output});});});}
module.exports={createManagedUpdates};
