// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: storage; interfaceConfig; runtime
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/agent-browser-host.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Standalone wrapper used by CLI/config; OS injects its own native mount.
const {app}=require('electron'),path=require('node:path'),net=require('node:net'),readline=require('node:readline');
const storage=process.argv[2];if(!storage||!path.isAbsolute(storage))throw Error('Missing browser storage');
const interfaceConfig=process.env.AIEYRA_UI_CONFIG||path.join(path.dirname(storage),'config.json');delete process.env.AIEYRA_UI_CONFIG;
app.setPath('userData',storage);app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
if(!app.requestSingleInstanceLock())app.exit(73);
let runtime,closing=false,closeFinished=false;app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
 if(!runtime||closeFinished)return;
 event.preventDefault();if(closing)return;closing=true;
 Promise.resolve().then(()=>runtime.close()).catch(()=>{process.exitCode=1;process.stderr.write('Browser shutdown cleanup failed\n');}).finally(()=>{closeFinished=true;app.quit();});
});
app.whenReady().then(()=>{
 app.setAccessibilitySupportEnabled(true);
 const address=JSON.parse(process.env.AIEYRA_BROWSER_BRIDGE||'{}');delete process.env.AIEYRA_BROWSER_BRIDGE;if(!Number.isInteger(address.port)||!/^[a-f0-9]{64}$/.test(address.token||''))return app.quit();
 runtime=require('./browser-runtime.cjs').createBrowserRuntime({storage,interfaceConfig,language:process.env.AIEYRA_BROWSER_LANGUAGE==='en-US'?'en-US':'zh-CN'});
 const bridge=net.connect(address.port,'127.0.0.1',()=>reply({ready:true,token:address.token})),operations=new Map();
 const reply=v=>{if(!bridge.destroyed)bridge.write(JSON.stringify(v)+'\n');};bridge.on('error',()=>app.quit());bridge.on('close',()=>app.quit());
 const lines=readline.createInterface({input:bridge});lines.on('error',()=>app.quit());lines.on('close',()=>app.quit());
 lines.on('line',line=>{
  let req;try{if(line.length>1<<20)throw Error('oversized');req=JSON.parse(line);}catch{bridge.destroy();return;}
  if(req.cancel){const op=operations.get(req.cancel);if(op?.owner===req.owner)op.controller.abort();return;}
  if(operations.has(req.id))return;
  const controller=new AbortController();operations.set(req.id,{owner:req.owner,controller});
  runtime.execute(req.owner,req.arguments,controller.signal,phase=>reply({id:req.id,progress:phase})).then(result=>reply({id:req.id,...result}),e=>reply({id:req.id,ok:false,error:e.message})).finally(()=>operations.delete(req.id));
 });
}).catch(error=>{process.stderr.write(error.message+'\n');app.exit(1);});
