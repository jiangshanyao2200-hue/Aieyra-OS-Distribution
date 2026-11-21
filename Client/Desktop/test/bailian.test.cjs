// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: providers; base
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/bailian.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const providers=require('../src/provider-settings.cjs'),bailian=require('../src/bailian.cjs'),pool=require('../src/model-pool.cjs'),spec=require('../src/spec.cjs'),cfg=require('../src/config.cjs');
const base='https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',other='https://llm-other.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
test('Bailian identity accepts official regions and rejects similar origins and credentials',()=>{
 for(const url of [base,other,bailian.DEFAULT_BASE_URL,'https://dashscope-us.aliyuncs.com/compatible-mode/v1','https://llm-test.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1/'])assert.equal(providers.identity({base_url:url}),'bailian');
 for(const url of [base+'.evil',base.replace('aliyuncs.com','aliyuncs.com.evil'),base.replace('https:','http:'),base+'?token=x',base+'#x',base.replace('https://','https://fake@'),base.replace('maas.aliyuncs.com','maas.aliyuncs.com:8443'),base.replace('llm-test.cn-beijing','cn-beijing'),base+'/other'])assert.equal(providers.identity({base_url:url}),'custom',url);
});
test('Bailian catalog uses exact official context references and conservative unknown capabilities',()=>{
 const rows=providers.normalizeCatalog('bailian',{data:[{id:'qwen3.8-flash'},{id:'gpt-6-sol'},{id:'qwen3.8-omni-flash'},{id:'text-embedding-v4'}]});
 for(const row of rows){assert.equal(row.api_protocol,'chat_completions');assert.equal(row.protocol_source,'provider_contract');assert.equal(row.tool_calls,false);assert.equal(row.available,false);if(row.id!=='qwen3.8-flash'){assert.equal(row.context_window,null);assert.equal(row.context_window_source,'conservative_client_budget');}}
 const flash=rows.find(r=>r.id==='qwen3.8-flash');assert.equal(flash.context_window,1000000);assert.equal(flash.context_window_source,'official_model_reference');assert.equal(flash.context_window_reference,'https://help.aliyun.com/zh/model-studio/text-generation-model');assert.equal(flash.output_limit,0);assert.deepEqual(flash.parameter_specs.find(f=>f.key==='reasoning_enabled').wire_path,['enable_thinking']);
 const declared=providers.normalizeCatalog('bailian',{data:[{id:'qwen3.8-flash',context_window:128000}]})[0];assert.equal(declared.context_window,128000);assert.equal(declared.context_window_source,'provider_catalog');assert.equal(declared.context_window_reference,undefined);
 assert(!rows.find(r=>r.id==='qwen3.8-omni-flash').parameter_specs.some(f=>f.key==='reasoning_enabled'));
 const p=require('../host/connection.cjs').draftProfile({base_url:base,model:'gpt-6-sol'},rows.find(r=>r.id==='gpt-6-sol'));assert.equal(p.context_window,8192);assert.equal(p.api_protocol,'chat_completions');assert(!p.parameter_specs.some(f=>f.key==='reasoning_effort'));
});
test('Bailian legacy reasoning descriptor maps once and applies reviewed defaults',()=>{
 const row=providers.normalizeCatalog('bailian',{data:[{id:'qwen3.8-flash'}]})[0];
 for(const value of [true,false,undefined]){
  const p=require('../host/connection.cjs').draftProfile({base_url:base,model:row.id,parameters:value===undefined?{}:{reasoning_enabled:value}},row);
  const s={...spec.defaults(),...p.parameters,api_profiles:[p],active_profile:p.id,model:p.model,base_url:base,adapter:'openai',api_protocol:p.api_protocol};
  const body=spec.buildRequest(s,[{role:'user',content:'Hello'}],true);assert.equal(body.enable_thinking,value??true);assert.equal(body.reasoning,undefined);assert.equal(body.reasoning_effort,value===false?undefined:'xhigh');assert.equal(Object.hasOwn(body,'enable_thinking'),true);
 }
});
test('Bailian connections and catalog cache are isolated by endpoint and key',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bailian-cache-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');
 const urls=[],ps=providers.createProviderSettings(async url=>{urls.push(url);return new Response(JSON.stringify({data:[{id:url.startsWith(base)?'first':'second'}]}));},file);
 const source=pool.migrate({...spec.defaults(),api_key:'old-key'}),before=structuredClone(source),update=require('../src/agent-connections.cjs').update;
 let s=update(source,{provider:'bailian',patch:{base_url:base,api_key:'shared-key'}});s=update(s,{provider:'bailian',patch:{base_url:other,api_key:'shared-key'}});
 assert.equal(s.provider_connections.filter(c=>c.provider==='bailian').length,2);assert.deepEqual(source,before);assert.equal(s.active_profile,source.active_profile);
 for(const endpoint of [base,other]){let d=ps.select(s,ps.decorate(s),'bailian',pool.connectionID({base_url:endpoint}));d=(await ps.discover(d)).settings;assert.deepEqual(d.__models.filter(m=>!m.reference_only).map(m=>m.id),[endpoint===base?'first':'second']);}
 assert.deepEqual(urls,[base+'/models',other+'/models']);assert.notEqual(providers.catalogID({base_url:base,api_key:'shared-key'}),providers.catalogID({base_url:other,api_key:'shared-key'}));
 assert.deepEqual(ps.select(s,ps.decorate(s),'bailian',pool.connectionID({base_url:base})).__models.filter(m=>!m.reference_only).map(m=>m.id),['first']);
 assert.throws(()=>update(s,{provider:'bailian',patch:{base_url:'https://evil.example/v1',api_key:'key'}}),/百炼/);
 s=update(s,{provider:'bailian',patch:{base_url:base,api_key:'new-key'}});const d=ps.select(s,ps.decorate(s),'bailian',pool.connectionID({base_url:base}));assert(d.__models.length>0);assert(d.__models.every(m=>m.reference_only));assert(!d.__models.some(m=>['first','second'].includes(m.id)));pool.validate(s);
});
test('Bailian UI draft, response receipt and inactive save preserve current selection',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bailian-save-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');
 const original=pool.migrate({...spec.defaults(),api_key:'old-key'});fs.writeFileSync(file,JSON.stringify(original));
 const service=require('../src/system-settings.cjs').createSystemSettings(file),calls=[],old=global.fetch;t.after(()=>global.fetch=old);
 global.fetch=async(url,options)=>{calls.push({url,body:options.body?JSON.parse(options.body):null});return new Response(JSON.stringify(url.endsWith('/models')?{data:[{id:'qwen3.8-flash'}]}:{choices:[{finish_reason:'stop',message:{role:'assistant',content:'Hello'}}]}));};
 const blank=await service.call('connection_draft',{user_slot:'bailian'},'test');assert.equal(blank.api_protocol,'chat_completions');
 const input={user_slot:'bailian',base_url:base,api_key:'test-secret',model:'qwen3.8-flash'};
 await service.call('onboarding_catalog',input,'test');
 const proof=await service.call('response_test',input,'test');assert.equal(proof.ok,true);assert.equal(calls.at(-1).url,base+'/chat/completions');
 const saved=await service.call('response_save',{test_id:proof.test_id,expected_version:proof.version,activate:false},'test');assert.equal(saved.ok,true,JSON.stringify(saved));
 const after=cfg.load(file).settings;assert.equal(after.active_profile,original.active_profile);assert.equal(after.matrix_profile,original.matrix_profile);assert.deepEqual(after.api_profiles.filter(p=>p.provider!=='bailian'),original.api_profiles);
 const draft=await service.call('connection_draft',{user_slot:'bailian'},'test');assert.equal(draft.provider,'bailian');assert.equal(draft.base_url,base);assert.equal(draft.has_key,true);assert(!JSON.stringify(draft).includes('test-secret'));
 const n=calls.length;await assert.rejects(service.call('onboarding_catalog',{...input,base_url:'https://evil.example/v1'},'test'),/百炼/);assert.equal(calls.length,n);
});
