// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; createWindowTheme
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/window-theme.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createProfileStore}=require('./profile.cjs');
const {createAppearanceStore}=require('../src/os-appearance.cjs');
function createWindowTheme(config){
 const profile=createProfileStore(config),appearance=createAppearanceStore(config);
 const files=['companion-profile.json','os-appearance.json'].map(name=>path.join(path.dirname(config),name));
 let stamp='',cached=null;
 function read(){
  const next=files.map(file=>{try{const s=fs.statSync(file);return s.mtimeMs+':'+s.size;}catch{return 'missing';}}).join('|');
  if(!cached||stamp!==next){
   const p=profile.read(),a=appearance.read();
   cached={ok:true,background:p.background||'',backgroundBlur:p.backgroundBlur??12,backgroundOpacity:p.backgroundOpacity??.5,...(a.ok!==false?{settings:a.settings,fields:a.fields,version:a.version}:{})};stamp=next;
  }
  return cached;
 }
 function watch(changed){const listener=()=>changed(read());for(const file of files)fs.watchFile(file,{interval:500,persistent:false},listener);return ()=>{for(const file of files)fs.unwatchFile(file,listener);};}
 return {read,watch};
}
module.exports={createWindowTheme};
