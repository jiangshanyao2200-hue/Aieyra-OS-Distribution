// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; cfg; createHaloStore
// Impact: python -B scripts/code-atlas.py show Halo/runtime/settings.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cfg=require('../../Core/platform/config-file.cjs');
const {validateSelection}=require('../contract/definition.mjs');
// Independent sibling file; neither Theme nor personality owns Halo selection.
function createHaloStore(config,{changed=()=>{}}={}){
 const file=path.join(path.dirname(config),'halo.json');let active=null,ready=false;
 function read(){
  try{if(!fs.existsSync(file))return {ok:true,version:'missing',selection:null};if(fs.statSync(file).size>70000)throw Error('光圈配置过大');const bytes=fs.readFileSync(file),saved=JSON.parse(bytes.toString('utf8'));if(saved.schema!==1||Object.keys(saved).some(k=>!['schema','selection'].includes(k)))throw Error('光圈配置格式无效');return {ok:true,version:crypto.createHash('sha256').update(bytes).digest('hex'),selection:validateSelection(saved.selection)};}
  catch{let version='unreadable';try{version=cfg.version(file);}catch{}return {ok:false,version,selection:null,error:'光圈配置无法读取，原文件已保留。'};}
 }
 function publish(value){const next=validateSelection(value);if(ready&&JSON.stringify(active)===JSON.stringify(next))return;active=next;ready=true;changed();}
 function update(selection,expected){
  if(typeof expected!=='string'||!expected)return {ok:false,error:'请先读取光圈配置版本'};
  try{const clean=validateSelection(selection);cfg.withWriteLock(file,expected,()=>{const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify({schema:1,selection:clean})+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}});publish(clean);return {ok:true,...read()};}
  catch(error){return {ok:false,code:error.code,error:error.message};}
 }
 return {read,update,publish,public:()=>({ok:true,selection:structuredClone(active)})};
}
module.exports={createHaloStore};
