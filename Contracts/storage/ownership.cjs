// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fs; barrier; key; available; enter
// Impact: python -B scripts/code-atlas.py show Contracts/storage/ownership.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const barrier='.aieyra-migration.json',directory='.aieyra-profile-owners',leases=new Map();
const key=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
function available(root){try{fs.lstatSync(path.join(root,barrier));}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('Profile migration requires recovery or selection of the destination configuration; original retained');}
function enter(p){
 available(p.root);const id=key(p.root);let lease=leases.get(id);
 if(!lease){
  const dir=path.join(p.root,directory);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(key(fs.realpathSync(dir))!==key(dir))throw Error('Profile owner directory is redirected');
  const file=path.join(dir,process.pid+'-'+crypto.randomBytes(16).toString('hex')+'.json');let fd;
  try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({schema:1,pid:process.pid,config:p.config}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;available(p.root);}
  catch(e){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(file);}catch{}throw e;}
  lease={file,users:0};leases.set(id,lease);
 }
 lease.users++;let released=false;
 return ()=>{if(released)return;released=true;if(--lease.users===0){try{fs.unlinkSync(lease.file);}catch{}leases.delete(id);}};
}
// A normal process exit releases records even when its event loop owns the scope.
process.once('exit',()=>{for(const lease of leases.values())try{fs.unlinkSync(lease.file);}catch{}});
module.exports={barrier,directory,available,enter};
