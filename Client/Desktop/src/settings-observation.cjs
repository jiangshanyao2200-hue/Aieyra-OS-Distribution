// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; targets; location; acknowledge; observed
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/settings-observation.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),cfg=require('./config.cjs');
const targets={profile:'companion-profile.json',appearance:'os-appearance.json',interface:'interface-preferences.json'};
const location=config=>path.join(require('./paths.cjs').privatePath(config,'runtime'),'settings-observed');
function acknowledge(config,scope,version,windowID){
 if(!Object.hasOwn(targets,scope)||typeof version!=='string')throw Error('设置观察标识无效');
 if(cfg.version(path.join(path.dirname(config),targets[scope]))!==version)return {ok:true,observed:false,reason:'superseded'};
 const dir=location(config);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const row={scope,version,pid:process.pid,window_id:windowID,at:new Date().toISOString()},file=path.join(dir,scope+'-'+process.pid+'.json');
 cfg.withWriteLock(file,undefined,()=>{const tmp=file+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(row),{mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}});
 return {ok:true,observed:true};
}
function observed(config,scope,version){
 if(!Object.hasOwn(targets,scope))return {state:'request_or_open_boundary'};
 let rows=[];try{rows=fs.readdirSync(location(config)).filter(n=>n.startsWith(scope+'-')&&n.endsWith('.json'));}catch(e){if(e.code!=='ENOENT')return {state:'unavailable',error:e.message};}
 const consumers=[];
 for(const name of rows)try{const row=JSON.parse(fs.readFileSync(path.join(location(config),name),'utf8'));if(row.version===version&&Number.isSafeInteger(row.pid)){process.kill(row.pid,0);consumers.push(row);}}catch{}
 return {state:consumers.length?'observed':'pending_observation',consumers};
}
module.exports={targets,acknowledge,observed};
