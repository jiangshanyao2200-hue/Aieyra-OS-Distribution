// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: crypto; hashes; executableIdentity; runtimeIdentity; lineage; surfaceOwner; liveDiagnostics
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/live-diagnostics.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const crypto=require('node:crypto'),fs=require('node:fs');
const {visualReadability}=require('./visual-readability.cjs');
const hashes=new Map();
function executableIdentity(file){
 if(!file)return {available:false};
 try{const stat=fs.statSync(file),key=file+':'+stat.size+':'+stat.mtimeMs;let sha256=hashes.get(key);if(!sha256){sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');hashes.clear();hashes.set(key,sha256);}return {path:file,size:stat.size,modified:stat.mtime.toISOString(),sha256,bytes:'current file on disk; loaded image not attested'};}catch{return {path:file,available:false};}
}
function runtimeIdentity(root,descriptor){
 const build=descriptor.build?Object.fromEntries(['build_id','source_digest','built_at'].map(key=>[key,String(descriptor.build[key]||'')])):null;
 return {hostPid:process.pid,hostParentPid:process.ppid,host:executableIdentity(process.execPath),
  corePid:descriptor.parent_pid||null,core:executableIdentity(descriptor.executable),version:descriptor.version||'',build,root};
}
function lineage(snapshot){
 const roles=(snapshot.roles||[]).slice(0,6).map(role=>({role:role.role,id:role.id,generation:role.generation,state:role.state,model:role.request_model||role.model_id,tools:(role.activity?.items||[]).slice(-20).map(item=>({id:item.id,tool:item.tool,action:item.action,state:item.state,generation:item.generation,revision:item.revision,sequence:item.sequence}))}));
 return {session:snapshot.session_id,scope:snapshot.link?.scope,epoch:snapshot.core_epoch,revision:snapshot.revision,historySegment:snapshot.history_segment,cursor:snapshot.cursor,messages:(snapshot.messages||[]).slice(-80).map(message=>({id:message.id,from:message.from,to:message.to,state:message.state,generation:message.generation,agent_id:message.agent_id,turn_id:message.turn_id})),live:Object.fromEntries(Object.entries(snapshot.live||{}).map(([role,value])=>[role,{agent_id:value.agent_id,generation:value.generation,phase:value.phase,turn_id:value.turn_id,body_id:value.body_id,revision:value.revision}])),roles,contentIncluded:false,limit:'Current public snapshot only; full receipts remain in the existing scoped history API.'};
}
// Fixed read-only probes; no caller-provided JavaScript, form values or chat.
function surfaceOwner(electron,id){
 const contains=view=>!!view&&(view.webContents?.id===id||(view.children||[]).some(contains));
 const owners=(electron.BrowserWindow?.getAllWindows()||[]).filter(w=>!w.isDestroyed()&&(w.webContents.id===id||contains(w.contentView)));
 if(owners.length!==1)return null;
 const [owner]=owners,handle=owner.getNativeWindowHandle();
 return {handle:(handle.length===4?BigInt(handle.readUInt32LE()):handle.readBigUInt64LE()).toString(),visible:owner.isVisible()&&!owner.isMinimized()};
}
async function liveDiagnostics({electron,root,profile,browser,control,descriptor={},observe,modules={}}){
 const prefix=require('node:url').pathToFileURL(root+require('node:path').sep).href;
 const active=new Set(Object.values(modules).filter(module=>module.visible||module.detached).map(module=>module.web_contents_id));
 const pages=electron.webContents.getAllWebContents().filter(w=>!w.isDestroyed()&&w.getURL().startsWith(prefix));
 pages.sort((a,b)=>Number(active.has(b.id))-Number(active.has(a.id)));
 const surfaces=[];
 for(const wc of pages.slice(0,Math.max(8,active.size))){
  const surface={id:wc.id,page:wc.getURL().slice(prefix.length).split('?')[0],crashed:wc.isCrashed(),loading:wc.isLoadingMainFrame(),zoom:wc.getZoomFactor()};
  surface.nativeOwner=surfaceOwner(electron,wc.id);
  try{
   const result=await wc.executeJavaScript(`(()=>{const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {view:document.getElementById('browser-view')?.checkVisibility()?'browser':document.body?.dataset.desktopPage||document.body?.dataset.view||'',viewport:{width:innerWidth,height:innerHeight},toolReceipts:[...document.querySelectorAll('.tool-receipt[data-id]')].slice(-24).map(n=>({id:n.dataset.id,state:n.dataset.state,open:n.open,visible:n.checkVisibility()})),errors:[...document.querySelectorAll('#browser-error,#module-notice,#settings-extension-status')].filter(n=>n.checkVisibility()&&n.textContent.trim()).map(n=>n.textContent.trim().slice(0,200)).slice(0,3),avatars:[...document.querySelectorAll('#avatar-user img,#avatar-user .avatar-initial,#presence-avatar,#avatar-eyra-img,.role-setting .role-face,.cp-row .role-face,.chat-avatar img')].slice(0,32).map(n=>{const owner=n.closest('.role-ring,.avatar-slot,#eyra-trigger'),circle=owner?.querySelector('.halo-edge'),style=getComputedStyle(n);return {id:n.id,ownerKey:n.closest('[data-key],[data-id]')?.dataset.key||n.closest('[data-id]')?.dataset.id||'',rect:rect(n),visible:n.checkVisibility(),opacity:Number(style.opacity),frame:owner?rect(owner):null,circle:circle?rect(circle):null,src:n.tagName==='IMG'?n.getAttribute('src')||'':''};})};})()`);
   surface.observation={...result,avatars:result.avatars.map(({src,...value})=>({...value,avatarHash:src?crypto.createHash('sha256').update(src).digest('hex'):null}))};
   surface.readability=await wc.executeJavaScript('('+visualReadability.toString()+')()');
  }catch{surface.observation={available:false};}
  surfaces.push(surface);
 }
 const current=profile.read();let trace={available:false};
 if(observe)try{trace={available:true,...lineage(await observe())};}catch{trace={available:false,error:'Current snapshot unavailable'};}
 return {available:true,pid:process.pid,identity:runtimeIdentity(root,descriptor),trace,profileVersion:current.version,avatarHash:current.eyraAvatar?crypto.createHash('sha256').update(current.eyraAvatar).digest('hex'):null,browser:browser.status(),link:control.peek(),surfaces};
}
module.exports={liveDiagnostics,lineage,executableIdentity,runtimeIdentity,surfaceOwner};
