// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fs; marker; key; readMarker; bind; scope; previousRoots; use
// Impact: python -B scripts/code-atlas.py show Contracts/storage/profile.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),ownership=require('./ownership.cjs'),origins=require('./origins.cjs');
const marker='.aieyra-userdata.json',schema='aieyra.user-data/1',configs=new Map(),roots=new Set(),mappings=new Map();
const key=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
function readMarker(root){
 const file=path.join(root,marker);let st;
 try{st=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(!st.isFile()||st.isSymbolicLink()||st.size>4096||key(fs.realpathSync(root))!==key(root))throw Error('Invalid or redirected user-data declaration');
 const fd=fs.openSync(file,'r');let bytes;
 try{const opened=fs.fstatSync(fd);if(opened.dev!==st.dev||opened.ino!==st.ino)throw Error('User-data declaration changed');const buffer=Buffer.alloc(4097);const count=fs.readSync(fd,buffer,0,buffer.length,0);bytes=buffer.subarray(0,count);}finally{fs.closeSync(fd);}
 if(bytes.length>4096)throw Error('User-data declaration exceeds limit');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),m=JSON.parse(text);
 if(!m||Array.isArray(m)||Object.keys(m).some(k=>!['schema','id','state','config'].includes(k))||m.schema!==schema||!/^[a-f0-9]{32}$/.test(m.id)||m.config!=='Config/config.json'||!['initializing','migrating','ready'].includes(m.state))throw Error('Damaged or unsupported user-data declaration; original retained');
 return m;
}
function bind(config){
 if(typeof config!=='string'||!config.trim())throw Error('Configuration identity is required');
 const file=path.resolve(config),id=key(file);if(configs.has(id)){const p=configs.get(id);ownership.available(p.root);return p;}
 const dir=path.dirname(file),canonical=path.basename(dir).toLowerCase()==='config',container=canonical?path.dirname(dir):dir,m=readMarker(container);
 if(m&&(m.state!=='ready'||key(file)!==key(path.join(container,m.config))))throw Error('User-data profile is incomplete or configuration identity does not match');
 if(m){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||key(fs.realpathSync(file))!==id)throw Error('Declared configuration is missing or redirected');}
 const p=Object.freeze({root:m?container:canonical?path.join(container,'Data'):dir,config:file,overrides:m?path.join(container,'Overrides'):container,unified:!!m,...(m?{id:m.id}:{})});
 const originMappings=m?origins.read(container,m.id):{mappings:[],identityConfig:''};
 ownership.available(p.root);
 mappings.set(id,originMappings);
 configs.set(id,p);if(m)roots.add(key(p.root));return p;
}
let scope=null,users=0;
function previousRoots(config){
 const p=bind(config);
 if(!p.unified||!require('./migration.cjs').receivedProfile(p.root,p.id))return [];
 return mappings.get(key(p.config)).mappings.filter(m=>m.directory&&m.to==='.').map(m=>m.from);
}
function use(config){
 const p=bind(config);if(users&&key(scope.config)!==key(p.config))throw Error('Another user-data profile owns this process');
 const releaseOwner=ownership.enter(p);scope=p;users++;let released=false;return ()=>{if(released)return;released=true;releaseOwner();if(--users===0)scope=null;};
}
module.exports={marker,schema,bind,previousRoots,identityConfig(config){const p=bind(config);return mappings.get(key(p.config))?.identityConfig||p.config;},resolve:config=>require('./migration.cjs').resolve(config,readMarker),relocate(config,value){const p=bind(config);return origins.relocate(p.root,mappings.get(key(p.config))?.mappings||[],value);},enter:config=>ownership.enter(bind(config)),readMarker,use,active:()=>scope,rootBound:root=>roots.has(key(root))};
