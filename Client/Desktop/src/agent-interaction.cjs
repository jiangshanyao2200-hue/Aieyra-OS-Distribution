// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; createInteraction
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/agent-interaction.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),crypto=require('node:crypto'),net=require('node:net');
const {spawn}=require('node:child_process');
function createInteraction(configFile){
 const storage=require('./paths.cjs').privatePath(configFile,'browser');
 let child,ready,server,socket;const pending=new Map();
 function close(){const previous=child;child=null;ready=null;if(socket){socket.destroy();socket=null;}if(server){server.close();server=null;}if(previous)previous.kill();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Browser closed; interrupted operation outcome unknown'));}pending.clear();}
 async function ensure(){
  if(ready)return ready;
  ready=new Promise((resolve,reject)=>{
   const runtime=require('./runtime-paths.cjs').electronPath(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
   try{env.AIEYRA_BROWSER_LANGUAGE=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,'')).language||'zh-CN';}catch{env.AIEYRA_BROWSER_LANGUAGE='zh-CN';}
   env.AIEYRA_UI_CONFIG=path.resolve(configFile);
   const token=crypto.randomBytes(32).toString('hex');
   const timer=setTimeout(()=>{reject(Error('Browser startup timed out'));close();},15000);
   server=net.createServer(client=>{
    const authTimer=setTimeout(()=>client.destroy(),2000);let authenticated=false;
    client.on('error',()=>{});
    readline.createInterface({input:client}).on('line',line=>{
     let r;try{r=JSON.parse(line);}catch{client.destroy();return;}
     if(!authenticated){if(r.ready&&r.token===token&&!socket){authenticated=true;clearTimeout(authTimer);socket=client;clearTimeout(timer);resolve();}else client.destroy();return;}
     const p=pending.get(r.id);if(p){if(r.progress){p.phase=r.progress;return;}pending.delete(r.id);clearTimeout(p.timer);p.resolve(r);}
    }).on('error',()=>client.destroy());
    client.on('close',()=>{clearTimeout(authTimer);if(socket===client)close();});
   });
   server.once('error',()=>{clearTimeout(timer);reject(Error('Browser bridge unavailable'));close();});
   server.listen(0,'127.0.0.1',()=>{
    env.AIEYRA_BROWSER_BRIDGE=JSON.stringify({port:server.address().port,token});
    const processChild=spawn(runtime,[path.join(__dirname,'agent-browser-host.cjs'),storage],{env,stdio:'ignore',windowsHide:false});child=processChild;
    processChild.once('error',()=>{clearTimeout(timer);reject(Error('Browser runtime unavailable'));if(child===processChild)close();});
    processChild.once('exit',code=>{clearTimeout(timer);reject(Error(code===73?'Browser profile store is in use by another Aieyra window; finish and close its browser service before retrying.':'Browser exited'));if(child===processChild)close();});
   });
  });return ready;
 }
 async function browser(owner,args,signal){
  if(signal?.aborted)throw Error('Browser operation cancelled before dispatch');
  await ensure();if(pending.size>=16)throw Error('Too many browser requests');
  if(signal?.aborted)throw Error('Browser operation cancelled before dispatch');
  const id=crypto.randomBytes(12).toString('hex');
  return new Promise((resolve,reject)=>{
   const abort=()=>{if(socket&&!socket.destroyed)socket.write(JSON.stringify({cancel:id,owner})+'\n');};
   signal?.addEventListener('abort',abort,{once:true});
   const finish=fn=>value=>{signal?.removeEventListener('abort',abort);fn(value);};
   const timer=setTimeout(()=>{const phase=pending.get(id)?.phase||'dispatch';pending.delete(id);finish(reject)(Error('Browser operation timed out at '+phase+'; outcome unknown. Inspect before retrying.'));close();},45000);
   pending.set(id,{resolve:finish(resolve),reject:finish(reject),timer});socket.write(JSON.stringify({id,owner,arguments:args})+'\n');
  });
 }
 return {browser,close};
}
module.exports={createInteraction};
