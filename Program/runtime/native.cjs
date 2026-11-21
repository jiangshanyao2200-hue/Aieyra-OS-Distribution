// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: catalog; createNativePrograms
// Impact: python -B scripts/code-atlas.py show Program/runtime/native.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Trusted adapters are injected by the host; package code is never required.
const catalog=require('../official/catalog.cjs');
function createNativePrograms({resolve,readPackage,verify=item=>catalog.verify(item,readPackage(item)),adapters,changed=()=>{},onError=()=>{},onProgramError=()=>{}}){
 const admitted=new Map(),retiring=new Map(),pending=new Set(),admitting=new Map();let closed=false,generation=0,selection=null,draining=null;
 async function revoke(key){
  const active=admitted.delete(key);if(retiring.has(key))return retiring.get(key);if(!active&&!pending.has(key))return;pending.add(key);
  const work=Promise.resolve().then(()=>adapters[key]?.close());retiring.set(key,work);
  try{await work;pending.delete(key);}catch(error){onError(error);throw error;}finally{retiring.delete(key);if(!closed)changed();}
 }
 async function performAdmission(key){
  const own=catalog.find(key);if(!own)return null;
  if(closed)throw Error('程序服务已关闭');const before=generation;
  const checkCurrent=()=>{
   if(closed)throw Error('程序服务已关闭');
   if(before!==generation)throw Object.assign(Error('程序状态已变化，请重试'),{code:'PROGRAM_ADMISSION_CHANGED'});
  };
  try{
   const item=await resolve(own.packageID);await verify(item);
   checkCurrent();
   if(!adapters[own.id])throw Error('当前客户端不支持这个原生程序');
   if(pending.has(own.id))await revoke(own.id);
   checkCurrent();
   const previous=admitted.get(own.id);if(previous&&previous!==item.digest)await revoke(own.id);
   checkCurrent();
   admitted.set(own.id,item.digest);if(previous!==item.digest)changed();return item;
  }catch(error){if(before===generation)await revoke(own.id);throw error;}
 }
 function admit(key){
  const own=catalog.find(key);if(!own)return Promise.resolve(null);
  const current=admitting.get(own.id);if(current?.generation===generation)return current.promise;
  // Share only an in-flight verification. The next operation must still check
  // the actual installed and executing bytes; no long-lived trust cache.
  const entry={generation,promise:null};
  entry.promise=performAdmission(own.id).finally(()=>{if(admitting.get(own.id)===entry)admitting.delete(own.id);});
  admitting.set(own.id,entry);return entry.promise;
 }
 function assert(key){const own=catalog.find(key);if(own&&(closed||!admitted.has(own.id)))throw Error(own.title+'已停用或不可用，请在资源中心核对程序包');}
 async function run(key,fn){await admit(key);assert(key);return fn();}
 async function reconcile(items=[]){
  const enabled=new Map(items.filter(r=>r.enabled).map(r=>[r.manifest.id,r.digest]));
  // The mutation reply and file watcher can report the same installation.
  // Only a changed native selection invalidates admission already in flight;
  // still reverify payloads and retry incomplete releases on every snapshot.
  const next=JSON.stringify(catalog.programs.map(own=>[own.id,enabled.get(own.packageID)??null]));
  if(next!==selection){selection=next;generation++;}const ticket=generation;
  const errors=[];
  for(const own of catalog.programs){
   if(closed||ticket!==generation)return;
   try{
    if(!enabled.has(own.packageID)){await revoke(own.id);continue;}
    // Reconciliation must not wait on an unrelated held operation's resolve.
    try{await performAdmission(own.id);}catch{if(!closed&&ticket===generation)await revoke(own.id);}
   }catch(error){errors.push(error);}
  }
  if(closed||ticket!==generation)return;
  if(errors.length===1)throw errors[0];
  if(errors.length)throw new AggregateError(errors,'部分程序同步未完成');
 }
 async function call(item,action,p={},{signal}={}){
  const checkCancelled=()=>{if(signal?.aborted)throw Object.assign(Error('程序操作在执行前已取消。'),{code:'CANCELLED'});};
  checkCancelled();
  const own=catalog.find(item.manifest.id);if(!own)throw Error('未知原生程序');
  return run(own.id,async()=>{
   checkCancelled();
   if(admitted.get(own.id)!==item.digest)throw Error('程序版本已变化');
   const adapter=adapters[own.id];
   if(action==='open')return adapter.open();
   if(action==='snapshot')return adapter.snapshot(p.arguments??{});
   if(action==='invoke'){
    if(!own.definition.operations.some(op=>op.id===p.operation))throw Error('程序没有声明这项操作');
    if(!p.arguments||typeof p.arguments!=='object'||Array.isArray(p.arguments))throw Error('程序参数必须是对象');
    try{return await adapter.invoke(p.operation,p.arguments,{request_id:p.request_id});}
    catch(error){
     if(own.id!=='center'&&!signal?.aborted&&error?.code!=='CANCELLED')onProgramError();
     throw error;
    }
   }
   throw Error('未知原生程序操作');
  });
 }
 function shutdown(){
  if(draining)return draining;
  closed=true;generation++;
  // Retention failure leaves that surface pending for retry, while every other
  // admitted program still gets its own release attempt. Repeated quits join.
  draining=(async()=>{
   const errors=[];
   for(const key of new Set([...admitted.keys(),...pending,...retiring.keys()])){
    try{await revoke(key);}catch(error){errors.push(error);}
   }
   if(errors.length)throw new AggregateError(errors,'部分程序释放未完成');
  })().finally(()=>{draining=null;});
  return draining;
 }
 return {admit,assert,run,reconcile,call,async closeProgram(id){const own=catalog.find(id);if(own)await adapters[own.id]?.close();},shutdown};
}
module.exports={createNativePrograms};
