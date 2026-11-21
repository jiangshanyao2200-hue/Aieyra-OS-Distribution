// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; limit; empty; validate; hashesOf; createComposerDraft
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/composer-draft.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {ordinaryDirectory,createAttachmentReferences}=require('./attachment-references.cjs');
const {validateSelection}=require('./attachments.cjs');
const {acquireDraftWriteLock}=require('./draft-write-lock.cjs');
const {validateProgramContext}=require('../../../Program/contract/reference-context.cjs');
const limit=512*1024,hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const empty=()=>({value:'',pastes:'',attachments:[]});
async function validate(value){
 if(!value||typeof value.value!=='string'||typeof value.pastes!=='string'||Buffer.byteLength(JSON.stringify(value))>limit)throw Error('草稿过大或记录不完整，当前输入已保留。');
 const {PasteDraft}=await import(pathToFileURL(path.join(__dirname,'../ui/paste-blocks.mjs')).href);
 const draft=new PasteDraft();draft.restore(value.value,value.pastes);
 validateSelection(value.attachments);
 const result={value:value.value,pastes:value.pastes,attachments:structuredClone(value.attachments)};
 if(value.context)result.context=validateProgramContext(value.context);
 if(value.outbox!==undefined){
  if(!Array.isArray(value.outbox)||value.outbox.length>64)throw Error('待发消息记录过多或不完整，原记录已保留。');
  const ids=new Set();result.outbox=value.outbox.map(e=>{
   if(!e||typeof e.text!=='string'||Buffer.byteLength(e.text)>65536||!['session_id','request_id'].every(k=>typeof e[k]==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(e[k]))||!['prepared','pending',undefined].includes(e.delivery))throw Error('待发消息记录不完整，原记录已保留。');
   const key=e.session_id+'/'+e.request_id;if(ids.has(key))throw Error('待发消息身份重复，原记录已保留。');ids.add(key);
   validateSelection(e.attachments||[]);
   const next={session_id:e.session_id,request_id:e.request_id,text:e.text,delivery:e.delivery||'pending',attachments:structuredClone(e.attachments||[])};
   if(e.preserve_draft!==undefined&&typeof e.preserve_draft!=='boolean')throw Error('待发消息草稿标记无效');
   if(e.preserve_draft===true)next.preserve_draft=true;
   if(e.context)next.context=validateProgramContext(e.context);
   if(e.rejection){if(!['edited','attachment_rejected','not_admitted','local_save_failed'].includes(e.rejection.code)||typeof e.rejection.message!=='string'||e.rejection.message.length>4096)throw Error('未发送回执不完整，原记录已保留。');next.rejection={code:e.rejection.code,message:e.rejection.message};}
   return next;
  });
 }
 return result;
}
const hashesOf=d=>[...d.attachments,...(d.outbox||[]).flatMap(e=>e.attachments||[])].map(a=>a.sha256);
function createComposerDraft(config,workdir,{sessionID=''}={}){
 if(typeof workdir!=='string'||!path.isAbsolute(workdir))throw Error('草稿工作目录无效。');
 if(sessionID&&!/^[a-f0-9]{32}$/.test(sessionID))throw Error('草稿所属会话无效。');
 const canonical=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
 const scope=hash(canonical(require('../../../Contracts/storage/profile.cjs').identityConfig(config))+'\0'+(sessionID?'conversation:'+sessionID:canonical(workdir)));
 const file=path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'composer-drafts',scope+'.json');
 const refs=createAttachmentReferences(config,scope);
 let loaded=false,expected='missing',state=empty(),tail=Promise.resolve(),lastSave=Promise.resolve(),closing=false,token='',sequence=0;
 function serial(fn){const result=tail.then(fn);tail=result.catch(()=>{});return result;}
 function readBytes(){
  try {const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>limit+1024)throw Error('本地草稿记录异常，原文件已保留。');return fs.readFileSync(file);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 async function load(){
  if(loaded)return;
  await ordinaryDirectory(path.dirname(file));
  const bytes=readBytes();
  if(bytes){
   let saved;try{saved=JSON.parse(bytes.toString('utf8'));}catch{throw Error('本地草稿内容损坏，原文件已保留，请先复制当前输入。');}
   if(!saved||saved.version!==1||saved.scope!==scope)throw Error('本地草稿所属工作目录不符。');state=await validate(saved.draft);expected=hash(bytes);
  }
  loaded=true;
 }
 async function commit(value){
   const next=await validate(value),hashes=[...new Set(hashesOf(next))];
   await ordinaryDirectory(path.dirname(file));
   // Hold the same lock across reference and draft writes. A stale host must
   // not replace another host's draft or its attachment retention journal.
   const release=await acquireDraftWriteLock(file+'.write-lock');
   try {
   const bytes=readBytes();
   if((bytes?hash(bytes):'missing')!==expected)throw Error('另一个窗口已更新本地草稿，当前输入已保留，请先核对其它窗口。');
   // Pin before committing. Failed writes conservatively retain snapshots.
   await refs.pinSend('composer-draft',[...new Set([...hashesOf(state),...hashes])]);
   const text=JSON.stringify({version:1,scope,draft:next});
    const temp=file+'.'+crypto.randomUUID()+'.tmp';let fd;
    try {fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,text);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(temp,file);}
    finally {if(fd!=null)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
   state=next;expected=hash(text);
   await refs.pinSend('composer-draft',hashes);
   return {ok:true,revision:expected,draft:structuredClone(state)};
   }finally{await release();}
 }
 return {
  file,
  sharedRead(){return serial(async()=>{await load();return {ok:true,revision:expected,draft:structuredClone(state)};});},
  sharedSave(p){
   if(closing)return Promise.reject(Error('窗口正在关闭，草稿保存已收尾。'));
   lastSave=serial(async()=>{await load();if(p.revision!==expected)throw Error('另一个入口已修改草稿，当前输入保留，请先核对最新草稿。');return commit(p.draft);});return lastSave;
  },
  inspect(){return serial(async()=>{await load();return structuredClone(state);});},
  open(){return serial(async()=>{await load();token=crypto.randomUUID();sequence=0;return {token,draft:structuredClone(state)};});},
  save(p){
   if(closing)return Promise.reject(Error('窗口正在关闭，草稿保存已收尾。'));
   lastSave=serial(async()=>{
   await load();if(p.token!==token||!Number.isSafeInteger(p.sequence)||p.sequence<=sequence)return {ok:true,stale:true};
   const result=await commit(p.draft);sequence=p.sequence;return {...result,sequence};
  });return lastSave;},
  flush:()=>lastSave,
  async close(){closing=true;try{await tail;await lastSave;}catch(error){closing=false;throw error;}},
 };
}
module.exports={createComposerDraft};
