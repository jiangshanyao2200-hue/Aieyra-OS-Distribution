// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: caps; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/simple-living.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const caps=require('../src/model-capabilities.cjs'),spec=require('../src/spec.cjs'),providers=require('../src/provider-settings.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-simple-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'config.json');}
test('Fast and explicit off map to both GPT wire protocols; unrelated models stay unchanged',()=>{
 for(const protocol of ['responses','chat_completions'])for(const tier of ['fast','default']){
  const p=require('../host/connection.cjs').draftProfile({base_url:'https://relay.invalid/v1',model:'gpt-6-astra',api_protocol:protocol,parameters:{service_tier:tier,reasoning_effort:'high'}});
  const request=spec.buildRequest({...spec.defaults(),...p.parameters,base_url:p.base_url,model:p.model,adapter:p.adapter,api_protocol:protocol},[{role:'user',content:'hi'}],true);
  assert.equal(request.service_tier,tier);assert.ok(request.stream);assert.equal(p.parameters.max_tokens,0);
 }
 assert.ok(!caps.specs('custom',{id:'unlisted-model',api_protocol:'responses'}).some(f=>f.key==='service_tier'));
});
test('relay catalogs survive service restart and isolate two URLs with the same key',async t=>{
 const file=fixture(t),pool=require('../src/model-pool.cjs'),store=require('../src/catalog-store.cjs').createStore(file);
 const rows=providers.normalizeCustomCatalog({data:[{id:'gpt-6-astra'},{id:'unknown-model'},{id:'gpt-6-astra'}]});assert.equal(rows.length,2);assert.equal(rows[0].api_protocol,'responses');assert.equal(rows[1].api_protocol,'responses');assert.equal(rows[0].tool_calls,false);
 const connections=['a','b'].map(id=>({id,provider:'custom',base_url:'https://'+id+'.invalid/v1',api_key:'synthetic-key',api_key_history:['synthetic-key'],request_timeout_seconds:300}));
 for(const [i,c] of connections.entries())store.put('catalog:'+providers.catalogID(c),{models:[rows[i]],fetched_at:'test'});
 const s=pool.migrate({...spec.defaults(),model_pool_version:1,api_profiles:[],provider_connections:connections});
 const service=providers.createProviderSettings(undefined,file);
 assert.equal(service.select(s,s,'custom','a').__models[0].id,'gpt-6-astra');assert.equal(service.select(s,s,'custom','b').__models[0].id,'unknown-model');
 const fetcher=async url=>{assert.equal(url,'https://b.invalid/v1/models');return Response.json({data:[{id:'new-model'}]});};
 const fresh=await providers.createProviderSettings(fetcher,file).discover(service.select(s,s,'custom','b'),{refresh:true});assert.equal(fresh.settings.__models[0].id,'new-model');assert.equal(service.select(s,s,'custom','a').__models[0].id,'gpt-6-astra');
});
test('memory deduplicates across sessions, excerpts large preferences and expires dream claims',t=>{
 const {createMemoryStore,dreamWords}=require('./fixtures/legacy-memory-store.cjs');let time=1000000000000;const file=fixture(t)+'.sqlite',context={project:'p',session:'one'};
 let s=createMemoryStore(file,{now:()=>time});const args={action:'record',kind:'preference',title:'星空花园',content:'星空花园需要安静的音乐。'.repeat(200)};
 const first=s.call(args,context).record;assert.equal(s.call({...args,request_id:'retry'},{...context,session:'two'}).record.id,first.id);assert.equal(s.call({action:'status'},context).records,1);
 const surface=s.call({action:'surface',token_budget:700},context);assert.equal(surface.records[0].id,first.id);assert.ok(surface.records[0].truncated);
 s.close();time+=10000;s=createMemoryStore(file,{now:()=>time});let d=s.call({action:'dream',mode:'claim'},context).dream;assert.ok(d.fiction);time+=120001;
 assert.throws(()=>s.call({action:'dream',mode:'ack',id:d.id,claim:d.claim},context));d=s.call({action:'dream',mode:'claim'},context).dream;assert.ok(d);
 s.call({action:'update',id:first.id,expected_revision:1,content:'用户已经改为海边散步。'},context);assert.throws(()=>s.call({action:'dream',mode:'ack',id:d.id,claim:d.claim},context));s.close();
 const words=dreamWords([{title:'星空花园',content:'https://secret.invalid/path token API key 星空花园和安静音乐'}]);assert.ok(words.length>=2);assert.ok(!words.some(w=>/token|secret|https|api|key/i.test(w)));assert.equal(new Set(words).size,words.length);
});
