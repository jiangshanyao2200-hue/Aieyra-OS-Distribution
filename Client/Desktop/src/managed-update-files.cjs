// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; path; hash; BOOTSTRAP; LEGACY_BOOTSTRAP; protectedName; moduleExecutables; spreadsheetTheme; promptSidecar; moduleLayout; moduleSource; developmentLayout; developmentDocuments; protectedPath; publicConfig; promptResource; mediaResource; safeName; plainPath; fileHash; read; validateFiles; expandBootstrap; verifySigned; inventory; fileIdentity; inventoryAsync; sourceNames; same; compare; atomicJSON; requireSpace
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/managed-update-files.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Signed ASAR payloads are regular files on disk, even inside Electron.
const fs=process.versions.electron?require('original-fs'):require('node:fs');
const path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const BOOTSTRAP=Object.freeze({
 'Client/Desktop/update-bootstrap/cli.exe':'Aieyra CLI.exe',
 'Client/Desktop/update-bootstrap/LICENSE':'LICENSE',
 'Client/Desktop/update-bootstrap/create-launchers.ps1':'scripts/create-launchers.ps1',
 'Client/Desktop/update-bootstrap/CLI-README.md':'scripts/CLI-README.md'
});
// Read the original signed inventory after a full-package layout migration.
// New packages only produce BOOTSTRAP; legacy mappings grant no new targets.
const LEGACY_BOOTSTRAP=Object.freeze(Object.fromEntries(Object.entries(BOOTSTRAP).map(([source,destination])=>[source.replace(/^Client\//,''),destination])));
const protectedName=/(^|\/)(?:\.git|\.env(?:\..*)?|config\.json|auth\.json|companion-profile\.json|workspace-desktop|\.aieyra-updates|sessions|memory|Data)(\/|$)|\.(?:sqlite(?:3)?|db)(?:-(?:wal|shm|journal))?$/i;
const moduleExecutables=new Set(Object.values(require('../host/module-launchers.json')).map(name=>name+'.exe'));
const spreadsheetTheme='Program/official/workspace/node_modules/exceljs/lib/doc/data/theme1.json';
const {toolManualSidecar}=require('../../../Contracts/resources/prompts.cjs');
const promptSidecar=name=>toolManualSidecar(name)||/(?:^|\/)prompts\/.*\.(?:backup\.[a-f0-9]{64}|tmp\.[^/]+|write-lock|restore\.json)$/.test(name);
const moduleLayout=require('../../../Contracts/product-layout.json');
const moduleSource=name=>moduleLayout.source_files.includes(name)||moduleLayout.source_trees.some(tree=>name.startsWith(tree+'/'));
const developmentLayout=require('../../../Contracts/development-documents.json');
const developmentDocuments=new Set([...developmentLayout.documents,...Object.keys(developmentLayout.templates)]);
// Special names are allowed only at their declared product locations. Never
// grant a nested private directory access because an ancestor is product code.
function protectedPath(name,directory=false){
 if(name!==spreadsheetTheme&&protectedName.test(name))return true;
 const parts=name.split('/');
 return parts.some((part,index)=>{
  const lower=part.toLowerCase(),prefix=parts.slice(0,index+1).join('/');
  if(lower==='history')return prefix!=='Agent/context/history'||!moduleLayout.source_trees.includes(prefix);
  if(lower==='cloud')return !developmentDocuments.has(name)&&!(prefix==='Link/cloud'&&(moduleLayout.source_files.includes(name)||directory&&moduleLayout.source_files.some(file=>file.startsWith(name+'/'))));
  if(lower==='docs'||lower==='aidebug')return !developmentDocuments.has(name);
  return false;
 });
}
const publicConfig=new Set(['默认设置.json','模型目录.json','模型资料.json','OpenCode模型.json','终端配色.json','提示词索引.json','运行参数.json','official-baseline.json','release.pub.pem','release.json']);
const promptResource=name=>/^Prompt\/(?:Matrix\/(?:默认|运行协定|工具说明|辅助指令|记忆|连接检测|问候)\/.+\.txt|(?:Vaya|Cota|Nova|莹|潜意识)\/(?:[^/]+\/)*[^/]+\.txt|子代\/模板\/(?:提示词|Eyra会话|对话|看图|工作|群聊|群主持|群工具|附件未观察)\.txt)$/.test(name);
const mediaResource=/^(?:runtime\/media\/(?:runtime-manifest\.json|README\.txt|LICENSE|ffprobe\.exe|ffmpeg\.exe)|scripts\/(?:provision-media\.py|media-runtime\.lock\.json))$/;
function safeName(value){
 if(typeof value==='string'&&mediaResource.test(value))return value;
 if(typeof value!=='string'||!value||value.length>512||/[\\:\x00-\x1f]/.test(value)||value.startsWith('/')||protectedPath(value)||promptSidecar(value)||value.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('更新文件路径无效或属于个人数据');
 if(!(value.startsWith('Config/')&&publicConfig.has(value.slice(7)))&&!promptResource(value)&&!moduleSource(value)&&!developmentDocuments.has(value)&&!moduleExecutables.has(value)&&!/^(Core\/|Desktop\/|Client\/Desktop\/|Aieyra (?:OS|CLI)\.exe$|README\.md$|LICENSE$|Control\/app\/(?:service\/|web\/|scripts\/|runtime\/python\/|config\/release-public\.pem$|LICENSE$)|Link\/app\/(?:link-core\/|runtime\/link\/aieyra-link\.exe$|LICENSE$)|runtime\/search\/|scripts\/(?:build\-provenance\.py|development\-docs\.py|build\-cli\.py|build\-linux\.py|build\-macos\.py|build\-module\-launchers\.ps1|check\-modules\.py|CLI\-README\.md|create\-launchers\.ps1|sync\-cli\-entry\.ps1|create\-module\-shortcuts\.ps1|export\-source\.py|install\-cli\.sh|install\-linux\.sh|link_product\.py|LINUX\-README\.md|package\-link\.py|package\-release\.py|plugins\.py|PLUGINS\.md|provision\-search\.py|public\-privacy\-policy\.json|public\-privacy\.py|PUBLIC\-README\.md|release\-metadata\.json|resources\.py|runtime\-files\.py|search\-runtime\.lock\.json|sign\-link\.cjs|smoke\-macos\.cjs|update\-model\-reference\.py|winres\.py)$)/.test(value))throw Error('更新路径不属于产品');return value;
}
function plainPath(root,name,missing=false){
 safeName(name);root=path.resolve(root);let current=root;
 if(fs.lstatSync(root).isSymbolicLink())throw Error('更新根目录不能是链接');
 for(const part of name.split('/')){current=path.join(current,part);try{const st=fs.lstatSync(current);if(st.isSymbolicLink()||st.isFile()&&st.nlink>1)throw Error('更新文件不能通过链接读写');}catch(e){if(e.code==='ENOENT'&&missing)return path.join(root,...name.split('/'));throw e;}}
 return current;
}
function fileHash(file){const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),b=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
function read(file,maximum=32*1024*1024){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink>1||st.size>maximum)throw Error('文件类型或大小不支持');return fs.readFileSync(file);}
function validateFiles(files){
 if(!files||typeof files!=='object'||Array.isArray(files)||Object.keys(files).length>10000)throw Error('文件清单无效');const seen=new Set();
 for(const [name,value]of Object.entries(files)){safeName(name);const lower=name.toLowerCase();if(seen.has(lower))throw Error('更新文件大小写冲突');seen.add(lower);if(!value||!/^[a-f0-9]{64}$/.test(value.sha256)||!Number.isSafeInteger(value.size)||value.size<0||value.size>1024**3)throw Error('文件摘要无效');}
 for(const name of seen){const parts=name.split('/');while(parts.length>1){parts.pop();if(seen.has(parts.join('/')))throw Error('更新文件与目录冲突');}}
 return files;
}
function expandBootstrap(p){
 if(p.bootstrap===undefined)return p;
 if(!Array.isArray(p.bootstrap)||p.bootstrap.length!==Object.keys(BOOTSTRAP).length)throw Error('启动补全清单无效');
 const seen=new Set(),files={...p.files},texts={...p.texts};
 for(const row of p.bootstrap){
  const destination=row&&(Object.hasOwn(BOOTSTRAP,row.source)?BOOTSTRAP[row.source]:Object.hasOwn(LEGACY_BOOTSTRAP,row.source)?LEGACY_BOOTSTRAP[row.source]:null);
  if(!row||!destination||destination!==row.destination||seen.has(row.destination)||Object.hasOwn(p.files,row.destination)||Object.keys(p.files).some(n=>n.toLowerCase()===row.destination.toLowerCase())||!same(row,p.files[row.source]))throw Error('启动补全映射或摘要无效');
  seen.add(row.destination);files[row.destination]={sha256:row.sha256,size:row.size};
  if(Object.hasOwn(texts,row.destination))throw Error('启动补全文本存在冲突');
  if(typeof texts[row.source]==='string'){
   if(Buffer.byteLength(texts[row.source])!==row.size||hash(Buffer.from(texts[row.source]))!==row.sha256)throw Error('启动补全文本摘要无效');
   texts[row.destination]=texts[row.source];
  }
 }
 validateFiles(files);return {...p,files,texts};
}
function verifySigned(envelope,key,kind){
 if(envelope?.algorithm!=='Ed25519'||typeof envelope.payload!=='string'||envelope.payload.length>24*1024*1024||typeof envelope.signature!=='string')throw Error('缺少签名发布信息');
 const data=Buffer.from(envelope.payload,'base64'),signature=Buffer.from(envelope.signature,'base64');if(data.toString('base64')!==envelope.payload||signature.length!==64||signature.toString('base64')!==envelope.signature||!crypto.verify(null,data,key,signature))throw Error('官方签名验证失败');const p=JSON.parse(data);
 if(p.product!=='aieyra-os'||!Number.isSafeInteger(p.sequence)||p.sequence<1||!/^\d+\.\d+\.\d+$/.test(p.version))throw Error('发布身份不正确');
 if(kind==='baseline'){if(p.schema!=='aieyra-os-baseline-v1')throw Error('基线结构不兼容');validateFiles(p.files);return expandBootstrap(p);}
 else {if(p.channel!=='stable'||!Array.isArray(p.artifacts)||!p.artifacts.length||p.artifacts.length>12||!/^[a-z0-9][a-z0-9.-]{0,99}$/.test(p.id)||!Number.isFinite(Date.parse(p.publishedAt)))throw Error('发布清单无效');const names=new Set();for(const a of p.artifacts){if(!a||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(a.name)||names.has(a.name.toLowerCase())||!Number.isSafeInteger(a.size)||a.size<1||a.size>2**31||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('下载清单无效');names.add(a.name.toLowerCase());}}
 if(p.sourceCommit!==undefined&&(typeof p.sourceCommit!=='string'||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(p.sourceCommit)))throw Error('发布源码编号无效');
 return p;
}
function inventory(root,names){
 const files={};for(const name of [...new Set(names)].sort()){try{const file=plainPath(root,name),st=fs.statSync(file);if(!st.isFile())throw Error('文件被目录替换');files[name]={sha256:fileHash(file),size:st.size};}catch(e){if(e.code!=='ENOENT')throw e;}}
 return files;
}

const fileIdentity=st=>[st.dev,st.ino,st.size,st.mtimeNs,st.ctimeNs].join(':');

async function inventoryAsync(root,names,{cache,fresh=false,signal}={}){
 root=path.resolve(root);
 const paths=[...new Set(names)].sort(),results=new Array(paths.length),parents=new Map();
 const {lstat,open}=fs.promises;
 function checkDirectory(dir){
  if(!parents.has(dir))parents.set(dir,(async()=>{
   if(dir!==root)await checkDirectory(path.dirname(dir));
   const stat=await lstat(dir);
   if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('更新目录不能是链接或普通文件');
  })());
  return parents.get(dir);
 }
 async function identify(name){
  safeName(name);
  signal?.throwIfAborted();
  const file=path.join(root,...name.split('/'));
  try{
   await checkDirectory(path.dirname(file));
   const stat=await lstat(file,{bigint:true});
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1n)throw Error('更新目标须为没有链接的普通文件：'+name);
   const identity=fileIdentity(stat),saved=cache?.get(file);
   if(!fresh&&stat.ino!==0n&&saved?.identity===identity)return saved.meta;
   const handle=await open(file,'r');
   try{
    const opened=await handle.stat({bigint:true});
    if(!opened.isFile()||opened.nlink>1n||fileIdentity(opened)!==identity)throw Error('核对期间文件已变化：'+name);
    const digest=crypto.createHash('sha256');
    const stream=handle.createReadStream({autoClose:false,highWaterMark:1024*1024,...(signal?{signal}:{})});
    for await(const data of stream)digest.update(data);
    const after=await lstat(file,{bigint:true});
    if(!after.isFile()||after.nlink>1n||fileIdentity(after)!==identity)throw Error('核对期间文件已变化：'+name);
    const meta={sha256:digest.digest('hex'),size:Number(stat.size)};
    if(cache&&stat.ino!==0n)cache.set(file,{identity,meta});
    return meta;
   }finally{await handle.close();}
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 let index=0;
 const scan=async()=>{while(index<paths.length){const at=index++;results[at]=await identify(paths[at]);}};
 const workers=await Promise.allSettled([scan(),scan()]);
 const failed=workers.find(result=>result.status==='rejected');
 if(failed)throw failed.reason;
 return Object.fromEntries(paths.flatMap((name,at)=>results[at]?[[name,results[at]]]:[]));
}
function sourceNames(root){
 const names=[];for(const prefix of new Set(['Core','Control/app/service','Control/app/web','Control/app/scripts','Link/app/link-core',...moduleLayout.source_trees])){
  const visit=(dir)=>{if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),name=path.relative(root,file).split(path.sep).join('/');if(entry.isSymbolicLink())throw Error('产品目录内发现链接');if(protectedPath(name,entry.isDirectory())||promptSidecar(name)||name==='Config/official-baseline.json'||name.startsWith('Client/Desktop/node_modules/'))continue;if(entry.isDirectory())visit(file);else{safeName(name);names.push(name);}}};visit(path.join(root,prefix));
 }for(const name of moduleLayout.source_files)if(fs.existsSync(path.join(root,name))){safeName(name);names.push(name);}return names;
}
function same(a,b){return a?.sha256===b?.sha256&&a?.size===b?.size;}
function compare(base,local,incoming){return [...new Set([...Object.keys(base),...Object.keys(local),...Object.keys(incoming)])].sort().map(name=>{safeName(name);const b=base[name],l=local[name],n=incoming[name];return {name,base:b||null,local:l||null,incoming:n||null,choice:same(l,n)?'local':same(l,b)?'incoming':same(n,b)?'local':'conflict'};});}
function atomicJSON(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
// Reserve space before downloads, expansion and replacement backups. A later
// disk change can still fail a write; the existing journal owns that recovery.
function requireSpace(directory,bytes){
 if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('更新空间预算无效');
 let existing=path.resolve(directory);
 while(!fs.existsSync(existing)){const parent=path.dirname(existing);if(parent===existing)throw Error('无法找到更新磁盘');existing=parent;}
 let stats;try{stats=fs.statfsSync(existing,{bigint:true});}catch{throw Error('无法核对更新所需磁盘空间');}
 const available=BigInt(stats.bavail)*BigInt(stats.bsize),required=BigInt(bytes)+64n*1024n*1024n;
 if(available<required)throw Error('磁盘空间不足，请释放空间后继续原更新；当前程序和审阅记录已保留');
}
module.exports={diskFS:fs,BOOTSTRAP,hash,safeName,plainPath,fileHash,read,validateFiles,verifySigned,inventory,inventoryAsync,sourceNames,same,compare,atomicJSON,requireSpace};
