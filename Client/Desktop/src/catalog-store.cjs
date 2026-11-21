// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; createStore
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/catalog-store.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 目录和探测结果独立于用户配置；仅显式刷新写入，读取不联网、不按时间删除。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cfg=require('./config.cjs');
function createStore(configFile){
 const memory=new Map(),dir=configFile?(require('./paths.cjs').profile(configFile).unified?path.join(path.dirname(configFile),'catalog-cache'):path.join(require('./paths.cjs').dataDir(configFile),path.basename(configFile)+'.catalog-cache')):null;
 const location=id=>dir&&path.join(dir,crypto.createHash('sha256').update(id).digest('hex')+'.json');
 function get(id){
  if(!dir)return structuredClone(memory.get(id)||null);
  const file=location(id);
  try{if(fs.statSync(file).size>16*1024*1024)return null;const data=JSON.parse(fs.readFileSync(file,'utf8'));return data.version===1&&data.id===id?data.value:null;}catch{return null;}
 }
 function put(id,value){
  if(!dir){memory.set(id,structuredClone(value));return;}
  fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=location(id);
  cfg.withWriteLock(file,undefined,()=>{
   const tmp=file+'.'+crypto.randomUUID()+'.tmp';
   try{fs.writeFileSync(tmp,JSON.stringify({version:1,id,value}),{mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  });
 }
 return {get,put};
}
module.exports={createStore};
