// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; cache; crypto; promptIndexes; root; read; defaults; promptIndex; promptPath; runtimeOverrideRoot; prompt; releaseStage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/resources.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
const {TextDecoder}=require('node:util');
const cache=new Map();
const crypto=require('node:crypto'),promptContract=require('../../../Contracts/resources/prompts.cjs');
const promptIndexes=new WeakMap();
const root=()=>process.env.AIEYRA_RESOURCE_ROOT||path.resolve(__dirname,'../../..');
function read(name,sourceRoot=root()){
 if(typeof name!=='string'||path.isAbsolute(name)||name.split(/[\\/]/).includes('..'))throw Error('配置资源路径无效');
 const file=path.join(sourceRoot,'Config',name),stat=fs.statSync(file,{bigint:true});
 if(!stat.isFile()||stat.size>16n*1024n*1024n)throw Error('配置资源必须是最多 16 MiB 的普通文件：'+name);
 const stamp=[stat.mtimeNs,stat.ctimeNs,stat.size,stat.ino].join(':'),old=cache.get(file);
 if(old?.stamp===stamp)return old.value;
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file)));
 cache.set(file,{stamp,value});return value;
}
function defaults(){return structuredClone(read('默认设置.json'));}
function promptIndex(sourceRoot=root()){
 let value;try{value=read('提示词索引.json',sourceRoot);}catch(e){if(e.code!=='ENOENT')throw e;value={resources:[]};}
 let index=promptIndexes.get(value);if(!index){index=promptContract.parse(value);promptIndexes.set(value,index);}return index;
}
function promptPath(name,sourceRoot=root()){
 const loc=promptIndex(sourceRoot).lookup(name),profile=require('../../../Contracts/storage/profile.cjs').active();
 const privateRoot=runtimeOverrideRoot(sourceRoot);
 if(!loc.readOnly){const file=path.join(privateRoot,loc.path);try{fs.statSync(file);return file;}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(profile?.unified){
  if(!loc.readOnly)for(const name of [loc.path,loc.legacy]){const override=path.join(profile.overrides,name);try{fs.statSync(override);return override;}catch(e){if(e.code!=='ENOENT')throw e;}}
  return path.join(sourceRoot,loc.path);
 }
 if(loc.legacySHA256){
  const legacy=path.join(sourceRoot,loc.legacy);let st;
  try{st=fs.statSync(legacy);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(st){
   if(!st.isFile()||st.size>256*1024)throw Error('旧提示词覆盖必须是最多 256 KiB 的普通文件');
   const bytes=fs.readFileSync(legacy);if(bytes.length>256*1024)throw Error('旧提示词覆盖过大');
   if(crypto.createHash('sha256').update(bytes).digest('hex')!==loc.legacySHA256)return legacy;
  }
 }
 return path.join(sourceRoot,loc.path);
}
function runtimeOverrideRoot(sourceRoot=root()){
 const profile=require('../../../Contracts/storage/profile.cjs').active();
 return profile?.unified?profile.overrides:path.join(profile?.root||path.join(sourceRoot,'Data'),'Overrides');
}
function prompt(name){
 if(typeof name!=='string'||path.isAbsolute(name)||name.split(/[\\/]/).includes('..'))throw Error('提示词资源路径无效');
 const file=promptPath(name),stat=fs.statSync(file);
 if(!stat.isFile()||stat.size>256*1024)throw Error('提示词必须是最多 256 KiB 的普通文件：'+name);
 return new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file)).replace(/\r\n/g,'\n');
}
function releaseStage(){
 let raw;try{raw=read('运行参数.json').release_stage;}catch{}
 return Object.fromEntries(['team_collaboration','toolbox','link_situation','cli','os_first_ring'].map(k=>[k,raw?.[k]===true]));
}
module.exports={root,read,defaults,prompt,promptIndex,promptPath,runtimeOverrideRoot,releaseStage};
