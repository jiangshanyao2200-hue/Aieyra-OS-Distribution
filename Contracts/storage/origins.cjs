// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fs; file; normalized; read; relocate
// Impact: python -B scripts/code-atlas.py show Contracts/storage/origins.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
const file='.aieyra-origins.json';
const normalized=(v,windows)=>path.posix.normalize(windows?v.replaceAll('\\','/').toLowerCase():v);
function read(root,id){
 const target=path.join(root,file);let st;try{st=fs.lstatSync(target);}catch(e){if(e.code==='ENOENT')return {mappings:[],identityConfig:''};throw e;}
 if(!st.isFile()||st.isSymbolicLink()||st.size>8*1024*1024)throw Error('Invalid migration path mapping file');
 const bytes=fs.readFileSync(target);if(bytes.length>8*1024*1024)throw Error('Migration mapping exceeds limit');
 const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(d?.schema!==1||d.profile_id!==id||!Array.isArray(d.mappings)||d.mappings.length>10000)throw Error('Invalid migration path mapping');
 const seen=new Set();
 for(const m of d.mappings){
  if(typeof m.from!=='string'||typeof m.to!=='string'||typeof m.directory!=='boolean'||typeof m.windows!=='boolean')throw Error('Invalid migration path mapping');
  const from=normalized(m.from,m.windows);
  if(!/^(\/|[a-zA-Z]:\/)/u.test(from)||from==='/'||/^[a-zA-Z]:\/$/u.test(from)||/[\x00\r\n]/u.test(from)||!m.to||m.to==='.'&&!m.directory||m.to==='..'||m.to.startsWith('../')||m.to.startsWith('/')||/[\\:\x00\r\n]/u.test(m.to)||path.posix.normalize(m.to)!==m.to||seen.has(from))throw Error('Invalid migration path mapping');
  seen.add(from);Object.freeze(m);
 }
 if(d.identity_config!==undefined&&(typeof d.identity_config!=='string'||!d.mappings.some(m=>!m.directory&&m.to==='Config/config.json'&&normalized(m.from,m.windows)===normalized(d.identity_config,m.windows))))throw Error('Migration config identity has no matching origin');
 return Object.freeze({mappings:Object.freeze(d.mappings.sort((a,b)=>b.from.length-a.from.length)),identityConfig:d.identity_config||''});
}
function relocate(root,mappings,value){
 if(typeof value!=='string')return value;
 for(const m of mappings){const from=normalized(m.from,m.windows),v=normalized(value,m.windows);if(v===from)return path.join(root,...m.to.split('/'));if(m.directory&&v.startsWith(from+'/')){const raw=path.posix.normalize(m.windows?value.replaceAll('\\','/'):value);return path.join(root,...m.to.split('/'),...raw.split('/').slice(from.split('/').length));}}
 return value;
}
module.exports={file,read,relocate};
