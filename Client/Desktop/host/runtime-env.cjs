// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; linkEnvironment; availablePort; prepareLinkEnvironment; togetherLegacyOffice
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/runtime-env.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Link 与 OS 共用 Config / Data 分区；显式隔离环境始终优先。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');

function linkEnvironment(env,configDir){
 const config=path.join(path.resolve(configDir),'config.json');
 const data=require('../src/paths.cjs').dataDir(config),base=require('../src/paths.cjs').privatePath(config,'link');
 const port=require('../src/resources.cjs').read('运行参数.json').control_port;
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('运行参数 control_port 必须是 1024–65535 的整数');
 const next={...env};
 const profile=require('../src/paths.cjs').profile(config);
 if(profile.unified){
  const identity=process.platform==='win32'?path.resolve(data).toLowerCase():path.resolve(data);
  next.AIEYRA_CONTROL_SCOPE=crypto.createHash('sha256').update(identity+'\n'+profile.id).digest('hex');
  next.AIEYRA_CONTROL_RUNTIME ||= path.join(base,'runtime');
 }
 next.AIEYRA_CONTROL_PORT ||= String(port);
 next.AIEYRA_CONTROL_DATA ||= path.join(base,'control');
 next.AIEYRA_CONTROL_STORAGE ||= path.join(path.resolve(configDir),'link','control-storage.json');
 next.AIEYRA_LINK_DATA_DIR ||= path.join(base,'hub');
 // 兼容协议变量名；其值指向 Data，供 Control 读取模块运行注册表。
 next.AIEYRA_OS_CONFIG_DIR ||= data;
 for(const dir of [next.AIEYRA_CONTROL_DATA,next.AIEYRA_LINK_DATA_DIR])fs.mkdirSync(dir,{recursive:true});
 return next;
}

async function availablePort(port){
 const server=net.createServer();
 return new Promise((resolve,reject)=>{
  server.once('error',error=>error.code==='EADDRINUSE'||error.code==='EACCES'?resolve(null):reject(error));
  server.listen({host:'127.0.0.1',port,exclusive:true},()=>{const selected=server.address().port;server.close(error=>error?reject(error):resolve(selected));});
 });
}
async function prepareLinkEnvironment(env,configDir){
 const next=linkEnvironment(env,configDir);
 if(!next.AIEYRA_CONTROL_SCOPE||env.AIEYRA_CONTROL_PORT)return next;
 const legacyOffice=togetherLegacyOffice(path.join(configDir,'config.json'));
 if(legacyOffice){
  next.AIEYRA_CONTROL_PORT=new URL(legacyOffice.origin).port;
  return next;
 }
 const file=path.join(configDir,'link','instance.json'),scope=next.AIEYRA_CONTROL_SCOPE;
 let port=20000+parseInt(scope.slice(0,8),16)%40000;
 try{
  const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw Error('Link 实例配置无效');
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  if(saved.schema!==1||!Number.isInteger(saved.port)||saved.port<1024||saved.port>65535||!/^[a-f0-9]{64}$/.test(saved.scope||''))throw Error('Link 实例配置无效');
  if(saved.scope===scope)port=saved.port;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 let selected=await availablePort(port);
 if(!selected){
  let health;
  try{health=await require('./control.cjs').requestJSON('http://127.0.0.1:'+port,'/api/health',{timeout:1000,limit:8192});}catch{}
  // A matching live office may be shared by OS/Link of this profile only.
  selected=health?.service==='aieyra-control'&&health.profile_scope===scope?port:await availablePort(0);
 }
 if(!selected)throw Error('无法为本资料分配 Link 端口');
 next.AIEYRA_CONTROL_PORT=String(selected);
 require('./json-storage.cjs').atomicWriteJson(file,{schema:1,scope,port:selected});
 return next;
}
function togetherLegacyOffice(config){
 const dir=path.join(path.dirname(config),'link');
 const read=name=>{
  const file=path.join(dir,name),st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw Error('本地办公室交接配置无效');
  return JSON.parse(fs.readFileSync(file,'utf8'));
 };
 let marker;
 try{marker=read('together-owner.json');}catch(error){if(error.code==='ENOENT')return undefined;throw error;}
 const saved=read('instance.json');
 const env=linkEnvironment({},path.dirname(config));
 if(marker.schema!==1||marker.owner!=='together'||saved.schema!==1||
    !/^[a-f0-9]{64}$/.test(saved.scope||'')||saved.scope!==env.AIEYRA_CONTROL_SCOPE||
    marker.scope!==saved.scope||marker.port!==saved.port||
    !Number.isInteger(saved.port)||saved.port<1024||saved.port>65535){
  throw Error('本地办公室交接身份与当前 OS 资料不一致');
 }
 const dataRoot=env.AIEYRA_CONTROL_DATA;
 return {origin:'http://127.0.0.1:'+saved.port,dataRoot,configFile:path.join(dataRoot,'config','control.json'),
  stateRoot:path.join(dataRoot,'shared'),runtimeRoot:env.AIEYRA_CONTROL_RUNTIME,
  hubRoot:env.AIEYRA_LINK_DATA_DIR,scope:saved.scope};
}
module.exports={linkEnvironment,prepareLinkEnvironment,togetherLegacyOffice};
