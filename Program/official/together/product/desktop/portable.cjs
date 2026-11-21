/* @file-map:start
文件: link/desktop/portable.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/portable.test.cjs, link/desktop/main.cjs
链路: startup
验证: AIDEBUG/portable.test.cjs, AIDEBUG/startup-review.py, AIDEBUG/test_aidebug_launch.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  digest | function
  fileDigest | function
  copyTree | function
  migrate | function
  migrate.replacePath | function
  migrate.receipts | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// Migration copies physical files. Electron's patched fs treats .asar files as
// virtual directories and would unpack/corrupt a cached OS during migration.
const fs=process.versions.electron?require('original-fs'):require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const /* @chain-region digest | calls: digest, update, crypto.createHash */ digest=value=>crypto.createHash('sha256').update(value).digest('hex');
let digestBuffer;
/* @chain-region fileDigest | calls: crypto.createHash, Buffer.allocUnsafe, fs.openSync, fs.readSync, hash.update, buffer.subarray, fs.closeSync, hash.digest */ function fileDigest(file){
 const hash=crypto.createHash('sha256'),buffer=digestBuffer||=Buffer.allocUnsafe(1024*1024),fd=fs.openSync(file,'r');
 try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));}finally{fs.closeSync(fd);}
 return hash.digest('hex');
}
const excluded=new Set(['Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache','Crashpad','SingletonLock','SingletonCookie','SingletonSocket','lockfile']);
/* @chain-region copyTree | calls: fs.existsSync, fs.lstatSync, stat.isSymbolicLink, Error, isSymbolicLink, stat.isDirectory, fs.mkdirSync, fs.readdirSync … */ function copyTree(source,target,options={}){
 if(!fs.existsSync(source))return;
 const stat=fs.lstatSync(source);
 if(stat.isSymbolicLink())throw Error('portable_redirected_path');
 if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('portable_redirected_destination');
 if(stat.isDirectory()){
  fs.mkdirSync(target,{recursive:true});
  for(const entry of fs.readdirSync(source))if(!excluded.has(entry))copyTree(path.join(source,entry),path.join(target,entry),options);
 }else if(stat.isFile()){
  if(fs.existsSync(target)&&fs.lstatSync(target).isDirectory()){
   const relative=options.stage&&path.relative(options.stage,target);
   if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!source.toLowerCase().endsWith('.asar'))throw Error('portable_destination_conflict');
   const recovery=path.join(options.stage,'migration-recovery',relative+'.'+crypto.randomUUID());
   fs.mkdirSync(path.dirname(recovery),{recursive:true});fs.renameSync(target,recovery);
   options.recovered?.push({path:relative,recovery:path.relative(options.stage,recovery)});
  }
  // Each file is replaced atomically, so an interrupted migration can resume.
  const unchanged=fs.existsSync(target)&&fs.statSync(target).size===stat.size&&fileDigest(target)===fileDigest(source);
  if(!unchanged){const temp=target+'.migrating';fs.copyFileSync(source,temp);fs.renameSync(temp,target);}
  options.files=(options.files||0)+1;options.bytes=(options.bytes||0)+stat.size;
  options.onProgress?.({files:options.files,bytes:options.bytes,path:options.stage?path.relative(options.stage,target):target,reused:unchanged});
 }
}
/* @chain-region migrate | calls: path.join, fs.existsSync, Error, isSymbolicLink, fs.lstatSync, fs.mkdirSync, copyTree, receipts … */ function migrate({base,legacyBase,legacyProfile,onProgress}){
 const marker=path.join(base,'layout.json');
 if(fs.existsSync(marker))return {migrated:false,profile:path.join(base,'profile')};
 const stage=base+'.migrating';
 if(fs.existsSync(base))throw Error('portable_layout_incomplete');
 if(fs.existsSync(stage)&&fs.lstatSync(stage).isSymbolicLink())throw Error('portable_redirected_destination');
 fs.mkdirSync(stage,{recursive:true});
 const options={stage,onProgress,recovered:[],files:0,bytes:0};
 copyTree(legacyProfile,path.join(stage,'profile'),options);
 for(const name of ['account','data','cache','runtime'])copyTree(path.join(legacyBase,name),path.join(stage,name),options);
 const /* @chain-region migrate.replacePath | calls: legacyBase.replaceAll, base.replaceAll, value.toLowerCase, before.toLowerCase, startsWith, value.slice */ replacePath=value=>{
  if(typeof value==='string'){
   for(const [before,after] of [[legacyBase,base],[legacyBase.replaceAll('\\','/'),base.replaceAll('\\','/')]])
    if(value.toLowerCase()===before.toLowerCase()||value.toLowerCase().startsWith(before.toLowerCase()+path.sep)||value.toLowerCase().startsWith(before.toLowerCase()+'/'))return after+value.slice(before.length);
  }
  return value;
 };
 // Rewrite only path-bearing execution receipts, never source/config contents.
 /* @chain-region migrate.receipts | calls: fs.existsSync, fs.readdirSync, path.join, entry.isDirectory, includes, receipts, entry.isFile, JSON.parse … */ function receipts(directory){
  if(!fs.existsSync(directory))return;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const file=path.join(directory,entry.name);
   if(entry.isDirectory()&&!['trees','runtime','cache','blobs','temporary','node_modules'].includes(entry.name))receipts(file);
   else if(entry.isFile()&&['development.json','run.json','record.json'].includes(entry.name)){
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    for(const key of ['source_path','runtime_path','directory','workdir','log','artifact_path'])if(value[key])value[key]=replacePath(value[key]);
    fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});
   }
  }
 }
 receipts(path.join(stage,'data'));
 const cocreation=path.join(stage,'data','cocreation');
 if(fs.existsSync(cocreation))for(const account of fs.readdirSync(cocreation,{withFileTypes:true}).filter(x=>x.isDirectory())){
  const original=path.join(legacyBase,'data','cocreation',account.name),sources=path.join(cocreation,account.name,'sources');
  if(!fs.existsSync(sources))continue;
  for(const scope of fs.readdirSync(sources,{withFileTypes:true}).filter(x=>x.isDirectory())){
   const sandbox=path.join(sources,scope.name,'sandbox'),identity=path.join(sandbox,'container-identity.json');
   if(fs.existsSync(sandbox)&&!fs.existsSync(identity))fs.writeFileSync(identity,JSON.stringify({name:'aieyra.together.dev.'+digest(original).slice(0,20)}),{mode:0o600});
  }
 }
 fs.writeFileSync(path.join(stage,'layout.json'),JSON.stringify({version:1,migratedAt:new Date().toISOString(),files:options.files,bytes:options.bytes,recovered:options.recovered}),{mode:0o600});
 fs.renameSync(stage,base);
 return {migrated:true,profile:path.join(base,'profile'),files:options.files,bytes:options.bytes,recovered:options.recovered};
}
module.exports={migrate,copyTree};
