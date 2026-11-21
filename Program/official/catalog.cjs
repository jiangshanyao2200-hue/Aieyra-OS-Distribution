// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: fs; programs; find; verify; navigationSource
// Impact: python -B scripts/code-atlas.py show Program/official/catalog.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Navigation and discovery are projected from the owning program packages.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const programs=Object.freeze(require('./catalog.json').map(folder=>{
 const root=path.join(__dirname,folder),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 const definition=JSON.parse(fs.readFileSync(path.join(root,manifest.entrypoints.program),'utf8'));
 if(manifest.id!=='aieyra.'+folder||definition.desktop.native!==folder)throw Error('官方程序身份与目录不一致');
 const {navigation}=definition.desktop;
 return Object.freeze({id:folder,packageID:manifest.id,title:manifest.name,summary:manifest.summary,order:navigation.order,tab:navigation.tab,host:navigation.host,
  ...(navigation.host==='surface'?{page:'../../Program/official/'+folder+'/'+definition.desktop.entry}:{}),
  ...(navigation.background?{background:navigation.background}:{}),root,manifest,definition});
}));
const find=key=>programs.find(row=>row.id===key||row.packageID===key);
function verify(item,files){
 const own=find(item?.manifest?.id);
 if(!own||item.origin!=='official'||item.manifest.kind!=='program')throw Error('原生程序需要宿主认可的官方包');
 const expected=own.manifest,compatible=require('./compatibility.json')[item.manifest.id]?.find(row=>row.digest===item.digest);
 if(Object.keys(item.manifest.files).sort().join('\n')!==Object.keys(expected.files).sort().join('\n')||item.manifest.version!==expected.version)throw Error('原生程序载荷与当前宿主不匹配');
 for(const [name,want]of Object.entries(expected.files)){
  const bytes=fs.readFileSync(path.join(own.root,...name.split('/')));
  const previous=compatible?.documentation[name],accepted=previous&&name.endsWith('.md')?previous:want,installed=files[name];
  if(item.manifest.files[name].sha256!==accepted.sha256||item.manifest.files[name].size!==accepted.size||bytes.length!==want.size||crypto.createHash('sha256').update(bytes).digest('hex')!==want.sha256||!installed||installed.length!==accepted.size||crypto.createHash('sha256').update(installed).digest('hex')!==accepted.sha256)throw Error('原生程序源码与已登记版本不一致：'+name);
 }
 return own;
}
function navigationSource(){return '// Generated from Program official manifests by catalog.cjs --write-navigation.\nexport const programPages=Object.freeze('+JSON.stringify(programs.filter(p=>p.host==='surface').sort((a,b)=>a.order-b.order).map(p=>({key:p.id,title:p.title,tab:p.tab})))+'.map(Object.freeze));\n';}
if(require.main===module&&process.argv[2]==='--write-navigation')fs.writeFileSync(path.join(__dirname,'navigation.mjs'),navigationSource());
module.exports={programs,find,verify,navigationSource};
