// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; f; io; privatePath; pending; committed; metadata; current; acquire; destinationParent; promoteBootstrap
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/managed-update-bootstrap.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const f=require('./managed-update-files.cjs');
const io=fs.promises;

// Legacy helpers can only replace Core/Desktop and OS.exe. Promotion happens
// after their committed receipt and pending-marker removal, never during health.
function privatePath(root,name,missing=false){
 if(!/^\.aieyra-updates\/(?:pending\.json|transaction\.json|bootstrap\.json|[a-z0-9][a-z0-9.-]{0,99}\/apply\.json)$/.test(name))throw Error('补全事务路径无效');
 let current=root;
 for(const part of ['',...name.split('/')]){
  current=path.join(current,part);
  try{const st=fs.lstatSync(current);if(st.isSymbolicLink()||st.isFile()&&st.nlink>1)throw Error('补全事务不能通过链接读写');}
  catch(error){if(error.code==='ENOENT'&&missing)return path.join(root,name);throw error;}
 }
 return current;
}
function pending(root){try{privatePath(root,'.aieyra-updates/pending.json');return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function committed(root,baseline){
 if(pending(root))return false;
 let receipt,plan;
 try{
  receipt=JSON.parse(f.read(privatePath(root,'.aieyra-updates/transaction.json'),1024*1024));
  if(receipt.phase!=='committed'||!/^([a-z0-9][a-z0-9.-]{0,99})$/.test(receipt.release))return false;
  plan=JSON.parse(f.read(privatePath(root,`.aieyra-updates/${receipt.release}/apply.json`)));
 }catch(error){if(error.code==='ENOENT')return false;throw error;}
 return plan.phase==='committed'&&plan.release===receipt.release&&plan.version===baseline.version&&plan.sequence===baseline.sequence&&path.resolve(plan.root)===root&&!pending(root);
}
async function metadata(file){
 const stat=await io.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1)throw Error('补全文件不能通过链接读写');
 const hash=crypto.createHash('sha256');for await(const part of fs.createReadStream(file))hash.update(part);
 return {sha256:hash.digest('hex'),size:stat.size};
}
async function current(root,name){try{return await metadata(f.plainPath(root,name));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function acquire(root){
 // 由内核持有互斥，进程崩溃后自动释放；不留下需要猜测存活时间的锁文件。
 const stat=fs.statSync(root,{bigint:true}),id=f.hash(`${stat.dev}:${stat.ino}`);
 const address=process.platform==='win32'?{path:'\\\\.\\pipe\\aieyra-os-bootstrap-'+id}:{host:'127.0.0.1',port:49152+parseInt(id.slice(0,8),16)%16384,exclusive:true};
 // Unix 使用兼容旧 Node 的本机端口；冲突只会延后补全，绝不夺取存活锁。
 const server=net.createServer(socket=>socket.destroy());server.unref();
 return new Promise((resolve,reject)=>{
  server.once('error',error=>{if(error.code==='EADDRINUSE')resolve(null);else reject(error);});
  server.listen(address,()=>resolve(()=>new Promise(done=>server.close(done))));
 });
}
function destinationParent(root,name){
 // 恢复只检查白名单目标的祖先，不能用虚构脚本名，也不能先拒绝待恢复的双链接。
 if(!Object.values(f.BOOTSTRAP).includes(name))throw Error('补全目标不在签名映射内');
 let current=root;
 for(const part of ['',...name.split('/').slice(0,-1)]){
  current=path.join(current,part);
  try{const st=fs.lstatSync(current);if(st.isSymbolicLink()||!st.isDirectory())throw Error('补全目录不能通过链接读写');}
  catch(error){if(error.code==='ENOENT')return path.dirname(path.join(root,name));throw error;}
 }
 return current;
}
async function promoteBootstrap({root,publicKey,ioHooks={}}){
 root=path.resolve(root);
 if(pending(root))return {phase:'deferred',reason:'update_pending'};
 let envelope;
 try{envelope=JSON.parse(f.read(f.plainPath(root,'Config/official-baseline.json')));}catch(error){if(error.code==='ENOENT')return {phase:'complete',installed:[]};throw error;}
 const key=publicKey||f.read(f.plainPath(root,'Config/release.pub.pem'));
 const baseline=f.verifySigned(envelope,key,'baseline');
 if(!baseline.bootstrap)return {phase:'complete',installed:[]};
 const release=await acquire(root);if(!release)return {phase:'deferred',reason:'bootstrap_busy'};
 try{
 if(pending(root))return {phase:'deferred',reason:'update_pending'};
 const identity=f.hash(envelope.payload),journalFile=privatePath(root,'.aieyra-updates/bootstrap.json',true);
 let journal;
 try{journal=JSON.parse(f.read(journalFile,1024*1024));}catch(error){if(error.code!=='ENOENT')throw error;}
 // Recover only the exact temporary file named by our journal. A crash after
 // link() can leave two names for identical complete bytes; unlink temp first.
 if(journal?.temporary){
  if(!committed(root,baseline))return {phase:'deferred',reason:'awaiting_committed_update'};
  const {destination,temp}=journal.temporary;
  if(journal.identity!==identity||!Object.values(f.BOOTSTRAP).includes(destination)||!new RegExp('^'+destination.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\.bootstrap-[a-f0-9]{32}\\.tmp$').test(temp))throw Error('补全恢复记录与签名不一致');
  const parent=destinationParent(root,destination);
  const temporary=path.join(parent,path.basename(temp));
  try{const st=fs.lstatSync(temporary);if(st.isSymbolicLink()||!st.isFile())throw Error('补全临时文件类型无效');if(!committed(root,baseline))return {phase:'deferred',reason:'update_changed'};fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const missing=[],conflicts=[];
 for(const row of baseline.bootstrap){
  if(!f.same(await metadata(f.plainPath(root,row.source)),row))throw Error('补全源文件与签名不一致：'+row.destination);
  const local=await current(root,row.destination);
  if(!local)missing.push(row);else if(!f.same(local,row))conflicts.push(row.destination);
 }
 if(!missing.length)return {phase:conflicts.length?'conflict':'complete',installed:[],conflicts};
 if(!committed(root,baseline))return {phase:'deferred',reason:'awaiting_committed_update',conflicts};
 fs.mkdirSync(path.dirname(journalFile),{recursive:true});privatePath(root,'.aieyra-updates/bootstrap.json',true);
 journal={schema:1,identity,version:baseline.version,sequence:baseline.sequence,phase:'installing',installed:[],conflicts};
 f.atomicJSON(journalFile,journal);
 for(const row of missing){
  if(!committed(root,baseline))return {phase:'deferred',reason:'update_changed',installed:journal.installed};
  const destination=f.plainPath(root,row.destination,true);
  fs.mkdirSync(path.dirname(destination),{recursive:true});f.plainPath(root,row.destination,true);
  if(!committed(root,baseline))return {phase:'deferred',reason:'update_changed',installed:journal.installed};
  const temp=row.destination+'.bootstrap-'+crypto.randomBytes(16).toString('hex')+'.tmp';
  const temporary=path.join(root,temp);journal.temporary={destination:row.destination,temp};f.atomicJSON(journalFile,journal);
  try{
   await io.copyFile(f.plainPath(root,row.source),temporary,fs.constants.COPYFILE_EXCL);
   const handle=await io.open(temporary,'r+');try{await handle.sync();}finally{await handle.close();}
   if(!f.same(await metadata(temporary),row))throw Error('补全复制校验失败：'+row.destination);
   await ioHooks.beforePublish?.(row,temporary);
   f.plainPath(root,row.destination,true);
   if(!committed(root,baseline))return {phase:'deferred',reason:'update_changed',installed:journal.installed};
   // An exclusive hard link publishes complete bytes atomically without ever
   // overwriting a destination created concurrently by the user or updater.
   try{fs.linkSync(temporary,destination);}catch(error){if(error.code!=='EEXIST')throw error;}
  }finally{
   // 事务切换后连清理也留到下次已提交时恢复，避免回滚阶段修改磁盘。
   if(committed(root,baseline)){
    destinationParent(root,row.destination);
    try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
    delete journal.temporary;privatePath(root,'.aieyra-updates/bootstrap.json');f.atomicJSON(journalFile,journal);
   }
  }
  if(!committed(root,baseline))return {phase:'deferred',reason:'update_changed',installed:journal.installed};
  if(f.same(await current(root,row.destination),row))journal.installed.push(row.destination);else journal.conflicts.push(row.destination);
  if(!committed(root,baseline))return {phase:'deferred',reason:'update_changed',installed:journal.installed};
  f.atomicJSON(journalFile,journal);
 }
 journal.phase=journal.conflicts.length?'conflict':'complete';f.atomicJSON(journalFile,journal);
 return {phase:journal.phase,installed:journal.installed,conflicts:journal.conflicts};
 }finally{await release();}
}
module.exports={promoteBootstrap};
