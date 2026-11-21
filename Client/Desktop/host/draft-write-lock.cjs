// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; pause; busy; gate; read; dead; acquireDraftWriteLock
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/draft-write-lock.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),net=require('node:net');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const busy=()=>Object.assign(Error('本地草稿保存繁忙，输入和待发消息已保留，请重试。'),{code:'draft_busy'});

// A kernel-owned gate serializes recovery as well as acquisition. It disappears
// when the host exits, including between creating and filling the legacy file.
// Windows named pipes and Linux abstract sockets leave no recovery lock behind.
async function gate(file,deadline){
 const key=crypto.createHash('sha256').update(process.platform==='win32'?file.toLowerCase():file).digest('hex');
 const address=process.platform==='win32'?'\\\\.\\pipe\\aieyra-draft-'+key:process.platform==='linux'?'\0aieyra-draft-'+key:null;
 if(!address)return null;
 for(;;){
  const server=net.createServer(socket=>socket.destroy());
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,resolve);});return ()=>new Promise(resolve=>server.close(resolve));}
  catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;if(Date.now()>=deadline)throw busy();await pause(35);}
 }
}
function read(file){
 try{const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw Error('本地草稿保存锁异常，原记录已保留。');return fs.readFileSync(file,'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function dead(pid){if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}}
async function acquireDraftWriteLock(file,{timeout=1500}={}){
 const deadline=Date.now()+timeout,releaseGate=await gate(file,deadline);
 let fd,record;
 try{
  for(;;){
   try{
    // Updated hosts need no persistent marker: the kernel owns their lifetime.
    // Only read the old marker to avoid overlapping a still-running old host.
    if(releaseGate){if(read(file)===null)return releaseGate;const exists=Error();exists.code='EEXIST';throw exists;}
    fd=fs.openSync(file,'wx',0o600);break;
   }
   catch(error){
    if(error.code!=='EEXIST')throw error;
    const bytes=read(file);if(bytes===null)continue;
    let owner;try{owner=JSON.parse(bytes);}catch{}
    // Never infer that a slow process is dead from lock age. Unknown or reused
    // PIDs retain the file. Recovery is serialized with every updated writer.
    if(releaseGate&&dead(owner?.pid)&&read(file)===bytes){fs.unlinkSync(file);continue;}
    if(Date.now()>=deadline)throw busy();await pause(35);
   }
  }
  record=JSON.stringify({pid:process.pid,created:Date.now(),token:crypto.randomUUID()});
  fs.writeFileSync(fd,record);fs.closeSync(fd);fd=undefined;
  return async()=>{try{if(read(file)===record)fs.unlinkSync(file);}finally{await releaseGate?.();}};
 }catch(error){
  if(fd!==undefined){try{fs.closeSync(fd);}finally{fs.unlinkSync(file);}}
  await releaseGate?.();throw error;
 }
}
module.exports={acquireDraftWriteLock};
