// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/cloud-control.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {attachCloudControl,readConfig,project}=require('../host/cloud-control.cjs');
function fixture({url='https://office.example/link/cloud',configuredPython=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'link-cloud-host-')),file=path.join(dir,'cloud-office.json'),key=path.join(dir,'key.txt');
 fs.writeFileSync(key,'private-test-join-key');
 const cfg={schema:1,mode:'cloud',url,key_file:key,client_data:path.join(dir,'device')};if(configuredPython){cfg.python=path.join(dir,'python.exe');fs.writeFileSync(cfg.python,'synthetic interpreter');}fs.writeFileSync(file,JSON.stringify(cfg));
 const calls={localStatus:0,localOpen:0,localClose:0,localRelease:0,localHidden:0,localEnsure:0,ensureError:null,launch:[],requests:[],cookies:[]},views=[],children=[];
 const win=Object.assign(new EventEmitter(),{webContents:new EventEmitter(),getContentSize:()=>[800,600],isDestroyed:()=>false,contentView:{addChildView(){},removeChildView(v){v.removed=true;}}});win.webContents.getZoomFactor=()=>1;
 const local={status:async()=>{calls.localStatus++;return {local:true,available:true};},open:async()=>{calls.localOpen++;return {local:true,page_ready:true};},surface:p=>{calls.surface=p;if(p.visible===false)calls.localHidden++;return {local:true,shown:p.visible===true};},close:async()=>{calls.localClose++;},release:async()=>{calls.localRelease++;},ensure:async()=>{calls.localEnsure++;if(calls.ensureError)throw Error(calls.ensureError);return {local:true};}};
 const session={cookies:{set:async v=>calls.cookies.push(v)},setPermissionRequestHandler(fn){this.permission=fn;},setPermissionCheckHandler(fn){this.check=fn;}};
 class View{constructor(options){this.options=options;this.webContents=new EventEmitter();const wc=this.webContents;wc.session=session;wc.isDestroyed=()=>!!wc.destroyed;wc.close=()=>{wc.destroyed=true;};wc.setWindowOpenHandler=f=>{wc.popup=f;};wc.loadURL=async url=>{this.url=url;if(hang){return new Promise(()=>{});}wc.emit('did-finish-load');};views.push(this);}setVisible(v){this.visible=v;}setBounds(b){this.bounds=b;}}
 const electron={WebContentsView:View,session:{fromPartition:()=>session}};
 let unavailable=false,rejectCookie=false,hang=false;
 const snapshot={office_id:'test-office',capacity:21,devices:[{device_id:'desktop',name:'Desktop',online:true,state:'idle'},{device_id:'server',name:'Server',online:true,state:'busy',server_worker:true}]};
 const read=async(_cfg,route,opts)=>{calls.requests.push({route,opts});if(unavailable)throw Error('temporarily offline');if(route.endsWith('login'))return {status:200,value:{logged_in:true},cookies:['aieyra_link_view='+'v'.repeat(43)+'; HttpOnly; Secure']};if(rejectCookie){rejectCookie=false;return {status:401,value:{code:'cloud_view_login_required'}};}return {status:200,value:snapshot};};
 const launch=(file,args,options)=>{calls.launch.push({file,args,options});const p=new EventEmitter();p.stdout=new EventEmitter();p.stdin=new EventEmitter();p.stdin.end=()=>{p.ended=true;queueMicrotask(()=>p.emit('close',0,null));};children.push(p);return p;};
 const control=attachCloudControl(local,{read,launch,env:{AIEYRA_LINK_CLOUD_CONFIG:file,CODEX_THREAD_ID:'must-not-inherit',AIEYRA_OS_OWNER_TOKEN:'must-not-inherit'}});
 return {control,file,cfg,calls,children,views,session,win,setOffline:v=>{unavailable=v;},expire:()=>{rejectCookie=true;},hang:v=>{hang=v;},cleanup:async()=>{await control.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
// 用户 2026-10-16：Link 只有一种页面（本地标签页）；云办公室只在后台让这台电脑接入并报告云工位数。
test('cloud mode shows the local Link page and joins the cloud office in the background',async()=>{
 const f=fixture();try{
  const s=await f.control.open();assert.equal(s.mode,'cloud');assert.equal(s.local,true);assert.equal(f.calls.localOpen,1);assert.equal(f.views.length,0,'不挂服务器上的旧页面');
  await f.control.status();const st=await f.control.status();assert.equal(st.cloud_available,true);assert.equal(st.cloud_office.count,2);assert.equal(st.cloud_office.running,1);assert(!JSON.stringify(st).includes('private-test-join-key'));
  assert.equal(f.calls.launch.length,1);assert.equal(f.calls.launch[0].options.env.CODEX_THREAD_ID,undefined);assert.equal(f.calls.launch[0].options.env.AIEYRA_OS_OWNER_TOKEN,undefined);assert(!f.calls.launch[0].args.includes('private-test-join-key'));
  const shown=f.control.surface({visible:true,bounds:{x:1,y:2,width:100,height:90}});assert.equal(shown.shown,true);assert.deepEqual(f.calls.surface.bounds,{x:1,y:2,width:100,height:90});
  await f.control.release();assert.equal(f.calls.localRelease,1);assert.equal(f.calls.localClose,0);assert.equal(f.children[0].ended,true);
 }finally{await f.cleanup();}assert.equal(f.calls.localClose,1);
});
test('cloud outage marks cloud observations stale and recovery renews an expired viewer',async()=>{
 const f=fixture();try{await f.control.status();f.setOffline(true);const stale=await f.control.status();assert.equal(stale.cloud_available,false);assert.equal(stale.cloud_office.stale,true);assert.equal(stale.cloud_office.running,null);assert.equal(stale.available,true,'本地页面不受云端影响');f.setOffline(false);f.expire();const restored=await f.control.status();assert.equal(restored.cloud_available,true);assert.equal(f.calls.requests.filter(x=>x.route.endsWith('login')).length,2);assert.equal(f.calls.launch.length,1);}finally{await f.cleanup();}
});

test('status polling after detach cannot reclaim Control or restart the cloud owner',async()=>{
 const f=fixture();try{
  await f.control.status();await f.control.release();
  const before={ensure:f.calls.localEnsure,launch:f.calls.launch.length,requests:f.calls.requests.length};
  await Promise.all([f.control.status(),f.control.status(),f.control.status()]);
  assert.equal(f.calls.localEnsure,before.ensure,'detached OS must only observe the new owner');
  assert.equal(f.calls.launch.length,before.launch,'polling must not resurrect the released cloud worker');
  assert.equal(f.calls.requests.length,before.requests);
  await f.control.open();await f.control.status();
  assert.equal(f.calls.localEnsure,before.ensure+1,'explicitly reopening the docked page resumes service');
  assert.equal(f.calls.launch.length,before.launch+1);
 }finally{await f.cleanup();}
});
test('invalid configured cloud endpoint fails closed for the cloud side only',async()=>{
 const f=fixture({url:'http://office.example/link/cloud'});try{assert.throws(()=>readConfig(f.file),/HTTPS/);assert.throws(()=>project({capacity:21,devices:[{name:'bad',online:'yes'}]}));const status=await f.control.status();assert.equal(status.mode,'cloud');assert.equal(status.cloud_available,false);assert.match(status.cloud_error,/HTTPS/);const opened=await f.control.open();assert.equal(opened.local,true);assert.equal(f.calls.launch.length,0);assert.equal(f.calls.requests.length,0);}finally{await f.cleanup();}
});
test('cloud mode still brings up the local office so stations are not left offline',async()=>{
 const f=fixture();try{
  const status=await f.control.status();
  assert.equal(f.calls.localEnsure,1,'读状态时就要保证本地指挥中心在跑');
  assert.equal(status.local_error,null);
 }finally{await f.cleanup();}
});
test('a local office that will not start is reported honestly',async()=>{
 const f=fixture();try{
  f.calls.ensureError='端口 17930 已被占用';
  const status=await f.control.status();
  assert.equal(status.local_error,'端口 17930 已被占用','本地失败要如实记下来，不冒称已恢复');
  assert.equal(status.cloud_available,true);
 }finally{await f.cleanup();}
});

test('cloud owner uses the explicit validated interpreter without inheriting model identity',async()=>{
 const f=fixture({configuredPython:true});try{
  await f.control.status();assert.equal(f.calls.launch.length,1);
  const call=f.calls.launch[0];assert.equal(call.file,f.cfg.python);
  assert.deepEqual(call.args.slice(0,3),['-B','-X','utf8']);
  assert.equal(call.options.env.CODEX_THREAD_ID,undefined);
 }finally{await f.cleanup();}
});
