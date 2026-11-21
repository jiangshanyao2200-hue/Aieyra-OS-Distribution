// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; stamp; snapshot; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/module-control.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createControl}=require('../host/control.cjs');
const stamp='2026-10-09T04:00:00Z',now=Date.parse(stamp);
const snapshot={observed_at:stamp,connection:{state:'online'},agents:[]},registry={observed_at:stamp,connection:{state:'online'},seats:[]};

function fixture({ownerKind='os',heldBy=null,allowExternalView=false}={}){
 const views=[],launched=[];let running=heldBy;
 const win={webContents:Object.assign(new EventEmitter(),{getZoomFactor:()=>1}),getContentSize:()=>[800,600],isDestroyed:()=>false,contentView:{addChildView(){},removeChildView(v){v.removed=true;}}};
 class View{
  constructor(options){const w=this.webContents=new EventEmitter();w.session=options.webPreferences.session;w.isDestroyed=()=>!!w.destroyed;w.close=()=>{w.destroyed=true;};w.setWindowOpenHandler=()=>{};w.loadURL=async()=>{w.emit('did-finish-load');};views.push(this);}
  setVisible(v){this.visible=v;}setBounds(v){this.bounds=v;}
 }
 const electron={WebContentsView:View,shell:{openExternal:async()=>{}},session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){}})}};
 const read=async(_base,endpoint)=>{
  if(!running)throw Object.assign(Error('refused'),{code:'ECONNREFUSED'});
  return endpoint==='/api/health'?{service:'aieyra-control',version:'test',os_managed:true,owner_kind:running}:endpoint==='/api/snapshot'?snapshot:registry;
 };
 const launch=(file,args)=>{
  const p=new EventEmitter();p.pid=5000+launched.length;p.stdout=new EventEmitter();p.stdin=new EventEmitter();p.stdin.messages=[];
  p.stdin.write=s=>{const m=JSON.parse(s);p.stdin.messages.push(m);if(m.type==='owner.hello')queueMicrotask(()=>{running=args.find(a=>a.startsWith('--owner-kind=')).slice(13);p.stdout.emit('data',JSON.stringify({type:'control.ready',owned:true,owner_id:m.owner_id,pid:p.pid})+'\n');});};
  p.stdin.end=()=>{p.stdin.ended=true;queueMicrotask(()=>{running=null;p.emit('exit',0,null);p.emit('close',0,null);});};
  launched.push({file,args,p});return p;
 };
 const control=createControl({apps:{call:async()=>({installed:true,executable:'python',directory:process.cwd()})},win,electron,read,launch,now:()=>now,env:{},platform:'linux',ownerKind,allowExternalView});
 return {control,views,launched,stopExternal(){running=null;}};
}

test('standalone Link starts Control as the link owner',async()=>{
 const f=fixture({ownerKind:'link'});
 try{const state=await f.control.open();assert.equal(state.ownership,'owned');assert.equal(state.owner_kind,'link');assert.equal(state.detached,false);}
 finally{await f.control.close();}
 assert.ok(f.launched[0].args.includes('--owner-kind=link'));
});

test('OS does not attach to or replace a Control held by standalone Link',async()=>{
 const f=fixture({heldBy:'link'});
 try{
  await assert.rejects(f.control.open(),e=>e.code==='control_held_elsewhere'&&/独立的 Aieyra Link/.test(e.message));
  const state=await f.control.status();
  assert.equal(state.detached,true);assert.equal(state.owner_kind,'link');assert.equal(f.launched.length,0);assert.equal(f.views.length,0);
 }finally{await f.control.close();}
});

test('standalone Link refuses a Control that OS still holds',async()=>{
 const f=fixture({ownerKind:'link',heldBy:'os'});
 try{await assert.rejects(f.control.open(),e=>e.code==='control_held_elsewhere'&&/Aieyra OS/.test(e.message));}
 finally{await f.control.close();}
 assert.equal(f.launched.length,0);
});

test('Link may display an existing OS service without owning, replacing or shutting it down',async()=>{
 const f=fixture({ownerKind:'link',heldBy:'os',allowExternalView:true});
 try{
  const ready=await f.control.open();
  assert.equal(ready.page_ready,true);assert.equal(ready.ownership,'external');assert.equal(ready.owner_kind,'os');
  assert.equal(ready.detached,false,'this host displays the existing office');
  assert.equal(f.control.surface({visible:true,bounds:{x:0,y:0,width:800,height:600}}).shown,true);
  assert.equal(f.launched.length,0);
  await f.control.release();
  assert.equal((await f.control.status()).available,true,'releasing a borrowed page leaves the service alive');
  assert.equal((await f.control.open()).page_ready,true);
 }finally{await f.control.close();}
 assert.equal(f.launched.length,0);
});

test('Link acquires its own service only after the borrowed service is confirmed offline',async()=>{
 const f=fixture({ownerKind:'link',heldBy:'os',allowExternalView:true});
 try{
  await f.control.open();f.stopExternal();
  const health=await f.control.ensure();
  assert.equal(health.owner_kind,'link');assert.equal(f.launched.length,1);
  assert.equal((await f.control.status()).ownership,'owned');
 }finally{await f.control.close();}
 assert.equal(f.launched[0].p.stdin.messages.at(-1).type,'owner.shutdown');
});

test('release hands Control back through EOF and the host can own it again later',async()=>{
 const f=fixture();
 try{
  assert.equal((await f.control.open()).ownership,'owned');
  const released=await f.control.release();
  assert.equal(released.service_state,'released');assert.equal(released.ownership,'none');
  const first=f.launched[0].p;
  assert.equal(first.stdin.messages.at(-1).type,'owner.shutdown');assert.equal(first.stdin.ended,true);
  assert.equal(f.views[0].removed,true);assert.equal(f.views[0].webContents.destroyed,true);
  assert.equal((await f.control.open()).ownership,'owned');
  assert.equal(f.launched.length,2);assert.equal(f.views.length,2);
 }finally{await f.control.close();}
});
