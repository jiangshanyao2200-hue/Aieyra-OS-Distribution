// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/resources/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: relative; logical; prefixes; agentPrompt; toolManual; toolManualSidecar; parse
// Impact: python -B scripts/code-atlas.py show Contracts/resources/prompts.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Pure index contract; callers own filesystem access and legacy overrides.
function relative(name){return typeof name==='string'&&name.length>0&&name.length<=500&&!/[\\:\x00\r\n]/.test(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p));}
function logical(name){
 if(typeof name!=='string')throw Error('Invalid prompt resource');
 const parts=name.split('#');
 if(parts.length>2||!relative(parts[0])||!parts[0].endsWith('.txt')||parts.length===2&&!parts[1].trim())throw Error('Invalid prompt resource: '+name);
 return parts[0];
}
const prefixes=['Agent/program/prompts/','Agent/official/Eyra/prompts/','Agent/official/Eyra/context/prompts/','Agent/official/Vaya/prompts/','Agent/official/Cota/prompts/'];
const agentPrompt=name=>relative(name)&&name.endsWith('.txt')&&prefixes.some(p=>name.startsWith(p));
const toolManual=name=>relative(name)&&/^Tool\/(?:base|toolbox|workbox)\/official\/[a-z][a-z0-9_-]{0,63}\/(?:manual\.txt|(?:manual|prompts)\/[a-z][a-z0-9_-]{0,63}\.txt)$/.test(name);
const toolManualSidecar=name=>typeof name==='string'&&/^Tool\/(?:base|toolbox|workbox)\/official\/[a-z][a-z0-9_-]{0,63}\/(?:manual\.txt|(?:manual|prompts)\/[a-z][a-z0-9_-]{0,63}\.txt)\.(?:backup\.[a-f0-9]{64}|tmp\.[^/]+|write-lock|restore\.json)$/.test(name);
function parse(index){
 if(!index||typeof index!=='object'||Array.isArray(index)||!Array.isArray(index.resources))throw Error('Invalid prompt resource index');
 const locations=new Map();
 for(const row of index.resources){
  const key=logical(row?.file),legacy='Prompt/'+key;
  let target=legacy,legacySHA256='';
  if(row.path!=null&&row.path!==''){
   if(!(agentPrompt(row.path)||toolManual(row.path))||typeof row.legacy_sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.legacy_sha256))throw Error('Invalid mapped prompt resource: '+key);
   target=row.path;legacySHA256=row.legacy_sha256;
  }else if(row.legacy_sha256)throw Error('Prompt legacy digest needs a mapped path');
  if(row.read_only!=null&&typeof row.read_only!=='boolean')throw Error('Invalid prompt read-only declaration');
  const loc={path:target,legacy,legacySHA256,readOnly:row.read_only===true||key.startsWith('Matrix/默认/')},old=locations.get(key);
  if(old&&JSON.stringify(old)!==JSON.stringify(loc))throw Error('Conflicting prompt resource paths: '+key);
  locations.set(key,loc);
 }
 return {
  lookup(name){const key=logical(name);return {...locations.get(key)||{path:'Prompt/'+key,legacy:'Prompt/'+key,legacySHA256:'',readOnly:key.startsWith('Matrix/默认/')}};},
  files(){return [...new Set([...locations.values()].map(v=>v.path))].sort();},
  names(){return [...locations.keys()].sort();}
 };
}
module.exports={relative,logical,agentPrompt,toolManual,toolManualSidecar,parse};
