// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; hashPattern; ordinaryDirectory; durableJSON; hashes; createAttachmentReferences
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/attachment-references.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const hashPattern=/^[a-f0-9]{64}$/u;
async function ordinaryDirectory(dir){
 await fs.mkdir(dir,{recursive:true});
 const st=await fs.lstat(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||path.resolve(await fs.realpath(dir))!==path.resolve(dir))throw Error('附件存储目录已重定向，原文件已保留。');
}
async function durableJSON(file,value){
 const dir=path.dirname(file);await ordinaryDirectory(dir);
 const temp=path.join(dir,'.reference-'+crypto.randomUUID()+'.tmp');let handle;
 try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();handle=null;await fs.rename(temp,file);}
 finally{await handle?.close();await fs.unlink(temp).catch(()=>{});}
}
function hashes(values){
 if(!Array.isArray(values)||values.length>20000||values.some(h=>!hashPattern.test(h)))throw Error('附件引用清单无效，快照已保留。');
 return [...new Set(values)].sort();
}
function createAttachmentReferences(config,owner){
 if(!/^[a-f0-9]{16,64}$/u.test(owner))throw Error('附件所属会话无效。');
 const file=path.join(require('../src/paths.cjs').privatePath(config,'attachments'),'references-v2',owner+'.json');
 let state,tail=Promise.resolve(),token='',sequence=0;
 async function load(){
  if(state)return;
  let data;try{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>4*1024*1024)throw Error('附件引用记录损坏，原文件已保留。');data=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  state=data||{version:2,owner,refs:[],pending:{},sends:{}};
  if(state.version!==2||state.owner!==owner||!state.pending||typeof state.pending!=='object'||Array.isArray(state.pending)||!state.sends||typeof state.sends!=='object'||Array.isArray(state.sends))throw Error('附件引用记录损坏，原文件已保留。');
  hashes(state.refs);for(const h of [...Object.values(state.pending),...Object.values(state.sends)])hashes(h);
 }
 function serial(fn){const result=tail.then(async()=>{await load();return fn();});tail=result.catch(()=>{});return result;}
 async function commit(next){await durableJSON(file,next);state=next;}
 return {
  begin(){token=crypto.randomUUID();sequence=0;return token;},
  stage(fn){return serial(async()=>{
   const entries=await fn(),receipt=crypto.randomUUID();
   await commit({...state,pending:{...state.pending,[receipt]:hashes(entries.map(a=>a.sha256))}});
   return {attachments:entries,receipt};
  });},
  sync(p){return serial(async()=>{
   if(p.token!==token||!Number.isSafeInteger(p.sequence)||p.sequence<=sequence)return {ok:true,stale:true};
   const refs=hashes(p.hashes),receipts=p.receipts||[];
   if(!Array.isArray(receipts)||receipts.length>20000||receipts.some(r=>typeof r!=='string'||r.length>64))throw Error('附件选择回执无效。');
   const pending={...state.pending};for(const r of receipts)delete pending[r];
   await commit({...state,refs,pending});sequence=p.sequence;return {ok:true,sequence};
  });},
  pinSend(id,values){return serial(async()=>{if(typeof id!=='string'||id.length>512)throw Error('发送引用编号无效。');await commit({...state,sends:{...state.sends,[id]:hashes(values)}});});},
  settleSend(id){return serial(async()=>{const sends={...state.sends};delete sends[id];await commit({...state,sends});});},
 };
}
module.exports={createAttachmentReferences,ordinaryDirectory};
