// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: SDK/tools/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: fs; hash; canonical; goJSON; normalizeManifest; pack; exportPackage
// Impact: python -B scripts/code-atlas.py show SDK/tools/package.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Refresh a local author's file inventory, optionally sign with an Ed25519 PEM.
// The private key stays outside the package. This tool does not install or run it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
// Serialize directly: JS object enumeration reorders integer-looking keys,
// and UTF-16 sorting differs from Go's UTF-8 order for supplementary characters.
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const goJSON=v=>canonical(v).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
function normalizeManifest(m){
 delete m.signature;
 for(const name of ['capabilities','clients','platforms','dependencies','permissions'])m[name]??=null;
 // Match Manifest's typed omitempty fields before signing or persisting it.
 for(const dependency of m.dependencies||[])if(dependency.optional===false||dependency.optional===null)delete dependency.optional;
 if(m.presentation===null||m.presentation&&typeof m.presentation==='object'&&!Array.isArray(m.presentation)&&Object.keys(m.presentation).length===0)delete m.presentation;
 for(const view of Object.values(m.presentation||{}))if(view.entry===''||view.entry===null)delete view.entry;
}
function pack(folder,keyFile){
 const root=path.resolve(folder),manifestFile=path.join(root,'manifest.json');
 const m=JSON.parse(fs.readFileSync(manifestFile,'utf8'));normalizeManifest(m);
 const nativeTool=m.kind==='tool'&&m.presentation?.desktop?.renderer==='aieyra.native-tool';
 m.files={};let total=0;
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,e.name),name=path.relative(root,file).split(path.sep).join('/'),s=fs.lstatSync(file);
  if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('Package links are forbidden');
  if(e.isDirectory()){walk(file);continue;}if(file===manifestFile)continue;
  // Compiled tools ship their implementation and views. Their tests and author notes stay in the source tree.
  if(nativeTool&&(/^(?:AGENTS|CODEMAP)\.md$/i.test(e.name)||/(?:_test\.go|\.test\.[cm]?js)$/.test(e.name)))continue;
  if(!s.isFile()||s.size>64*1024*1024||(total+=s.size)>64*1024*1024||Object.keys(m.files).length>=2048)throw Error('Package exceeds limits');
  if(keyFile&&path.resolve(keyFile)===file)throw Error('Signing key must be outside the package');
  const bytes=fs.readFileSync(file);m.files[name]={sha256:hash(bytes),size:bytes.length};
 }}walk(root);
 if(keyFile){
  const key=crypto.createPrivateKey(fs.readFileSync(path.resolve(keyFile)));if(key.asymmetricKeyType!=='ed25519')throw Error('An Ed25519 key is required');
  const pub=crypto.createPublicKey(key).export({format:'jwk'});m.signature={public_key:Buffer.from(pub.x,'base64url').toString('base64'),value:crypto.sign(null,Buffer.from(goJSON(m)),key).toString('base64')};
 }
 const tmp=manifestFile+'.tmp-'+crypto.randomUUID();try{fs.writeFileSync(tmp,JSON.stringify(m,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,manifestFile);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 return {id:m.id,version:m.version,files:Object.keys(m.files).length,signed:!!m.signature};
}
// Export the already declared payload without rewriting its identity/signature.
// Source trees can contain tests and author notes; an importable package cannot.
function exportPackage(folder,destination){
 const root=path.resolve(folder),target=path.resolve(destination),limit=64*1024*1024;
 const inside=(a,b)=>{const r=path.relative(a,b);return !r||!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
 if(inside(root,target)||inside(target,root))throw Error('Export destination must be outside the source tree');
 function noLinks(file){for(let current=path.resolve(file);;){try{const s=fs.lstatSync(current);if(s.isSymbolicLink())throw Error('Package links are forbidden');}catch(e){if(e.code!=='ENOENT')throw e;}const parent=path.dirname(current);if(parent===current)break;current=parent;}}
 function read(file,max){
  noLinks(file);const s=fs.lstatSync(file);
  if(!s.isFile()||s.nlink!==1||s.size>max)throw Error('Package file is linked, non-regular or exceeds limits');
  const bytes=fs.readFileSync(file);if(bytes.length!==s.size||bytes.length>max)throw Error('Package file changed while reading');return bytes;
 }
 noLinks(root);noLinks(target);
 if(fs.existsSync(target))throw Error('Export destination already exists');
 const manifest=read(path.join(root,'manifest.json'),1024*1024),m=JSON.parse(manifest.toString('utf8'));
 if(m.schema!=='aieyra.mod/1'||!m.files||typeof m.files!=='object'||Array.isArray(m.files))throw Error('A Mod file inventory is required');
 const entries=Object.entries(m.files);if(!entries.length||entries.length>2048)throw Error('Package file count exceeds limits');
 const files=[['manifest.json',manifest]],seen=new Set(['manifest.json']);let total=0;
 for(const [name,want]of entries){
  if(Buffer.byteLength(name)>240||/[\\:<>"|?*\x00-\x1f\x7f]/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))||seen.has(name.toLowerCase()))throw Error('Invalid or duplicate package path: '+name);
  seen.add(name.toLowerCase());
  if(!want||!Number.isSafeInteger(want.size)||want.size<0||want.size>limit||!/^[a-f0-9]{64}$/.test(want.sha256)||(total+=want.size)>limit)throw Error('Invalid package file declaration: '+name);
  const bytes=read(path.join(root,...name.split('/')),want.size);
  if(bytes.length!==want.size||hash(bytes)!==want.sha256)throw Error('Declared package payload changed: '+name);
  files.push([name,bytes]);
 }
 fs.mkdirSync(path.dirname(target),{recursive:true});noLinks(path.dirname(target));fs.mkdirSync(target);
 try{for(const [name,bytes]of files){const file=path.join(target,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});}}
 catch(error){fs.rmSync(target,{recursive:true,force:true});throw error;}
 return {id:m.id,version:m.version,files:entries.length,signed:!!m.signature,destination:target,manifest_sha256:hash(manifest)};
}
if(require.main===module){
 const args=process.argv.slice(2);
 if(args[0]==='--export'){if(args.length!==3)throw Error('Usage: node SDK/tools/package.cjs --export SOURCE NEW_DESTINATION');console.log(JSON.stringify(exportPackage(args[1],args[2])));}
 else {if(!args.length||args.length>2)throw Error('Usage: node SDK/tools/package.cjs FOLDER [ED25519_PRIVATE_KEY_FILE]');console.log(JSON.stringify(pack(args[0],args[1])));}
}
module.exports={pack,goJSON,exportPackage};
