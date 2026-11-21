// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; time; catalog; relay; fixture; deferred; turn; observeCommand
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/link-host.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createLink,projectCatalog,projectControl,dataDirectory,childEnvironment,runCommand}=require('../host/link.cjs');
const time=Date.UTC(2026,9,2),stamp=new Date(time).toISOString();
const catalog=()=>({cursor:4,devices:[{device_id:'device',name:'My PC',admin:true,revoked:false,public_key:'secret'}],sessions:[{id:'device:os',device_id:'device',local_id:'os',title:'OS task',mode:'os',state:'busy',updated_at:stamp,private_key:'secret'}]});
const relay=()=>({protocol:'aieyra-control-relay/1',services:[{id:'device:control',device_id:'device',name:'Office',state:'online',updated_at:stamp,signing_key:'secret',signature:'secret',public_key:'secret'}]});
function fixture(options={}){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-link-host-')),calls=[];fs.writeFileSync(path.join(data,'owner.json'),'fixture never parsed by host');
 let impl=async(_file,args)=>args[0]==='version'?'Aieyra Link 0.3.0\n':JSON.stringify(args[0]==='status'?catalog():relay());
 const link=createLink({apps:{call:async p=>{assert.deepEqual(p,{action:'status',app_id:'aieyra.link'});return {installed:true,executable:'trusted-link'};}},env:{AIEYRA_LINK_DATA_DIR:data,APPDATA:data,PATH:'kept',AIEYRA_RUNTIME_TOKEN:'secret',AIEYRA_WORKSPACE_BRIDGE:'secret',ELECTRON_RUN_AS_NODE:'1',API_KEY:'secret'},now:()=>time,cacheMs:0,run:(...args)=>{calls.push(args);return impl(...args);},...options});
 return {data,calls,link,setRun(fn){impl=fn;},close(){link.close();fs.rmSync(data,{recursive:true,force:true});}};
}
test('catalog projections whitelist fields and separate observed execution from device pairing',()=>{
 const c=projectCatalog(catalog(),time),r=projectControl(relay(),time);assert(!JSON.stringify([c,r]).includes('secret'));assert.equal(c.sessions[0].state,'busy');assert.equal(c.devices[0].online,undefined);
 assert.equal(projectCatalog(catalog(),time+45001).sessions[0].state,'offline');assert.equal(projectControl(relay(),time+45001).services[0].state,'offline');
 const revoked=catalog();revoked.devices[0].revoked=true;assert.equal(projectCatalog(revoked,time).sessions[0].state,'offline');
 const invalid=catalog();invalid.sessions[0].updated_at='unknown';assert.equal(projectCatalog(invalid,time).sessions[0].state,'unknown');invalid.sessions[0].updated_at=new Date(time+6000).toISOString();assert.equal(projectCatalog(invalid,time).sessions[0].state,'unknown');
 assert.throws(()=>projectCatalog({...catalog(),sessions:null},time));assert.throws(()=>projectCatalog({...catalog(),cursor:NaN},time));assert.throws(()=>projectControl({...relay(),protocol:'other'},time));
});
test('host invokes only fixed read commands and excludes inherited secrets',async()=>{
 const f=fixture();try{const s=await f.link.status();assert.equal(s.hub_state,'online');assert.equal(s.identity_state,'verified');assert.equal(s.version,'0.3.0');assert.equal(s.catalog.sessions.length,1);
 assert.deepEqual(f.calls.map(x=>x[1][0]),['version','status','control-status']);for(const [,args,opt]of f.calls){assert.equal(opt.env.PATH,'kept');assert.equal(Object.keys(opt.env).some(k=>/TOKEN|BRIDGE|API_KEY|ELECTRON/.test(k)),false);if(args[0]!=='version')assert.deepEqual(args.slice(1),['--data',f.data]);}
 }finally{f.close();}
});
test('missing installation and identity do not attempt network queries or create identities',async()=>{
 for(const installed of [false,true]){const f=fixture({apps:{call:async()=>({installed,executable:'trusted-link'})}});try{fs.unlinkSync(path.join(f.data,'owner.json'));const s=await f.link.status();assert.equal(s.installed,installed);assert.equal(s.hub_state,'unknown');assert.equal(s.catalog,null);assert.equal(f.calls.filter(c=>c[1][0]!=='version').length,0);assert.deepEqual(fs.readdirSync(f.data),[]);}finally{f.close();}}
});
test('ambiguous discovery fails without passing file paths or raw errors to renderer',async()=>{
 const f=fixture({apps:{call:async()=>{throw Error('secret C:/private/identity');}}});try{const s=await f.link.status();assert.equal(s.installed,null);assert(!JSON.stringify(s).includes('secret'));assert.equal(f.calls.length,0);}finally{f.close();}
});
test('offline cache keeps prior rows with unknown activity; recovery refreshes authority',async()=>{
 const f=fixture();try{await f.link.status();f.setRun(async()=>{throw Object.assign(Error('secret'),{kind:'offline'});});const s=await f.link.status();assert.equal(s.hub_state,'offline');assert.equal(s.catalog.stale,true);assert.equal(s.catalog.sessions[0].state,'unknown');assert.equal(s.control.services[0].state,'unknown');assert.equal(s.catalog.cursor,4);assert(!JSON.stringify(s).includes('secret'));
 f.setRun(async(_file,args)=>JSON.stringify(args[0]==='status'?catalog():relay()));assert.equal((await f.link.status()).catalog.stale,false);
 }finally{f.close();}
});
test('partial or malformed catalogs do not turn unknown counts into zero',async()=>{
 const f=fixture();try{f.setRun(async(_file,args)=>args[0]==='version'?'unrecognized':args[0]==='status'?'{"cursor":0}':JSON.stringify(relay()));const s=await f.link.status();assert.equal(s.hub_state,'online');assert.equal(s.catalog,null);assert.equal(s.control.services.length,1);assert.equal(s.version,null);assert(s.error);}finally{f.close();}
});
test('failed discovery or authentication cannot retain a current verified identity',async()=>{
 let discover=true;const f=fixture({apps:{call:async()=>{if(!discover)throw Error('private discovery');return {installed:true,executable:'trusted-link'};}}});
 try{
  assert.equal((await f.link.status()).identity_state,'verified');discover=false;
  const missing=await f.link.status();assert.equal(missing.identity_state,'unknown');assert.equal(missing.catalog.stale,true);assert.equal(missing.catalog.sessions[0].state,'unknown');
  discover=true;f.setRun(async()=>{throw Error('private authentication refusal');});
  const refused=await f.link.status();assert.equal(refused.identity_state,'configured');assert.equal(refused.hub_state,'unknown');assert.equal(refused.catalog.stale,true);assert(!JSON.stringify(refused).includes('private'));
 }finally{f.close();}
});
test('changed identity clears old cache and late previous-identity results',async()=>{
 const f=fixture();try{await f.link.status();fs.writeFileSync(path.join(f.data,'device.json'),'new selected identity');f.setRun(async()=>{throw Error('refused');});const s=await f.link.status();assert.equal(s.catalog,null);assert.equal(s.control,null);
 f.setRun(async(_file,args)=>{if(args[0]==='status')fs.writeFileSync(path.join(f.data,'device.json'),'changed during status query');return JSON.stringify(args[0]==='status'?catalog():relay());});const next=await f.link.status();assert.equal(next.catalog,null);assert.equal(next.identity_state,'unknown');
 }finally{f.close();}
});
test('simultaneous polls share one bounded query and close aborts only owned commands',async()=>{
 const f=fixture();let release;try{await f.link.status();f.setRun(async(_file,args,opt)=>{assert.equal(opt.signal.aborted,false);await new Promise(r=>{if(args[0]==='status')release=r;else opt.signal.addEventListener('abort',r,{once:true});});return JSON.stringify(args[0]==='status'?catalog():relay());});const a=f.link.status(),b=f.link.status();assert.equal(a,b);await new Promise(r=>setImmediate(r));f.link.close();release();const s=await a;assert.equal(s.hub_state,'closed');assert.equal(s.catalog.stale,true);assert.equal(s.catalog.sessions[0].state,'unknown');}finally{f.close();}
});
test('real child timeout and failure retain no raw diagnostics',async()=>{
 await assert.rejects(runCommand(process.execPath,['-e','const timer=setTimeout(()=>{},10000);process.stdin.resume();process.stdin.on("end",()=>{clearTimeout(timer);process.exit(0);})'],{timeout:100,env:childEnvironment(process.env)}),e=>e.kind==='timeout'&&!e.message.includes('setTimeout'));
 await assert.rejects(runCommand(process.execPath,['-e','process.stderr.write("Link hub unavailable\\n");process.exit(1)'],{timeout:2000,env:childEnvironment(process.env)}),e=>e.kind==='offline');
 await assert.rejects(runCommand(process.execPath,['-e','process.stderr.write("secret identity");process.exit(1)'],{timeout:2000,env:childEnvironment(process.env)}),e=>e.kind==='query_failed'&&!e.message.includes('secret'));
});
test('platform data defaults follow Link CLI while override must be absolute',()=>{
 assert.equal(dataDirectory({APPDATA:path.resolve('roaming')},'win32'),path.resolve('roaming/AieyraLink'));assert.throws(()=>dataDirectory({AIEYRA_LINK_DATA_DIR:'relative'},'win32'));
});
test('Link summary distinguishes unknown, offline, unconfigured and a verified empty catalog',async()=>{
 const {linkSummary}=await import('../ui/link.mjs');assert.match(linkSummary({installed:true,identity_state:'missing'}),/尚未连接其他设备/);assert.match(linkSummary({installed:true,hub_state:'offline'}),/离线/);assert.match(linkSummary({installed:true,hub_state:'online',catalog:null}),/未知/);assert.match(linkSummary({installed:true,hub_state:'online',catalog:{sessions:[],stale:false}}),/0 个会话/);assert.match(linkSummary({installed:true,hub_state:'online',catalog:{sessions:[],stale:true}}),/未知/);
});

function deferred(){let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return {promise,resolve,reject};}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('设备码只由页面请求创建，合并并发、缓存有效期且不泄露到状态',async()=>{
 let clock=time;const f=fixture({now:()=>clock});let issued=0;
 try{
  f.setRun(async(_file,args)=>args[0]==='code'?JSON.stringify({device_code:'owned-invite-'+(++issued),expires_unix:Math.floor(clock/1000)+30}):args[0]==='version'?'Aieyra Link 0.3.0\n':JSON.stringify(args[0]==='status'?catalog():relay()));
  await f.link.status();assert.equal(issued,0);
  const [a,b]=await Promise.all([f.link.deviceCode(),f.link.deviceCode()]);assert.deepEqual(a,b);assert.equal(issued,1);
  await f.link.status();assert.equal(issued,1);assert.equal(JSON.stringify(await f.link.status()).includes('owned-invite'),false);
  assert.deepEqual(await f.link.deviceCode(),a);assert.equal(issued,1);
  clock+=31000;assert.notEqual((await f.link.deviceCode()).device_code,a.device_code);assert.equal(issued,2);
  fs.writeFileSync(path.join(f.data,'owner.json'),'changed identity bytes and size');
  await f.link.deviceCode();assert.equal(issued,3);
 }finally{await f.link.close();f.close();}
});

test('身份切换丢弃迟到设备码；退出等待本人邀请命令并禁止新查询',async()=>{
 const f=fixture(),gate=deferred();
 try{
  f.setRun(async()=>{await gate.promise;return JSON.stringify({device_code:'old-secret',expires_unix:Math.floor(time/1000)+60});});
  const reading=f.link.deviceCode();await turn();fs.writeFileSync(path.join(f.data,'owner.json'),'different owner');gate.resolve();
  assert.equal((await reading).device_code,'');
  const next=deferred();f.setRun(async()=>{await next.promise;return JSON.stringify({device_code:'late-secret',expires_unix:Math.floor(time/1000)+60});});
  const pending=f.link.deviceCode();await turn();const closing=f.link.close();let ended=false;closing.then(()=>{ended=true;});
  await turn();assert.equal(ended,false);const count=f.calls.length;assert.equal((await f.link.deviceCode()).device_code,'');assert.equal(f.calls.length,count);
  next.resolve();assert.equal((await pending).device_code,'');await closing;assert.equal(ended,true);
 }finally{gate.resolve();await f.link.close();f.close();}
});
test('close shares a Promise and waits for both active queries while blocking further polls',async()=>{
 const f=fixture(),gates=[deferred(),deferred()];
 try{
  await f.link.status();
  f.setRun(async(_file,args,opt)=>{assert.equal(opt.signal.aborted,false);await gates[args[0]==='status'?0:1].promise;return JSON.stringify(args[0]==='status'?catalog():relay());});
  const polling=f.link.status();await turn();const count=f.calls.length;
  const closing=f.link.close();assert(closing instanceof Promise);assert.equal(f.link.close(),closing);
  assert(f.calls.slice(-2).every(call=>call[2].signal.aborted));
  let finished=false;closing.then(()=>{finished=true;});
  assert.equal((await f.link.status()).hub_state,'closed');assert.equal(f.calls.length,count);
  await turn();assert.equal(finished,false);
  gates[0].resolve();await turn();assert.equal(finished,false);
  gates[1].resolve();await closing;
  const state=await polling;assert.equal(state.hub_state,'closed');assert.equal(state.catalog.stale,true);assert.equal(state.catalog.sessions[0].state,'unknown');
 }finally{gates.forEach(g=>g.resolve());f.close();}
});
test('closing during discovery waits for discovery without launching a Link command',async()=>{
 const discovery=deferred();let discoveries=0;
 const f=fixture({apps:{call:()=>{discoveries++;return discovery.promise;}}});
 try{
  const polling=f.link.status(),closing=f.link.close();assert(closing instanceof Promise);
  let finished=false;closing.then(()=>{finished=true;});await turn();assert.equal(finished,false);
  assert.equal((await f.link.status()).hub_state,'closed');assert.equal(discoveries,1);
  discovery.resolve({installed:true,executable:'trusted-link'});await closing;
  assert.equal((await polling).hub_state,'closed');assert.equal(f.calls.length,0);
 }finally{discovery.resolve({installed:false});f.close();}
});
test('closing during version detection drains that command and starts no catalog queries',async()=>{
 const version=deferred(),f=fixture();
 try{
  f.setRun(()=>version.promise);const polling=f.link.status();await turn();assert.equal(f.calls.length,1);
  const closing=f.link.close();assert(closing instanceof Promise);let finished=false;closing.then(()=>{finished=true;});
  await turn();assert.equal(finished,false);version.resolve('Aieyra Link 0.3.0\n');await closing;
  assert.equal((await polling).hub_state,'closed');assert.deepEqual(f.calls.map(c=>c[1][0]),['version']);
 }finally{version.resolve('Aieyra Link 0.3.0\n');f.close();}
});
test('a drain timeout reports a sanitized unconfirmed release and keeps the host closed',async()=>{
 const gates=[deferred(),deferred()],f=fixture({closeTimeout:30});let polling;
 try{
  f.setRun(async(_file,args)=>{if(args[0]==='version')return 'Aieyra Link 0.3.0\n';await gates[args[0]==='status'?0:1].promise;throw Error('secret C:/private/identity');});
  polling=f.link.status();await turn();const closing=f.link.close();
  assert(closing instanceof Promise);
  await assert.rejects(closing,e=>e.code==='link_release_unconfirmed'&&!e.message.includes('secret')&&!e.message.includes('C:/'));
  assert.equal(f.link.close(),closing);const count=f.calls.length;
  assert.equal((await f.link.status()).hub_state,'closed');assert.equal(f.calls.length,count);
  gates.forEach(g=>g.resolve());assert.equal((await polling).hub_state,'closed');
 }finally{gates.forEach(g=>g.resolve());if(polling)await polling;f.close();}
});
function observeCommand(){
 const cp=require('node:child_process'),vm=require('node:vm'),filename=require.resolve('../../../Program/official/link/service.cjs');
 const events=[];let child;const closed=deferred();
 const sandbox={module:{exports:{}},require(name){if(name!=='node:child_process')return require(name);return {spawn(...args){
  child=cp.spawn(...args);
  child.once('close',(code,signal)=>{events.push({event:'close',code,signal});closed.resolve();});return child;
 }};},process,AbortController,structuredClone,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
 return {run:sandbox.module.exports.runCommand,events,closed:closed.promise,get child(){return child;}};
}
test('stdin cancellation waits for actual child close without a termination signal',{timeout:5000},async()=>{
 const observed=observeCommand(),abort=new AbortController();
 const pending=observed.run(process.execPath,['-e','process.stdout.write("ready");process.stdin.resume();process.stdin.on("end",()=>setTimeout(()=>process.exit(0),80));'],{timeout:3000,signal:abort.signal,env:childEnvironment(process.env)});
 try{
  await new Promise((resolve,reject)=>{observed.child.stdout.once('data',resolve);observed.child.once('error',reject);});abort.abort();
  await assert.rejects(pending,e=>e.kind==='closed'&&e.message==='Link 查询未完成');
  assert.equal(observed.events[0].signal,null);assert(observed.events.some(e=>e.event==='close'),'runCommand settled before the real close event');
 }finally{abort.abort();await observed.closed;}
});
test('normal output and failed spawning settle only after the child close receipt',async()=>{
 for(const failed of [false,true]){
  const observed=observeCommand();
  const pending=observed.run(failed?path.join(os.tmpdir(),'aieyra-link-absent-'+process.pid+'-'+Date.now()):process.execPath,failed?[]:['-e','process.stdout.write("result")'],{timeout:2000,env:childEnvironment(process.env)});
  try{if(failed)await assert.rejects(pending,e=>e.kind==='query_failed');else assert.equal(await pending,'result');assert(observed.events.some(e=>e.event==='close'));}
  finally{await observed.closed;}
 }
});
