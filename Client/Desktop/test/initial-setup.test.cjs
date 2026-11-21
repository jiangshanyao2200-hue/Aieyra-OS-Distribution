// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; png; jpeg; fresh
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/initial-setup.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {connectionGuidance,initialGuideVisible}=require('../ui/setup-guidance.mjs');
const {EyraState}=require('../ui/eyra-state.mjs');
const {createProfileStore}=require('../host/profile.cjs');
const {createOfficialLibrary}=require('../../../Theme/runtime/official-library.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64');
function fresh(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-initial-setup-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return {directory,profile:createProfileStore(path.join(directory,'config.json'))};}

test('offline setup failures offer configuration while network failures can retry',()=>{
 for(const detail of ['尚未配置 API Key','请先接入一个经过验证的模型：未选择模型','HTTP 401 unauthorized']){
  const result=connectionGuidance({state:'offline',error:'您的Eyra处于离线状态。',detail});
  assert.equal(result.action,'settings');assert.equal(result.needsSetup,true);assert.ok(result.reason);
 }
 const retry=connectionGuidance({state:'offline',detail:'连接超时，请检查网络'});assert.equal(retry.action,'retry');assert.equal(retry.needsSetup,false);
 assert.equal(connectionGuidance({},true).action,'');assert.equal(connectionGuidance({state:'online'}),null);
});

test('welcome is local guidance for an empty home and never replaces a real turn or another session',()=>{
 const home={session_id:'home',root_id:'home'};
 assert.equal(initialGuideVisible(home,{initialized:false},{}),true);
 assert.equal(initialGuideVisible(home,{initialized:true},{needsSetup:true}),true);
 for(const flow of [{active:true},{submitted:true},{user:{from:'user'}}])assert.equal(initialGuideVisible(home,{initialized:false},flow),false);
 assert.equal(initialGuideVisible({session_id:'other',root_id:'home'},{initialized:false},{}),false);
 assert.equal(initialGuideVisible(home,{initialized:false},{},true),false);
});

test('missing model keeps configuration guidance across skipped greetings and retained generations',()=>{
 const state=new EyraState();
 for(const greeting of [{state:'skipped'},{state:'local',text:'Earlier greeting'},{}]){
  const snapshot={ready:false,greeting,roles:[{role:'matrix',state:'idle',generation:3}],messages:[]};
  const flow=state.project(snapshot);
  assert.equal(flow.state,'offline');assert.equal(flow.needsSetup,true);assert.equal(flow.connectionAction,'settings');
  assert.equal(initialGuideVisible(snapshot,{initialized:true},flow),true);
  const restored=state.project({...snapshot,ready:true});
  assert.equal(restored.needsSetup,false);assert.equal(restored.connectionAction,'');
 }
 const active=state.project({ready:false,roles:[{role:'matrix',state:'running',generation:3}],messages:[],live:{}});
 assert.equal(active.active,true);assert.equal(active.needsSetup,false,'configuration guidance must not cover ongoing work');
 assert.equal(connectionGuidance({state:'skipped'},true,false).action,'','transport recovery still takes precedence');
});

test('fresh media is seeded atomically from bundled files even when signed in, without a cloud request',async t=>{
 const f=fresh(t);let requests=0,changes=0,decoded=0;
 const library=createOfficialLibrary({client:{status:()=>({signedIn:true,user:{id:'example'}}),themeRequest:()=>{requests++;throw Error('must stay local');}},profile:f.profile,directory:path.join(f.directory,'cache'),decode:(_bytes,{category})=>{decoded++;return category==='background'?jpeg:png;},now:()=>1000,changed:()=>changes++});t.after(()=>library.close());
 await Promise.all([library.initialize(),library.initialize()]);
 const p=f.profile.read();assert.equal(requests,0);assert.equal(changes,1);assert.equal(decoded,5);assert.equal(p.initialized,false);
 assert.ok(p.avatar&&p.eyraAvatar&&p.background&&p.roles.execution.avatar&&p.roles.project.avatar);
 assert.equal(p.mediaRotation.background.intervalSeconds,600);
 const avatars=['avatar','eyraAvatar','cotaAvatar','vayaAvatar'];
 assert.equal(new Set(avatars.map(key=>p.mediaRotation[key].id)).size,4,'initial avatars use separate draws');
 for(const key of ['background',...avatars]){assert.ok(p.mediaRotation[key].id.startsWith('builtin.'));assert.equal(p.mediaRotation[key].nextAt,1000+p.mediaRotation[key].intervalSeconds*1000);}
 for(const key of avatars)assert.equal(p.mediaRotation[key].intervalSeconds,86400);
 const before=fs.readFileSync(f.profile.file);await library.initialize();assert.deepEqual(fs.readFileSync(f.profile.file),before);
});

test('a manual profile save during initial decoding wins over the pending default allocation',async t=>{
 const f=fresh(t);let release,entered;
 const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 const library=createOfficialLibrary({client:{status:()=>({signedIn:false})},profile:f.profile,decode:async(_bytes,{category})=>{entered();await held;return category==='background'?jpeg:png;}});t.after(()=>library.close());
 const initialization=library.initialize();await ready;
 f.profile.update({name:'Chosen Name',avatar:png,mediaRotation:{avatar:{mode:'custom',intervalSeconds:86400}}},f.profile.read().version);
 const chosen=fs.readFileSync(f.profile.file);release();await initialization;
 assert.deepEqual(fs.readFileSync(f.profile.file),chosen,'no delayed initialization may replace the chosen profile');
});
