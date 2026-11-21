// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; cfg; OLD; fixture; ids; assertSafe
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/provider-edit.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// External draft only; not executed by its author. Temporary synthetic JSON,
// public settings service and shared config lock; no HTTP, model or SQLite.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cfg=require('../src/config.cjs'),spec=require('../src/spec.cjs');
const {draftProfile}=require('../host/connection.cjs');
const {createSystemSettings}=require('../src/system-settings.cjs');
const OLD='r27-synthetic-old-key-0001',OLDER='r27-synthetic-history-0001',NEW='r27-synthetic-new-key-0002',OTHER='r27-synthetic-other-key-0003';
function fixture(t,disabled=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-provider-edit-')),file=path.join(dir,'config.json');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const connections=[{id:'edit-target',provider:'custom',preset:'custom',name:'本人自定义连接',base_url:'https://old.invalid/v1',api_key:OLD,api_key_history:[OLD,OLDER],enabled:!disabled,request_timeout_seconds:77,custom_marker:'keep-target'},
  {id:'edit-other',provider:'custom',preset:'custom',name:'独立连接',base_url:'https://other.invalid/v1',api_key:OTHER,api_key_history:[OTHER],enabled:true,request_timeout_seconds:88}];
 const profiles=['target-a','target-b','other-a'].map((id,i)=>{
  const c=connections[i===2?1:0],model='r27-edit-fixture-'+i;
  return {...draftProfile({base_url:c.base_url,model,api_protocol:'responses'},{context_window:128000,tool_calls:true}),id,connection_id:c.id,provider:c.provider,name:'自定义模型 '+i,enabled:i===2||i===0&&!disabled,compact_at_tokens:64000,custom_marker:'keep-model-'+i};
 });
 const main=disabled?'other-a':'target-a';
 const pool=require('../src/model-pool.cjs'),initial={...spec.defaults(),model_pool_version:1,provider_connections:connections,api_profiles:profiles,matrix_profile:main,active_profile:main,execution_profile:'other-a',user_connections:{custom:'edit-target'}};
 fs.writeFileSync(file,JSON.stringify(pool.synchronize(pool.migrate(initial))));
 const service=createSystemSettings(file),call=p=>service.call('pool',p,'r27-edit-human');
 return {file,service,call,state:()=>cfg.load(file).settings};
}
const ids=s=>s.api_profiles.map(p=>p.id);
function assertSafe(value){const text=JSON.stringify(value);for(const key of [OLD,OLDER,NEW,OTHER])assert.equal(text.includes(key),false,'raw synthetic Key escaped the settings projection');}

test('blank Key edits the same connection and preserves custom parameters and all model IDs',async t=>{
 const f=fixture(t),v=await f.call({op:'view'}),before=f.state();
 const r=await f.call({op:'key_edit',connection_id:'edit-target',preset:'custom',patch:{name:'改名但不换 Key',api_key:''},expected_version:v.version});
 assert.equal(r.ok,true,JSON.stringify(r.errors));assertSafe(r);
 const after=f.state(),c=after.provider_connections[0];assert.equal(c.id,'edit-target');assert.equal(c.name,'改名但不换 Key');
 assert.equal(c.api_key,OLD);assert.deepEqual(c.api_key_history,[OLD,OLDER]);assert.equal(c.request_timeout_seconds,77);assert.equal(c.custom_marker,'keep-target');
 assert.deepEqual(ids(after),ids(before));assert.deepEqual(after.api_profiles,before.api_profiles);assert.deepEqual(after.user_connections,before.user_connections);
 assert.deepEqual(after.provider_connections[1],before.provider_connections[1]);assert.equal(after.matrix_profile,before.matrix_profile);
});

test('address edit updates existing consumers without changing their model or session selections',async t=>{
 const f=fixture(t),v=await f.call({op:'view'}),before=f.state(),sessions=require('../src/session-model.cjs');
 assert.equal(sessions.select(f.file,'r27-existing-session','target-a',v.version,'missing').ok,true);
 const selection=sessions.read(f.file,'r27-existing-session');
 const r=await f.call({op:'key_edit',connection_id:'edit-target',patch:{base_url:'https://new.invalid/v1',api_key:' '},expected_version:v.version});
 assert.equal(r.ok,true,JSON.stringify(r.errors));assertSafe(r);
 const after=f.state();assert.deepEqual(ids(after),ids(before));assert.equal(after.provider_connections.length,2);
 for(const p of after.api_profiles){const prior=before.api_profiles.find(x=>x.id===p.id);assert.deepEqual(p,{...prior,base_url:p.connection_id==='edit-target'?'https://new.invalid/v1':prior.base_url});}
 assert.equal(after.api_key,OLD);assert.equal(after.base_url,'https://new.invalid/v1');assert.deepEqual(sessions.read(f.file,'r27-existing-session'),selection);
 const consumer=await f.service.call('read',{},'r27-existing-session');assert.equal(consumer.effective_profile,'target-a');assert.equal(consumer.settings.base_url,'https://new.invalid/v1');
});

test('replacement requires confirmation, drops old fallback keys and never returns raw keys',async t=>{
 const f=fixture(t),v=await f.call({op:'view'}),bytes=fs.readFileSync(f.file);
 const request={op:'key_edit',connection_id:'edit-target',patch:{api_key:NEW},expected_version:v.version};
 await assert.rejects(f.call(request),/确认替换/);assert.deepEqual(fs.readFileSync(f.file),bytes);
 const r=await f.call({...request,replace_key:true});assert.equal(r.ok,true,JSON.stringify(r.errors));assertSafe(r);
 const after=f.state();assert.equal(after.provider_connections[0].api_key,NEW);assert.deepEqual(after.provider_connections[0].api_key_history,[NEW]);
 assert.equal(after.api_key,NEW);assert.deepEqual(after.api_key_history,[NEW]);assert.equal(after.provider_connections[1].api_key,OTHER);
});

test('stale versions and a held shared write lock leave configuration bytes unchanged',async t=>{
 const f=fixture(t),v=await f.call({op:'view'});
 const current=await f.call({op:'key_edit',connection_id:'edit-target',patch:{name:'另处已保存'},expected_version:v.version});assert.equal(current.ok,true);
 const bytes=fs.readFileSync(f.file),stale=await f.call({op:'key_edit',connection_id:'edit-target',patch:{name:'旧草稿'},expected_version:v.version});
 assert.equal(stale.code,'version_conflict');assert.deepEqual(fs.readFileSync(f.file),bytes);
 const locked=await cfg.withWriteLock(f.file,current.version,()=>f.call({op:'key_edit',connection_id:'edit-target',patch:{name:'锁内不应保存'},expected_version:current.version}));
 assert.equal(locked.code,'config_busy');assert.deepEqual(fs.readFileSync(f.file),bytes);
});

test('editing preserves explicit connection/model disables and switches platform without adding models',async t=>{
 const f=fixture(t,true),v=await f.call({op:'view'}),before=f.state();
 const r=await f.call({op:'key_edit',connection_id:'edit-target',preset:'deepseek',patch:{name:'改为官方平台'},expected_version:v.version});
 assert.equal(r.ok,true,JSON.stringify(r.errors));const after=f.state(),c=after.provider_connections[0];
 assert.equal(c.id,'edit-target');assert.equal(c.provider,'deepseek');assert.equal(c.base_url,spec.DEFAULT_BASE_URL);assert.equal(c.enabled,false);assert.equal(c.request_timeout_seconds,77);assert.equal(c.api_key,OLD);
 assert.deepEqual(ids(after),ids(before));assert.equal(after.active_profile,'other-a');assert.equal(after.matrix_profile,'other-a');
 for(const p of after.api_profiles.filter(p=>p.connection_id===c.id)){const prior=before.api_profiles.find(x=>x.id===p.id);assert.equal(p.enabled,false);assert.equal(p.base_url,c.base_url);assert.equal(p.api_protocol,prior.api_protocol);assert.equal(p.adapter,prior.adapter);assert.deepEqual(p.parameters,prior.parameters);}
 assertSafe(r);
});

test('missing connections, unsupported fields, duplicate credentials and account endpoints cannot be edited',async t=>{
 const f=fixture(t),v=await f.call({op:'view'}),bytes=fs.readFileSync(f.file);
 const variants=[{connection_id:'removed-connection',patch:{name:'不应重建'}},{connection_id:'edit-target',patch:{enabled:true}},
  {connection_id:'edit-target',patch:{base_url:'https://other.invalid/v1',api_key:OTHER},replace_key:true},
  {connection_id:'edit-target',patch:{base_url:require('../src/model-setup.cjs').GATEWAY}}];
 for(const p of variants){await assert.rejects(f.call({op:'key_edit',expected_version:v.version,...p}));assert.deepEqual(fs.readFileSync(f.file),bytes);}
});
