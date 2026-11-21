// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fs; barrier; key; read; resolve
// Impact: python -B scripts/code-atlas.py show Contracts/storage/migration.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
const barrier='.aieyra-migration.json',receiptFile='.aieyra-migration-receipt.json';
const key=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
function read(root,name){
 const file=path.join(root,name);let st;try{st=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(!st.isFile()||st.isSymbolicLink()||st.size>8192||key(fs.realpathSync(root))!==key(root))throw Error('Invalid migration metadata');
 const fd=fs.openSync(file,'r');let bytes;
 try{const opened=fs.fstatSync(fd);if(opened.dev!==st.dev||opened.ino!==st.ino)throw Error('Migration metadata changed');const buf=Buffer.alloc(8193);bytes=buf.subarray(0,fs.readSync(fd,buf,0,buf.length,0));}finally{fs.closeSync(fd);}
 const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(bytes.length>8192||!m||Array.isArray(m)||Object.keys(m).some(k=>!['schema','id','state','source_config','source_root','destination','profile_id','inventory_sha'].includes(k))||m.schema!==1||!/^[a-f0-9]{32}$/u.test(m.id)||!/^[a-f0-9]{32}$/u.test(m.profile_id)||!['copying','complete'].includes(m.state)||![m.source_config,m.source_root,m.destination].every(v=>typeof v==='string'&&path.isAbsolute(v))||key(m.source_root)===key(m.destination)||m.state==='complete'&&!/^[a-f0-9]{64}$/u.test(m.inventory_sha))throw Error('Damaged migration metadata; originals retained');
 return m;
}
function resolve(config,readMarker){
 let current=path.resolve(config);const seen=new Set();
 for(let n=0;n<16;n++){
  if(seen.has(key(current)))throw Error('Migration redirect cycle');seen.add(key(current));
  const dir=path.dirname(current),canonical=path.basename(dir).toLowerCase()==='config',container=canonical?path.dirname(dir):dir,marker=readMarker(container);
  if(marker&&(marker.state!=='ready'||key(current)!==key(path.join(container,marker.config))))throw Error('User-data profile is incomplete');
  const root=marker?container:canonical?path.join(container,'Data'):dir,m=read(root,barrier);if(!m)return current;
  if(m.state!=='complete'||key(m.source_config)!==key(current)||key(m.source_root)!==key(root))throw Error('Profile migration is incomplete; resume profile migrate');
  const receipt=read(m.destination,receiptFile),target=readMarker(m.destination);
  if(!receipt||Object.keys(m).length!==Object.keys(receipt).length||Object.keys(m).some(k=>m[k]!==receipt[k])||!target||target.state!=='ready'||target.id!==m.profile_id)throw Error('Migration destination does not confirm the completed transfer');
  current=path.join(m.destination,target.config);
 }
 throw Error('Too many migration redirects');
}
module.exports={resolve};
