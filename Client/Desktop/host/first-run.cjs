// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; readOptional; installationSettings; ensureDesktopShortcut
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/first-run.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
const {atomicWriteJson}=require('./json-storage.cjs');
function readOptional(file){
 try{const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>8192)throw Error('安装记录无效');return JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function installationSettings(config,root){
 const value=readOptional(path.join(path.dirname(config),'installation.json'));
 if(value===null)return {schema:1,role:'user'};
 if(value.schema!==1||!['user','development'].includes(value.role)||Object.keys(value).some(k=>!['schema','role'].includes(k)))throw Error('安装角色配置无效');
 if(root&&value.role==='development'){
  const binding=readOptional(path.join(root,'.aieyra-installation.json'));
  if(binding?.schema===1&&typeof binding.dataRoot==='string'&&path.isAbsolute(binding.dataRoot)){
   const profile=require('../src/paths.cjs').profile(config);
   // An installed copy can receive a profile that was previously used to develop the OS.
   if(profile.unified&&binding.profileId===profile.id&&path.relative(binding.dataRoot,profile.root)===''&&
      require('../../../Contracts/storage/migration.cjs').receivedProfile(profile.root,profile.id))return {schema:1,role:'user'};
  }
 }
 return value;
}
function ensureDesktopShortcut({root,config,desktop,shell}){
 if(installationSettings(config,root).role==='development')return {status:'development'};
 const p=require('../src/paths.cjs').profile(config);
 if(!p.unified)return {status:'legacy'};
 const record=path.join(path.dirname(config),'windows-first-run.json'),target=path.join(path.resolve(root),'Aieyra OS.exe');
 const prior=readOptional(record);
 if(prior?.schema===1&&prior.target===target&&['created','existing','preserved-other'].includes(prior.status))return prior;
 const installedShortcut=path.join(desktop,'Aieyra OS','Aieyra OS.lnk');
 const shortcut=fs.existsSync(installedShortcut)?installedShortcut:path.join(desktop,'Aieyra OS.lnk');
 let status='created';
 if(fs.existsSync(shortcut)){
  const old=shell.readShortcutLink(shortcut);
  status=path.resolve(old.target).toLowerCase()===target.toLowerCase()?'existing':'preserved-other';
 }else{
  fs.mkdirSync(desktop,{recursive:true});
  if(!shell.writeShortcutLink(shortcut,'create',{target,cwd:path.resolve(root),args:'',icon:target,iconIndex:0,description:'Aieyra OS'}))throw Error('Windows 未确认快捷方式写入');
  const saved=shell.readShortcutLink(shortcut);
  if(path.resolve(saved.target).toLowerCase()!==target.toLowerCase()||saved.args||path.resolve(saved.cwd).toLowerCase()!==path.resolve(root).toLowerCase())throw Error('快捷方式读回校验失败');
 }
 const result={schema:1,status,target,shortcut};atomicWriteJson(record,result);return result;
}
module.exports={installationSettings,ensureDesktopShortcut};
