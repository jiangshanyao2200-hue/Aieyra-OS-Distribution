// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: os; appRoot; userConfigPath; userPromptDir; profile; dataDir; privatePath; privateStorage; configCandidates; portableConfigPath; preparePortableConfig; resolveConfigPath; matrixDir; resolvePromptDir
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/paths.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const os=require('node:os'),path=require('node:path'),fs=require('node:fs');
const appRoot=()=>require('./resources.cjs').root();
function userConfigPath(){
 const base=process.env.APPDATA||(process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support'):path.join(os.homedir(),'.config'));
 return path.join(base,'AieyraOS','Config','config.json');
}
function userPromptDir(){return path.join(path.dirname(path.dirname(userConfigPath())),'Prompt','Matrix');}
function profile(file){return require('../../../Contracts/storage/profile.cjs').bind(file);}
function dataDir(file){return profile(file).root;}
function privatePath(file,area){return require('../../../Contracts/storage/paths.cjs').root(dataDir(file),area);}
function privateStorage(file){return require('../../../Contracts/storage/paths.cjs').describe(dataDir(file));}
function configCandidates(){
 const executable=path.dirname(process.execPath);
 return [...new Set([path.join(appRoot(),'Data','Config','config.json'),path.join(appRoot(),'Config','config.json'),path.join(executable,'config.json'),userConfigPath(),path.join(process.cwd(),'config.json')])];
}
function portableConfigPath(){return configCandidates().find(file=>fs.existsSync(file))||path.join(appRoot(),'Config','config.json');}
function preparePortableConfig(){
 const contract=require('../../../Contracts/storage/profile.cjs'),local=path.join(appRoot(),'Data'),marker=contract.readMarker(local);
 if(marker?.state==='ready')return contract.resolve(path.join(local,marker.config));
 if(!marker)for(const file of [path.join(appRoot(),'Config','config.json'),path.join(appRoot(),'config.json')]){
  try{if(!fs.lstatSync(file).isFile())throw Error('本地配置不是普通文件');return file;}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 // Use the native profile initializer; Electron must not implement a second
 // migration/first-use transaction or silently open a global AppData profile.
 const output=require('node:child_process').execFileSync(path.join(appRoot(),'Aieyra OS.exe'),['cli','profile','prepare','--root',appRoot()],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});
 const value=JSON.parse(output);if(!path.isAbsolute(value.config||''))throw Error('资料初始化未返回有效配置路径');return value.config;
}
function resolveConfigPath(explicit){const file=explicit&&String(explicit).trim()?path.resolve(String(explicit).trim()):process.platform==='win32'?preparePortableConfig():configCandidates().find(file=>fs.existsSync(file))||userConfigPath();const resolved=require('../../../Contracts/storage/profile.cjs').resolve(file);profile(resolved);return resolved;}
function matrixDir(dir){const child=path.join(dir,'Matrix');try{if(fs.statSync(child).isDirectory())return child;}catch{}return dir;}
function resolvePromptDir(explicit){
 if(explicit&&String(explicit).trim()){const p=require('../../../Contracts/storage/profile.cjs'),active=p.active(),value=path.resolve(String(explicit).trim());return matrixDir(active?p.relocate(active.config,value):value);}
 const active=require('../../../Contracts/storage/profile.cjs').active();
 if(active){const role=path.join(require('../../../Contracts/storage/paths.cjs').root(active.root,'agents'),'Eyra','prompts');try{if(fs.statSync(role).isDirectory())return role;}catch{}if(active.unified)return path.join(active.overrides,'Prompt','Matrix');}
 const candidates=[appRoot(),path.dirname(process.execPath),process.cwd()].flatMap(base=>[path.join(base,'Data','Agents','Eyra','prompts'),path.join(base,'Prompt','Matrix')]);candidates.push(userPromptDir());
 for(const dir of candidates){try{if(fs.statSync(dir).isDirectory())return dir;}catch{}}
 return candidates[0];
}
module.exports={profile,appRoot,userConfigPath,userPromptDir,dataDir,privatePath,privateStorage,portableConfigPath,configCandidates,resolveConfigPath,resolvePromptDir};
