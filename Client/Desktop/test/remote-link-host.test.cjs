// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; ORIGIN; epoch; identity; deferred; fixture; ADMIN; adminReady
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/remote-link-host.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createRemoteLink,endpoint}=require('../host/remote-link.cjs');
const ORIGIN='https://api.aieyra.cn',BASE=ORIGIN+'/api/aieyra/cloud-instances';
const epoch='fixture-login-0001';
const identity=(key=epoch,id=19)=>({signedIn:true,user:{id:String(id)},remoteAccount:{userID:id,sessionKey:key}});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture(t,options={}){
 const cookies=new EventEmitter(),seen=[],views=[],external=[],changes=[],terminalSessions=[];let fetcher,loader=async()=>{};
 cookies.get=async()=>[{name:'session',value:'isolated-http-only-session',domain:'api.aieyra.cn',secure:true,httpOnly:true}];
 const descriptor=id=>({revision:1,generation:1,binding:{runtime_user:'fixture',deploy_allowed:true},remote:{baota:{state:'registered',url:'https://panel-'+id+'.invalid/entry'}}});
 const session={cookies,fetch:async(url,opt)=>{seen.push({url,opt});if(fetcher)return fetcher(url,opt);return Response.json({success:true,data:url.includes('/self?')?{items:[{id:1,owner_id:19},{id:2,owner_id:19},{id:3,owner_id:20},{id:4,owner_id:19,root_only:true}],total:4}:url.endsWith('/remote')?descriptor(Number(url.split('/').at(-2))):{state:'active'}});}};
 const win=Object.assign(new EventEmitter(),{webContents:Object.assign(new EventEmitter(),{getZoomFactor:()=>1}),getContentSize:()=>[900,700],contentView:{addChildView(){},removeChildView(view){view.removed=true;}}});
 class View{
  constructor(options){this.options=options;const w=this.webContents=new EventEmitter();w.isDestroyed=()=>!!w.destroyed;w.close=()=>{w.destroyed=true;};w.setWindowOpenHandler=handler=>w.openHandler=handler;w.loadURL=async url=>{w.url=url;await loader(url);};views.push(this);}
  setVisible(value){this.visible=value;}setBounds(value){this.bounds=value;}
 }
 const electron={session:{fromPartition:(name,options)=>{assert.equal(options.cache,false);if(name==='persist:aieyra-os-account')return session;assert.match(name,/^aieyra-link-admin-terminal-/);const ephemeral={webRequest:{onBeforeRequest(filter,fn){ephemeral.guard=filter===null?null:fn;},onBeforeSendHeaders(filter,fn){ephemeral.inject=filter===null?null:fn;}}};terminalSessions.push(ephemeral);return ephemeral;}},WebContentsView:View,shell:{openExternal:async url=>external.push(url)}};
 const account={status:()=>identity(),refresh:async()=>identity(),login:async()=>({ok:true}),logout:async()=>{}};
 const remote=createRemoteLink({win,electron,account,onChange:state=>changes.push(state),...options});t.after(()=>remote.close());
 let serial=0;
 const request=(url,extra={})=>remote.call({action:'request',url,method:'GET',sessionKey:epoch,userID:19,requestID:'fixture-request-'+(++serial),...extra});
 const discover=async()=>{await request(BASE+'/remote-entitlement');await request(BASE+'/self?page=1');};
 const describe=async id=>request(BASE+'/'+id+'/remote');
 const terminal=(id,viewID='fixture-view-0001')=>remote.call({action:'terminal',instance:id,sessionID:'fixture-session-'+id,sessionKey:epoch,viewID});
 return {remote,request,discover,describe,terminal,seen,views,external,changes,win,cookies,session,terminalSessions,setFetch:fn=>fetcher=fn,setLoad:fn=>loader=fn,descriptor};
}
const ADMIN=ORIGIN+'/api/aieyra/admin-servers';
async function adminReady(f){
 f.setFetch(url=>Response.json({success:true,data:url.endsWith('/servers')?{state:'active',items:[{id:1,owner_id:19,resource_scope:'administrator_server'}],total:1}:f.descriptor(1)}));
 await f.request(ADMIN);await f.request(ADMIN+'/1/remote');
}
test('administrator bridge forwards only native cookies to the fixed Link gateway',async t=>{
 const f=fixture(t);await adminReady(f);
 assert.equal(f.seen[0].url,'https://os.aieyra.cn/link/cloud/v1/admin-remote/servers');
 assert.equal(f.seen[0].opt.credentials,'omit');assert.equal(f.seen[0].opt.headers['X-Link-NewApi-Session'],'isolated-http-only-session');
 await assert.rejects(f.request(BASE+'/1/remote'),{code:'remote_resource_scope_mismatch'});
 await assert.rejects(f.request(ADMIN+'/1/remote?host=evil'),{code:'remote_endpoint_denied'});
 await assert.rejects(f.request('https://os.aieyra.cn/link/cloud/v1/admin-remote/servers'),{code:'remote_endpoint_denied'});
 f.cookies.get=async()=>[];await assert.rejects(f.request(ADMIN+'/1/remote'),{code:'remote_admin_login_required'});
});
test('administrator terminal uses an empty partition and injects secrets only into its own server requests',async t=>{
 const f=fixture(t);await adminReady(f);await f.terminal(1);
 const view=f.views[0],isolated=f.terminalSessions[0];assert.equal(view.options.webPreferences.session,isolated);
 assert.equal(new URL(view.webContents.url).pathname,'/link/cloud/remote/terminal.html');
 assert.equal(view.webContents.url.includes('isolated-http-only-session'),false);
 const allowed=await new Promise(resolve=>isolated.inject({requestHeaders:{Accept:'application/json'}},resolve));
 assert.equal(allowed.requestHeaders['X-Link-NewApi-Session'],'isolated-http-only-session');
 for(const url of ['https://api.aieyra.cn/api/user/self','https://os.aieyra.cn/link/cloud/v1/admin-remote/2/remote','https://evil.invalid/']){
  let result;isolated.guard({url},value=>result=value);assert.equal(result.cancel,true);
 }
 f.cookies.emit('changed',{}, {domain:'api.aieyra.cn'});assert.equal(view.webContents.destroyed,true);assert.equal(isolated.inject,null);assert.equal(isolated.guard,null);
});
test('late administrator cookie reads cannot recreate a terminal after logout or a new view',async t=>{
 const f=fixture(t);await adminReady(f);const gate=deferred();f.cookies.get=()=>gate.promise;
 const pending=f.terminal(1);await f.remote.call({action:'logout'});gate.resolve([{name:'session',domain:'api.aieyra.cn',secure:true,value:'isolated-http-only-session'}]);
 await assert.rejects(pending,{code:'remote_request_aborted'});assert.equal(f.views.length,0);assert.equal(f.terminalSessions.length,0);
});
test('bridge allows only the tenant API and discovered owner resources',async t=>{
 const f=fixture(t);
 for(const url of ['https://elsewhere.invalid/api/aieyra/cloud-instances/self?page=1',ORIGIN+'/api/user/self',BASE+'/self?page=0',BASE+'/self?page=101',BASE+'/1/remote?host=x',BASE+'/1/remote#x',BASE+'/1/remote/fixture-session'])await assert.rejects(f.request(url),{code:'remote_endpoint_denied'});
 assert.throws(()=>endpoint(BASE+'/self?page=1','DELETE'),{code:'remote_endpoint_denied'});
 await assert.rejects(f.describe(1),{code:'remote_resource_not_discovered'});await f.discover();
 await assert.rejects(f.describe(3),{code:'remote_resource_not_discovered'});await assert.rejects(f.describe(4),{code:'remote_resource_not_discovered'});
 await assert.rejects(f.request(BASE+'/1/remote',{userID:20}),{code:'remote_account_mismatch'});
 await assert.rejects(f.request(BASE+'/1/remote',{method:'POST',body:JSON.stringify({action:'execute',command:'arbitrary'})}),{code:'remote_action_denied'});
 await f.describe(1);assert.equal(f.seen.length,3);assert.equal(f.seen.at(-1).opt.credentials,'include');assert.equal(f.seen.at(-1).opt.redirect,'error');assert.equal(f.seen.at(-1).opt.headers['New-Api-User'],'19');
});
test('unverified signedIn state never authorizes remote requests',async t=>{
 const f=fixture(t);f.remote.accountChanged({signedIn:true,user:{id:19}});assert.equal(f.remote.status().account,null);
 await assert.rejects(f.discover(),{code:'remote_login_required'});assert.equal(f.seen.length,0);
});
test('cookie change revokes cached resources and rejects late same-user responses',async t=>{
 const f=fixture(t);await f.discover();const gate=deferred();f.setFetch(()=>gate.promise);const pending=f.describe(1);
 f.cookies.emit('changed',{}, {domain:'.aieyra.cn'});assert.equal(f.remote.status().account,null);assert.equal(f.seen.at(-1).opt.signal.aborted,true);
 f.remote.accountChanged(identity('fixture-login-0002'));gate.resolve(Response.json({success:true,data:f.descriptor(1)}));await assert.rejects(pending,{code:'remote_request_aborted'});
 await assert.rejects(f.request(BASE+'/1/remote',{sessionKey:'fixture-login-0002'}),{code:'remote_resource_not_discovered'});
});
test('caller cancellation and deadline abort a read without replaying it',async t=>{
 const f=fixture(t,{timeout:15});let aborts=0;
 f.setFetch((_url,opt)=>new Promise((_resolve,reject)=>opt.signal.addEventListener('abort',()=>{aborts++;reject(Error('fixture aborted'));},{once:true})));
 const pending=f.request(BASE+'/remote-entitlement',{requestID:'fixture-cancellable'});await f.remote.call({action:'cancel',requestID:'fixture-cancellable',sessionKey:epoch});await assert.rejects(pending,{code:'remote_request_aborted'});
 await assert.rejects(f.request(BASE+'/remote-entitlement'),{code:'remote_request_aborted'});assert.equal(aborts,2);assert.equal(f.seen.length,2);
});
test('failed deployment receipt is not replayed by native transport',async t=>{
 const f=fixture(t);await f.discover();f.setFetch(()=>{throw Error('receipt lost');});
 await assert.rejects(f.request(BASE+'/1/remote-deployments',{method:'POST',body:JSON.stringify({consent:true,idempotency_key:'fixture-original'})}),{code:'remote_service_unavailable'});
 assert.equal(f.seen.filter(item=>item.opt.method==='POST').length,1);
});
test('sandbox terminal and panel mappings stay attached to the chosen server',async t=>{
 const f=fixture(t);await f.discover();await f.describe(1);await f.describe(2);await f.terminal(1);
 const first=f.views[0],prefs=first.options.webPreferences;assert.equal(prefs.session,f.session);assert.equal(prefs.sandbox,true);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.preload,undefined);
 assert.equal(new URL(first.webContents.url).searchParams.get('instance'),'1');assert.equal(new URL(first.webContents.url).searchParams.get('user'),'19');assert.deepEqual(first.webContents.openHandler(),{action:'deny'});
 let denied=false;first.webContents.emit('will-navigate',{preventDefault:()=>denied=true},'https://elsewhere.invalid');assert.equal(denied,true);
 await f.terminal(2,'fixture-view-0002');assert.equal(first.webContents.destroyed,true);
 await f.remote.call({action:'terminalClose',sessionKey:epoch,viewID:'fixture-view-0001'});assert.equal(f.views[1].webContents.destroyed,undefined,'old completion cannot close the new view');
 for(const id of [1,2])await f.remote.call({action:'baota',instance:id,sessionKey:epoch,url:'https://untrusted.invalid'});
 assert.deepEqual(f.external,['https://panel-1.invalid/entry','https://panel-2.invalid/entry']);
});
test('terminal bounds follow viewport clipping and stale layout cannot alter another view',async t=>{
 const f=fixture(t);await f.discover();await f.describe(1);await f.terminal(1);
 const surface={action:'surface',sessionKey:epoch,viewID:'fixture-view-0001',visible:true,bounds:{x:10,y:-30,width:600,height:500},viewport:{x:15,y:50,width:500,height:300}};
 await f.remote.call(surface);assert.deepEqual(f.views[0].bounds,{x:15,y:50,width:500,height:300});assert.equal(f.views[0].visible,true);
 await f.remote.call({...surface,bounds:{x:10,y:-600,width:600,height:500}});assert.equal(f.views[0].visible,false);
 await f.remote.call({...surface,viewID:'fixture-old-view'});assert.equal(f.views[0].visible,false);
});
test('minimize, logout and close remove terminal surfaces while keeping remote tmux untouched',async t=>{
 const f=fixture(t);await f.discover();await f.describe(1);await f.terminal(1);f.win.emit('minimize');assert.equal(f.remote.status().terminal,false);assert.equal(f.views[0].webContents.destroyed,true);
 await f.terminal(1,'fixture-view-0002');await f.remote.call({action:'logout'});assert.equal(f.remote.status().account,null);assert.equal(f.views[1].webContents.destroyed,true);
 assert.equal(f.seen.every(item=>item.opt.method==='GET'),true);f.remote.close();assert.equal(f.cookies.listenerCount('changed'),0);
});
test('terminal loading has a deadline and old load cannot replace a newer terminal',async t=>{
 const f=fixture(t,{pageLoadTimeout:20});await f.discover();await f.describe(1);await f.describe(2);const gate=deferred();f.setLoad(()=>gate.promise);
 const pending=f.terminal(1);f.setLoad(async()=>{});await f.terminal(2,'fixture-view-0002');gate.resolve();await assert.rejects(pending,{code:'remote_request_aborted'});assert.equal(f.remote.status().terminalViewID,'fixture-view-0002');
 f.setLoad(()=>new Promise(()=>{}));await assert.rejects(f.terminal(1,'fixture-view-timeout'),{code:'remote_terminal_timeout'});assert.equal(f.remote.status().terminal,false);
});
test('oversized JSON responses and unsafe registered panel URLs are rejected',async t=>{
 const f=fixture(t);await f.discover();f.setFetch(()=>Response.json({success:true,data:{...f.descriptor(1),remote:{baota:{state:'registered',url:'http://panel.invalid'}}}}));await f.describe(1);
 await assert.rejects(f.remote.call({action:'baota',instance:1,sessionKey:epoch}),{code:'remote_panel_invalid'});assert.equal(f.external.length,0);
 f.setFetch(()=>new Response('x'.repeat(2*1024*1024+1)));await assert.rejects(f.describe(1),{code:'remote_response_too_large'});
});
