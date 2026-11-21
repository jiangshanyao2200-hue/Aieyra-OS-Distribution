// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; maxBytes; validId; createGroupDraftStore
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/group-draft.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {ordinaryDirectory}=require('./attachment-references.cjs');
const {acquireDraftWriteLock}=require('./draft-write-lock.cjs');
const maxBytes=64*1024,revision=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/u.test(id);

function createGroupDraftStore(config){
 const dir=path.join(require('../src/paths.cjs').privatePath(config,'runtime'),'group-drafts');
 const queues=new Map(),pending=new Set();
 function fileFor(id){if(!validId(id))throw Error('群聊标识无效。');return path.join(dir,id+'.json');}
 function serial(id,fn){
  const previous=queues.get(id)||Promise.resolve();
  const next=previous.catch(()=>{}).then(fn);
  let tracked;
  tracked=next.finally(()=>{pending.delete(tracked);if(queues.get(id)===tail)queues.delete(id);});
  const tail=tracked.catch(()=>{});
  queues.set(id,tail);pending.add(tracked);
  return tracked;
 }
 async function current(id){
  const file=fileFor(id);await ordinaryDirectory(dir);
  let bytes;
  try{
   const st=await fs.lstat(file);
   if(!st.isFile()||st.isSymbolicLink()||st.size>maxBytes+1024)throw Error('群聊草稿记录异常，原文件已保留。');
   bytes=await fs.readFile(file);
  }catch(error){if(error.code==='ENOENT')return {text:'',revision:'missing'};throw error;}
  let saved;try{saved=JSON.parse(bytes.toString('utf8'));}catch{throw Error('群聊草稿内容损坏，原文件已保留。');}
  if(saved?.version!==1||saved.group_id!==id||typeof saved.text!=='string'||Buffer.byteLength(saved.text)>maxBytes)throw Error('群聊草稿格式无效，原文件已保留。');
  return {text:saved.text,revision:revision(bytes)};
 }
 async function load(id){return serial(id,async()=>({ok:true,...await current(id)}));}
 async function save({id,text,expected_revision:expected}){
  if(typeof text!=='string'||Buffer.byteLength(text)>maxBytes)throw Error('群聊草稿过大，当前输入仍保留在窗口中。');
  if(typeof expected!=='string'||(expected!=='missing'&&!/^[a-f0-9]{64}$/u.test(expected)))throw Error('群聊草稿版本无效。');
  return serial(id,async()=>{
   const file=fileFor(id);await ordinaryDirectory(dir);
   const release=await acquireDraftWriteLock(file+'.write-lock');
   try{
    const before=await current(id);
    if(before.revision!==expected)return {ok:false,code:'GROUP_DRAFT_CONFLICT',error:'群聊草稿已在另一个窗口更新；当前输入仍保留，请先核对。',revision:before.revision};
    if(!text){if(before.revision!=='missing')await fs.unlink(file);return {ok:true,revision:'missing'};}
    const bytes=Buffer.from(JSON.stringify({version:1,group_id:id,text}));
    const temp=path.join(dir,'.'+id+'.'+crypto.randomUUID()+'.tmp');let handle;
    try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await fs.rename(temp,file);}
    finally{await handle?.close();await fs.unlink(temp).catch(()=>{});}
    return {ok:true,revision:revision(bytes)};
   }finally{await release();}
  });
 }
 return {load,save,async flush(){while(pending.size)await Promise.all([...pending]);}};
}
module.exports={createGroupDraftStore};
