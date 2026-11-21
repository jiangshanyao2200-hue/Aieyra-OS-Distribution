// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; error; clone; canonical; digest; createToolOperations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/tool-operations.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const {atomicWriteJson}=require('./json-storage.cjs');
const error=(code,message)=>Object.assign(Error(message),{code});
const clone=value=>structuredClone(value);
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// Receipts contain only public operation arguments/results. A saved in-flight
// operation is uncertain after restart and must never be blindly replayed.
function createToolOperations({file,scope,limit=512,maxBytes=8*1024*1024,write=atomicWriteJson}){
 if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('invalid receipt limits');
 let rows=new Map(),archives={},fault=null;const pending=new Map(),archiveRoot=file+'.archive';
 const encode=value=>JSON.stringify(value,null,2)+'\n',bytes=value=>Buffer.byteLength(encode(value));
 const unavailable=()=>error('RECEIPT_STORE_UNAVAILABLE','操作回执无法读取，已保留原文件；未执行新的操作。');
 function validate(row){
  if(!row||!validID(row.id)||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest)||!['running','completed','failed','unknown'].includes(row.state)||!Object.hasOwn(row,'arguments')||digest(row.arguments)!==row.digest)throw Error('invalid receipt');
  if(row.state!=='running'){
   const result=row.result;
   if(!result||Array.isArray(result)||result.ok!==(row.state==='completed')||result.state!==row.state||result.request_id!==row.id||result.operation_session!==undefined&&result.operation_session!==scope)throw Error('invalid terminal receipt');
  }
  return row;
 }
 try{if(fs.existsSync(file)){
  if(fs.statSync(file).size>maxBytes)throw Error('receipt file too large');
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  if(![1,2].includes(saved.schema)||saved.scope!==scope||!Array.isArray(saved.rows)||saved.rows.length>limit)throw Error('receipt scope or format mismatch');
  if(saved.schema===2){
   if(!saved.archives||Array.isArray(saved.archives)||typeof saved.archives!=='object')throw Error('invalid archive index');
   for(const [prefix,hash]of Object.entries(saved.archives))if(!/^[a-f0-9]{2}$/.test(prefix)||!/^[a-f0-9]{64}$/.test(hash))throw Error('invalid archive index');
   archives=saved.archives;
  }
  for(const row of saved.rows){
   validate(row);if(rows.has(row.id))throw Error('duplicate receipt');
   rows.set(row.id,row);
  }
 }}catch{fault=unavailable();}
 function validID(id){return typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(id);}
 const prefixFor=id=>crypto.createHash('sha256').update(id).digest('hex').slice(0,2);
 const archiveFile=(prefix,hash)=>path.join(archiveRoot,prefix,hash+'.json');
 function bucket(prefix){
  const hash=archives[prefix];if(!hash)return new Map();
  try{
   const target=archiveFile(prefix,hash);if(fs.statSync(target).size>maxBytes)throw Error('archive too large');
   const raw=fs.readFileSync(target);if(crypto.createHash('sha256').update(raw).digest('hex')!==hash)throw Error('archive digest mismatch');
   const saved=JSON.parse(raw);if(saved.schema!==1||saved.scope!==scope||!Array.isArray(saved.rows))throw Error('invalid archive');
   const found=new Map();for(const row of saved.rows){validate(row);if(row.state==='running'||prefixFor(row.id)!==prefix||found.has(row.id))throw Error('invalid archive row');found.set(row.id,row);}return found;
  }catch{throw unavailable();}
 }
 function find(id){return rows.get(id)||bucket(prefixFor(id)).get(id);}
 function payload(next,index){return {schema:Object.keys(index).length?2:1,scope,rows:[...next.values()],...(Object.keys(index).length?{archives:index}:{})};}
 function save(){
  const next=new Map(rows),index={...archives},changed=new Map(),obsolete=[];
  while(next.size>limit||bytes(payload(next,index))>maxBytes){
   const row=[...next.values()].find(r=>r.state!=='running'&&!pending.has(r.id));
   if(!row)throw error('RECEIPT_LIMIT','在途回执或当前记录已达容量上限，原回执保留；未执行新操作。');
   const prefix=prefixFor(row.id),items=changed.get(prefix)||bucket(prefix);changed.set(prefix,items);
   const prior=items.get(row.id);if(prior&&encode(prior)!==encode(row))throw unavailable();
   items.set(row.id,row);next.delete(row.id);
   // Reserve the index entry while sizing the hot file, before writing anything.
   index[prefix]='0'.repeat(64);
   if(bytes({schema:1,scope,rows:[...items.values()]})>maxBytes)throw error('RECEIPT_LIMIT','此分区回执归档已达容量上限，旧记录保留；未执行新操作。');
  }
  for(const [prefix,items]of changed){
   const data={schema:1,scope,rows:[...items.values()]},raw=encode(data),hash=crypto.createHash('sha256').update(raw).digest('hex'),target=archiveFile(prefix,hash);
   try{write(target,data);}catch{throw error('RECEIPT_ARCHIVE_FAILED','无法保存旧操作回执归档，原记录保留；未执行新操作。');}
   index[prefix]=hash;if(archives[prefix]&&archives[prefix]!==hash)obsolete.push(archiveFile(prefix,archives[prefix]));
  }
  // The content-addressed bucket is durable before the hot index switches.
  // A failed index write leaves the old index and its buckets authoritative.
  write(file,payload(next,index));rows=next;archives=index;
  for(const target of obsolete)try{fs.rmSync(target,{force:true});}catch{/* A redundant old bucket may be retained; its IDs exist in the new bucket. */}
 }
 function query(id){
  if(!validID(id))throw error('INVALID_REQUEST_ID','request_id 必须为1到128位字母、数字、点、下划线、冒号或短横线。');
  if(fault)throw fault;
  const row=find(id);if(!row)return {ok:false,request_id:id,operation_session:scope,state:'not_found',code:'RECEIPT_NOT_FOUND',error:'没有此操作回执；请先核对当前模块状态。'};
  if(row.state==='running')return {ok:false,request_id:id,operation_session:scope,state:pending.has(id)?'running':'unknown',code:pending.has(id)?'OPERATION_PENDING':'OUTCOME_UNKNOWN',error:pending.has(id)?'操作尚未完成。':'上次运行在完成确认前结束，请核对模块状态；原请求不会重复执行。'};
  return {...clone(row.result),request_id:id,state:row.state,operation_session:scope};
 }
 async function execute(id,args,work,{signal,replayOnly=false}={}){
  if(!validID(id))throw error('INVALID_REQUEST_ID','窗口变更需要有效的 request_id。');
  if(fault)throw fault;
  const hash=digest(args),prior=find(id);
  if(prior){if(prior.digest!==hash)throw error('REQUEST_ID_CONFLICT','此 request_id 已用于不同参数，请查询原回执。');if(pending.has(id))return pending.get(id);return {...query(id),replayed:true};}
  if(replayOnly)throw error('ARCHIVED_SESSION','旧会话仅允许查询或重放已有回执，不能执行新操作。');
  if(signal?.aborted)throw error('CANCELLED','操作在执行前已取消。');
  const row={id,digest:hash,arguments:clone(args),state:'running',created_at:new Date().toISOString()};rows.set(id,row);
  try{save();}catch(e){rows.delete(id);if(['RECEIPT_LIMIT','RECEIPT_ARCHIVE_FAILED','RECEIPT_STORE_UNAVAILABLE'].includes(e?.code))throw e;throw error('RECEIPT_SAVE_FAILED','无法保存操作记录，未执行窗口操作。');}
  const task=Promise.resolve().then(async()=>{
   let result;
   try{if(signal?.aborted)throw error('CANCELLED','操作在执行前已取消。');result=await work();}
   catch(e){result={ok:false,code:e?.code||'OPERATION_FAILED',error:String(e?.message??e)};}
   // Freeze the JSON representation before saving or returning it. A module's
   // live objects cannot rewrite a receipt, and an unretainable result cannot
   // authorize replay of an effect that may already have happened.
   try{
    if(!result||typeof result.ok!=='boolean')throw Error('invalid result');
    result=JSON.parse(JSON.stringify(clone(result)));
    if(!result||typeof result.ok!=='boolean')throw Error('invalid result');
   }catch{result={ok:false,state:'unknown',code:'INVALID_RESULT',error:'操作可能已生效，但未返回可保留的结果；请核对当前模块状态。'};}
   row.state=result.ok?'completed':result.state==='unknown'?'unknown':'failed';row.result={...result,request_id:id,state:row.state,operation_session:scope};row.completed_at=new Date().toISOString();
   try{save();}catch{row.state='unknown';row.result={ok:false,request_id:id,state:'unknown',code:'RECEIPT_SAVE_FAILED',error:'操作可能已生效，但最终回执保存失败；请核对当前模块状态。'};}
   return {...clone(row.result),operation_session:scope};
  }).finally(()=>pending.delete(id));pending.set(id,task);return task;
 }
 return {execute,query};
}
module.exports={createToolOperations,digest,error};
