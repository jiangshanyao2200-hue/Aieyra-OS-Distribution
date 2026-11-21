// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; FILE_LIMIT; imageMime; validateSelection; createAttachmentStore
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/attachments.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const FILE_LIMIT=32*1024*1024,TOTAL_LIMIT=64*1024*1024,COUNT_LIMIT=10;
function imageMime(data){
 if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(data[0]===255&&data[1]===216&&data[2]===255)return 'image/jpeg';
 if(['GIF87a','GIF89a'].includes(data.subarray(0,6).toString('ascii')))return 'image/gif';
 return '';
}
function validateSelection(entries){
 if(!Array.isArray(entries)||entries.length>COUNT_LIMIT)throw Error('每条消息最多添加 10 个附件。');
 let total=0,images=0;
 for(const a of entries){
  if(a?.web_reference&&(!a.web_reference.id||typeof a.web_reference.text!=='string'||Buffer.byteLength(JSON.stringify(a.web_reference))>60000))throw Error('网页引用快照无效。');
  if(!a||typeof a.name!=='string'||!a.name||a.name.length>255||/[\x00-\x1f\x7f/\\]/u.test(a.name)||!/^[a-f0-9]{64}$/u.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<0||a.bytes>FILE_LIMIT||!['file','image'].includes(a.kind)||typeof a.asset!=='string')throw Error('附件记录不完整，请移除后重新添加。');
  total+=a.bytes;if(a.kind==='image'){if(!['image/png','image/jpeg','image/gif'].includes(a.mime)||a.bytes>8*1024*1024)throw Error('图片只支持 8 MiB 以内的 PNG、JPEG 或 GIF。');images+=a.bytes;}
  else if(a.mime!=='application/octet-stream')throw Error('附件类型无效，请重新添加。');
 }
 if(total>TOTAL_LIMIT||images>24*1024*1024)throw Error('附件合计最多 64 MiB，其中图片最多 24 MiB。');
 return entries;
}
function createAttachmentStore(config,{managed=false,owner,decodeImage}={}){
 const base=path.resolve(require('../src/paths.cjs').privatePath(config,'attachments')),root=managed?path.join(base,'v2'):base;
 const {createAttachmentReferences,ordinaryDirectory}=require('./attachment-references.cjs');
 const references=managed?createAttachmentReferences(config,owner):null;
 async function readBounded(file){
  const handle=await fs.open(file,'r');
  try{
   const stat=await handle.stat();if(!stat.isFile())throw Error('暂不支持文件夹，请添加普通文件。');if(stat.size>FILE_LIMIT)throw Error('请选择不超过 32 MiB 的普通文件。');
   const data=Buffer.alloc(stat.size+1);let length=0;
   while(length<data.length){const {bytesRead}=await handle.read(data,length,data.length-length,null);if(!bytesRead)break;length+=bytesRead;}
   if(length!==stat.size)throw Error('文件在读取期间发生变化，请重新添加。');
   return data.subarray(0,length);
  }finally{await handle.close();}
 }
 async function storeData(name,data){
   let mime=imageMime(data),imageUnavailable=false,sourceName='';
   if(!mime&&/\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif|avif|tiff?)$/iu.test(name)){
    if(!decodeImage||/\.(png|jpe?g|gif)$/iu.test(name))throw Error('图片只支持有效的 PNG、JPEG 或 GIF，请转换后添加。');
    if(/\.(svg|heic|heif)$/iu.test(name))imageUnavailable=true;
    else {try{const converted=decodeImage(data);sourceName=name;data=converted.data;mime='image/png';name=path.parse(name).name+'.png';}catch{imageUnavailable=true;}}
   }
   const sha256=crypto.createHash('sha256').update(data).digest('hex'),asset=path.join(root,sha256),entry={name,asset,sha256,bytes:data.length,kind:mime?'image':'file',mime:mime||'application/octet-stream'};
   if(imageUnavailable)entry.preview_unavailable=true;
   if(sourceName)entry.source_name=sourceName;
   validateSelection([entry]);
   await ordinaryDirectory(root);let created=false;const temp=path.join(root,'.stage-'+crypto.randomUUID()+'.tmp');
   try{const f=await fs.open(temp,'wx',0o600);try{await f.writeFile(data);await f.sync();}finally{await f.close();}await fs.link(temp,asset);created=true;}
   catch(error){if(error.code!=='EEXIST')throw error;const stat=await fs.lstat(asset);if(!stat.isFile()||stat.isSymbolicLink()||!(await readBounded(asset)).equals(data))throw Error('已有附件快照损坏，请保留证据后处理。');}
   finally{await fs.unlink(temp).catch(()=>{});}
   if(managed&&created){const f=await fs.open(asset+'.json','wx',0o600);try{await f.writeFile(JSON.stringify({version:2,sha256,bytes:data.length}));await f.sync();}finally{await f.close();}}
   return entry;
 }
 async function stage(files){
  if(!Array.isArray(files)||files.length>COUNT_LIMIT||files.some(f=>typeof f!=='string'||!path.isAbsolute(f)))throw Error('每次最多添加 10 个本地文件。');
  const entries=[];
  for(const file of files){
   const data=await readBounded(file),entry=await storeData(path.basename(file),data);
   validateSelection([...entries,entry]);entries.push(entry);
  }
  return entries;
 }
 async function stageBytes({name,bytes}={}){
  // Check before copying an IPC payload; arbitrary text is never accepted as
  // an image. CORE performs the full image/dimensions check again on send.
  if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>8*1024*1024)throw Error('截图或图片最多 8 MiB。');
  const data=Buffer.from(bytes);if(!imageMime(data))throw Error('图片只支持有效的 PNG、JPEG 或 GIF。');
  return [await storeData(name,data)];
 }
 async function stageFileBytes({name,bytes}={}){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>FILE_LIMIT)throw Error('每个文件最多 32 MiB。');
  return [await storeData(name,Buffer.from(bytes))];
 }
 async function readVerified(a){
   validateSelection([a]);
   const asset=require('../../../Contracts/storage/profile.cjs').relocate(config,a.asset);
   const ownRoot=path.resolve(asset)===path.join(base,'v2',a.sha256)?path.join(base,'v2'):base;
   if(path.resolve(asset)!==path.join(ownRoot,a.sha256))throw Error('附件不属于当前配置。');
   const stat=await fs.lstat(asset);if(!stat.isFile()||stat.isSymbolicLink())throw Error('附件快照已失效。');
   if(await fs.realpath(asset)!==path.join(await fs.realpath(ownRoot),a.sha256))throw Error('附件快照路径已变化。');
   const data=await readBounded(asset);
   if(data.length!==a.bytes||crypto.createHash('sha256').update(data).digest('hex')!==a.sha256||Boolean(imageMime(data))!==(a.kind==='image')||(a.kind==='image'&&imageMime(data)!==a.mime))throw Error('附件快照发生变化，待发送消息已保留。');
   return data;
 }
 async function verify(entries=[]){
  validateSelection(entries);
  for(const a of entries)await readVerified(a);
  return entries.map(a=>({...a}));
 }
 const keep=load=>references?references.stage(load):load().then(attachments=>({attachments}));
 async function chooseBatch(files){
  if(!Array.isArray(files)||files.length>COUNT_LIMIT)throw Error('每次最多添加 10 个本地文件。');
  const attachments=[],receipts=[],warnings=[];
  for(const file of files){try{const r=await keep(()=>stage([file]));attachments.push(...r.attachments);if(r.receipt)receipts.push(r.receipt);}catch(e){warnings.push(path.basename(String(file))+': '+e.message);}}
  return {attachments,receipts,warnings};
 }
 const owned=fn=>async(...args)=>{const release=require('../../../Contracts/storage/profile.cjs').enter(config);try{return await fn(...args);}finally{release();}};
 return {stage:owned(stage),stageBytes:owned(stageBytes),stageFileBytes:owned(stageFileBytes),verify:owned(verify),readVerified:owned(readVerified),choose:owned(files=>keep(()=>stage(files))),chooseBatch:owned(chooseBatch),chooseBytes:owned(payload=>keep(()=>stageBytes(payload))),chooseFileBytes:owned(payload=>keep(()=>stageFileBytes(payload))),references};
}
module.exports={createAttachmentStore,validateSelection};
