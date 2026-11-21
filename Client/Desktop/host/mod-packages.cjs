// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; storage; hash; readPackage; createModPackages
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/mod-packages.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Desktop adapter for the one Core registry. No second installation database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createProgramRuntime,descriptor}=require('../../../Program/runtime/desktop.cjs');
const {createToolOperations}=require('./tool-operations.cjs');
const storage=require('../../../Contracts/storage/paths.cjs');
const {createThemeAssets}=require('../../../Theme/runtime/assets.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function readPackage(item){
 const root=path.resolve(item.directory),files={};
 for(const [name,want]of Object.entries(item.manifest.files)){
  const file=path.resolve(root,...name.split('/'));if(!file.startsWith(root+path.sep))throw Error('程序路径越界');
  for(let p=file;;p=path.dirname(p)){const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('程序路径不能经过链接');if(path.dirname(p)===p)break;}
  const stat=fs.statSync(file);if(!stat.isFile()||stat.size!==want.size||stat.size>64*1024*1024)throw Error('程序文件大小已变化');
  const bytes=fs.readFileSync(file);if(hash(bytes)!==want.sha256)throw Error('程序文件内容已变化');files[name]=bytes;
 }
 return files;
}
function createModPackages({core,dataDir,BrowserWindow,programWindow,session,appearance,halo,nativePrograms,legacyProgramStorageRoot,offscreen=false,onError=()=>{}}){
 const programs=createProgramRuntime({BrowserWindow,programWindow,session,storageRoot:storage.root(dataDir,'programs'),legacyStorageRoot:legacyProgramStorageRoot,offscreen});
 const operations=createToolOperations({file:path.join(storage.root(dataDir,'runtime'),'program-operations.json'),scope:'programs'});
 let closed=false,watcher=null,parentWatcher=null,timer=null,reconciliation=0,closing=null,releases=null;
 const root=storage.root(dataDir,'packages');
 const contextView=out=>{if(out?.ok===false)throw Error(out.error||'上下文操作未完成');const p=out.provider||{};return {ok:true,source:out.source,session_id:out.session_id,busy:out.busy,provider:{selected:p.selected,available:p.available,ready:p.ready,error:p.error,catalog_error:p.catalog_error}};};
 async function checked(p){const out=await core('workspace.packages',p);if(out?.ok===false)throw Object.assign(Error(out.error||out.compatibility?.issues?.map(x=>x.detail).join('; ')||'包操作未完成'),{report:out});return out;}
 const themeAssets=createThemeAssets({resolve:async id=>(await checked({action:'resolve',id})).item,readPackage,current:()=>appearance?.read()?.settings?.layout_theme});
 const protocol=session?.defaultSession?.protocol;
 const previews=require('../../../Theme/runtime/preview.cjs').createThemePreviews({load:async p=>{
  const state=await checked({action:'list'}),item=state.items.find(row=>row.manifest.id===p.id);
  if(!item||item.manifest.kind!=='theme'||p.expected_digest!==item.digest)throw Error('主题版本已变化，请刷新后预览');
  const inspected=await checked({action:'inspect',source:item.directory});
  if(!inspected.compatibility?.compatible||inspected.digest!==item.digest)throw Error('主题内容已变化或不兼容');
  const files=readPackage(item),definition=JSON.parse(files[item.manifest.entrypoints.theme]);
  return {id:item.manifest.id,digest:item.digest,version:item.manifest.version,name:item.manifest.name,definition,files};
 }});
 protocol?.handle('aieyra-theme',request=>{try{return new URL(request.url).host==='preview'?previews.serve(request):themeAssets.serve(request);}catch{return new Response('',{status:400});}});
 async function reconcile(){
  if(closed)return;const ticket=++reconciliation;
  const before=appearance?.read(),selected=before?.settings?.layout_theme;
  const savedHalo=halo?.read();
  let items,active,trusted=true;
  // Only an unreadable package list withdraws all admissions. A later surface
  // retention failure belongs to that surface, not to the trusted snapshot.
  try{const state=await checked({action:'list'});if(closed||ticket!==reconciliation)return;items=state.items||[];active=new Map(items.filter(x=>x.enabled).map(x=>[x.manifest.id,x.digest]));}
  catch{if(closed||ticket!==reconciliation)return;trusted=false;items=[];active=new Map();}
  const errors=[];
  for(const row of programs.active()){
   if(closed||ticket!==reconciliation)return;
   if(active.get(row.id)!==row.digest)try{programs.close(row.id);}catch(error){errors.push(error);}
  }
  if(closed||ticket!==reconciliation)return;
  try{await nativePrograms?.reconcile(items);}catch(error){errors.push(error);}
  if(closed||ticket!==reconciliation)return;
  if(halo){
   try{
    const choice=savedHalo.selection;let verified=null;
    if(choice&&active.get(choice.id)===choice.digest){try{const resolved=(await checked({action:'resolve',id:choice.id})).item;if(resolved.manifest.kind==='halo'&&resolved.digest===choice.digest){const files=readPackage(resolved);verified={id:choice.id,digest:resolved.digest,version:resolved.manifest.version,name:resolved.manifest.name,definition:JSON.parse(files[resolved.manifest.entrypoints.halo])};require('../../../Halo/contract/definition.mjs').validateSelection(verified);}}catch{verified=null;}}
    if(!closed&&ticket===reconciliation&&halo.read().version===savedHalo.version)halo.publish(verified);
   }catch(error){errors.push(error);}
  }
  if(closed||ticket!==reconciliation)return;
  try{if(!trusted)themeAssets.invalidate();else if(selected&&active.get(selected.id)!==selected.digest){themeAssets.invalidate();appearance.update({layout_theme:null},before.version);}}catch(error){errors.push(error);}
  if(errors.length===1)throw errors[0];
  if(errors.length)throw new AggregateError(errors,'部分包资源同步未完成');
 }
 // Watchers and startup have no awaiting caller. Retention may reject to keep
 // a surface alive, so route that failure to the host instead of crashing Node.
 function refresh(){void reconcile().catch(error=>{try{onError(error);}catch{}});}
 function watch(){
  if(closed||watcher||!fs.existsSync(root))return;
  watcher=fs.watch(root,{persistent:false},(_event,file)=>{if(!file||String(file)==='installed.json'){clearTimeout(timer);timer=setTimeout(refresh,50);timer.unref?.();}});
  watcher.on('error',()=>{watcher?.close();watcher=null;refresh();});
 }
 if(fs.existsSync(dataDir)){parentWatcher=fs.watch(dataDir,{persistent:false},(_event,file)=>{if(!file||String(file)===path.basename(root))watch();});parentWatcher.on('error',()=>parentWatcher?.close());}watch();
 if(appearance||halo)refresh();
 async function call(p={},owner,{signal}={}){
  if(closed)throw Error('包服务已关闭');
  const action=String(p.action||'').replace(/^mod_/,'');
  // Existing invoke receipts remain queryable even on an aborted transport.
  // New effects are gated by their receipt and by the runtime at dispatch.
  if(action!=='invoke'&&signal?.aborted)throw Object.assign(Error('操作在执行前已取消。'),{code:'CANCELLED'});
  if(action==='theme_preview')return previews.open(owner,p);
  if(action==='theme_preview_close'){previews.release(owner,p.preview_id);return {ok:true};}
  if(['list','inspect','capabilities'].includes(action))return checked({...p,action});
  if(['install','enable','disable','rollback','remove'].includes(action)){
   if(p.confirmed!==true)throw Error('请先核对作者、版本和权限，并取得用户对这项更改的授权');
   const out=await checked({...p,action});watch();await reconcile();return out;
  }
  if(action==='close'){programs.close(p.id);await nativePrograms?.closeProgram(p.id);return {ok:true};}
  if(action==='context_view')return contextView(await core('workspace.context',{action:'view'}));
  if(action==='context_reset'){
   if(p.confirmed!==true||typeof p.expected_source!=='string'||!p.expected_source)throw Error('请先读取并确认当前会话');
   return contextView(await core('workspace.context',{action:'provider',source:p.expected_source,provider:{id:'aieyra.context.structured',version:'1.0.0',state_schema:1}}));
  }
  if(action==='adapter_targets'){
   const item=(await checked({action:'resolve',id:p.id})).item;if(item.manifest.kind!=='api')throw Error('这个包不是API适配器');
   const definition=JSON.parse(readPackage(item)[item.manifest.entrypoints.adapter]);
   const pool=await core('settings',{action:'pool'});if(pool.ok===false)throw Error(pool.error||pool.errors?.join('; '));
   return {ok:true,version:pool.version,models:pool.models.filter(m=>m.api_protocol===definition.protocol&&m.kind!=='image').map(m=>({id:m.id,name:m.name||m.model,model:m.model,adapter_package:m.adapter_package||null}))};
  }
  if(action==='adapter_reset'||action==='adapter_test'){
   if(p.confirmed!==true)throw Error('请先确认模型操作');
   return core('settings',action==='adapter_test'?{action:'model_test',id:p.profile_id}:{action:'api_adapter_reset',profile_id:p.profile_id,expected_version:p.expected_version});
  }
  if(['open','apply','snapshot','invoke','describe'].includes(action)){
   const current=await checked({action:'resolve',id:p.id}),item=current.item;
   if(closed)throw Error('包服务已关闭');
   if(p.expected_digest&&p.expected_digest!==item.digest)throw Error('程序依赖版本已变化，请先核对实例绑定');
   if(item.manifest.kind==='context'&&action==='apply'){
    if(p.confirmed!==true||!p.expected_digest||typeof p.expected_source!=='string'||!p.expected_source)throw Error('请先读取并确认当前会话与Context包版本');
    const provider={id:item.manifest.id,version:item.manifest.version,state_schema:item.manifest.data.schema,digest:item.digest};
    return contextView(await core('workspace.context',{action:'provider',source:p.expected_source,provider}));
   }
   if(item.manifest.kind==='api'&&action==='apply'){
    if(p.confirmed!==true)throw Error('请先确认应用这个API适配器');
    return core('settings',{action:'api_adapter_apply',id:p.id,profile_id:p.profile_id,expected_digest:item.digest,expected_version:p.expected_version});
   }
   if(item.manifest.kind==='halo'&&action==='apply'){
    if(p.confirmed!==true)throw Error('请先确认应用这个光圈');if(!halo)throw Error('光圈服务不可用');
    const files=readPackage(item),definition=JSON.parse(files[item.manifest.entrypoints.halo]);
    const selected={id:p.id,digest:item.digest,version:item.manifest.version,name:item.manifest.name,definition};require('../../../Halo/contract/definition.mjs').validateSelection(selected);
    const latest=(await checked({action:'resolve',id:p.id})).item;if(latest.digest!==item.digest)throw Error('光圈版本已变化，请刷新后应用');
    reconciliation++;const before=halo.read();return halo.update(selected,before.version);
   }
   if(item.manifest.kind==='theme'&&action==='apply'){
    if(p.confirmed!==true)throw Error('请先确认应用这个主题');
    const files=readPackage(item),definition=JSON.parse(files[item.manifest.entrypoints.theme]);
    require('../../../Theme/contract/definition.mjs').validateTheme(definition);
    const before=await core('settings',{action:'os_appearance_read'});
    if(before.ok===false)throw Error(before.error);
    return core('settings',{action:'os_appearance_update',expected_version:before.version,patch:{layout_theme:{id:p.id,digest:item.digest,version:item.manifest.version,definition}}});
   }
   if(item.manifest.kind!=='program')throw Error('这个包不是程序');
   const files=readPackage(item),definition=descriptor(item.manifest,files);
   if(action==='describe')return {ok:true,id:p.id,version:item.manifest.version,digest:item.digest,...definition};
   if(definition.desktop.native){
    if(!nativePrograms)throw Error('当前宿主不支持这个原生程序');
    if(action==='open'||action==='snapshot')return nativePrograms.call(item,action,p,{signal});
    if(typeof p.request_id!=='string'||!p.request_id)throw Error('程序操作需要稳定的 request_id');
    return operations.execute(p.request_id,{id:p.id,digest:item.digest,operation:p.operation,args:p.arguments??{}},()=>nativePrograms.call(item,'invoke',{...p,arguments:p.arguments??{}},{signal}),{signal});
   }
   if(action==='open')return programs.open({id:p.id,name:item.manifest.name,digest:item.digest,entry:definition.desktop.entry,mode:definition.mode,operations:definition.operations,files,network:(item.grants||[]).filter(x=>x.capability==='network.https').map(x=>x.scope)},{signal});
   if(action==='snapshot')return programs.invoke(p.id,'snapshot',{},{expectedDigest:item.digest,signal});
   if(typeof p.request_id!=='string'||!p.request_id)throw Error('程序操作需要稳定的 request_id');
   return operations.execute(p.request_id,{id:p.id,digest:item.digest,operation:p.operation,args:p.arguments??{}},()=>programs.invoke(p.id,p.operation,p.arguments,{expectedDigest:item.digest,signal}),{signal});
  }
  throw Error('未知的包操作');
 }
 function close(){
  if(closing)return closing;
  if(!releases){
   closed=true;reconciliation++;clearTimeout(timer);
   releases=new Map([
    ['watcher',()=>watcher?.close()],['parentWatcher',()=>parentWatcher?.close()],
    ['themeAssets',()=>themeAssets.close()],['previews',()=>previews.close()],
    ['protocol',()=>protocol?.unhandle('aieyra-theme')],['programs',()=>programs.shutdown()],['nativePrograms',()=>nativePrograms?.shutdown()]
   ]);
  }
  closing=(async()=>{
   const errors=[];
   for(const [key,release]of releases){try{await release();releases.delete(key);}catch(error){errors.push(error);}}
   if(errors.length===1)throw errors[0];
   if(errors.length)throw new AggregateError(errors,'部分包资源释放未完成');
  })().finally(()=>{closing=null;});
  return closing;
 }
 return {call,reconcile,close};
}
module.exports={createModPackages,readPackage};
