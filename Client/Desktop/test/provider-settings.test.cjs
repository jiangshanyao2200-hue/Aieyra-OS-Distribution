// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: spec; model; response; original; fixture; mock; addProvider
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/provider-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const spec=require('../src/spec.cjs'),cfg=require('../src/config.cjs'),pool=require('../src/model-pool.cjs'),caps=require('../src/model-capabilities.cjs');
const {createProviderSettings,normalizeCatalog}=require('../src/provider-settings.cjs'),{createService}=require('../src/service.cjs');
const model=(id='vendor/coder')=>({id,name:id,context_length:128000,architecture:{output_modalities:['text']},supported_parameters:['tools','tool_choice','max_tokens','temperature','top_p'],top_provider:{max_completion_tokens:16384}});
const response=data=>new Response(JSON.stringify(data));
const original=()=>({...spec.defaults(),api_key:'fake-deepseek-key',api_key_history:['fake-deepseek-key'],max_tokens:65536});

test('New API endpoint declarations select a supported wire protocol without granting tools',()=>{
 const {normalizeCustomCatalog}=require('../src/provider-settings.cjs');
 const input={data:[
  {id:'gpt-6-sol',supported_endpoint_types:['openai']},
  {id:'grok-4.7',supported_endpoint_types:['openai','openai-response']},
  {id:'claude-future',supported_endpoint_types:['anthropic']},
  {id:'gemini-future',supported_endpoint_types:['gemini']},
  {id:'unknown',supported_endpoint_types:['future-vendor']},
 ]};
 const before=structuredClone(input),rows=normalizeCustomCatalog(input);
 assert.deepEqual(rows.map(x=>x.api_protocol),['chat_completions','responses','anthropic_messages','google_generate','responses']);
 assert(rows.slice(0,4).every(x=>x.protocol_source==='provider_catalog'));
 assert.equal(rows[4].protocol_source,'inferred');
 assert(rows.every(x=>x.tool_calls===false&&x.available===false),'endpoint support does not prove a tool roundtrip');
 assert.deepEqual(input,before);
});
test('ID-only catalogs distinguish bundled limits from provider-declared capacity',()=>{
 const modelID='muse-spark-1.3-contributor';
 const bundled=normalizeCatalog('opencode-go',{data:[{id:modelID}]})[0];
 assert.equal(bundled.context_window,1048576);assert.equal(bundled.context_window_source,'bundled_model_reference');
 assert.equal(bundled.protocol_source,'bundled_model_reference');
 const declared=normalizeCatalog('opencode-go',{data:[{id:modelID,context_window:128000,api_protocol:'chat_completions'}]})[0];
 assert.equal(declared.context_window,128000);assert.equal(declared.context_window_source,'provider_catalog');
 assert.equal(declared.api_protocol,'chat_completions');assert.equal(declared.protocol_source,'provider_catalog');
 assert.equal(normalizeCatalog('opencode-go',{data:[{id:'unknown-model'}]})[0].context_window_source,'conservative_client_budget');
});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-model-pool-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify(original()));return {file,service:createService(file)};}
function mock(t){const old=global.fetch;global.fetch=async url=>url.includes('models.dev')?response({}):url.includes('/rankings')?new Response('<html/>'):response({data:url.includes('openrouter')?[model(),model('vendor/second')]:[{id:'muse-spark-1.3-contributor'}]});t.after(()=>global.fetch=old);}
async function addProvider(service,s,id,key,modelID){s=(await service.call('provider:select',{settings:s,id})).settings;s.api_key=key;s.api_key_history=[key];s=(await service.call('provider:discover',{settings:s})).settings;const r=await service.call('provider:add',{settings:s,id:modelID});assert.equal(r.ok,true,r.errors?.join(';'));return r.settings;}

test('two provider keys survive one save and reload even without adding a model',async t=>{
 const {file,service}=fixture(t),boot=service.call('config:bootstrap');let s=boot.settings;const before=fs.readFileSync(file,'utf8');
 for(const [id,key]of [['openrouter','fake-router-key'],['opencode-go','fake-go-key']]){s=(await service.call('provider:select',{settings:s,id})).settings;assert.equal(s.api_key,'');s.api_key=key;s.api_key_history=[key];}
 assert.equal(fs.readFileSync(file,'utf8'),before);const saved=service.call('config:save',{settings:s,expected_version:boot.version});assert.equal(saved.ok,true,saved.errors?.join(';'));
 const disk=cfg.load(file).settings;assert.equal(disk.api_profiles.length,1);assert.equal(disk.model,'deepseek-flash');assert.equal(disk.provider_connections.length,3);
 for(const [id,key]of [['deepseek','fake-deepseek-key'],['openrouter','fake-router-key'],['opencode-go','fake-go-key']]){const r=await service.call('provider:select',{settings:service.call('config:bootstrap').settings,id});assert.equal(r.settings.api_key,key);}
 assert(!JSON.stringify((await service.call('system:settings',{action:'read'}))).includes('fake-router-key'));
 assert(!Object.keys(disk).some(k=>k.startsWith('__')));assert.equal(service.call('config:save',{settings:s,expected_version:boot.version}).code,'version_conflict');
});

test('two added providers and their models survive one save; choosing a catalog item never activates it',async t=>{
 mock(t);const {service}=fixture(t),boot=service.call('config:bootstrap');let s=boot.settings;
 s=await addProvider(service,s,'openrouter','fake-router-key','vendor/coder');const router=s.api_profiles.find(p=>p.model==='vendor/coder');
 s=await addProvider(service,s,'opencode-go','fake-go-key','muse-spark-1.3-contributor');assert.equal(s.api_profiles.length,3);assert.equal(s.active_profile,'deepseek-flash');
 let r=await service.call('pool:matrix',{settings:s,id:router.id});s=r.settings;assert.equal(s.matrix_profile,router.id);
 r=service.call('config:save',{settings:s,expected_version:boot.version});assert.equal(r.ok,true,r.errors?.join(';'));assert.equal(r.settings.model,'vendor/coder');assert.equal(r.settings.api_profiles.length,3);
 const models=await service.call('config:models');assert.equal(models.models.length,3);
 const back=await service.call('provider:select',{settings:r.settings,id:'deepseek'});assert.equal(back.settings.api_key,'fake-deepseek-key');assert.equal(back.settings.active_profile,router.id);
});

test('catalog keeps 450+ models, binds credentials to official host, and rejects incompatible additions',async()=>{
 const calls=[];const p=createProviderSettings(async(url,o)=>{calls.push({url,auth:o.headers.Authorization,redirect:o.redirect});if(url.includes('models.dev'))return response({});if(url.includes('/rankings'))return new Response('');return response({data:[...Array.from({length:450},(_,i)=>model('vendor/'+i)),{id:'image-only',context_length:32000}]});});
 let s=p.select(original(),p.decorate(original()),'openrouter');s.api_key='fake-router-key';const r=await p.discover(s);s=r.settings;assert.equal(s.__models.length,451);assert.equal(s.__models.filter(m=>m.available).length,450);
 assert.equal(calls[0].url,'https://openrouter.ai/api/v1/models/user');assert.equal(calls[0].auth,'Bearer fake-router-key');assert.equal(calls[0].redirect,'error');assert(calls.slice(1).every(c=>!c.auth));
 assert.throws(()=>p.add(original(),s,'image-only'));const chosen=p.choose(original(),s,'vendor/449');assert.equal(chosen.active_profile,'deepseek-flash');assert.equal(chosen.api_profiles.length,1);
 await assert.rejects(p.discover({...s,base_url:'https://foreign.invalid'}));assert.equal(calls.length,4);
 assert(calls.every(c=>new URL(c.url).hostname!=='models.dev'));
});

test('401, key changes and retries preserve every provider draft and never reuse another key catalog',async()=>{
 let fail=false;const p=createProviderSettings(async url=>{if(url.includes('models.dev'))return response({});if(url.includes('/rankings'))return new Response('');if(fail)return new Response('private echo',{status:401});return response({data:[model()]});});
 let s=p.select(original(),p.decorate(original()),'openrouter');s.api_key='fake-one';s=(await p.discover(s)).settings;s.api_key='fake-two';assert.throws(()=>p.add(original(),s,'vendor/coder'));
 const before=structuredClone(s);fail=true;await assert.rejects(p.discover(s),/HTTP 401/);assert.deepEqual(s,before);
});

test('OpenCode protocol selection and public metadata fallback remain explicit',async()=>{
 const p=createProviderSettings(async url=>{if(url.includes('models.dev')||url.includes('/rankings'))throw Error('offline');return response({data:[{id:'claude-sonnet-4-6'},{id:'gpt-5.5'},{id:'gemini-3.1-pro'},{id:'deepseek-v4-pro'},{id:'future-unknown'}]});});
 let s=p.select(original(),p.decorate(original()),'opencode');s.api_key='fake-zen';const r=await p.discover(s);assert.match(r.notice,/快照/);
 for(const [id,protocol]of [['claude-sonnet-4-6','anthropic_messages'],['gpt-5.5','responses'],['gemini-3.1-pro','google_generate'],['deepseek-v4-pro','chat_completions']])assert.equal(r.settings.__models.find(m=>m.id===id).api_protocol,protocol);
 assert.equal(r.settings.__models.find(m=>m.id==='future-unknown').available,false);
});

test('only enabled pool entries appear in model choice; disabled Matrix never causes implicit fallback',async t=>{
 mock(t);const {file,service}=fixture(t),boot=service.call('config:bootstrap');let s=await addProvider(service,boot.settings,'openrouter','fake-router','vendor/coder');const id=s.api_profiles.find(p=>p.model==='vendor/coder').id;
 s=(await service.call('pool:matrix',{settings:s,id})).settings;s=(await service.call('pool:toggle',{settings:s,id})).settings;
 assert.equal(s.active_profile,'');assert.equal(s.matrix_profile,'');const saved=service.call('config:save',{settings:s,expected_version:boot.version});assert.equal(saved.ok,true,saved.errors?.join(';'));
 assert(!(await service.call('config:models')).models.some(p=>p.id===id));assert.equal((await service.call('config:model',id)).ok,false);
 assert(spec.validate(cfg.load(file).settings).some(e=>e.includes('模型池')));
 const test=await service.call('pool:test',{settings:s,id});assert.equal(test.ok,false);
});

test('parameters live independently in the pool; API form contains only connection/global options',async t=>{
 mock(t);const {file,service}=fixture(t),boot=service.call('config:bootstrap');let s=await addProvider(service,boot.settings,'openrouter','fake-router','vendor/coder');s=(await service.call('provider:add',{settings:s,id:'vendor/second'})).settings;
 const one=s.api_profiles.find(p=>p.model==='vendor/coder').id,two=s.api_profiles.find(p=>p.model==='vendor/second').id;
 const capacity=s.api_profiles.find(p=>p.id===one).context_window;
 s=(await service.call('pool:edit',{settings:s,id:one})).settings;s.__param_compact_at_tokens='64000';s.__param_max_tokens='4096';s=(await service.call('pool:apply',{settings:s})).settings;
 s=(await service.call('pool:edit',{settings:s,id:two})).settings;s.__param_compact_at_tokens='96000';s=(await service.call('pool:apply',{settings:s})).settings;
 assert.equal(s.api_profiles.find(p=>p.id===one).compact_at_tokens,64000);assert.equal(s.api_profiles.find(p=>p.id===two).compact_at_tokens,96000);assert.equal(s.api_profiles.find(p=>p.id===one).context_window,capacity);
 s=(await service.call('pool:matrix',{settings:s,id:one})).settings;const saved=service.call('config:save',{settings:s,expected_version:boot.version});assert.equal(saved.ok,true,saved.errors?.join(';'));
 const real=pool.synchronize(pool.migrate(cfg.load(file).settings));assert.equal(real.model,'vendor/coder');assert.equal(real.model_context_window,capacity);
 const read=await service.call('system:settings',{action:'pool'});assert.equal(read.models.find(p=>p.id===one).parameters.max_tokens,4096);
 const fields=require('../src/native-config.cjs').fields(saved.settings);assert(!fields.some(f=>['max_tokens','temperature','thinking_type','reasoning_effort'].includes(f.key)));
 for(const language of ['zh-CN','en-US']){const f=require('../src/native-config.cjs').fields({...s,language});assert.equal(f.find(f=>f.key==='__provider').options.length,5);assert(f.find(f=>f.key==='__catalog_selected'&&f.type==='model_grid'));}
 const active=pool.synchronize({...pool.migrate(saved.settings),active_profile:one});const request=spec.buildRequest(active,[{role:'user',content:'test'}],true);assert.equal(request.temperature,undefined);assert.equal(request.max_tokens,4096);assert.equal(request.reasoning,undefined);
});

test('free and official popularity sort first; missing prices are not interpreted as free',()=>{
 const a=model('deepseek/deepseek-v4-flash-0731:free');a.pricing={prompt:'0',completion:'0'};const b=model('openai/gpt-5.6-luna');b.pricing={prompt:'0.001',completion:'0.002'};const c=model('unknown');
 const items=normalizeCatalog('openrouter',{data:[c,b,a]});assert.deepEqual(items.map(x=>x.id),[a.id,b.id,c.id]);assert.equal(items[2].free,null);
 for(const price of [null,'',-1,'unknown']){const m=model();m.pricing={prompt:price,completion:'0'};assert.equal(normalizeCatalog('openrouter',{data:[m]})[0].free,null);}
 const zen=normalizeCatalog('opencode',{data:[{id:'big-pickle'},{id:'gpt-5.5'}]});assert.equal(zen[0].id,'big-pickle');assert.equal(zen[0].free,true);
 const go=normalizeCatalog('opencode-go',{data:[{id:'muse-spark-1.3-contributor'}]});assert.equal(go[0].free,null);
});

test('per-model parameter ranges, mutually exclusive reasoning and provider-default omission',()=>{
 const m=normalizeCatalog('openrouter',{data:[model() ]})[0];let p={provider:'openrouter',model:m.id,name:m.name,adapter:'openai',api_protocol:'chat_completions',parameter_specs:m.parameter_specs,parameters:pool.parameters(spec.defaults())};
 assert.throws(()=>caps.edit(p,{max_tokens:99999}));assert.throws(()=>caps.validate({...p,parameters:{model_options:{thinking_budget:3}}}));
 assert.throws(()=>caps.edit(p,{temperature:0}),/不支持参数/);assert.throws(()=>caps.edit(p,{top_p:.5}),/不支持参数/);
 p.parameters.model_options={temperature:0,top_p:.5};assert.doesNotThrow(()=>caps.validate(p));
 const request=caps.apply({adapter:'openai',base_url:'https://openrouter.ai/api/v1',api_protocol:'chat_completions',model_options:p.parameters.model_options},{});assert.equal(request.temperature,undefined);assert.equal(request.top_p,undefined);
 const muse=normalizeCatalog('opencode-go',{data:[{id:'muse-spark-1.3-contributor'}]})[0];assert(muse.parameter_specs.some(f=>f.key==='reasoning_summary'));assert(muse.parameter_specs.find(f=>f.key==='reasoning_effort').values.includes('xhigh'));
});

test('removed provider credentials are not resurrected from legacy model copies',async t=>{
 const {file,service}=fixture(t),boot=service.call('config:bootstrap');const s={...boot.settings,api_key:'',api_key_history:[]};const saved=service.call('config:save',{settings:s,expected_version:boot.version});assert.equal(saved.ok,true,saved.errors?.join(';'));const raw=fs.readFileSync(file,'utf8');assert(!raw.includes('fake-deepseek-key'));assert.equal((await service.call('api:ping',saved.settings)).ok,false);
});

test('Agent model_update versions, parameters, Matrix and disable use the same pool contract',async t=>{
 mock(t);const {file,service}=fixture(t),boot=service.call('config:bootstrap');let s=await addProvider(service,boot.settings,'openrouter','fake-router','vendor/coder');
 let saved=service.call('config:save',{settings:s,expected_version:boot.version});assert.equal(saved.ok,true);
 const call=(action,arguments_)=>service.call('system:settings',{action,arguments:arguments_});
 const p=(await call('pool',{})).models.find(p=>p.model==='vendor/coder');
 let r=await call('model_update',{id:p.id,expected_version:saved.version,parameters:{compact_at_tokens:64000,max_tokens:2048},matrix:true});assert.equal(r.ok,true,r.errors?.join(';'));
 assert.equal(cfg.load(file).settings.matrix_profile,p.id);assert.equal(cfg.load(file).settings.model_context_window,p.context_window);assert.equal(cfg.load(file).settings.api_profiles.find(x=>x.id===p.id).compact_at_tokens,64000);
 const raw=fs.readFileSync(file,'utf8');
 r=await call('model_update',{id:p.id,expected_version:r.version,parameters:{unsupported:true}});assert.equal(r.ok,false);assert.equal(fs.readFileSync(file,'utf8'),raw);
 r=await call('model_update',{id:p.id,expected_version:saved.version,enabled:false});assert.equal(r.code,'version_conflict');assert.equal(fs.readFileSync(file,'utf8'),raw);
 r=await call('model_update',{id:p.id,expected_version:cfg.version(file),parameters:{max_tokens:null},enabled:false});assert.equal(r.ok,true,r.errors?.join(';'));
 const disk=cfg.load(file).settings;assert.equal(disk.active_profile,'');assert.equal(disk.matrix_profile,'');assert.equal(disk.api_profiles.find(p=>p.id===disk.matrix_profile),undefined);
 assert.equal(disk.api_profiles.find(x=>x.id===p.id).parameters.model_options.temperature,undefined);
 assert(!JSON.stringify(r).includes('fake-router'));
});

test('legacy profiles preserve all connection keys and normalize DeepSeek v1 without saving',()=>{
 const s=require('./pool-fixture.cjs').withLegacyProfiles(original());s.active_profile='deepseek-v4-pro';s.model='deepseek-v4-pro';s.api_key='active-key';s.api_key_history=['active-key'];
 s.api_profiles[0].api_key='older-key';s.api_profiles[0].api_key_history=['older-key'];s.api_profiles[1].api_key='active-key';s.api_profiles[1].api_key_history=['active-key'];
 s.base_url='https://api.deepseek.com/v1';for(const p of s.api_profiles)p.base_url=s.base_url;
 const next=pool.migrate(s);pool.validate(next);assert.equal(next.provider_connections[0].api_key,'active-key');assert(next.provider_connections[0].api_key_history.includes('older-key'));assert(!next.api_profiles.some(p=>p.api_key));
 assert.equal(s.api_profiles[0].api_key,'older-key');
 const inactive=next.api_profiles.find(p=>p.id!==next.active_profile);inactive.parameters.temperature=99;assert.doesNotThrow(()=>pool.validate(next));
 inactive.parameters.max_tokens=999999;assert.throws(()=>pool.validate(next),/max_tokens|最大输出/);
});
test('New API rows without endpoint declarations follow its chat default and match gateway aliases',()=>{
 const {normalizeCustomCatalog}=require('../src/provider-settings.cjs');
 const rows=normalizeCustomCatalog({data:[{id:'gpt-6-sol',supported_endpoint_types:['openai']},{id:'[max]claude-opus-5-5',object:'model'},{id:'claude-opus-4.6-kiro',object:'model'},{id:'o3-pro',object:'model'}]});
 assert.deepEqual(rows.map(x=>[x.api_protocol,x.protocol_source]),[['chat_completions','provider_catalog'],['chat_completions','gateway_default'],['chat_completions','gateway_default'],['responses','gateway_default']]);
 assert.equal(rows[1].context_window,1000000);assert.equal(rows[1].reasoning,true);assert.equal(rows[2].context_window,1000000);
 assert(rows.every(x=>x.available===false),'alias facts never grant tools');
 const plain=normalizeCustomCatalog({data:[{id:'claude-x',object:'model'},{id:'claude-opus-5',type:'model',display_name:'Claude Opus 5'}]});
 assert.deepEqual(plain.map(x=>x.api_protocol),['chat_completions','anthropic_messages']);
});
test('endpoint-missing fallback recognizes gateway not-implemented errors only',()=>{
 const {endpointMissing}=require('../src/native-protocols.cjs');
 assert.equal(endpointMissing({ok:false,status:500,errors:['HTTP 500 · 服务端错误（not implemented (request id: x)）']}),true);
 assert.equal(endpointMissing({ok:false,status:404,errors:[]}),true);
 assert.equal(endpointMissing({ok:false,status:500,errors:['upstream timeout']}),false);
 assert.equal(endpointMissing({ok:false,status:429,errors:['not supported']}),false);
 assert.equal(endpointMissing({ok:true,status:404}),false);
});
