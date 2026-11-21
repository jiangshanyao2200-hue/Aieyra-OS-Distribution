// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: root; fixture; get
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-preview.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {createThemePreviews}=require('../../../Theme/runtime/preview.cjs');
const {assetURL}=require('../../../Theme/contract/assets.mjs');
const {createModPackages}=require('../host/mod-packages.cjs');
const {selectTheme}=require('../../../Theme/runtime/overrides.cjs');
const root=path.resolve(__dirname,'../../../SDK/examples/theme-assets');
function fixture(){const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),definition=JSON.parse(fs.readFileSync(path.join(root,'theme.json')));return {manifest,id:manifest.id,version:manifest.version,name:manifest.name,digest:'a'.repeat(64),definition,files:Object.fromEntries(Object.keys(manifest.files).map(p=>[p,fs.readFileSync(path.join(root,p))]))};}
const get=selection=>({url:assetURL(selection,'paper'),method:'GET'});
test('preview resources are immutable, exact, owner scoped, expiring and never persistable',async()=>{
 let time=100;const f=fixture(),a=new EventEmitter(),b=new EventEmitter(),runtime=createThemePreviews({load:async()=>f,now:()=>time,lifetime:100});
 const first=await runtime.open(a,{preview_id:'first'}),other=await runtime.open(b,{preview_id:'other'}),original=Buffer.from(f.files['assets/paper.png']);
 f.files['assets/paper.png'].fill(0);first.selection.definition.tokens={};
 assert.deepEqual(Buffer.from(await runtime.serve(get(first.selection)).arrayBuffer()),original);
 assert.throws(()=>selectTheme({},first.selection),/主题选择/);
 for(const url of [get(first.selection).url+'?x=1',get(first.selection).url+'#x',get(first.selection).url.replace('/paper','/x/../paper'),get(first.selection).url.replace('/paper','/%70aper'),'bad'])assert.equal(runtime.serve({url,method:'GET'}).status,400);
 assert.equal(runtime.serve({...get(first.selection),method:'POST'}).status,400);
 const second=await runtime.open(a,{preview_id:'second'});runtime.release(a,'first');
 assert.equal(runtime.serve(get(first.selection)).status,410);assert.equal(runtime.serve(get(second.selection)).status,200);
 a.emit('render-process-gone');assert.equal(runtime.serve(get(second.selection)).status,410);assert.equal(runtime.serve(get(other.selection)).status,200);
 assert.equal(a.listenerCount('destroyed'),0);time=200;assert.equal(runtime.serve(get(other.selection)).status,410);assert.equal(b.listenerCount('render-process-gone'),0);
 runtime.close();await assert.rejects(runtime.open(a,{}),/关闭/);
});
test('preview cancellation during admission and replacement cannot revoke a newer lease',async()=>{
 const f=fixture(),a=new EventEmitter(),resumes=[];let time=0;
 const runtime=createThemePreviews({now:()=>time,lifetime:100,load:()=>new Promise(resolve=>resumes.push(resolve))});
 const first=runtime.open(a,{preview_id:'old'}),rejected=assert.rejects(first,/取消/),second=runtime.open(a,{preview_id:'new'});
 resumes[1](f);const selected=await second;resumes[0](f);await rejected;
 assert.equal(runtime.serve(get(selected.selection)).status,200);
 const pending=runtime.open(a,{preview_id:'pending'}),expired=assert.rejects(pending,/取消/);time=101;resumes[2](f);await expired;
 assert.equal(a.listenerCount('destroyed'),0);
 const destroyed=runtime.open(a,{}),dead=assert.rejects(destroyed,/取消/);a.emit('destroyed');resumes[3](f);await dead;runtime.close();
});
test('installed disabled themes preview through Core inspection without applying or enabling them',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-preview-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'source');fs.cpSync(root,source,{recursive:true});const f=fixture(),owner=new EventEmitter(),calls=[];let handler,changed=0,compatible=true;
 const service=createModPackages({dataDir:dir,session:{defaultSession:{protocol:{handle:(_name,fn)=>{handler=fn;},unhandle(){}}}},appearance:{read:()=>({settings:{}}),update(){changed++;}},core:async(action,p)=>{
  calls.push([action,p.action]);assert.equal(action,'workspace.packages');
  if(p.action==='list')return {items:[{manifest:f.manifest,directory:source,digest:f.digest,enabled:false}]};
  if(p.action==='inspect'){assert.equal(p.source,source);return {digest:f.digest,compatibility:{compatible}};}
  throw Error('unexpected mutation');
 }});t.after(()=>service.close());
 const request={action:'mod_theme_preview',id:f.id,expected_digest:f.digest,preview_id:'one'};
 const result=await service.call(request,owner);assert.equal((await handler(get(result.selection))).status,200);assert.equal(changed,0);
 await service.call({action:'mod_theme_preview_close',preview_id:'one'},owner);assert.equal((await handler(get(result.selection))).status,410);
 await assert.rejects(service.call({...request,expected_digest:'b'.repeat(64)},owner),/版本已变化/);
 compatible=false;await assert.rejects(service.call(request,owner),/不兼容/);compatible=true;
 fs.appendFileSync(path.join(source,'assets/paper.png'),'tampered');await assert.rejects(service.call(request,owner),/大小已变化/);
 assert.equal(changed,0);assert.ok(calls.every(([,action])=>['list','inspect'].includes(action)));assert.equal(handler({url:'bad'}).status,400);
});
test('preview admission bounds owners and resources and clears failed registrations',async()=>{
 const f=fixture(),owners=Array.from({length:5},()=>new EventEmitter());let loaded=f;
 const runtime=createThemePreviews({load:async()=>loaded});
 for(const owner of owners.slice(0,4))await runtime.open(owner,{});
 await assert.rejects(runtime.open(owners[4],{}),/最多/);assert.equal(owners[4].listenerCount('destroyed'),0);
 loaded={...f,files:{...f.files,'assets/paper.png':Buffer.alloc(8*1024*1024+1)}};
 await assert.rejects(runtime.open(owners[0],{}),/超出/);assert.equal(owners[0].listenerCount('destroyed'),0);
 loaded=f;await runtime.open(owners[4],{});runtime.close();for(const owner of owners)assert.equal(owner.listenerCount('destroyed'),0);
});
