// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; MAX_BYTES; digest; clean; bounded; createImageCodec; createImageLibrary
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/image-library.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const MAX_BYTES=32*1024*1024,MAX_PIXELS=32000000,MAX_ITEMS=4000;
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const clean=(v,n=200)=>String(v||'').replace(/[\x00-\x1f\x7f]/gu,' ').slice(0,n);
async function bounded(file,limit=MAX_BYTES){
 const f=await fs.open(file,'r');try{const s=await f.stat();if(!s.isFile()||s.size>limit)throw Error('图片文件过大或不可读');const data=Buffer.alloc(s.size+1);let at=0;while(at<data.length){const r=await f.read(data,at,data.length-at,null);if(!r.bytesRead)break;at+=r.bytesRead;}if(at!==s.size)throw Error('图片读取期间发生变化');return data.subarray(0,at);}finally{await f.close();}
}
function createImageCodec(nativeImage){
 return (data,{size=0,thumbnail=false}={})=>{
  // Inspect the common container dimensions before decoding potentially huge inputs.
  let width=0,height=0;
  if(data.length>=24&&data.subarray(1,4).toString()==='PNG'){width=data.readUInt32BE(16);height=data.readUInt32BE(20);}
  if(data.length>=10&&/^GIF8/.test(data.toString('ascii',0,4))){width=data.readUInt16LE(6);height=data.readUInt16LE(8);}
  if(width*height>MAX_PIXELS||width>16384||height>16384)throw Error('图片超过 3200 万像素，请先缩小');
  let image=nativeImage.createFromBuffer(data);if(image.isEmpty())throw Error('无法预览这种图片格式，可作为文件发送');
  ({width,height}=image.getSize());if(width<1||height<1||width*height>MAX_PIXELS||width>16384||height>16384)throw Error('图片尺寸超过限制');
  if(size&&Math.max(width,height)>size){const ratio=size/Math.max(width,height);image=image.resize({width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio)),quality:'best'});}
  const encoded=thumbnail?image.toJPEG(82):image.toPNG();
  return {width,height,data:encoded,mime:thumbnail?'image/jpeg':'image/png'};
 };
}
function createImageLibrary(config,{decode}={}){
 const profile=require('../../../Contracts/storage/profile.cjs'),relocate=value=>profile.relocate(config,value);
 const privatePath=require('../src/paths.cjs').privatePath,root=path.resolve(privatePath(config,'gallery')),assets=path.join(root,'assets'),stateFile=path.join(root,'library.json'),generated=path.resolve(privatePath(config,'generated_images'));
 let chain=Promise.resolve(),cache=new Map(),cacheBytes=0,generatedCache={stamp:null,items:[]};
 const serialize=fn=>{const p=chain.then(fn,fn);chain=p.catch(()=>{});return p;};
 async function state(){try{const s=JSON.parse((await bounded(stateFile,8*1024*1024)).toString('utf8'));if(s.version!==1||!Array.isArray(s.items)||!s.hidden||typeof s.hidden!=='object')throw Error('相册索引格式异常');if(!Array.isArray(s.folders))s.folders=[];if(!s.placed||typeof s.placed!=='object'||Array.isArray(s.placed))s.placed={};return s;}catch(e){if(e.code==='ENOENT')return {version:1,items:[],hidden:{},folders:[],placed:{}};throw e;}}
 async function save(s){await fs.mkdir(root,{recursive:true});const temp=stateFile+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(s),{flag:'wx',mode:0o600});await fs.rename(temp,stateFile);}finally{await fs.unlink(temp).catch(()=>{});}}
 async function within(file,base){
  const resolved=path.resolve(relocate(file)),rel=path.relative(base,resolved);if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('图片不属于相册');
  const st=await fs.lstat(resolved);if(!st.isFile()||st.isSymbolicLink())throw Error('图片文件已失效');
  const real=await fs.realpath(resolved),realBase=await fs.realpath(base),r=path.relative(realBase,real);if(!r||r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r))throw Error('图片位置已变化');return resolved;
 }
 async function generatedItems(){
  const legacy=path.join(generated,'index.json'),entries=path.join(generated,'entries');
  const stat=async p=>{try{const s=await fs.stat(p);return [s.mtimeMs,s.size];}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const stamp=JSON.stringify(await Promise.all([stat(legacy),stat(entries)]));
  if(stamp===generatedCache.stamp)return generatedCache.items;
  const items=[];
  try{const j=JSON.parse((await bounded(legacy,8*1024*1024)).toString('utf8'));if(j.version!==1||!Array.isArray(j.images))throw Error('生成图片索引格式异常');items.push(...j.images);}catch(e){if(e.code!=='ENOENT')throw e;}
  let files=[];try{files=await fs.readdir(entries,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  // Bounded IO concurrency; metadata is immutable and cached until the directory changes.
  const pending=files.filter(f=>f.isFile()&&/^[a-f0-9]{64}\.json$/u.test(f.name));let cursor=0;
  await Promise.all(Array.from({length:Math.min(8,pending.length)},async()=>{while(cursor<pending.length){const f=pending[cursor++],x=JSON.parse((await bounded(path.join(entries,f.name),256*1024)).toString('utf8'));if(x.id+'.json'!==f.name)throw Error('生成图片元数据身份异常');items.push(x);}}));
  const mapped=items.filter(x=>x&&typeof x.path==='string'&&/^[a-f0-9]{64}$/u.test(x.id||x.sha256||path.basename(x.path).split('.')[0])).map(x=>({id:x.id||x.sha256||path.basename(x.path).split('.')[0],path:path.isAbsolute(x.path)?x.path:path.join(generated,x.path),name:clean(x.name||x.title||((x.operation==='edit'?'编辑图片':'生成图片')+(x.model?' · '+x.model:'')+(x.created_at?' · '+String(x.created_at).slice(0,19).replaceAll(':','-').replace('T',' '):''))),mime:x.mime||'image/png',width:x.width,height:x.height,created_at:x.created_at,model:clean(x.model),prompt:clean(x.prompt,24000),operation:x.operation==='edit'?'edit':'generate',source:'generated',source_paths:Array.isArray(x.source_paths)?x.source_paths:[],sha256:x.sha256||path.basename(x.path).split('.')[0]}));
  generatedCache={stamp,items:mapped};return mapped;
 }
 async function items(s){s=s||await state();const all=new Map(),folders=new Set(s.folders.map(f=>f.id));for(const x of [...s.items,...await generatedItems()])if(x&&/^[a-f0-9]{64}$/u.test(x.id))all.set(x.id,{...x,hidden:!!s.hidden[x.id],folder:folders.has(s.placed[x.id])?s.placed[x.id]:''});return [...all.values()].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));}
 // folder: undefined lists everything, '' the loose images, an id one folder.
 async function list({query='',source='',removed=false,offset=0,limit=60,folder}={}){
  const s=await state(),all=await items(s),q=clean(query).toLocaleLowerCase(),filtered=all.filter(x=>x.hidden===!!removed&&(!source||x.source===source)&&(folder===undefined||folder===null||x.folder===folder)&&(!q||[x.name,x.model,x.prompt].join(' ').toLocaleLowerCase().includes(q)));
  offset=Math.max(0,Math.trunc(Number(offset)||0));limit=Math.min(100,Math.max(1,Math.trunc(Number(limit)||60)));
  const shown=all.filter(x=>!x.hidden),made=shown.filter(x=>x.source==='generated');
  const folders=s.folders.map(f=>({id:f.id,name:f.name,created_at:f.created_at,count:shown.filter(x=>x.folder===f.id).length,cover:shown.find(x=>x.folder===f.id)?.id||''}));
  return {ok:true,items:filtered.slice(offset,offset+limit).map(({path:_,source_paths:__,...x})=>x),total:filtered.length,count:shown.length,generated:made.length,generated_latest:made[0]?.created_at||'',folders,next_offset:offset+limit<filtered.length?offset+limit:null};
 }
 const folderName=name=>{const n=clean(name,60).trim();if(!n)throw Error('请填写文件夹名字');return n;};
 const known=(s,id)=>{const f=s.folders.find(f=>f.id===id);if(!f)throw Error('文件夹已不存在');return f;};
 async function createFolder(name){return serialize(async()=>{const s=await state();if(s.folders.length>=200)throw Error('最多 200 个文件夹');const f={id:crypto.randomUUID(),name:folderName(name),created_at:new Date().toISOString()};s.folders.push(f);await save(s);return {ok:true,folder:f};});}
 async function renameFolder(id,name){return serialize(async()=>{const s=await state();known(s,id).name=folderName(name);await save(s);return {ok:true};});}
 // Deleting a folder never deletes images: they go back to the loose list.
 async function deleteFolder(id){return serialize(async()=>{const s=await state();known(s,id);s.folders=s.folders.filter(f=>f.id!==id);for(const [k,v] of Object.entries(s.placed))if(v===id)delete s.placed[k];await save(s);return {ok:true};});}
 async function move(ids,folder){if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!/^[a-f0-9]{64}$/u.test(id)))throw Error('每次请选择 1–100 张图片');return serialize(async()=>{const s=await state();if(folder)known(s,folder);const have=new Set((await items(s)).map(x=>x.id));for(const id of ids){if(!have.has(id))throw Error('图片已不在相册');if(folder)s.placed[id]=folder;else delete s.placed[id];}await save(s);return {ok:true};});}
 async function folderItems(id){const s=await state();known(s,id);return (await items(s)).filter(x=>!x.hidden&&x.folder===id).map(x=>x.id);}
 async function resolve(id){if(!/^[a-f0-9]{64}$/u.test(id||''))throw Error('图片标识无效');const item=(await items()).find(x=>x.id===id);if(!item)throw Error('图片不在相册中');const file=await within(item.path,item.source==='generated'?generated:assets);return {...item,path:file};}
 async function previewFile(file,{size=1600,thumbnail=false,sha256}={}){
  size=thumbnail?Math.min(512,Math.max(80,Number(size)||256)):Math.min(8192,Math.max(320,Number(size)||1600));
  file=relocate(file);
  const st=await fs.stat(file),key=[file,st.size,st.mtimeMs,size,thumbnail,sha256].join('|');
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
  const bytes=await bounded(file);if(sha256&&digest(bytes)!==sha256)throw Error('图片内容已变化，请保留原始文件');
  const image=decode(bytes,{size,thumbnail}),out={ok:true,width:image.width,height:image.height,mime:image.mime,data:'data:'+image.mime+';base64,'+image.data.toString('base64')};
  if(out.data.length<2*1024*1024){while(cache.size&&cacheBytes+out.data.length>12*1024*1024){const k=cache.keys().next().value;cacheBytes-=cache.get(k).data.length;cache.delete(k);}cache.set(key,out);cacheBytes+=out.data.length;}
  return out;
 }
 async function preview(id,options){const x=await resolve(id);return previewFile(x.path,{...options,sha256:x.sha256});}
 async function importFiles(entries){return serialize(async()=>{
  const s=await state(),added=[];await fs.mkdir(assets,{recursive:true});
  for(const a of entries){if(a.kind!=='image')continue;const data=await bounded(relocate(a.asset));if(digest(data)!==a.sha256)throw Error('附件图片已变化');const image=decode(data,{size:64,thumbnail:true});
   const extension=({'image/png':'png','image/jpeg':'jpg','image/gif':'gif'})[a.mime];if(!extension)continue;
   const file=path.join(assets,a.sha256+'.'+extension);try{await fs.writeFile(file,data,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;if(digest(await bounded(file))!==a.sha256)throw Error('相册原图损坏');}
   let x=s.items.find(x=>x.id===a.sha256);if(!x){if(s.items.length>=MAX_ITEMS)throw Error('相册已达 4000 张，请先导出整理');x={id:a.sha256,sha256:a.sha256,path:file,name:clean(a.name),mime:a.mime,width:image.width,height:image.height,created_at:new Date().toISOString(),source:'imported',operation:'import'};s.items.push(x);}delete s.hidden[x.id];added.push(x.id);
  }await save(s);return added;
 });}
 async function setHidden(ids,hidden){if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!/^[a-f0-9]{64}$/u.test(id)))throw Error('每次请选择 1–100 张图片');return serialize(async()=>{const s=await state(),known=new Set((await items()).map(x=>x.id));for(const id of ids){if(!known.has(id))throw Error('图片已不在相册');if(hidden)s.hidden[id]=true;else delete s.hidden[id];}await save(s);return {ok:true};});}
 const owned=fn=>async(...args)=>{const release=profile.enter(config);try{return await fn(...args);}finally{release();}};
 return Object.fromEntries(Object.entries({list,resolve,preview,previewFile,importFiles,setHidden,createFolder,renameFolder,deleteFolder,move,folderItems}).map(([key,fn])=>[key,owned(fn)]));
}
module.exports={createImageLibrary,createImageCodec,bounded};
