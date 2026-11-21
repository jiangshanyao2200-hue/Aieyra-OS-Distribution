// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; hash; idPattern; consent; plain; name; atomic; digestFile; read; manifest; bundle; createResources
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/resources.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Content-addressed local resources. Installing never executes downloaded code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const idPattern=/^[a-z][a-z0-9_-]{0,47}\.[a-z][a-z0-9_-]{0,63}$/,BUNDLE_MAX=64*1024*1024;
const consent=p=>{if(p.confirmed!==true)throw Error('这一步会改变用户的电脑：先用 ask_user 说明作者、权限和摘要并征得同意，再带 confirmed=true 调用');};
function plain(file){for(let p=path.resolve(file);;p=path.dirname(p)){try{const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('资源路径不能经过链接');}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(p)===p)break;}return file;}
function name(value){if(typeof value!=='string'||value.length>240||!value||/[\\:<>"|?*\x00-\x1f]/.test(value)||value.split('/').some(x=>!x||x==='.'||x==='..'||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))throw Error('资源文件路径无效');return value;}
function atomic(file,value){plain(file);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function digestFile(file){plain(file);const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1<<20);let size=0;try{for(let n;(n=fs.readSync(fd,buffer,0,buffer.length,null))>0;size+=n)h.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}return {size,sha256:h.digest('hex')};}
function read(file,max=24*1024*1024){plain(file);const s=fs.statSync(file);if(!s.isFile()||s.size>max)throw Error('资源文件过大或无效');return fs.readFileSync(file);}
function manifest(m){if(m?.schema!=='aieyra-resource/1'||!idPattern.test(m.id||'')||!/^\d+\.\d+\.\d+$/.test(m.version||'')||!['program','tool','role','drawing','prompt','theme'].includes(m.kind)||!Array.isArray(m.permissions)||m.permissions.some(x=>!['files','terminal','network','browser','appearance','clipboard','computer'].includes(x))||!m.artifact||!Number.isSafeInteger(m.artifact.size)||m.artifact.size<1||m.artifact.size>512*1024*1024||!/^[a-f0-9]{64}$/.test(m.artifact.sha256||''))throw Error('中心资源清单无效');name(m.artifact.name);if(m.artifact.name.includes('/'))throw Error('资源包名称无效');if(m.kind==='role'&&!m.artifact.name.endsWith('.zip'))throw Error('角色需要公开 Agent 模板 ZIP');return m;}
function bundle(bytes,m){
 if(bytes.length>BUNDLE_MAX||bytes.length!==m.artifact.size||hash(bytes)!==m.artifact.sha256)throw Error('资源包摘要不匹配或过大');const b=JSON.parse(bytes);if(b.schema!=='aieyra-bundle/1'||b.kind!==m.kind)throw Error('资源包类型不匹配');
 if(m.kind==='tool'&&(!b.tool||!b.tool.presentation||b.tool.presentation.kind!==m.visual?.kind||typeof b.tool.code!=='string'))throw Error('工具必须包含匹配的声明式可视化');
 if(m.kind==='theme'){if(!b.theme||typeof b.theme!=='object'||Array.isArray(b.theme))throw Error('主题内容无效');require('../src/os-appearance.cjs').merge(require('../src/os-appearance.cjs').defaults(),b.theme);}
 if(m.kind==='prompt'&&(typeof b.text!=='string'||!b.text.trim()||b.text.length>64000))throw Error('提示词资源无效');
 if(m.kind==='drawing'&&(!['image/png','image/jpeg','image/webp'].includes(b.mime)||typeof b.data!=='string'||b.data.length>20*1024*1024))throw Error('绘图资源无效');
 if(m.kind==='program'){
  if(!b.files||typeof b.files!=='object'||Array.isArray(b.files)||Object.keys(b.files).length>256||!name(b.entry).endsWith('.html')||!Object.hasOwn(b.files,b.entry))throw Error('程序需要 HTML 入口和文件集');
  let total=0;const seen=new Set();for(const [n,value]of Object.entries(b.files)){name(n);if(seen.has(n.toLowerCase())||typeof value!=='string')throw Error('程序文件重复或无效');seen.add(n.toLowerCase());total+=Buffer.byteLength(value);if(!/\.(html|css|js|mjs|json|svg|txt)$/.test(n)||total>16*1024*1024)throw Error('程序文件类型或大小无效');}
 }
 return b;
}
function createResources({client,directory,core,modPackages}={}){
 directory=path.resolve(directory);plain(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});const registryFile=path.join(directory,'installed.json');let busy=false,closed=false;
 const registry=()=>{try{return JSON.parse(read(registryFile,1024*1024));}catch(e){if(e.code==='ENOENT')return {schema:1,items:{}};throw e;}};
 const folder=(id,version)=>path.join(directory,'installed',id,version),archive=m=>path.join(directory,'downloads',m.id+'-'+m.version+'-'+m.artifact.sha256+(m.kind==='role'?'.zip':'.aieyra'));
 const current=id=>{if(!idPattern.test(id||''))throw Error('资源 ID 无效');const item=registry().items[id];if(!item)throw Error('资源未安装');return item;};
 async function checked(action,p){const r=await core(action,p);if(r?.ok===false)throw Error(r.error||'资源操作未完成');return r;}
 const common=async()=>modPackages?((await modPackages.call({action:'mod_list'})).items||[]):[];
 function retainManifest(file,m){const target=file+'.manifest.json';if(fs.existsSync(target)){if(!require('node:util').isDeepStrictEqual(JSON.parse(read(target,1024*1024)),m))throw Error('本地下载清单已改变，未覆盖');}else atomic(target,m);}
 function localProgram(id,expected){
  const old=current(id),m=manifest(old.manifest);if(m.kind!=='program'||expected!==m.artifact.sha256)throw Error('旧程序身份或摘要已变化');
  const bytes=read(path.join(old.directory,'bundle.json'),BUNDLE_MAX);bundle(bytes,m);const file=archive(m);plain(file);
  if(fs.existsSync(file)){if(!read(file,BUNDLE_MAX).equals(bytes))throw Error('本地下载已改变，未覆盖');}else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
  retainManifest(file,m);return {manifest:m,file};
 }
 async function acquire(id,expected){
  if(!idPattern.test(id||''))throw Error('资源 ID 无效');const value=await client.call({action:'center_read',id}),m=manifest(value.item?.manifest),file=archive(m);
  if(m.id!==id)throw Error('资源身份不一致');if(expected!==undefined&&expected!==m.artifact.sha256)throw Error('请先核对资源作者、权限和摘要，再传 expected_sha256 安装');
  if(fs.existsSync(file)){const local=digestFile(file);if(local.size===m.artifact.size&&local.sha256===m.artifact.sha256){retainManifest(file,m);return {manifest:m,file};}throw Error('本地同名下载已改变，请先处理本地修改');}
  const {response,assertCurrent}=await client.centerDownload(id);if(!response.ok)throw Error('资源下载失败（'+response.status+'）');fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});plain(file);const temp=file+'.'+crypto.randomUUID()+'.part',fd=fs.openSync(temp,'wx',0o600),h=crypto.createHash('sha256');let size=0;
  try{for await(const bytes of response.body){assertCurrent();size+=bytes.length;if(size>m.artifact.size)throw Error('下载超过声明大小');h.update(bytes);fs.writeSync(fd,bytes);}assertCurrent();if(size!==m.artifact.size||h.digest('hex')!==m.artifact.sha256)throw Error('下载摘要不匹配');fs.fsyncSync(fd);}catch(e){fs.closeSync(fd);fs.unlinkSync(temp);throw e;}fs.closeSync(fd);fs.renameSync(temp,file);atomic(file+'.manifest.json',m);return {manifest:m,file};
 }
 async function inspectRole(m,file){
  if(!modPackages)throw Error('共同角色包服务不可用');
  const inspected=await modPackages.call({action:'mod_inspect',source:file});
  if(inspected.ok===false)throw Error(inspected.error||'角色包检查失败');
  if(inspected.manifest?.kind!=='agent'||inspected.manifest.version!==m.version)throw Error('角色 ZIP 的类型或版本与中心清单不一致');
  if(!inspected.compatibility?.compatible)throw Error(inspected.compatibility?.issues?.map(x=>x.detail).join('; ')||'角色包不兼容');
  return inspected;
 }
 // The center ID names a listing (u<account>.*), not the package. These are
 // download receipts only; enabled state and lifecycle remain in Core.
 function roleAliases(items){
  const root=path.join(directory,'downloads');plain(root);if(!fs.existsSync(root))return [];
  const aliases=[];for(const file of fs.readdirSync(root).filter(n=>n.endsWith('.package.json'))){
   try{const receipt=JSON.parse(read(path.join(root,file),65536)),item=items.find(r=>r.manifest.id===receipt.package_id&&r.digest===receipt.digest);if(item?.manifest.kind==='agent'&&idPattern.test(receipt.resource_id||''))aliases.push({resource_id:receipt.resource_id,package_id:receipt.package_id});}catch{/* A missing or damaged display receipt never changes an installed package. */}
  }return aliases;
 }
 async function call(p){
  if(closed)throw Error('资源服务已关闭');if(p.action==='center_local'){const items=await common(),registered=new Set(items.map(r=>r.manifest.id));return {ok:true,aliases:roleAliases(items),items:Object.values(registry().items).filter(r=>r.manifest.kind!=='program'||!registered.has(r.manifest.id)).map(r=>r.manifest.kind==='program'?{...r,migrationRequired:true}:r)};}
  if(busy)throw Error('另一个资源操作正在进行');busy=true;
  try{
   if(p.action==='center_acquire'){const acquired=await acquire(p.id,p.expected_sha256);return {ok:true,...acquired,...(acquired.manifest.kind==='role'?{inspection:await inspectRole(acquired.manifest,acquired.file)}:{})};}
   if(p.action==='center_publish_file'){
    const m=manifest(p.manifest);if(p.confirmed!==true||!path.isAbsolute(p.file||'')||typeof p.request_id!=='string'||!/^[A-Za-z0-9._-]{16,90}$/.test(p.request_id))throw Error('请提供已核对的公开文件和稳定提交编号');
    const bytes=read(p.file,512*1024*1024);if(bytes.length!==m.artifact.size||hash(bytes)!==m.artifact.sha256)throw Error('公开文件与清单不匹配');if(m.artifact.name.endsWith('.aieyra'))bundle(bytes,m);
    const begin=await client.call({action:'center_begin',request_id:p.request_id,manifest:m,confirmed:true});if(begin.alreadyPublished)return begin;
    const state=await client.call({action:'center_upload_status',upload_id:begin.uploadId});if(!Number.isSafeInteger(state.received)||state.received<0||state.received>bytes.length)throw Error('上传进度无效');
    for(let offset=state.received;offset<bytes.length;offset+=512*1024)await client.call({action:'center_chunk',upload_id:begin.uploadId,offset,data:bytes.subarray(offset,offset+512*1024).toString('base64')});
    return await client.call({action:'center_commit',upload_id:begin.uploadId,request_id:p.request_id+'.commit'});
   }
   if(p.action==='center_install'||p.action==='center_migrate'){
    consent(p);if(p.action==='center_migrate'&&p.origin!=='local')throw Error('请明确以本地包迁移（origin=local）');
    const {manifest:m,file}=p.action==='center_migrate'?localProgram(p.id,p.expected_sha256):await acquire(p.id,String(p.expected_sha256));
    if(m.kind==='role'){
     const inspected=await inspectRole(m,file);
     if(p.expected_digest!==inspected.digest||!Number.isSafeInteger(p.expected_revision)||p.expected_revision<0)throw Error('请先 center_acquire 核对角色包作者、实际权限和签名，并传回 expected_digest、expected_revision');
     if(inspected.compatibility.publisher_key==='unsigned'&&inspected.origin!=='official'&&p.origin!=='local')throw Error('角色包未签名；核对后请明确以本地包导入（origin=local）');
     const installed=await modPackages.call({action:'mod_install',source:file,origin:p.origin==='local'?'local':'third-party',expected_digest:inspected.digest,expected_revision:p.expected_revision,request_id:p.request_id||crypto.randomUUID(),confirmed:true});
     if(installed.ok===false)throw Error(installed.error||'角色包安装失败');
     atomic(path.join(directory,'downloads',m.id+'.package.json'),{resource_id:m.id,package_id:inspected.manifest.id,digest:inspected.digest});
     return {...installed,applied:false,resource_id:m.id,notice:'角色模板已导入；在已安装中核对权限并启用，再创建独立实例。'};
    }
    if(!m.artifact.name.endsWith('.aieyra'))return {ok:true,installed:false,file,manifest:m,instructions:m.lifecycle,notice:'原生程序包已核验下载；请按生命周期说明由 Agent 安装。'};
    const b=bundle(read(file,BUNDLE_MAX),m),state=registry(),old=state.items[m.id],dir=folder(m.id,m.version);plain(dir);
    if(m.kind==='program'){
     if(!modPackages)throw Error('共同程序包服务不可用');
     if(p.origin!=='local')throw Error('旧程序没有发布者签名；核对后请明确以本地包导入（origin=local），或使用带签名的 Mod');
     if(old){const original=bundle(read(path.join(old.directory,'bundle.json'),BUNDLE_MAX),old.manifest);for(const [name,text]of Object.entries(original.files||{})){if(!read(path.join(old.directory,name)).equals(Buffer.from(text)))throw Error('旧程序有本地修改，先保留并转换修改后的版本');}}
     const inspected=await modPackages.call({action:'mod_inspect',source:file});
     if(!inspected.compatibility?.compatible)throw Error(inspected.compatibility?.issues?.map(x=>x.detail).join('; ')||'旧程序无法兼容转换');
     const installed=await modPackages.call({action:'mod_install',source:file,origin:'local',expected_digest:inspected.digest,expected_revision:inspected.revision,request_id:p.request_id||crypto.randomUUID(),confirmed:true});
     // Only the common registry owns execution state. Legacy files and private
     // Chromium data remain intact, but no second installation record survives.
     if(old){delete state.items[m.id];atomic(registryFile,state);}
     return {...installed,applied:false,notice:'已转换为本地程序包；在已安装中核对权限并启用。旧程序资料保留。'};
    }
    if(fs.existsSync(path.join(dir,'bundle.json'))&&hash(read(path.join(dir,'bundle.json')))!==m.artifact.sha256)throw Error('已安装资源有本地修改，先保留并合并');
    // 先查完所有冲突再落盘，半路失败不留下半个版本。
    const outputs=m.kind==='program'?Object.entries(b.files):m.kind==='prompt'?[['prompt.txt',b.text]]:m.kind==='drawing'?[['drawing.'+b.mime.split('/')[1],Buffer.from(b.data,'base64')]]:[];
    for(const [n,value]of outputs){const dest=path.join(dir,n);plain(dest);if(fs.existsSync(dest)&&!read(dest).equals(Buffer.from(value)))throw Error('资源文件有本地修改，未覆盖');}
    fs.mkdirSync(dir,{recursive:true,mode:0o700});if(!fs.existsSync(path.join(dir,'bundle.json')))fs.copyFileSync(file,path.join(dir,'bundle.json'),fs.constants.COPYFILE_EXCL);
    let toolID='';if(m.kind==='tool'){const result=await checked('tool_factory',{...b.tool,action:'register'});toolID=result.id;}
    for(const [n,value]of outputs){const dest=path.join(dir,n);fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.writeFileSync(dest,value,{flag:'wx'});}
    state.items[m.id]={manifest:m,directory:dir,toolID,previous:old?.manifest.version===m.version?old?.previous:old?{manifest:old.manifest,directory:old.directory,toolID:old.toolID}:null,installedAt:new Date().toISOString()};atomic(registryFile,state);return {ok:true,item:state.items[m.id],applied:false};
   }
   if(p.action==='center_apply'){
    consent(p);const item=current(p.id),m=item.manifest,b=bundle(read(path.join(item.directory,'bundle.json'),BUNDLE_MAX),m);if(m.kind!=='theme')throw Error('仅主题使用 apply；工具安装后直接调用，程序使用 open，提示词由 Agent 按用户要求选用');
    const old=await checked('settings',{action:'os_appearance_read'});if(p.expected_version!==old.version)throw Error('外观已变化，请读取最新版本后应用');
    const snapshot={...old.settings,theme_css:old.settings.theme_css||''},restoreFile=path.join(directory,'theme-restore.json');atomic(restoreFile,{previous:snapshot,applied:null});const result=await checked('settings',{action:'os_appearance_update',expected_version:old.version,patch:b.theme});atomic(restoreFile,{previous:snapshot,applied:result.version});return {...result,hotReload:true};
   }
   if(p.action==='center_restore_theme'){
    const saved=JSON.parse(read(path.join(directory,'theme-restore.json'))),old=await checked('settings',{action:'os_appearance_read'});if(old.version!==saved.applied)throw Error('应用主题后外观已有本地修改，请先合并');return checked('settings',{action:'os_appearance_update',expected_version:old.version,patch:saved.previous});
   }
   if(p.action==='center_open'){
    const registered=(await common()).find(r=>r.manifest.id===p.id);if(registered?.manifest.kind==='program')return modPackages.call({action:'mod_open',id:p.id});
    const item=current(p.id),m=item.manifest,b=bundle(read(path.join(item.directory,'bundle.json'),BUNDLE_MAX),m);if(m.kind!=='program')return {ok:true,kind:m.kind,directory:item.directory,tool_id:item.toolID,files:fs.readdirSync(item.directory).filter(n=>n!=='bundle.json')};
    throw Error('这个旧程序需要先转换为共同程序包；在已安装中选择以本地包迁移，原资料保留');
   }
   if(p.action==='center_remove'){
    const registered=(await common()).find(r=>r.manifest.id===p.id);if(registered?.manifest.kind==='program')throw Error('这个程序已由共同包服务管理；请先停用，再使用 mod_remove 卸载');
    const item=current(p.id);if(p.expected_sha256!==item.manifest.artifact.sha256)throw Error('资源版本已变化');// 工具版本被已保存的智能体引用时 Core 会保留它，这不该卡住卸载。
    const retained=[];for(const id of new Set([item.toolID,item.previous?.toolID].filter(Boolean))){const r=await core('tool_factory',{action:'remove',id}).catch(e=>({ok:false,error:e.message}));if(r?.ok===false)retained.push(id);}
    const state=registry();delete state.items[p.id];atomic(registryFile,state);return {ok:true,removed:p.id,filesRetained:true,...(retained.length?{toolsRetained:retained}:{})};
   }
   throw Error('不支持的本地资源操作');
  }finally{busy=false;}
 }
 return {call,close(){closed=true;}};
}
module.exports={createResources,bundle,manifest,name};
