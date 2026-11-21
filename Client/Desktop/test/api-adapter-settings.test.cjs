// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; cfg; capabilityFixture; precision
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/api-adapter-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const cfg=require('../src/config.cjs'),spec=require('../src/spec.cjs'),pool=require('../src/model-pool.cjs'),{createSystemSettings}=require('../src/system-settings.cjs');
test('adapter binding persists only its target with CAS, retains credentials, and reset keeps the model',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'api-adapter-')),file=path.join(dir,'config.json');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const base='http://127.0.0.1:8765',s={...spec.defaults(),model_pool_version:1,provider_connections:[{id:'fixture',provider:'custom',base_url:base,api_key:'fixture-credential',api_key_history:['fixture-credential'],request_timeout_seconds:300}],api_profiles:['one','two'].map(id=>({id,name:id,model:'fixture-model',connection_id:'fixture',provider:'custom',base_url:base,api_protocol:'responses',adapter:'openai',context_window:200000,context_window_source:'user_config',tool_calls:true,enabled:true,parameters:pool.parameters(spec.defaults())})),active_profile:'one',matrix_profile:'one'};
 fs.writeFileSync(file,JSON.stringify(pool.synchronize(s)));const api=createSystemSettings(file),version=cfg.version(file),choice={id:'example.gateway',digest:'a'.repeat(64)};
 let result=await api.call('model_adapter_update',{id:'one',selection:choice,expected_version:version});assert.equal(result.ok,true,JSON.stringify(result.errors));
 const saved=cfg.load(file).settings;assert.deepEqual(saved.api_profiles[0].adapter_package,choice);assert.equal(saved.api_profiles[1].adapter_package,undefined);assert.equal(saved.provider_connections[0].api_key,'fixture-credential');
 result=await api.call('model_adapter_update',{id:'one',selection:null,expected_version:version});assert.equal(result.code,'version_conflict');
 const oldFetch=global.fetch;let calls=0;global.fetch=()=>{calls++;throw Error('unexpected network');};t.after(()=>global.fetch=oldFetch);
 await assert.rejects(()=>require('../src/api.cjs').requestModel(pool.activate(saved,saved.api_profiles[0]),{}),/共同Core/);assert.equal(calls,0);
 result=await createSystemSettings(file).call('model_adapter_update',{id:'one',selection:null,expected_version:cfg.version(file)});assert.equal(result.ok,true);const restored=cfg.load(file).settings;assert.equal(restored.api_profiles[0].adapter_package,undefined);assert.equal(restored.active_profile,'one');assert.equal(restored.provider_connections[0].api_key,'fixture-credential');
});

function capabilityFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'api-capability-')),file=path.join(dir,'config.json');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const base='http://127.0.0.1:8765',s={...spec.defaults(),model_pool_version:1,provider_connections:[{id:'fixture',provider:'custom',base_url:base,api_key:'fixture-credential',api_key_history:[],request_timeout_seconds:300}],api_profiles:[{id:'one',name:'fixture',model:'fixture-model',connection_id:'fixture',provider:'custom',base_url:base,api_protocol:'responses',adapter:'openai',context_window:200000,context_window_source:'user_config',tool_calls:true,enabled:true,parameters:pool.parameters(spec.defaults())}],active_profile:'one',matrix_profile:'one'};
 fs.writeFileSync(file,JSON.stringify(pool.synchronize(s)));return file;
}
const precision={key:'precision_mode',type:'enum',values:['fast','precise'],wire_path:['precision_mode'],source:'local fixture specification'};
test('adapter capability evidence follows exact package identity while values and editable definitions survive switching',async t=>{
 const file=capabilityFixture(t),a={id:'example.gateway',digest:'a'.repeat(64)},b={...a,digest:'b'.repeat(64)};
 let requests=0;t.mock.method(require('../src/api.cjs'),'sample',async()=>{requests++;return {elapsedMs:1};});
 const call=async(action,args)=>{const r=await createSystemSettings(file).call(action,{id:'one',...args,expected_version:cfg.version(file)});assert.equal(r.ok,true,JSON.stringify(r.errors));return r;};
 const saved=()=>cfg.load(file).settings.api_profiles[0];
 await call('model_adapter_update',{selection:a});
 const learned=await call('parameters_probe',{parameters:['precision_mode'],descriptors:[precision]});assert.equal(requests,2);assert.equal(learned.probe.accepted[0].evidence,'request_accepted');
 await call('model_update',{parameters:{precision_mode:'precise'}});
 const first=saved();assert.equal(first.parameter_probe.requests,2);
 for(const selection of [b,{...a,id:'example.other'}]){
  await call('model_adapter_update',{selection});const changed=saved();
  assert.equal(changed.parameter_probe,undefined,'A different adapter must not inherit probe evidence');
  assert.equal(changed.capability_source,undefined);assert.equal(changed.capability_updated_at,undefined);
  assert.equal(changed.parameters.model_options.precision_mode,'precise');
  assert.deepEqual(changed.parameter_specs.find(f=>f.key==='precision_mode'),precision);
  await call('model_adapter_update',{selection:a});const restored=saved();
  assert.deepEqual(restored.parameter_probe,first.parameter_probe);assert.equal(restored.parameter_specs.find(f=>f.key==='precision_mode').evidence,'request_accepted');
 }
 await call('model_adapter_update',{selection:b});await call('parameters_probe',{parameters:[]});assert.equal(saved().parameter_probe.requests,1);
 await call('model_adapter_update',{selection:a});assert.deepEqual(saved().parameter_probe,first.parameter_probe);
 await call('model_adapter_update',{selection:b});assert.equal(saved().parameter_probe.requests,1);
 await call('model_adapter_update',{selection:null});assert.equal(saved().parameter_probe,undefined);assert.equal(saved().parameters.model_options.precision_mode,'precise');
 assert.equal(requests,3,'Switching and rollback must only read local evidence');
});
test('legacy capability caches remain available to built-in adapters and cannot validate a newly bound package',async t=>{
 for(const protocolKey of [false,true]){
  const file=capabilityFixture(t),s=cfg.load(file).settings,p=s.api_profiles[0],record={api_protocol:p.api_protocol,at:'2026-01-01T00:00:00Z',source:'probe',specs:[{...precision,evidence:'request_accepted'}],probe:{requests:2,semantic_support:'not_proven'}};
  require('../src/catalog-store.cjs').createStore(file).put('capability:'+p.base_url+':'+p.model+(protocolKey?':'+p.api_protocol:''),record);
  const service=require('../src/provider-settings.cjs').createProviderSettings(undefined,file),legacy=service.hydrate(s);
  assert.deepEqual(legacy.api_profiles[0].parameter_probe,record.probe);
  // Older settings may already contain this evidence without an ownership marker.
  delete legacy.api_profiles[0].capability_identity;fs.writeFileSync(file,JSON.stringify(pool.synchronize(legacy)));
  const r=await createSystemSettings(file).call('model_adapter_update',{id:p.id,selection:{id:'example.gateway',digest:'a'.repeat(64)},expected_version:cfg.version(file)});assert.equal(r.ok,true,JSON.stringify(r.errors));
  const bound=cfg.load(file).settings.api_profiles[0];assert.equal(bound.parameter_probe,undefined);assert.equal(bound.capability_source,undefined);assert.deepEqual(bound.parameter_specs.find(f=>f.key===precision.key),precision);
 }
});
