// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; LIMIT; failure; createProjectFiles
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/project-files.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Filesystem capability injected into Coding. The caller supplies Core's bound
// project; the renderer supplies only a relative path and an observed version.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const LIMIT=1024*1024,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const failure=(code,message)=>Object.assign(Error(message),{code});
function createProjectFiles({dataRoot}){
 function resolve(root,relative='',directory=false){
  if(typeof root!=='string'||!path.isAbsolute(root))throw failure('project_missing','当前项目尚未就绪');
  if(typeof relative!=='string'||relative.includes('\0')||relative.includes(':')||path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))throw failure('project_path','文件不在当前项目内');
  const base=fs.realpathSync(root);if(fs.lstatSync(root).isSymbolicLink())throw failure('project_link','项目链接不能直接编辑');
  const parts=relative.split(/[\\/]/).filter(p=>p&&p!=='.');let file=base;
  for(const part of parts){file=path.join(file,part);if(fs.lstatSync(file).isSymbolicLink())throw failure('project_link','链接文件请从真实项目打开');}
  const stat=fs.statSync(file);if(directory?!stat.isDirectory():!stat.isFile())throw failure('project_kind',directory?'目录不可用':'请选择文本文件');
  if(!directory&&stat.nlink!==1)throw failure('project_link','关联文件仅能在原位置处理');
  return {file,base,relative:parts.join('/'),stat};
 }
 function textFile(root,relative){
  const f=resolve(root,relative);if(f.stat.size>LIMIT)throw failure('project_large','文件较大，请在外部编辑器查看');
  const raw=fs.readFileSync(f.file);if(raw.length>LIMIT||raw.includes(0))throw failure('project_binary','此文件不能作为文本编辑');
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}catch{throw failure('project_encoding','当前仅支持 UTF-8 文本，原文件保持不变');}
  const after=fs.statSync(f.file);if(after.mtimeMs!==f.stat.mtimeMs||after.size!==f.stat.size||after.ino!==f.stat.ino)throw failure('project_changed','文件正在变化，请重试');
  return {...f,text,version:hash(raw)+':'+after.mtimeMs+':'+after.ino};
 }
 const folder=(root,relative)=>path.join(dataRoot,'versions',hash(root),hash(relative));
 function remember(f,origin){
  const dir=folder(f.base,f.relative);fs.mkdirSync(dir,{recursive:true});const index=path.join(dir,'index.json');
  let rows=[];try{rows=JSON.parse(fs.readFileSync(index,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(rows.at(-1)?.version===f.version)return rows;
  const id=hash(f.version),record={id,version:f.version,at:new Date().toISOString(),source:origin?.source||'observed',member:origin?.member||'',call_id:origin?.call_id||'',generation:origin?.generation||0,receipt_version:origin?.receipt_version||''};
  const content=path.join(dir,id+'.txt');if(!fs.existsSync(content))fs.writeFileSync(content,f.text,{flag:'wx'});
  rows.push(record);const obsolete=rows.splice(0,Math.max(0,rows.length-100)),temp=index+'.'+crypto.randomUUID();
  try{fs.writeFileSync(temp,JSON.stringify(rows),{flag:'wx'});fs.renameSync(temp,index);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  for(const row of obsolete)try{fs.unlinkSync(path.join(dir,row.id+'.txt'));}catch{}
  return rows;
 }
 const draftPath=f=>path.join(folder(f.base,f.relative),'draft.json');
 const draftOf=f=>{try{return JSON.parse(fs.readFileSync(draftPath(f),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const view=(f,origin)=>({path:f.relative,text:f.text,version:f.version,draft:draftOf(f),history:remember(f,origin).map(({version,...row})=>row)});
 return {
  create(selected){
   if(typeof selected!=='string'||!path.isAbsolute(selected)||selected.includes('\0'))throw failure('project_path','请选择新项目的位置');
   const parent=resolve(path.dirname(selected),'',true).base,name=path.basename(selected);
   if(!name||name==='.'||name==='..'||/[<>:"|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name))throw failure('project_name','项目名称无效');
   const target=path.join(parent,name);
   try{fs.mkdirSync(target);}catch(error){if(error.code==='EEXIST')throw failure('project_exists','该位置已存在，请使用打开项目');throw error;}
   return {root:target,path:''};
  },
  selection(root,selected,kind){
   if(typeof selected!=='string'||!path.isAbsolute(selected))throw failure('project_path','请选择本地项目或文件');
   if(kind==='directory')return {root:resolve(selected,'',true).base,path:''};
   // Validate the file before committing a new workspace. Reuse the same
   // link, encoding and size checks as ordinary project reads.
   let base=path.dirname(selected);
   if(root){try{const current=fs.realpathSync(root),rel=path.relative(current,selected);if(rel&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep))base=current;}catch{}}
   const file=textFile(base,path.relative(base,selected));return {root:file.base,path:file.relative};
  },
  list(root,relative=''){
   const f=resolve(root,relative,true),entries=fs.readdirSync(f.file,{withFileTypes:true}).filter(e=>!['.git','node_modules','.cache'].includes(e.name));
   entries.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));
   return {path:f.relative,name:path.basename(f.base),entries:entries.slice(0,500).map(e=>({name:e.name,path:[f.relative,e.name].filter(Boolean).join('/'),directory:e.isDirectory(),link:e.isSymbolicLink()})),truncated:entries.length>500};
  },
  read:(root,relative,origin)=>view(textFile(root,relative),origin),
  observe(root,relative,origin){
   const f=textFile(root,relative);
   if(!/^[a-f0-9]{64}$/.test(origin.after_sha256||'')||f.version.split(':')[0]!==origin.after_sha256)return false;
   remember(f,origin);return true;
  },
  draft(root,relative,value){
   const f=resolve(root,relative),target=draftPath(f);fs.mkdirSync(path.dirname(target),{recursive:true});
   if(!value){if(fs.existsSync(target))fs.unlinkSync(target);return {ok:true};}
   if(typeof value.text!=='string'||typeof value.baseText!=='string'||typeof value.baseVersion!=='string'||Buffer.byteLength(value.text)+Buffer.byteLength(value.baseText)>LIMIT*2)throw failure('project_draft','编辑草稿格式无效');
   const temp=target+'.'+crypto.randomUUID();try{fs.writeFileSync(temp,JSON.stringify({text:value.text,baseText:value.baseText,baseVersion:value.baseVersion}),{flag:'wx'});fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
   return {ok:true};
  },
  history(root,relative,id){
   const f=resolve(root,relative);if(!/^[a-f0-9]{64}$/.test(id||''))throw failure('project_version','历史版本无效');
   const dir=folder(f.base,f.relative),rows=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
   if(!rows.some(row=>row.id===id))throw failure('project_version','该版本不属于当前文件');
   return {path:f.relative,text:fs.readFileSync(path.join(dir,id+'.txt'),'utf8'),record:rows.find(row=>row.id===id)};
  },
  save(root,relative,text,version){
   if(typeof text!=='string'||Buffer.byteLength(text)>LIMIT||text.includes('\0'))throw failure('project_text','文本格式或大小不适合保存');
   const before=textFile(root,relative);if(!version||version!==before.version)throw failure('project_conflict','文件已被修改，草稿已保留，请先比较变化');
   remember(before);const temp=before.file+'.aieyra-'+crypto.randomUUID()+'.tmp';
   try{
    fs.writeFileSync(temp,text,{flag:'wx',mode:before.stat.mode});
    if(textFile(root,relative).version!==version)throw failure('project_conflict','文件已被修改，草稿已保留，请先比较变化');
    fs.renameSync(temp,before.file);
   }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
   return view(textFile(root,relative),{source:'user'});
  },
 };
}
module.exports={createProjectFiles};
