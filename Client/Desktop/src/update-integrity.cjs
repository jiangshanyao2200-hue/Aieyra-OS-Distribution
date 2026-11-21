// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; files; moduleName; inspect; createIntegrity
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/update-integrity.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),{Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const files=require('./managed-update-files.cjs'),layout=require('../../../Contracts/product-layout.json');
function moduleName(name){
 const tree=[...layout.source_trees].sort((a,b)=>b.length-a.length).find(t=>name.startsWith(t+'/'));
 if(tree)return tree;
 if(/^Aieyra (OS|CLI|Browser|Link)\.exe$/.test(name))return '启动入口';
 return name.includes('/')?name.split('/')[0]:'公共入口';
}
function inspect(root){
 const baselinePath=path.join(root,'Config/official-baseline.json');
 if(!fs.existsSync(baselinePath))return {phase:'unavailable',reason:'当前安装没有官方完整性基线，尚不能判定模块是否一致'};
 const key=files.read(path.join(root,'Config/release.pub.pem')).toString();
 const baseline=files.verifySigned(JSON.parse(files.read(baselinePath)),key,'baseline');
 const names=[...new Set([...Object.keys(baseline.files),...files.sourceNames(root)])];
 const groups=new Map();let checkedFiles=0;
 for(const name of names){
  const module=moduleName(name);if(!groups.has(module))groups.set(module,{name:module,consistent:0,changed:0,missing:0,added:0,unknown:0});
  const row=groups.get(module),expected=baseline.files[name];
  try{
   const file=files.plainPath(root,name),st=fs.statSync(file);if(!st.isFile())throw Error('not a file');
   if(!expected)row.added++;else if(st.size===expected.size&&files.fileHash(file)===expected.sha256)row.consistent++;else row.changed++;
  }catch(error){if(error.code==='ENOENT')row.missing++;else row.unknown++;}
  checkedFiles++;
 }
 const modules=[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(row=>({...row,state:row.changed+row.missing+row.added?'different':row.unknown?'unknown':'consistent'}));
 return {phase:'checked',version:baseline.version,checkedAt:new Date().toISOString(),checkedFiles,consistent:modules.filter(r=>r.state==='consistent').length,different:modules.filter(r=>r.state==='different').length,unknown:modules.filter(r=>r.state==='unknown').length,modules};
}
function createIntegrity({root}){
 let state={phase:'unchecked'},worker=null,closed=false,job=null;
 function check(){
  if(closed)return Promise.resolve(state);if(job)return job;
  state={...state,phase:'checking'};
  job=new Promise(resolve=>{
   let settled=false;const finish=value=>{if(settled)return;settled=true;if(!closed)state=value;worker=null;job=null;resolve(state);};
   worker=new Worker(__filename,{workerData:{root}});worker.unref();
   worker.once('message',finish);worker.once('error',()=>finish({phase:'error',reason:'完整性检查失败，请重试'}));worker.once('exit',code=>finish({phase:'error',reason:code?'完整性检查已中断':'完整性检查没有返回结果'}));
  });return job;
 }
 return {status:()=>state,check,close(){closed=true;void worker?.terminate();worker=null;}};
}
if(!isMainThread){try{parentPort.postMessage(inspect(workerData.root));}catch{parentPort.postMessage({phase:'error',reason:'官方基线无效或检查未完成，无法判定一致性'});}}
module.exports={createIntegrity,inspect,moduleName};
