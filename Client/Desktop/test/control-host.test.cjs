// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; stamp; data; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/control-host.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),http=require('node:http');
const {createControl,projectOffice,runtimeOptions,requestJSON}=require('../host/control.cjs');
const stamp='2026-10-02T12:00:00Z',now=Date.parse(stamp);
function data(){return {
 snapshot:{observed_at:stamp,connection:{state:'online'},agents:[{id:'a',online:true,runtime:{bound:true,stale:false,state:'running',observed_at:stamp,last_activity_at:stamp}},{id:'b',online:true,runtime:{bound:false,state:'running',observed_at:stamp}}]},
 registry:{observed_at:stamp,connection:{state:'online'},seats:[{id:'s1',actor_id:'a',project:'os',membership_state:'active'},{id:'s2',actor_id:'b',project:'other',membership_state:'active'},{id:'removed',actor_id:'a',project:'os',membership_state:'removed'}]}
};}
function fixture(extra={},hooks={}){
 const d=data(),views=[],launched=[],external=[],sessions=[];let available=true;
 const wc=new EventEmitter();wc.getZoomFactor=()=>1.25;
 const win={webContents:wc,getContentSize:()=>[800,600],isDestroyed:()=>false,contentView:{addChildView(){},removeChildView(v){v.removed=true;}}};
 class View{
  constructor(options){this.options=options;this.webContents=new EventEmitter();const w=this.webContents;w.session=options.webPreferences.session;w.isDestroyed=()=>!!w.destroyed;w.close=()=>{w.destroyed=true;};w.setWindowOpenHandler=fn=>{w.popup=fn;};w.loadURL=async url=>{this.loads=(this.loads||0)+1;this.url=url;if(hooks.loadURL)await hooks.loadURL();w.emit('did-finish-load');};views.push(this);}
  setVisible(v){this.visible=v;}setBounds(v){this.bounds=v;}
 }
 const electron={WebContentsView:View,shell:{openExternal:async url=>external.push(url)},session:{fromPartition(){const s={setPermissionRequestHandler(fn){this.request=fn;},setPermissionCheckHandler(fn){this.check=fn;}};sessions.push(s);return s;}}};
 const read=async(_base,endpoint)=>{if(!available)throw Object.assign(Error('refused'),{code:'ECONNREFUSED'});return endpoint==='/api/health'?{service:'aieyra-control',version:'test',os_managed:true}:endpoint==='/api/snapshot'?d.snapshot:d.registry;};
 const launch=(file,args,options)=>{
  const p=new EventEmitter();p.pid=4321;p.exitCode=null;p.signalCode=null;p.killCalls=[];p.kill=signal=>{p.killCalls.push(signal);};
  p.finishExit=(code=0,signal=null)=>{if(p.exitCode!==null||p.signalCode!==null)return;p.exitCode=code;p.signalCode=signal;p.emit('exit',code,signal);p.emit('close',code,signal);};
  p.stdout=new EventEmitter();p.stdin=new EventEmitter();p.stdin.messages=[];p.stdin.write=s=>{p.stdin.messages.push(JSON.parse(s));if(JSON.parse(s).type==='owner.hello')queueMicrotask(()=>p.stdout.emit('data',JSON.stringify({...{type:'control.ready',owned:true,owner_id:JSON.parse(s).owner_id,pid:p.pid},...hooks.ready})+'\n'));};p.stdin.end=()=>{p.stdin.ended=true;if(!hooks.holdExit)queueMicrotask(()=>p.finishExit());};
  const named=args.find(a=>a.startsWith('--os-owner-pipe='));
  if(named){p.messages=[];p.peer=require('node:net').createConnection(named.slice('--os-owner-pipe='.length));let buffer='';p.peer.on('error',()=>{});p.peer.on('end',()=>{p.peerEnded=true;p.peer.end();});p.peer.on('close',()=>{if(!hooks.holdExit)p.finishExit();});p.peer.on('data',c=>{buffer+=String(c);while(buffer.includes('\n')){const at=buffer.indexOf('\n'),m=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);p.messages.push(m);if(m.type==='owner.hello')p.peer.write(JSON.stringify({type:'control.ready',owned:true,owner_id:m.owner_id,pid:p.pid,...hooks.ready})+'\n');}});}
  launched.push({file,args,options,p});available=true;return p;
 };
 const control=createControl({apps:{call:async()=>({installed:true,executable:'control.exe',directory:process.cwd()})},win,electron,read,launch,now:()=>now,env:{},platform:'linux',...extra});
 return {control,d,wc,win,views,external,sessions,launched,setAvailable:value=>{available=value;}};
}

test('Link registers only its mounted loopback page and releases modal ownership across hide, close and reopen',async()=>{
 const registrations=[],target={name:'actual native owner'};let refreshes=0,releases=0;
 const nativeModal={register(wc,options){const entry={wc,options};registrations.push(entry);return {refresh(){refreshes++;},release(){releases++;}};}};
 const f=fixture({nativeModal,modalWindow:()=>target});
 try{
  await f.control.open();const first=registrations[0];assert.equal(registrations.length,1);assert.equal(first.wc,f.views[0].webContents);assert.equal(first.options.receive,true);assert.equal(first.options.window(),target);assert.match(f.views[0].options.webPreferences.preload,/file-drop-preload\.cjs$/);
  assert.equal(first.options.allowed('http://127.0.0.1:17910/office'),true);for(const url of ['http://127.0.0.1:17911/','https://127.0.0.1:17910/','http://user@127.0.0.1:17910/','https://example.org/'])assert.equal(first.options.allowed(url),false);
  assert.equal(first.options.visible(),false);f.control.surface({visible:true,bounds:{x:0,y:0,width:100,height:80}});assert.equal(first.options.visible(),true);
  f.control.surface({visible:false});assert.equal(first.options.visible(),false);assert.ok(refreshes>0);await f.control.release();assert.equal(releases,1);
  await f.control.open();assert.equal(registrations.length,2);assert.notEqual(registrations[1].wc,first.wc);assert.equal(first.options.visible(),false);
 }finally{await f.control.close();}
 assert.equal(releases,2);assert.equal(registrations[1].options.visible(),false);
});
test('office projection counts active seats and separates heartbeat from execution',()=>{
 const {snapshot,registry}=data(),p=projectOffice(snapshot,registry,now);
 assert.equal(p.count,2);assert.equal(p.os_count,1);assert.equal(p.running,1);assert.equal(p.stale,false);assert.equal(p.seats[1].online,true);assert.equal(p.seats[1].execution_state,'unknown');
 snapshot.agents[0].runtime.last_activity_at=new Date(now-180001).toISOString();assert.equal(projectOffice(snapshot,registry,now).running,0);
});
test('offline hub and aged snapshot cannot present cached membership or heartbeat as current',()=>{
 const {snapshot,registry}=data();snapshot.connection.state='offline';registry.connection.state='offline';
 let p=projectOffice(snapshot,registry,now);assert.equal(p.stale,true);assert.equal(p.count_stale,true);assert.equal(p.seats[0].online,null);assert.equal(p.seats[0].execution_state,'running');
 p=projectOffice(snapshot,registry,now+180001);assert.equal(p.seats[0].execution_state,'unknown');
});
test('control options reject invalid port and relative runtime paths',()=>{
 assert.throws(()=>runtimeOptions({AIEYRA_CONTROL_PORT:'abc'}));assert.throws(()=>runtimeOptions({AIEYRA_CONTROL_PORT:'80'}));assert.throws(()=>runtimeOptions({AIEYRA_CONTROL_DATA_DIR:'relative'}));assert.equal(runtimeOptions({}).url,'http://127.0.0.1:17910');
});
test('external Control opens once, scales and clips bounds, hides on navigation, never owns a process',async()=>{
 const f=fixture();try{
  const [a,b]=await Promise.all([f.control.open(),f.control.open()]);assert.equal(a.ownership,'external');assert.equal(b.available,true);assert.equal(f.views.length,1);assert.equal(f.views[0].loads,1);assert.equal(f.launched.length,0);
  f.control.surface({visible:true,bounds:{x:10,y:20,width:100,height:80}});assert.deepEqual(f.views[0].bounds,{x:13,y:25,width:124,height:100});
  f.control.surface({visible:true,bounds:{x:-10,y:0,width:20,height:20}});assert.deepEqual(f.views[0].bounds,{x:0,y:0,width:12,height:25});
  assert.throws(()=>f.control.surface({visible:true,bounds:{x:0,y:0,width:NaN,height:10}}));assert.equal(f.views[0].visible,false);
  f.control.surface({visible:true,bounds:{x:0,y:0,width:100,height:80}});f.wc.emit('did-start-navigation');assert.equal(f.views[0].visible,false);
 }finally{await f.control.close();}
 assert.equal(f.views[0].removed,true);assert.equal(f.views[0].webContents.destroyed,true);assert.equal(f.sessions[0].request,null);assert.equal(f.sessions[0].check,null);assert.equal(f.wc.listenerCount('did-start-navigation'),0);
});
test('shared desktop opens a Link-owned background office without taking its lifetime',async()=>{
 const d=data(),read=async(_base,endpoint)=>endpoint==='/api/health'?{service:'aieyra-control',os_managed:true,owner_kind:'link'}:endpoint==='/api/snapshot'?d.snapshot:d.registry;
 const f=fixture({allowExternalView:true,read});
 try{
  const opened=await f.control.open();assert.equal(opened.page_ready,true);assert.equal(opened.owner_kind,'link');assert.equal(opened.ownership,'external');assert.equal(opened.detached,false);assert.equal(f.launched.length,0);
  await f.control.release();assert.equal(f.views[0].webContents.destroyed,true);assert.equal(f.launched.length,0);
  assert.equal((await f.control.open()).page_ready,true);assert.equal(f.views.length,2);assert.equal(f.launched.length,0);
 }finally{await f.control.close();}
 assert.equal(f.launched.length,0);
});

test('legacy exclusive desktop still refuses a differently owned office',async()=>{
 const f=fixture({read:async()=>({service:'aieyra-control',os_managed:true,owner_kind:'link'})});
 try{await assert.rejects(f.control.open(),{code:'control_held_elsewhere'});assert.equal(f.views.length,0);assert.equal(f.launched.length,0);}finally{await f.control.close();}
});

test('confirmed child receives only its own owner shutdown and sanitized environment',async()=>{
 const f=fixture({env:{AIEYRA_RUNTIME_TOKEN:'secret',AIEYRA_WORKSPACE_BRIDGE:'secret',ELECTRON_RUN_AS_NODE:'1',KEEP:'yes'}});f.setAvailable(false);
 try{assert.equal((await f.control.open()).ownership,'owned');}finally{await f.control.close();}
 const {p,args,options}=f.launched[0];assert.ok(args.includes('--os-owner-stdin'));assert.equal(options.env.AIEYRA_RUNTIME_TOKEN,undefined);assert.equal(options.env.KEEP,'yes');assert.equal(options.windowsHide,true);
 assert.equal(p.stdin.messages.length,2);assert.equal(p.stdin.messages[1].type,'owner.shutdown');assert.equal(p.stdin.messages[1].owner_id,p.stdin.messages[0].owner_id);assert.equal(p.stdin.ended,true);
});
test('Windows owner uses stdin and validates each ready receipt',async()=>{
 for(const ready of [{},{owner_id:'wrong'},{pid:9876},{type:'control.attached',owned:false}]){
  const f=fixture({platform:'win32'},{ready});f.setAvailable(false);
  try{
   const r=await f.control.open();assert.equal(r.ownership,Object.keys(ready).length?'external':'owned');
   const {args,options}=f.launched[0];assert(args.includes('--os-owner-stdin'));assert(!args.some(a=>a.startsWith('--os-owner-pipe=')));assert.equal(options.stdio[0],'pipe');assert.equal(options.windowsHide,true);
  }finally{await f.control.close();}
  const p=f.launched[0].p;assert.equal(p.stdin.ended,true);assert.deepEqual(p.stdin.messages.map(m=>m.type),Object.keys(ready).length?['owner.hello']:['owner.hello','owner.shutdown']);
 }
});
test('old standalone service cannot be attached or replaced automatically',async()=>{
 const f=fixture({read:async()=>({service:'aieyra-control',os_managed:false})});
 try{await assert.rejects(f.control.open(),/旧版独立/);assert.equal(f.launched.length,0);assert.equal(f.views.length,0);}finally{await f.control.close();}
});

test('different profile scope is rejected before reading any office data',async()=>{
 const calls=[],f=fixture({env:{AIEYRA_CONTROL_SCOPE:'expected'},read:async(_base,endpoint)=>{calls.push(endpoint);return {service:'aieyra-control',os_managed:true,profile_scope:'another'};}});
 try{await assert.rejects(f.control.open(),/另一份资料/);assert.equal((await f.control.status()).available,false);assert(calls.every(endpoint=>endpoint==='/api/health'));assert.equal(f.views.length,0);assert.equal(f.launched.length,0);}finally{await f.control.close();}
});

test('a migrated Together office serves the legacy reader only for the selected profile',async()=>{
 const d=data();
 for(const attachOnly of [false,true]){
  const f=fixture({attachOnly,env:{AIEYRA_CONTROL_SCOPE:'expected'},read:async(_base,endpoint)=>{
   if(endpoint==='/api/health')return {service:'aieyra-together-link',os_managed:true,profile_scope:'expected',owner_kind:'link'};
   return endpoint==='/api/snapshot'?d.snapshot:d.registry;
  }});
  try{
   const result=await f.control.status();
   assert.equal(result.available,attachOnly);
   if(attachOnly)assert.equal(result.office.count,2);
   assert.equal(f.launched.length,0);
  }finally{await f.control.close();}
 }
});

test('unknown port and timeout do not start a competing Control',async()=>{
 for(const read of [async()=>({service:'other'}),async()=>{throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});}]){
  const f=fixture({read});try{await assert.rejects(f.control.open());assert.equal(f.launched.length,0);}finally{await f.control.close();}
 }
});
test('missing installation fails locally without creating a view',async()=>{
 const f=fixture({apps:{call:async()=>({installed:false})}});f.setAvailable(false);try{await assert.rejects(f.control.open(),/尚未安装/);assert.equal(f.views.length,0);assert.equal(f.launched.length,0);}finally{await f.control.close();}
});
test('offline read preserves the last snapshot but invalidates its current counts and activity',async()=>{
 const f=fixture();try{await f.control.status();f.setAvailable(false);const p=await f.control.status();assert.equal(p.office.count,2);assert.equal(p.office.count_stale,true);assert.equal(p.office.running,null);assert.equal(p.office.seats[0].execution_state,'unknown');assert.equal(p.office.seats[0].online,null);}finally{await f.control.close();}
});
test('close during health read prevents mounting and spawning',async()=>{
 let release;const f=fixture({read:()=>new Promise(r=>release=r)}),opening=f.control.open();await f.control.close();release({service:'aieyra-control',os_managed:true});await assert.rejects(opening,/关闭/);assert.equal(f.views.length,0);assert.equal(f.launched.length,0);assert.equal((await f.control.status()).service_state,'closed');
});
test('page recovery reloads once and external login links keep the Control view on its own origin',async()=>{
 const f=fixture();try{await f.control.open();const w=f.views[0].webContents;w.emit('render-process-gone');await f.control.open();assert.equal(f.views[0].loads,2);
  assert.deepEqual(w.popup({url:'about:blank'}),{action:'deny'});w.popup({url:'https://example.test/login'});w.popup({url:'file:///private'});assert.deepEqual(f.external,['https://example.test/login']);
  let denied=false;w.emit('will-redirect',{preventDefault(){denied=true;}},'https://example.test');assert.equal(denied,true);assert.equal(f.external.length,1);
 }finally{await f.control.close();}
});
test('local JSON reader rejects interrupted, oversized and slow streaming responses',async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/api/ok'){res.end('{"ok":true}');return;}
  if(req.url==='/api/large'){res.end('x'.repeat(100));return;}
  if(req.url==='/api/aborted'){res.writeHead(200,{'content-length':'100'});res.write('{');setTimeout(()=>res.destroy(),10);return;}
  if(req.url==='/api/slow'){res.write(' ');const timer=setInterval(()=>res.write(' '),5);res.on('close',()=>clearInterval(timer));return;}
  res.writeHead(503);res.end('{}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.deepEqual(await requestJSON(base,'/api/ok'),{ok:true});await assert.rejects(requestJSON(base,'/api/large',{limit:10}),{code:'INVALID_RESPONSE'});await assert.rejects(requestJSON(base,'/api/aborted'));await assert.rejects(requestJSON(base,'/api/slow',{timeout:40}),{code:'ETIMEDOUT'});await assert.rejects(requestJSON(base,'/api/offline'));await assert.rejects(requestJSON('http://example.test','/api/ok'),/本机/);}finally{await new Promise(r=>server.close(r));}
});

test('unmatched ownership and attached launcher never receive an owner shutdown',async()=>{
 for(const ready of [{owner_id:'mismatch'},{pid:9999},{type:'control.attached',owned:false}]){
  const f=fixture({}, {ready});f.setAvailable(false);
  try{assert.equal((await f.control.open()).ownership,'external');}finally{await f.control.close();}
  assert.deepEqual(f.launched[0].p.stdin.messages.map(m=>m.type),['owner.hello']);assert.equal(f.launched[0].p.stdin.ended,true);
 }
});
test('closing during page load removes the view and cannot restore ready state',async()=>{
 let release,entered;const started=new Promise(r=>entered=r),f=fixture({}, {loadURL:()=>{entered();return new Promise(r=>release=r);}});
 const opening=f.control.open();await started;await f.control.close();release();await assert.rejects(opening,/关闭/);
 const r=await f.control.status();assert.equal(r.page_ready,false);assert.equal(r.shown,false);assert.equal(f.views[0].webContents.destroyed,true);
});
// 用户 2026-10-13 第 L 项：页面一直载不完时，不能永远停在“正在连接指挥中心…”，要按截止时间失败并可重试。
test('a page that never finishes loading fails on the deadline and stays retryable',async()=>{
 let hanging=true;
 const f=fixture({pageLoadTimeout:150},{loadURL:()=>hanging?new Promise(()=>{}):undefined});
 try{
  const started=Date.now();
  await assert.rejects(f.control.open(),e=>e.code==='control_page_timeout'&&/超时/.test(e.message));
  assert(Date.now()-started<3000,'按截止时间失败，而不是一直等');
  const failed=await f.control.status();
  assert.equal(failed.available,true,'指挥中心服务本身是好的');
  assert.equal(failed.page_ready,false);
  assert.match(failed.page_error,/超时/);
  hanging=false;
  const ready=await f.control.open();
  assert.equal(ready.page_ready,true);
  assert.equal(ready.page_error,null);
 }finally{await f.control.close();}
});
test('failed main-frame navigation hides the page and remains retryable without falsifying service health',async()=>{
 const f=fixture();try{await f.control.open();f.control.surface({visible:true,bounds:{x:0,y:0,width:100,height:80}});
  f.views[0].webContents.emit('did-fail-load',{},-105,'failed','http://127.0.0.1:17910/',true);
  const failed=await f.control.status();assert.equal(failed.available,true);assert.equal(failed.page_ready,false);assert.match(failed.page_error,/载入/);assert.equal(f.views[0].visible,false);
  const ready=await f.control.open();assert.equal(ready.page_ready,true);assert.equal(ready.page_error,null);
 }finally{await f.control.close();}
});

test('owner shutdown stays pending until the launched child has actually exited',async()=>{
 const f=fixture({}, {holdExit:true});f.setAvailable(false);await f.control.open();
 const p=f.launched[0].p,closing=f.control.close();
 assert.equal(typeof closing?.then,'function');assert.equal(f.control.close(),closing);
 let finished=false;closing.then(()=>{finished=true;});await new Promise(r=>setImmediate(r));
 assert.equal(finished,false);assert.equal(p.exitCode,null);assert.equal(p.stdin.ended,true);
 assert.equal(p.stdin.messages[1].owner_id,p.stdin.messages[0].owner_id);
 p.finishExit();await closing;assert.equal(finished,true);assert.deepEqual(p.killCalls,[]);
});

test('attached launcher exit is awaited while the external service receives no shutdown',async()=>{
 const f=fixture({}, {holdExit:true,ready:{type:'control.attached',owned:false}});f.setAvailable(false);await f.control.open();
 const p=f.launched[0].p,closing=f.control.close();assert.equal(typeof closing?.then,'function');
 let finished=false;closing.then(()=>{finished=true;});await new Promise(r=>setImmediate(r));
 assert.equal(finished,false);assert.deepEqual(p.stdin.messages.map(m=>m.type),['owner.hello']);
 p.finishExit();await closing;assert.deepEqual(p.killCalls,[]);
});

test('missing exit confirmation yields a bounded shared failure and never kills a process',async()=>{
 const f=fixture({closeTimeout:20}, {holdExit:true});f.setAvailable(false);await f.control.open();
 const p=f.launched[0].p,closing=f.control.close();
 await assert.rejects(closing,{code:'control_shutdown_unconfirmed'});assert.equal(f.control.close(),closing);
 assert.equal(p.exitCode,null);assert.deepEqual(p.killCalls,[]);p.finishExit();
});

test('a launched child abnormal exit is reported even when it exited before close',async()=>{
 const f=fixture({}, {holdExit:true});f.setAvailable(false);await f.control.open();
 const p=f.launched[0].p;p.finishExit(1);
 await assert.rejects(f.control.close(),{code:'control_exit_failed'});assert.deepEqual(p.killCalls,[]);
});

test('shared host may destroy its page before service shutdown or a later open',async()=>{
 const f=fixture();
 const destroyPage=()=>{const view=f.views.at(-1),wc=view.webContents;wc.destroyed=true;wc.emit('destroyed');Object.defineProperty(view,'webContents',{get(){throw Error('Object has been destroyed');}});};
 await f.control.open();destroyPage();assert.equal(f.control.peek().page_ready,false);
 await f.control.open();assert.equal(f.views.length,2);assert.equal(f.control.peek().page_ready,true);assert.equal(f.launched.length,0);
 destroyPage();await f.control.close();assert.equal(f.control.peek().service_state,'closed');
});
