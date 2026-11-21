// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; catalog; setup; BAILIAN; profile; wire
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/model-thinking-context.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const catalog=require('../src/model-catalog.cjs'),caps=require('../src/model-capabilities.cjs');
const setup=require('../src/model-setup.cjs'),pool=require('../src/model-pool.cjs'),spec=require('../src/spec.cjs');
const {draftProfile}=require('../host/connection.cjs');
const BAILIAN=require('../src/bailian.cjs').DEFAULT_BASE_URL;
function profile(model,protocol='responses',options={},row={}){
 return draftProfile({base_url:model.startsWith('qwen')||model.startsWith('glm')||model.startsWith('kimi')?BAILIAN:'https://relay.invalid/v1',model,api_protocol:protocol,parameters:options},row);
}
function wire(p,stream=true){
 const state={...spec.defaults(),model_pool_version:1,active_profile:p.id,matrix_profile:p.id,api_profiles:[p],provider_connections:[{id:pool.connectionID(p),provider:p.provider,base_url:p.base_url,api_key:'synthetic-model-config-key',api_key_history:[],request_timeout_seconds:30}]};
 return spec.buildRequest(pool.activate(state,p),[{role:'user',content:'synthetic check'}],stream);
}

test('community reference supplies exact offline limits without assigning channel tools or choices',()=>{
 const p=profile('mistral-small-2506','chat_completions');
 assert.equal(p.context_window,128000);assert.equal(p.compact_at_tokens,102000);assert.equal(p.tool_calls,false);
 assert.equal(wire(p).reasoning_effort,undefined);
 assert.equal(catalog.nativeReference('x-ai/grok-4.7').id,'grok-4.7');
 assert.equal(catalog.nativeReference('openai/grok-4.7'),undefined);
 // Build 变体经网关实测与本体同档位；其他后缀仍不猜。
 assert.equal(catalog.nativeReference('grok-4.7-build-fast').id,'grok-4.7');
 assert.equal(catalog.nativeReference('grok-4.7-turbo'),undefined);
});

test('a reference-defined zero thinking budget survives validation and Google wire mapping',()=>{
 const p=profile('gemini-2.5-flash','google_generate');
 const budget=caps.forProfile(p).find(f=>f.key==='reasoning_budget');assert.equal(budget.min,0);
 const off=caps.edit(p,{reasoning_budget:0});assert.equal(wire(off).generationConfig.thinkingConfig.thinkingBudget,0);
 assert.equal(caps.specs('custom',{id:p.model,api_protocol:p.api_protocol,output_limit:1}).find(f=>f.key==='reasoning_budget').max,0);
});
test('every new model defaults to a 200K compression target while explicit targets survive',()=>{
 for(const model of ['unlisted-grok-build','gpt-6.1-sol','gemini-4-argon','deepseek-flash']){
  const p=profile(model);assert.equal(p.compact_at_tokens,200000,model);assert.equal(setup.entry(p).compact_recommended,200000);
  for(const value of [0,1000,20000,2000000]){p.compact_at_tokens=value;catalog.initialize(p);assert.equal(p.compact_at_tokens,value);}
  assert.equal(catalog.editContext(p,{compact_at_tokens:null}).compact_at_tokens,200000);
 }
});

test('Gemini 4 and GPT 6.1 use reviewed capacity and expose exact effort enums',()=>{
 for(const [model,window,efforts] of [
  ['gemini-4-argon',1048576,['low','medium','high']],
  ['gpt-6.1-sol',1050000,['low','medium','high','xhigh','max']],
 ]){
  const p=profile(model);assert.equal(p.context_window,window);assert.equal(p.tool_calls,false);
  assert.equal(p.vision,false);assert.deepEqual(setup.entry(p).thinking.values,efforts);
  assert.equal(setup.entry(p).context_limit,window);
  assert(!setup.entry(p).parameters.some(f=>['temperature','top_p','max_tokens','stream','service_tier'].includes(f.key)));
  const body=wire(p);assert.equal(body.reasoning,undefined,'Auto must leave the supplier default unset');
  const selected=caps.edit(p,{reasoning_effort:'low'});assert.deepEqual(wire(selected).reasoning,{effort:'low'});
  assert.throws(()=>caps.edit(p,{reasoning_effort:'none'}),/无效/);
  const user=profile(model,'responses',{}, {context_window:380000,context_window_source:'user_config',output_limit:4096});
  assert.equal(user.context_window,window);assert.equal(user.output_limit,4096);
 }
});

test('all persisted compact triggers survive capacity migration, including former recommendations and zero',()=>{
 for(const trigger of [6000,1234,0]){
  const p=profile('future-model');p.model='gemini-4-argon';p.compact_at_tokens=trigger;
  const state=pool.migrate({...spec.defaults(),model_pool_version:1,api_profiles:[p]});
  assert.equal(state.api_profiles[0].context_window,1048576);
  assert.equal(state.api_profiles[0].compact_at_tokens,trigger);
 }
});

test('GLM and Qwen effort values follow the current protocol, and thinking-only models have no off switch',()=>{
 assert.deepEqual(setup.entry(profile('glm-5.2','chat_completions')).thinking.values,['none','minimal','low','medium','high','xhigh','max']);
 assert.deepEqual(setup.entry(profile('glm-5.1','chat_completions')).thinking.values,['none','minimal','low','medium','high','xhigh']);
 assert.deepEqual(setup.entry(profile('glm-5.2','responses')).thinking.values,['none','high','max']);
 assert.deepEqual(setup.entry(profile('qwen3.8-flash','chat_completions')).thinking.values,['low','medium','xhigh']);
 assert.deepEqual(setup.entry(profile('qwen3.8-flash','responses')).thinking.values,['none','low','medium','xhigh']);
 for(const model of ['glm-5.3','kimi-k3','kimi-k2.7-code']){
  const entry=setup.entry(profile(model,'chat_completions'));
  assert.equal(entry.thinking_always,true);
  assert(!entry.parameters.some(f=>['reasoning_enabled','thinking_mode'].includes(f.key)));
 }
 assert.equal(setup.entry(profile('kimi-k2.7-code','anthropic_messages')).thinking,null);
 const off=caps.edit(profile('qwen3.8-flash'),{reasoning_effort:'none'});
 assert.deepEqual(wire(off).reasoning,{effort:'none'});assert.equal(wire(off).enable_thinking,undefined);
 const open=profile('qwen3.8-2.4t-a95b');assert.equal(setup.entry(open).thinking_always,false);assert.deepEqual(wire(caps.edit(open,{reasoning_effort:'none'})).reasoning,{effort:'none'});
 for(const value of ['none','low','max']){
  const relay=profile('deepseek-flash','chat_completions',{reasoning_effort:value}),body=wire(relay);
  assert.equal(body.thinking.type,value==='none'?'disabled':'enabled');assert.equal(body.reasoning_effort,value==='none'?undefined:value);
 }
});

test('changing thought strength clears the old budget and conflicting off switch, and Auto restores defaults',()=>{
 const p=profile('qwen3.8-flash','chat_completions',{reasoning_budget:1024});
 const state={api_profiles:[p]};
 setup.setThinking(state,{id:p.id,key:'reasoning_effort',value:'medium'});
 let body=wire(state.api_profiles[0]);assert.equal(body.reasoning_effort,'medium');assert.equal(body.thinking_budget,undefined);
 setup.setParam(state,{id:p.id,key:'reasoning_enabled',value:false});
 body=wire(state.api_profiles[0]);assert.equal(body.enable_thinking,false);assert.equal(body.reasoning_effort,undefined);
 setup.setThinking(state,{id:p.id,key:'reasoning_effort',value:'low'});
 body=wire(state.api_profiles[0]);assert.equal(body.enable_thinking,true);assert.equal(body.reasoning_effort,'low');
 setup.setThinking(state,{id:p.id,key:'reasoning_effort',value:''});
 assert.deepEqual(state.api_profiles[0].parameters.model_options,{});
 assert.equal(wire(state.api_profiles[0]).reasoning_effort,'xhigh');
});

test('supported thinking budgets are visible, editable and exclusive with effort without rewriting on view',()=>{
 for(const budget of [0,1024]){
  const p=profile('qwen3.8-max','chat_completions',{reasoning_budget:budget}),state={api_profiles:[p]},before=structuredClone(p);
  const entry=setup.entry(p);
  assert.equal(entry.parameters.find(f=>f.key==='reasoning_budget')?.value,budget);
  assert.equal(entry.thinking.inactive,true,'effort Auto must not look selected while budget is active');
  assert.match(entry.thinking.hint,/预算/);
  assert.deepEqual(p,before,'opening settings must preserve the saved profile');
  setup.setParam(state,{id:p.id,key:'reasoning_budget',value:2048});
  let body=wire(state.api_profiles[0]);assert.equal(body.thinking_budget,2048);assert.equal(body.reasoning_effort,undefined);assert.equal(body.enable_thinking,true);
  setup.setThinking(state,{id:p.id,key:'reasoning_effort',value:'medium'});
  body=wire(state.api_profiles[0]);assert.equal(body.reasoning_effort,'medium');assert.equal(body.thinking_budget,undefined);
  assert.equal(setup.entry(state.api_profiles[0]).thinking.inactive,false);
  const saved=structuredClone(state.api_profiles[0]);
  assert.throws(()=>setup.setParam(state,{id:p.id,key:'reasoning_budget',value:-1}),/无效|至少|范围/);
  assert.deepEqual(state.api_profiles[0],saved);
  setup.setParam(state,{id:p.id,key:'reasoning_budget',value:1024});
  setup.setParam(state,{id:p.id,key:'reasoning_enabled',value:false});
  body=wire(state.api_profiles[0]);assert.equal(body.enable_thinking,false);assert.equal(body.thinking_budget,undefined);assert.equal(body.reasoning_effort,undefined);
  assert.equal(setup.entry(state.api_profiles[0]).thinking.inactive,true);
  setup.setParam(state,{id:p.id,key:'reasoning_budget',value:1024});
  setup.setParam(state,{id:p.id,key:'reasoning_budget',value:''});
  body=wire(state.api_profiles[0]);assert.equal(body.thinking_budget,undefined);assert.equal(body.reasoning_effort,'xhigh');
 }
 const p=profile('gemini-4-argon');
 assert(!setup.entry(p).parameters.some(f=>f.key==='reasoning_budget'));
 assert.throws(()=>setup.setParam({api_profiles:[p]},{id:p.id,key:'reasoning_budget',value:1024}),/没有这个参数/);
});

test('context edits change only the compact trigger and capacity edits fail without mutation',t=>{
 const p=profile('gemini-4-argon'),state={api_profiles:[p]};
 const before=structuredClone(p);
 assert.throws(()=>setup.setContext(state,{id:p.id,key:'context_window',value:200000}),/只读/);
 assert.deepEqual(state.api_profiles[0],before);
 setup.setContext(state,{id:p.id,key:'compact_at_tokens',value:200000});
 let changed=state.api_profiles[0];assert.equal(changed.context_window,1048576);assert.equal(changed.compact_at_tokens,200000);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'thinking-window-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'profile.json');fs.writeFileSync(file,JSON.stringify(changed));
 changed=JSON.parse(fs.readFileSync(file,'utf8'));catalog.initialize(changed);assert.equal(changed.context_window,1048576);assert.equal(changed.compact_at_tokens,200000);
 assert.throws(()=>setup.setContext(state,{id:p.id,key:'compact_at_tokens',value:2000001}),/compact_at_tokens/);
 assert.equal(state.api_profiles[0].compact_at_tokens,200000);
 setup.setContext(state,{id:p.id,key:'compact_at_tokens',value:null});assert.equal(state.api_profiles[0].compact_at_tokens,200000);
 setup.setContext(state,{id:p.id,key:'compact_at_tokens',value:0});assert.equal(state.api_profiles[0].compact_at_tokens,0);
 assert.equal(state.api_profiles[0].context_window,1048576);
 assert.equal(state.api_profiles[0].parameters.max_tokens,p.parameters.max_tokens);
});

test('manual 10K through 1M targets are separate from model presets and actual input reservations',async()=>{
 const {contextPresets}=await import('../ui/model-context.mjs');
 const small=profile('small-context-fixture','responses',{}, {context_window:128000,context_window_source:'provider_catalog',output_limit:4096});
 const state={api_profiles:[small]},window=small.context_window,output=small.parameters.max_tokens;
 for(const mode of ['custom','manual'])for(const target of [10000,200000,1000000]){
  setup.setContext(state,{id:small.id,key:'compact_at_tokens',value:target,mode});
  const actual=state.api_profiles[0],entry=setup.entry(actual);
  assert.equal(actual.compact_at_tokens,target);assert.equal(actual.context_window,window);assert.equal(actual.parameters.max_tokens,output);
  assert.equal(entry.compact_limit,102000);assert(entry.compact_effective_tokens<=Math.floor(catalog.compactInputLimit(actual)*.8));
 }
 assert.equal(contextPresets(setup.entry(state.api_profiles[0])).at(-1).value,102000);
 const before=structuredClone(state.api_profiles[0]);
 for(const value of [9999,1000001,NaN,Infinity,12345.5])assert.throws(()=>setup.setContext(state,{id:small.id,key:'compact_at_tokens',value,mode:'custom'}),/compact_at_tokens/);
 assert.deepEqual(state.api_profiles[0],before);
 assert.throws(()=>setup.setContext(state,{id:small.id,key:'compact_at_tokens',value:1000000,mode:'maximum'}),/80%/);
 setup.setContext(state,{id:small.id,key:'compact_at_tokens',value:102000,mode:'maximum'});assert.equal(state.api_profiles[0].compact_at_tokens,102000);
 const large=profile('large-context-fixture','responses',{}, {context_window:4000000,context_window_source:'provider_catalog'}),wide={api_profiles:[large]};
 assert.equal(contextPresets(setup.entry(large)).at(-1).value,2000000);
 setup.setContext(wide,{id:large.id,key:'compact_at_tokens',value:2000000,mode:'maximum'});assert.equal(wide.api_profiles[0].compact_at_tokens,2000000);
 assert.throws(()=>setup.setContext(wide,{id:large.id,key:'compact_at_tokens',value:2000000,mode:'custom'}),/compact_at_tokens/);
});

test('manual context target commits through versioned settings and reloads intact',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'context-manual-commit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'config.json'),p=profile('small-context-commit','responses',{}, {context_window:128000,context_window_source:'provider_catalog',output_limit:4096});
 p.connection_id='synthetic-context';p.response_verified=true;
 fs.writeFileSync(file,JSON.stringify({...spec.defaults(),model_pool_version:1,active_profile:p.id,matrix_profile:p.id,api_profiles:[p],provider_connections:[{id:p.connection_id,provider:'custom',base_url:p.base_url,api_key:'synthetic-context-key',api_key_history:[],request_timeout_seconds:30}]}));
 const service=require('../src/system-settings.cjs').createSystemSettings(file),before=await service.call('pool',{op:'view'});
 const saved=await service.call('pool',{op:'context',id:p.id,key:'compact_at_tokens',value:1000000,mode:'custom',expected_version:before.version});
 assert.equal(saved.ok,true,JSON.stringify(saved.errors));assert.notEqual(saved.version,before.version);
 const actual=require('../src/config.cjs').load(file).settings.api_profiles.find(row=>row.id===p.id);
 assert.equal(actual.compact_at_tokens,1000000);assert.equal(actual.compact_preset,'custom');assert.equal(actual.context_window,128000);
 const reopened=await service.call('pool',{op:'view'}),entry=reopened.models.find(row=>row.id===p.id);
 assert.equal(entry.compact_at_tokens,1000000);assert.equal(entry.compact_limit,102000);
});

test('capacity migration keeps declared lower ceilings, unknowns and every persisted trigger',()=>{
 for(const source of ['user_config','user','','conservative_client_budget','provider_catalog','official_model_reference','bundled_model_reference'])for(const trigger of [0,1234,6000,286000]){
  const p=profile('gemini-4-argon');Object.assign(p,{context_window:380000,context_window_source:source,compact_at_tokens:trigger});catalog.initialize(p);
  const expected=['provider_catalog','official_model_reference','bundled_model_reference'].includes(source)?380000:1048576;
  assert.equal(p.context_window,expected,source);assert.equal(p.compact_at_tokens,trigger,source);
  const once=structuredClone(p);catalog.initialize(p);assert.deepEqual(p,once);
 }
 const p=profile('gemini-4-argon');Object.assign(p,{context_window:64000,context_window_source:'user_config',context_window_limit:128000,compact_at_tokens:0});catalog.initialize(p);
 assert.equal(p.context_window,128000);assert.equal(catalog.contextLimit(p),128000);assert.equal(p.compact_at_tokens,0);
 Object.assign(p,{model:'unreviewed-capacity-model',context_window:64000,context_window_limit:0,context_window_source:'user_config'});
 const before=structuredClone(p);catalog.upgrade(p);assert.deepEqual(p,before);assert.equal(catalog.describe(p).context_limit,null);
 const fields=caps.fields(p,'zh-CN');assert(!fields.some(f=>f.key==='__param_context_window'));assert(fields.some(f=>f.key==='__param_compact_at_tokens'));
});

test('all protocols ignore legacy sampling selections while retaining supported thinking control',()=>{
 const legacy={temperature:.4,top_p:.5,top_k:5,min_p:.1,frequency_penalty:1,presence_penalty:1,repetition_penalty:1,seed:7,stop:['old-stop'],logprobs:true,top_logprobs:3};
 for(const protocol of ['responses','chat_completions','google_generate','anthropic_messages']){
  const p=profile('unlisted-model',protocol);p.parameters.model_options={...legacy};
  caps.validate(p);const body=wire(p);
  for(const key of [...Object.keys(legacy),'stop_sequences'])assert(!Object.hasOwn(body,key),protocol+' '+key);
  for(const key of ['temperature','topP','topK','seed','stopSequences'])assert(!Object.hasOwn(body.generationConfig||{},key),protocol+' '+key);
  assert(!caps.forProfile(p).some(f=>caps.isSampling(f.key)));
 }
 for(const protocol of ['responses','chat_completions'])for(const thinking_type of ['enabled','disabled']){
  const s={...spec.defaults(),api_protocol:protocol,thinking_type,temperature:.2,top_p:.5};
  const body=spec.buildRequest(s,[],true);assert.equal(body.temperature,undefined);assert.equal(body.top_p,undefined);
 }
 const probe=require('../src/capability-probe.cjs');assert(!probe.candidates(profile('unlisted-model')).some(f=>caps.isSampling(f.key)));
 assert.throws(()=>require('../src/parameter-descriptors.cjs').validate({key:'top_k',type:'integer',min:1,max:20,wire_path:['top_k'],source:'https://example.org/api'}),/采样/);
});

test('compression controls use the effective input budget without rewriting saved triggers',()=>{
 for(const [model,window,input] of [['gpt-6.1-sol',1050000,922000],['gemini-4-argon',1048576,0]]){
  const p=profile(model);p.compact_at_tokens=window-4096;
  const before=structuredClone(p),limit=Math.min(window-4096-2048,input>0?input-2048:Infinity),entry=setup.entry(p);
  assert.equal(catalog.compactInputLimit(p),limit);assert.equal(entry.compact_limit,Math.floor(window*.8/1000)*1000);
  assert.equal(entry.compact_effective_tokens,Math.floor(limit*.8));assert.equal(entry.compact_at_tokens,p.compact_at_tokens);
  assert.equal(catalog.contextFields(p).find(f=>f.key==='compact_at_tokens').max,Math.floor(window*.8/1000)*1000);
  assert.deepEqual(p,before,'reading effective budget must not migrate a saved trigger');
  p.compact_at_tokens=0;assert.equal(setup.entry(p).compact_effective_tokens,0);
 }
 const unknown=profile('future-model');unknown.context_window=64000;unknown.parameters.max_tokens=8192;
 assert.equal(catalog.compactInputLimit(unknown),200000);
 unknown.context_window=8192;unknown.parameters.max_tokens=4096;unknown.compact_at_tokens=4000;
 assert.equal(catalog.editContext(unknown,{compact_at_tokens:null}).compact_at_tokens,200000);
 assert.equal(unknown.compact_at_tokens,4000,'reset returns a new profile and preserves its source');
 const qwen=profile('qwen3.8-flash','chat_completions');qwen.parameters.max_tokens=8192;
 assert.equal(catalog.compactInputLimit(qwen),981568,'Bailian max_input=983616 reserves its own protocol margin');
});

test('obsolete thought values reset on migration, and the reviewed reference is an external shared resource',()=>{
 const p=profile('future-model');p.model='gpt-6.1-sol';p.parameters.model_options={reasoning_effort:'none',reasoning_summary:'auto',temperature:.7};
 const next=pool.migrate({...spec.defaults(),model_pool_version:1,api_profiles:[p]}).api_profiles[0];
 assert.deepEqual(next.parameters.model_options,{reasoning_summary:'auto',temperature:.7});assert.deepEqual(wire(next).reasoning,{summary:'auto'});
 const fast=profile('gpt-6-astra','responses',{reasoning_effort:'low',reasoning_summary:'concise',service_tier:'fast'});caps.validate(fast);
 assert.equal(wire(fast).service_tier,'fast');assert.deepEqual(wire(fast).reasoning,{effort:'low',summary:'concise'});
 const shared=require('../src/resources.cjs').read('模型目录.json');
 assert.equal(catalog.info().analysis_sha256,shared.analysis_sha256);
 assert.deepEqual(catalog.nativeReference(p.model),shared.native_models.find(m=>m.id===p.model));
});
