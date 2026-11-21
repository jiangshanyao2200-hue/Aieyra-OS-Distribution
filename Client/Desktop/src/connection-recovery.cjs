// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; createRecovery
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/connection-recovery.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// One local last-verified checkpoint. Credentials remain in the existing store.
const fs=require('node:fs'),crypto=require('node:crypto'),cfg=require('./config.cjs'),pool=require('./model-pool.cjs');
function createRecovery(file,save){
 const target=file+'.connection-recovery.json';
 function load(){
  if(!fs.existsSync(target))return null;
  if(fs.lstatSync(target).isSymbolicLink()||fs.statSync(target).size>256*1024)throw Error('连接恢复记录无效');
  const value=JSON.parse(fs.readFileSync(target,'utf8'));
  if(value.schema!==1||!value.profile||!value.connection_id||!value.at)throw Error('连接恢复记录无效');
  return value;
 }
 function checkpoint(s,profile,key){
  const safe=structuredClone(profile);delete safe.api_key;delete safe.api_key_history;
  const record={schema:1,at:new Date().toISOString(),profile:safe,connection_id:profile.connection_id,key_sha256:crypto.createHash('sha256').update(key).digest('hex')};
  const text=JSON.stringify(record,null,2);if(Buffer.byteLength(text)>256*1024)throw Error('连接恢复记录过大');
  cfg.withWriteLock(target,undefined,()=>{const tmp=target+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,text,{mode:0o600});fs.renameSync(tmp,target);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}});
 }
 function status(){const r=load();return {ok:true,available:!!r,...(r?{at:r.at,model:r.profile.model,api_protocol:r.profile.api_protocol}: {})};}
 function restore(s,expected){
  if(!expected||expected!==cfg.version(file))return {ok:false,code:'version_conflict',errors:['配置已变化，请重新读取后恢复']};
  const r=load();if(!r)return {ok:false,errors:['尚无已验证连接可恢复']};
  const connection=s.provider_connections.find(c=>c.id===r.connection_id&&c.base_url===r.profile.base_url);
  const key=[connection?.api_key,...connection?.api_key_history||[]].find(k=>typeof k==='string'&&crypto.createHash('sha256').update(k).digest('hex')===r.key_sha256);
  if(!connection||!key)return {ok:false,errors:['原连接或密钥已不存在，请重新配置']};
  const profile={...structuredClone(r.profile),enabled:true};
  const next={...s,api_profiles:s.api_profiles.filter(p=>p.id!==profile.id).concat(profile),provider_connections:s.provider_connections.map(c=>c.id===connection.id?{...c,api_key:key}:c),matrix_profile:profile.id};
  return {...save(pool.activate(next,profile),expected),restored_model:profile.model,restored_protocol:profile.api_protocol,network_requests:0};
 }
 return {checkpoint,status,restore};
}
module.exports={createRecovery};
