// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; APP_IDS; regular; safeParents; controlInterpreter; createApps
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/apps.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Discover bundled OS modules. Installation belongs to the shared OS updater.
const fs=require('node:fs'),path=require('node:path');
const APP_IDS=Object.freeze(['aieyra.link','aieyra.control']);
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw Error('应用文件类型无效');return s;}
function safeParents(target){for(let p=path.resolve(target);;p=path.dirname(p)){let s;try{s=fs.lstatSync(p);}catch(e){if(e.code!=='ENOENT')throw e;}if(s?.isSymbolicLink())throw Error('应用路径不能经过链接');if(path.dirname(p)===p)break;}}
function controlInterpreter({root,platform=process.platform,env=process.env}){
 const directory=path.join(root,'Control','app');
  let executable=env.AIEYRA_CONTROL_PYTHON;
  if(executable&&!path.isAbsolute(executable))throw Error('Control Python 运行时必须为绝对路径');
  if(!executable){
   const bundled=path.join(directory,'runtime','python',platform==='win32'?'python.exe':'bin/python3');
   if(fs.existsSync(bundled))executable=bundled;
   else if(platform==='win32'&&env.LOCALAPPDATA){
    const base=path.join(env.LOCALAPPDATA,'Programs','Python');
    if(fs.existsSync(base)){safeParents(base);const versions=fs.readdirSync(base).filter(n=>/^Python3[0-9]+$/.test(n)).sort().reverse();
     executable=versions.map(n=>path.join(base,n,'python.exe')).find(p=>fs.existsSync(p));}
   }
  }
  executable ||= platform==='win32'?'python':'python3';
  if(path.isAbsolute(executable)){safeParents(executable);regular(executable);}
 return executable;
}
function createApps({root,programs=path.join(process.env.LOCALAPPDATA||'', 'Programs'),platform=process.platform,env=process.env}={}){
 root=path.resolve(root);programs=path.resolve(programs);
 const targetPlatform={win32:'windows',linux:'linux',darwin:'macos'}[platform];
 let closed=false;
 function idCheck(id){if(!APP_IDS.includes(id))throw Error('应用仅支持 Link 和 Control');}
 function installed(id){
  if(id==='aieyra.link')return require('./link-product.cjs').discoverLink({root,programs,platform});
  idCheck(id);
  const directory=path.join(root,'Control','app'),entry=path.join(directory,'service','main.py');
  if(!fs.existsSync(entry))return {installed:false};
  safeParents(entry);regular(entry);
  const executable=controlInterpreter({root,platform,env});
  return {installed:true,directory,executable,entry,args:['-X','utf8',entry],embedded:true,independent:false,reused:true};
 }
 function status(id){if(!id)return {ok:true,apps:APP_IDS.map(app_id=>({app_id,...status(app_id)}))};idCheck(id);return {ok:true,app_id:id,installationSupported:false,platform:targetPlatform,...installed(id)};}
 async function call(p){
  if(closed)throw Error('应用服务已关闭');
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['action','app_id','target_platform','target_arch'].includes(k)))throw Error('应用请求参数无效');
  if((p.target_platform!==undefined||p.target_arch!==undefined)&&!['resolve','acquire'].includes(p.action))throw Error('目标平台仅用于解析或获取；install始终安装本机版本');
  if(p.action==='status')return status(p.app_id);
  if(p.action==='list')return status();
  if(['resolve','acquire','install'].includes(p.action))throw Error('此模块随 Aieyra OS 构建与更新');
  throw Error('未知应用操作');
 }
 return {call,close(){closed=true;}};
}
module.exports={createApps,controlInterpreter};
