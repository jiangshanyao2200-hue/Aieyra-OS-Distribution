// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: windows
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/mod-packages.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createProgramRuntime,descriptor}=require('../../../Program/runtime/desktop.cjs');
const {createModPackages}=require('../host/mod-packages.cjs');
const {pack}=require('../../../SDK/tools/package.cjs');
const {createDesktopTools}=require('../host/desktop-tools.cjs');
function windows(){
 const opened=[];
 class Window {
  constructor(options){this.options=options;this.dead=false;this.events={};this.page=vm.createContext({aieyraProgram:{snapshot:()=>({value:3}),invoke:(_op,args)=>({value:args.value})}});this.webContents={session:{protocol:{isProtocolHandled:async()=>false,unhandle:async()=>{},handle:(_name,handler)=>{this.handler=handler;}},setPermissionRequestHandler:fn=>{this.permission=fn;},setPermissionCheckHandler:()=>{},on(){}},setWindowOpenHandler:fn=>{this.newWindow=fn;},on:(name,fn)=>{this.events[name]=fn;},executeJavaScript:code=>vm.runInContext(code,this.page)};opened.push(this);}
  on(name,fn){this.events[name]=fn;}loadURL(url){this.url=url;return Promise.resolve();}show(){this.shown=true;}isDestroyed(){return this.dead;}destroy(){this.dead=true;this.events.closed?.();}close(){this.destroy();}
 }
 return {Window,opened};
}
test('a Core-side cancellation during package resolve cannot dispatch a sandbox operation',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-program-cancel-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../../SDK/examples/program-notebook'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows();
 const item={manifest,directory:source,digest:'1'.repeat(64),enabled:true,origin:'local'};let hold=false,release,entered,dispatches=0;
 const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,core:async()=>{if(hold){entered();await gate;}return {ok:true,item};}});t.after(()=>service.close());
 const tools=createDesktopTools({sessionId:'owner',modPackages:service});await tools.call({action:'program',operation:'open',arguments:{id:manifest.id}},'owner');
 const execute=f.opened[0].webContents.executeJavaScript;f.opened[0].webContents.executeJavaScript=code=>{dispatches++;return execute(code);};
 const request={action:'program',operation:'invoke',arguments:{id:manifest.id,operation:'set_text',arguments:{value:9},request_id:'cancelled-program'}};
 const cancel=new AbortController();hold=true;const pending=tools.call(request,'owner',cancel.signal).then(value=>({value}),error=>({error}));await started;cancel.abort();release();
 assert.equal((await pending).error?.code,'CANCELLED');assert.equal(dispatches,0);
 await assert.rejects(tools.call(request,'owner',cancel.signal),error=>error.code==='CANCELLED');assert.equal(dispatches,0);
});
test('a cancelled journaled program edit remains cancelled across transport retry and a fresh receipt store',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-queued-program-cancel-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../../SDK/examples/program-notebook'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows();let release,entered,dispatches=0;
 const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),item={manifest,directory:source,digest:'1'.repeat(64),enabled:true,origin:'local'};
 f.Window.prototype.loadURL=async function(url){this.url=url;entered();await gate;};
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,core:async()=>({ok:true,item})});t.after(()=>service.close());
 const tools=createDesktopTools({sessionId:'owner',modPackages:service}),cancel=new AbortController();
 const opening=tools.call({action:'program',operation:'open',arguments:{id:manifest.id}},'owner');await started;
 const execute=f.opened[0].webContents.executeJavaScript;f.opened[0].webContents.executeJavaScript=code=>{dispatches++;return execute(code);};
 const request={action:'program',operation:'invoke',arguments:{id:manifest.id,operation:'set_text',arguments:{value:9},request_id:'cancelled-queued-edit'}};
 const invoking=tools.call(request,'owner',cancel.signal);await new Promise(r=>setImmediate(r));cancel.abort();release();await opening;
 const result=await invoking;assert.equal(result.ok,false);assert.equal(result.state,'failed');assert.equal(result.code,'CANCELLED');assert.equal(dispatches,0);
 const replay=await tools.call(request,'owner',cancel.signal);assert.equal(replay.replayed,true);assert.equal(replay.code,'CANCELLED');assert.equal(dispatches,0);
 const reopened=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,core:async()=>({ok:true,item})});t.after(()=>reopened.close());
 const persisted=await reopened.call({...request.arguments,action:'mod_invoke'});assert.equal(persisted.replayed,true);assert.equal(persisted.code,'CANCELLED');assert.equal(dispatches,0);
});
test('cancelling program open while resolve is pending cannot create a late sandbox window',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-open-cancel-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../../SDK/examples/program-notebook'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows();let release,entered;
 const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),item={manifest,directory:source,digest:'1'.repeat(64),enabled:true,origin:'local'};
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,core:async()=>{entered();await gate;return {ok:true,item};}});t.after(()=>service.close());
 const tools=createDesktopTools({sessionId:'owner',modPackages:service}),cancel=new AbortController();
 const pending=tools.call({action:'program',operation:'open',arguments:{id:manifest.id}},'owner',cancel.signal).then(value=>({value}),error=>({error}));
 await started;cancel.abort();release();assert.equal((await pending).error?.code,'CANCELLED');assert.equal(f.opened.length,0);
});
test('already cancelled package changes and program close perform no registry or window effects',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-package-cancel-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));let effects=0;
 const service=createModPackages({dataDir,core:async()=>{effects++;return {ok:true,items:[]};},nativePrograms:{closeProgram:async()=>{effects++;},shutdown:async()=>{}}});t.after(()=>service.close());
 const tools=createDesktopTools({sessionId:'owner',modPackages:service}),cancel=new AbortController();cancel.abort();
 for(const [action,operation]of [['package','install'],['package','enable'],['package','disable'],['package','rollback'],['package','remove'],['program','close']]){
  const result=await tools.call({action,operation,arguments:{id:'fixture.program',confirmed:true}},'owner',cancel.signal).then(value=>({value}),error=>({error}));
  assert.equal(result.error?.code,'CANCELLED',operation);assert.equal(effects,0,operation);
 }
});
test('program runtime restricts origins, navigation, permissions and human/observed modes',async()=>{
 const f=windows(),runtime=createProgramRuntime({BrowserWindow:f.Window,offscreen:true}),files={'index.html':Buffer.from('<p>Program</p>')};
 await runtime.open({id:'example.program',name:'Program',digest:'one',files,entry:'index.html',mode:'observed',operations:[{id:'set'}],network:['https://example.com']});
 const w=f.opened[0];assert.equal(w.options.webPreferences.nodeIntegration,false);assert.equal(w.options.webPreferences.sandbox,true);assert.equal(w.shown,undefined);
 assert.equal((await w.handler({url:'aieyra-resource://other.program/index.html',method:'GET'})).status,403);
 const response=await w.handler({url:'aieyra-resource://example.program/index.html',method:'GET'});assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/connect-src 'self' https:\/\/example.com;/);
 let prevented=0;for(const name of ['will-navigate','before-input-event','before-mouse-event'])w.events[name]({preventDefault(){prevented++;}},'https://example.com');assert.equal(prevented,3);
 assert.equal((await runtime.invoke('example.program','set',{value:7})).result.value,7);
 await assert.rejects(runtime.invoke('example.program','undeclared',{}),/没有声明/);
 runtime.close('example.program');await runtime.open({id:'example.program',name:'Human',digest:'two',files,entry:'index.html',mode:'human',operations:[]});await assert.rejects(runtime.invoke('example.program','snapshot',{}),/仅供用户/);runtime.shutdown();
});
test('desktop uses Core revisions and revokes active programs on disable; imports never run code',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-mod-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.join(dataDir,'source');fs.cpSync(path.resolve(__dirname,'../../../SDK/examples/program-notebook'),source,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows();let revision=1,enabled=true,invokes=0;
 const item=()=>({manifest,directory:source,digest:'1'.repeat(64),enabled,grants:null,origin:'local'});
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,core:async(action,p)=>{assert.equal(action,'workspace.packages');invokes++;if(p.action==='resolve'){if(!enabled)throw Error('not enabled');return {ok:true,item:item()};}if(p.action==='list')return {ok:true,revision,items:[item()]};if(p.action==='disable'){assert.equal(p.expected_revision,revision);revision++;enabled=false;return {ok:true,revision,item:item()};}throw Error('unexpected action');}});t.after(()=>service.close());
 assert.equal(f.opened.length,0);await service.call({action:'mod_open',id:manifest.id});assert.equal(f.opened.length,1);
 const args={action:'mod_invoke',id:manifest.id,operation:'set_text',arguments:{value:8},request_id:'operation-one'};const first=await service.call(args),second=await service.call(args);assert.equal(first.ok,true);assert.equal(second.replayed,true);
 await assert.rejects(service.call({action:'mod_disable',id:manifest.id,expected_revision:revision}),/授权/);
 await service.call({action:'mod_disable',id:manifest.id,confirmed:true,expected_revision:revision});assert.equal(f.opened[0].dead,true);await assert.rejects(service.call({action:'mod_open',id:manifest.id}),/not enabled/);assert.ok(invokes>0);
});
test('SDK refreshes the exact inventory and program definitions reject invented modes',t=>{
 const source=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-author-'));t.after(()=>fs.rmSync(source,{recursive:true,force:true}));fs.cpSync(path.resolve(__dirname,'../../../SDK/examples/program-notebook'),source,{recursive:true});
 fs.writeFileSync(path.join(source,'new.txt'),'author asset');const result=pack(source);assert.equal(result.signed,false);
 const m=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));assert.equal(m.files['new.txt'].size,12);
 const files=Object.fromEntries(Object.keys(m.files).map(n=>[n,fs.readFileSync(path.join(source,n))]));assert.equal(descriptor(m,files).mode,'collaborative');files['program.json']=Buffer.from('{"schema":"aieyra.program/1","mode":"invented"}');assert.throws(()=>descriptor(m,files),/模式/);
});

test('common program runtime reuses exact legacy user storage and refuses divergent roots',async t=>{
 const crypto=require('node:crypto'),root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-program-storage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const id='legacy.notebook',key=crypto.createHash('sha256').update(id).digest('hex'),storageRoot=path.join(root,'new'),legacyStorageRoot=path.join(root,'old'),old=path.join(legacyStorageRoot,key);fs.mkdirSync(old,{recursive:true});fs.writeFileSync(path.join(old,'user'),'unchanged');
 const opened=[],f=windows(),runtime=createProgramRuntime({BrowserWindow:f.Window,storageRoot,legacyStorageRoot,session:{fromPath(p){opened.push(p);return {};}}});t.after(()=>runtime.shutdown());
 const program={id,name:'Legacy',digest:'one',entry:'index.html',files:{'index.html':'ok'},mode:'human'};await runtime.open(program);assert.deepEqual(opened,[old]);assert.equal(fs.readFileSync(path.join(old,'user'),'utf8'),'unchanged');runtime.close(id);
 fs.mkdirSync(path.join(storageRoot,key),{recursive:true});await assert.rejects(runtime.open(program),/同时存在/);assert.equal(opened.length,1);
});

for(const failed of [false,true])test('an older package snapshot '+(failed?'failure':'reply')+' cannot revoke a newer active sandbox',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-package-order-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../../SDK/examples/program-notebook'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows();
 const item={manifest,directory:source,digest:'1'.repeat(64),enabled:true,origin:'local'},seen=[];let release,reject,lists=0;
 const held=new Promise((a,b)=>{release=a;reject=b;});
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,nativePrograms:{reconcile:async rows=>seen.push(rows.map(r=>r.manifest.id)),shutdown:async()=>{}},core:async(_action,p)=>p.action==='resolve'?{ok:true,item}:++lists===1?held:{ok:true,items:[item]}});t.after(()=>service.close());
 await service.call({action:'mod_open',id:manifest.id});const older=service.reconcile();await service.reconcile();
 if(failed)reject(Error('late stale read'));else release({ok:true,items:[]});await older;
 assert.equal(f.opened[0].dead,false);assert.deepEqual(seen,[[manifest.id]]);
});
test('background package reconciliation reports a failed retention without an unhandled process rejection',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-package-refresh-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const code=`
  const {createModPackages}=require('./host/mod-packages.cjs');let reported=0;
  const service=createModPackages({dataDir:process.argv[1],appearance:{read:()=>({settings:{}})},core:async()=>({ok:true,items:[]}),
   nativePrograms:{reconcile:async()=>{throw Error('retention fixture unavailable');},shutdown:async()=>{}},
   onError:error=>{if(!error.message.includes('retention fixture unavailable'))throw Error('wrong error');reported++;}});
  setTimeout(async()=>{await service.close();if(reported!==1)process.exitCode=2;else process.stdout.write('reported without process exit');},100);
 `;
 const result=require('node:child_process').spawnSync(process.execPath,['--unhandled-rejections=strict','-e',code,dataDir],{cwd:path.resolve(__dirname,'..'),windowsHide:true,encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'reported without process exit');
});

test('a native retention failure cannot invalidate a trusted package list or close an unrelated sandbox',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-package-isolation-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../../SDK/examples/program-notebook'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows();
 const item={manifest,directory:source,digest:'1'.repeat(64),enabled:true,origin:'local'},seen=[];
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,nativePrograms:{reconcile:async rows=>{seen.push(rows.map(r=>r.manifest.id));if(rows.length)throw Error('retention fixture unavailable');},shutdown:async()=>{}},core:async(_action,p)=>p.action==='resolve'?{ok:true,item}:{ok:true,items:[item]}});t.after(()=>service.close());
 await service.call({action:'mod_open',id:manifest.id});const failure=await service.reconcile().catch(error=>error);
 assert.equal(f.opened[0].dead,false);assert.deepEqual(seen,[[manifest.id]]);assert.match(failure?.message||'',/retention fixture unavailable/);
});
test('reconciliation attempts all inactive sandbox closes and native cleanup after one window refuses to close',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-sandbox-revoke-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../../SDK/examples/program-notebook'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows();let nativeReconciliations=0;
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,nativePrograms:{reconcile:async()=>{nativeReconciliations++;},shutdown:async()=>{}},core:async(_action,p)=>p.action==='resolve'?{ok:true,item:{manifest:{...manifest,id:p.id},directory:source,digest:'1'.repeat(64),enabled:true,origin:'local'}}:{ok:true,items:[]}});t.after(()=>service.close());
 await service.call({action:'mod_open',id:'fixture.first'});await service.call({action:'mod_open',id:'fixture.second'});
 const original=f.opened[0].destroy.bind(f.opened[0]);let attempts=0;f.opened[0].destroy=()=>{if(++attempts===1)throw Error('fixture close unavailable');original();};
 const failure=await service.reconcile().catch(error=>error);assert.match(failure?.message||'',/close unavailable/);
 assert.equal(f.opened[1].dead,true);assert.equal(nativeReconciliations,1);
 await service.reconcile();assert.equal(f.opened[0].dead,true);assert.equal(attempts,2);
});
test('package shutdown drains programs after a protocol failure and retries only the unfinished release',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-package-release-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../../SDK/examples/program-notebook'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows();let attempts=0,nativeCloses=0;
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,session:{defaultSession:{protocol:{handle(){},unhandle(){if(++attempts===1)throw Error('protocol release unavailable');}}}},nativePrograms:{shutdown:async()=>{nativeCloses++;}},core:async()=>({ok:true,item:{manifest,directory:source,digest:'1'.repeat(64),enabled:true,origin:'local'}})});t.after(()=>service.close());
 await service.call({action:'mod_open',id:manifest.id});await assert.rejects(service.close(),/protocol release unavailable/);
 assert.equal(f.opened[0].dead,true);assert.equal(nativeCloses,1);await service.close();assert.equal(attempts,2);assert.equal(nativeCloses,1);
});
test('concurrent package closes share the in-flight drain and reject new program admission immediately',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-package-drain-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 let release,started,closes=0;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r);
 const service=createModPackages({dataDir,core:async()=>{throw Error('must not resolve');},nativePrograms:{shutdown:async()=>{closes++;started();await gate;}}});t.after(()=>service.close());
 const first=service.close();await entered;const second=service.close();
 try{assert.strictEqual(first,second);await assert.rejects(service.call({action:'mod_open',id:'fixture.notebook'}),/已关闭/);assert.equal(closes,1);}
 finally{release();await Promise.all([first,second]);}
 await service.close();assert.equal(closes,1);
});
test('an unreadable package list still withdraws all programs and retries only an unfinished window close',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-package-untrusted-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../../SDK/examples/program-notebook'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows(),seen=[];
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,nativePrograms:{reconcile:async rows=>seen.push(rows),shutdown:async()=>{}},core:async(_action,p)=>{
  if(p.action==='list')throw Error('list unavailable');return {ok:true,item:{manifest:{...manifest,id:p.id},directory:source,digest:'1'.repeat(64),enabled:true,origin:'local'}};
 }});t.after(()=>service.close());
 await service.call({action:'mod_open',id:'fixture.first'});await service.call({action:'mod_open',id:'fixture.second'});
 const destroy=f.opened[0].destroy.bind(f.opened[0]);let attempts=0;f.opened[0].destroy=()=>{if(++attempts===1)throw Error('fixture close unavailable');destroy();};
 await assert.rejects(service.reconcile(),/close unavailable/);assert.equal(f.opened[1].dead,true);assert.deepEqual(seen,[[]]);
 await service.reconcile();assert.equal(f.opened[0].dead,true);assert.equal(attempts,2);assert.deepEqual(seen,[[],[]]);
});
test('current package snapshots and invocations cannot execute an older open sandbox after an upgrade',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-program-binding-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../../SDK/examples/program-notebook'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),f=windows();let digest='1'.repeat(64),dispatches=0;
 const service=createModPackages({dataDir,BrowserWindow:f.Window,offscreen:true,core:async()=>({ok:true,item:{manifest,directory:source,digest,enabled:true,origin:'local'}})});t.after(()=>service.close());
 await service.call({action:'mod_open',id:manifest.id});const execute=f.opened[0].webContents.executeJavaScript;f.opened[0].webContents.executeJavaScript=code=>{dispatches++;return execute(code);};digest='2'.repeat(64);
 const snapshot=await service.call({action:'mod_snapshot',id:manifest.id}).catch(error=>error);assert.match(snapshot?.message||snapshot?.error||'',/版本/);
 const invocation=await service.call({action:'mod_invoke',id:manifest.id,operation:'set_text',arguments:{value:7},request_id:'after-upgrade'});
 assert.equal(invocation.ok,false);assert.match(invocation.error,/版本/);assert.equal(dispatches,0);assert.equal(f.opened[0].dead,false);
 await service.call({action:'mod_close',id:manifest.id});await service.call({action:'mod_open',id:manifest.id});
 assert.equal((await service.call({action:'mod_snapshot',id:manifest.id})).result.value,3);
 assert.equal((await service.call({action:'mod_invoke',id:manifest.id,operation:'set_text',arguments:{value:9},request_id:'reopened-upgrade'})).result.value,9);
});
