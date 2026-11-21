// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createNativeProgramVerification
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/native-program-verification.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Every admission still reads and hashes the installed and executing bytes.
// Keep that synchronous filesystem work outside Electron's window/IPC thread.
const {Worker,isMainThread,parentPort}=require('node:worker_threads');

if(!isMainThread){
 const catalog=require('../../../Program/official/catalog.cjs');
 const {readPackage}=require('./mod-packages.cjs');
 parentPort.on('message',({id,item})=>{
  try{catalog.verify(item,readPackage(item));parentPort.postMessage({id,ok:true});}
  catch(error){parentPort.postMessage({id,ok:false,error:{message:String(error.message||error),code:error.code}});}
 });
}

function createNativeProgramVerification({WorkerClass=Worker}={}){
 let worker=null,closed=false,sequence=0,closing=null;const pending=new Map();
 function rejectAll(error){for(const entry of pending.values())entry.reject(error);pending.clear();}
 function start(){
  if(worker)return worker;
  const current=new WorkerClass(__filename);worker=current;
  const failed=error=>{if(worker!==current)return;worker=null;rejectAll(error);void current.terminate().catch(()=>{});};
  current.on('message',result=>{
   if(worker!==current)return;
   const entry=pending.get(result.id);if(!entry)return;
   pending.delete(result.id);
   if(result.ok)entry.resolve();else entry.reject(Object.assign(Error(result.error?.message||'程序载荷校验未完成'),{code:result.error?.code}));
   if(!pending.size)current.unref();
  });
  current.once('error',failed);
  current.once('exit',code=>failed(Error('程序校验服务已退出（'+code+'）')));
  current.unref();return current;
 }
 function verify(item){
  if(closed)return Promise.reject(Error('程序校验服务已关闭'));
  return new Promise((resolve,reject)=>{
   let current;
   try{current=start();const id=++sequence;pending.set(id,{resolve,reject});current.ref();current.postMessage({id,item});}
   catch(error){if(current&&worker===current){worker=null;rejectAll(error);void current.terminate().catch(()=>{});}reject(error);}
  });
 }
 function close(){
  if(closing)return closing;
  closed=true;const current=worker;worker=null;rejectAll(Error('程序校验服务已关闭'));
  closing=current?current.terminate().then(()=>{}):Promise.resolve();return closing;
 }
 return {verify,close};
}
module.exports={createNativeProgramVerification};
