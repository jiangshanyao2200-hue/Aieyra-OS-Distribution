// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; cfg; filename; read; select
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/session-model.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cfg=require('./config.cjs'),pool=require('./model-pool.cjs');
function filename(file,session){
 if(typeof session!=='string'||!session||Buffer.byteLength(session)>256||/[\x00-\x1f]/.test(session))throw Error('会话标识无效');
 return path.join(file+'.sessions',crypto.createHash('sha256').update(session).digest('hex')+'.json');
}
function read(file,session){
 if(!session)return {version:'missing',profile_id:''};
 try{
  const raw=fs.readFileSync(filename(file,session)),v=JSON.parse(raw);
  if(v.schema_version!==1||typeof v.profile_id!=='string'||v.profile_id.length>256)throw Error('invalid selection');
  return {...v,version:crypto.createHash('sha256').update(raw).digest('hex')};
 }catch(e){if(e.code==='ENOENT')return {version:'missing',profile_id:''};throw Error('会话模型选择文件损坏，请检查后重新选择；未回退到其他模型');}
}
function select(file,session,id,expected,expectedSession){
 if(!expected||!expectedSession)return {ok:false,code:'version_required',errors:['请先读取配置及 session_version，再切换会话模型']};
 try{
  return cfg.withWriteLock(file,expected,()=>{
   const s=pool.migrate(cfg.load(file).settings);
   if(id){const p=s.api_profiles.find(p=>p.id===id);if(!p||p.enabled===false)throw Error('会话模型不存在或已禁用，请选择启用的模型');pool.activate(s,p);}
   const target=filename(file,session);
   return cfg.withWriteLock(target,expectedSession,()=>{
    const tmp=target+'.'+crypto.randomUUID()+'.tmp';let fd;
    try{
     fd=fs.openSync(tmp,'wx',0o600);
     fs.writeFileSync(fd,JSON.stringify({schema_version:1,profile_id:id,updated_at:new Date().toISOString()}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
     fs.renameSync(tmp,target);
    }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    return {ok:true};
   });
  });
 }catch(e){return {ok:false,code:e.code||'session_model_invalid',errors:[e.message]};}
}
module.exports={filename,read,select};
