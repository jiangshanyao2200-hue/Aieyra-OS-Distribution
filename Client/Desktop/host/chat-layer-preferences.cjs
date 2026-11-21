// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; createChatLayerPreferences
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/chat-layer-preferences.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
const {atomicWriteJson}=require('./json-storage.cjs');
// Chromium profiles are per launch. Keep only UI choices in the stable,
// profile-owned runtime directory, using the shared atomic JSON writer.
function createChatLayerPreferences(file){
 const programChoices=new Map();
 return {call(p={}){
  const validPosition=v=>v&&typeof v==='object'&&Object.keys(v).length===2&&['x','y'].every(k=>Number.isFinite(v[k])&&v[k]>=0&&v[k]<=1);
  if(!/^(?:home|coding|program:[a-z][a-z0-9-]*):[a-zA-Z0-9_-]{1,128}$/.test(p.key||'')||p.open!==undefined&&typeof p.open!=='boolean'||p.position!==undefined&&!validPosition(p.position))throw Error('对话显示偏好无效');
  // A launch starts every program folded. Within this launch, switching pages
  // or docking the same session retains the user's explicit choice.
  const program=!p.key.startsWith('home:');
  if(program&&p.open!==undefined)programChoices.set(p.key,p.open);
  let entries={};try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1||!data.entries||Array.isArray(data.entries)||typeof data.entries!=='object')throw Error('对话显示偏好暂不可读');entries=data.entries;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!program&&p.open!==undefined||p.position!==undefined){
   entries[p.key]={...entries[p.key],...(!program&&p.open!==undefined?{open:p.open}:{}),...(p.position?{position:{...p.position}}:{}),at:Date.now()};
   const ordered=Object.entries(entries).sort((a,b)=>(b[1]?.at||0)-(a[1]?.at||0));entries=Object.fromEntries(ordered.slice(0,1024));
   fs.mkdirSync(path.dirname(file),{recursive:true});atomicWriteJson(file,{version:1,entries});
  }
  const position=entries[p.key]?.position;
  return {ok:true,open:program?programChoices.get(p.key)??false:typeof entries[p.key]?.open==='boolean'?entries[p.key].open:null,...(validPosition(position)?{position:{...position}}:{})};
 }};
}
module.exports={createChatLayerPreferences};
