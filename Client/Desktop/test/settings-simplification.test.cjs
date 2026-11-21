// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: spec; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/settings-simplification.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const spec=require('../src/spec.cjs'),cfg=require('../src/config.cjs'),pool=require('../src/model-pool.cjs');
const {createService}=require('../src/service.cjs'),{createProviderSettings}=require('../src/provider-settings.cjs'),{dirty}=require('../src/settings-draft.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-simple-settings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify({...spec.defaults(),api_key:'fake-settings-key',custom_preserved:'unchanged'}));const providers=createProviderSettings(async()=>{throw Error('No network expected');},file),service=createService(file);return {file,providers,service,boot:service.call('config:bootstrap')};}
test('browsing, filters, catalog selection and unchanged numeric values do not dirty settings',t=>{
 const {providers,boot}=fixture(t),base=boot.settings;let s=structuredClone(base);
 assert.equal(dirty(s,base,providers),false);
 s.__catalog_search='coder';s.__catalog_selected=['deepseek-v4-pro'];assert.equal(dirty(s,base,providers),false);
 s=providers.select({},s,'openrouter');s=providers.select({},s,'opencode');assert.equal(dirty(s,base,providers),false);
 s=providers.select({},s,'deepseek');s.request_timeout_seconds=String(base.request_timeout_seconds);assert.equal(dirty(s,base,providers),false);
 s.__param_max_tokens='8192';assert.equal(dirty(s,base,providers),true);s.__param_max_tokens='';assert.equal(dirty(s,base,providers),false);
 s.compact_percent=50;assert.equal(dirty(s,base,providers),true);s.compact_percent=base.compact_percent;assert.equal(dirty(s,base,providers),false);
 s.__param_max_tokens='invalid';assert.equal(dirty(s,base,providers),true);
});
test('model selection and parameters apply together on Save and persist after reopening',async t=>{
 const {service,boot,file}=fixture(t);let s=(await service.call('provider:add',{settings:boot.settings,id:'deepseek-v4-pro'})).settings;
 const id=s.api_profiles.find(p=>p.model==='deepseek-v4-pro').id;s=service.call('pool:select',{settings:s,id}).settings;
 const capacity=s.api_profiles.find(p=>p.id===id).context_window;
 s.__param_max_tokens='4096';s.__param_thinking_type='disabled';s.__param_compact_at_tokens='380000';
 assert.equal(cfg.load(file).settings.model,boot.settings.model,'selection must remain a draft until Save');
 const saved=service.call('config:save',{settings:s,expected_version:boot.version});assert(saved.ok,saved.errors?.join());
 assert.equal(saved.settings.active_profile,id);assert.equal(saved.settings.matrix_profile,id);assert.equal(saved.settings.max_tokens,4096);assert.equal(saved.settings.model_context_window,capacity);
 const reopened=createService(file).call('config:bootstrap');assert.equal(reopened.settings.__matrix_model,id);assert.equal(reopened.settings.api_profiles.find(p=>p.id===id).compact_at_tokens,380000);assert.equal(reopened.settings.model_context_window,capacity);assert.equal(reopened.settings.custom_preserved,'unchanged');
 assert(!reopened.nativeFields.some(f=>['__param_temperature','__param_top_p','__param_max_tokens'].includes(f.key)));
 assert.equal(service.call('config:draft-state',{settings:saved.settings,baseline:saved.settings}).dirty,false);
});
test('selecting another model and returning without edits is clean; edits on both models survive',async t=>{
 const {providers,service,boot}=fixture(t);let s=(await service.call('provider:add',{settings:boot.settings,id:'deepseek-v4-pro'})).settings;
 const saved=service.call('config:save',{settings:s,expected_version:boot.version});assert(saved.ok);const base=saved.settings,other=s.api_profiles.find(p=>p.model==='deepseek-v4-pro').id;
 s=service.call('pool:select',{settings:base,id:other}).settings;assert.equal(dirty(s,base,providers),true);
 s=service.call('pool:select',{settings:s,id:base.active_profile}).settings;assert.equal(dirty(s,base,providers),false);
 s.__param_max_tokens='4096';s=service.call('pool:select',{settings:s,id:other}).settings;s.__param_max_tokens='8192';
 const r=service.call('config:save',{settings:s,expected_version:saved.version});assert(r.ok,r.errors?.join());
 assert.equal(r.settings.api_profiles.find(p=>p.id===base.active_profile).parameters.max_tokens,4096);assert.equal(r.settings.api_profiles.find(p=>p.id===other).parameters.max_tokens,8192);
});
test('catalog batch validates all choices before adding, deduplicates, and preserves the parameter editor',t=>{
 const {providers,boot}=fixture(t);const base=boot.settings,s=structuredClone(base);s.__param_max_tokens='4096';s.__catalog_selected=['deepseek-flash','deepseek-v4-pro','deepseek-v4-pro'];
 const invalid={...s,__catalog_selected:['deepseek-v4-pro','missing']};assert.throws(()=>providers.add({},invalid),/不可用/);assert.equal(invalid.api_profiles.length,1);
 const result=providers.add({},s);assert.equal(result.api_profiles.length,2);assert.equal(result.__pool_edit,base.__pool_edit);assert.equal(result.__param_max_tokens,'4096');assert.deepEqual(result.__catalog_selected,[]);
 const fields=require('../src/native-config.cjs').fields(result),grid=fields.find(f=>f.type==='model_grid');assert(grid);assert(grid.options.every(o=>o.disabled));assert(!fields.some(f=>f.key==='__catalog_model'));
});
test('disable and remove clear unavailable Matrix choices, without automatically using another model',async t=>{
 const {service,boot}=fixture(t);const id=boot.settings.active_profile;
 const disabled=service.call('pool:toggle',{settings:boot.settings,id});assert(disabled.ok);assert.equal(disabled.settings.__matrix_model,'');assert.equal(disabled.settings.__pool_edit,undefined);assert.equal(disabled.settings.active_profile,'');assert.equal(disabled.settings.matrix_profile,'');
 assert.equal(service.call('pool:select',{settings:disabled.settings,id}).ok,false);
 const enabled=service.call('pool:toggle',{settings:disabled.settings,id});assert(enabled.ok);assert.equal(enabled.settings.active_profile,'');
 const removed=service.call('pool:remove',{settings:boot.settings,id});assert(removed.ok);assert.equal(removed.settings.__matrix_model,'');
});
test('failed and stale saves leave the saved file and edit values intact',t=>{
 const {service,boot,file}=fixture(t),s=structuredClone(boot.settings),before=fs.readFileSync(file,'utf8');s.__param_max_tokens='not-a-number';
 const r=service.call('config:save',{settings:s,expected_version:boot.version});assert.equal(r.ok,false);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(s.__param_max_tokens,'not-a-number');
 s.__param_max_tokens='4096';fs.writeFileSync(file,before+'\n');assert.equal(service.call('config:save',{settings:s,expected_version:boot.version}).code,'version_conflict');assert.equal(s.__param_max_tokens,'4096');
});
test('language belongs to display; pool and Matrix selections are separate from catalog browsing',t=>{
 const {boot}=fixture(t),fields=boot.nativeFields;assert.equal(fields.find(f=>f.key==='language').section,'display');assert.equal(fields.find(f=>f.key==='__matrix_model').section,'matrix');assert(!fields.some(f=>f.action==='pool:probe'));
});
