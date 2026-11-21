// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: cfg; model; response; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/matrix-capabilities.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cfg=require('../src/config.cjs'),spec=require('../src/spec.cjs'),pool=require('../src/model-pool.cjs'),{createProviderSettings}=require('../src/provider-settings.cjs'),{createSystemSettings}=require('../src/system-settings.cjs');
const model={id:'vendor/new',name:'New model',context_length:65536,architecture:{output_modalities:['text']},supported_parameters:['tools','temperature','max_tokens'],top_provider:{max_completion_tokens:4096},pricing:{prompt:'0',completion:'0'}};
const response=data=>new Response(JSON.stringify(data));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-matrix-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify({...spec.defaults(),api_key:'fake-deepseek-key'}));return file;}
test('catalog survives service restart, age and failed explicit refresh; keys isolated; concurrent refresh deduplicated',async t=>{
 const file=fixture(t);let calls=0,failed=false;
 const fetcher=async url=>{if(url.includes('/models/user')){calls++;if(failed)return new Response('',{status:503});await new Promise(r=>setTimeout(r,15));return response({data:[model]});}return url.includes('models.dev')?response({}):new Response('');};
 let service=createProviderSettings(fetcher,file),s=service.select({},service.decorate(cfg.load(file).settings),'openrouter');s.api_key='fake-router';
 const empty=await service.discover(s,{refresh:false});assert.equal(empty.cached,false);assert.equal(calls,0);assert.equal(empty.settings.__models.length,0);
 const two=await Promise.all([service.discover(s),service.discover(s)]);s=two[0].settings;assert.equal(calls,1);
 const originalNow=Date.now;Date.now=()=>originalNow()+864000000;try{service=createProviderSettings(fetcher,file);assert.equal(service.decorate(s).__models.length,1);assert.equal((await service.discover(s,{refresh:false})).cached,true);assert.equal(calls,1);}finally{Date.now=originalNow;}
 failed=true;await assert.rejects(service.discover(s));assert.equal(service.decorate(s).__models.length,1);
 assert.equal(service.decorate({...s,api_key:'different-key'}).__models.length,0);
 const cacheFiles=fs.readdirSync(file+'.catalog-cache').map(f=>fs.readFileSync(path.join(file+'.catalog-cache',f),'utf8')).join('');assert(!cacheFiles.includes('fake-router'));
});
test('agent manages connections, cached catalog, explicit pool membership and Matrix parameters with versions',async t=>{
 const file=fixture(t),old=global.fetch;let calls=0;global.fetch=async url=>{calls++;return url.includes('models.dev')?response({}):url.includes('/rankings')?new Response(''):response({data:[model]});};t.after(()=>global.fetch=old);
 const system=createSystemSettings(file);let version=cfg.version(file);
 let r=await system.call('connection_update',{provider:'openrouter',patch:{api_key:'fake-router-key'},expected_version:version});assert(r.ok,r.errors?.join());version=r.version;
 r=await system.call('catalog',{connection_id:'openrouter'});assert.equal(calls,0);assert.equal(r.models.length,0);
 r=await system.call('catalog',{connection_id:'openrouter',refresh:true});assert.equal(r.models.length,1);const after=calls;
 assert.equal((await system.call('catalog',{connection_id:'openrouter'})).models.length,1);assert.equal(calls,after);
 r=await system.call('catalog_add',{connection_id:'openrouter',model:model.id,expected_version:version});assert(r.ok,r.errors?.join());version=r.version;assert.equal(r.settings.active_profile,'deepseek-flash');
 const p=r.settings.api_profiles.find(p=>p.model===model.id);
 const capacity=p.context_window;
 r=await system.call('matrix_update',{id:p.id,parameters:{compact_at_tokens:32000},matrix:true,expected_version:version});assert(r.ok,r.errors?.join());assert.equal(r.settings.matrix_profile,p.id);assert.equal(r.settings.api_profiles.find(x=>x.id===p.id).compact_at_tokens,32000);assert.equal(r.settings.api_profiles.find(x=>x.id===p.id).context_window,capacity);
 assert.equal((await system.call('matrix_update',{id:p.id,parameters:{compact_at_tokens:48000},expected_version:version})).code,'version_conflict');
 const networkBefore=calls;
 for(const action of ['capabilities_refresh','parameters_probe'])assert.equal((await system.call(action,{id:p.id,expected_version:version})).code,'version_conflict');
 assert.equal(calls,networkBefore,'Stale mutations must fail before paid probing or catalog refresh');
 assert(!JSON.stringify(r).includes('fake-router-key'));
});
test('fresh supplier sampling evidence does not reopen removed configuration',async t=>{
 const file=fixture(t);let keys=['tools','max_tokens'];const fetcher=async url=>url.includes('models.dev')?response({}):url.includes('/rankings')?new Response(''):response({data:[{...model,supported_parameters:keys}]});
 const svc=createProviderSettings(fetcher,file);let s=svc.select({},svc.decorate(cfg.load(file).settings),'openrouter');s.api_key='fake-router';s=(await svc.discover(s)).settings;s=svc.add({},s,model.id);const id=s.api_profiles.find(p=>p.model===model.id).id;
 assert(!s.api_profiles.find(p=>p.id===id).parameter_specs.some(f=>f.key==='temperature'));keys.push('temperature');s=(await svc.learn(s,id,'refresh')).settings;
 assert(!s.api_profiles.find(p=>p.id===id).parameter_specs.some(f=>f.key==='temperature'));
 const next=createProviderSettings(fetcher,file);delete s.__pool_edit;assert(!next.decorate(s).api_profiles.find(p=>p.id===id).parameter_specs.some(f=>f.key==='temperature'));
});
test('parameter probes distinguish accepted from semantic support and stop on unavailable account',async()=>{
 const s=pool.migrate({...spec.defaults(),api_key:'fake-key'}),p={...s.api_profiles[0],model:'fixture',adapter:'openai',api_protocol:'chat_completions',parameter_specs:[{key:'reasoning_effort',type:'enum',values:['low','high']},{key:'response_format',type:'enum',values:['text','json_object']}],parameters:pool.parameters(spec.defaults())};s.api_profiles=[p];
 const probe=require('../src/capability-probe.cjs').probe;let calls=0;
 const r=await probe(s,p,['reasoning_effort','response_format'],async()=>{calls++;if(calls===3){const e=Error('invalid');e.apiError={status:400};throw e;}return {elapsedMs:1};});assert.equal(r.semantic_support,'not_proven');assert.equal(r.results[0].state,'request_accepted');assert.equal(r.results[1].state,'rejected');
 const denied=await probe(s,p,['reasoning_effort'],async()=>{const e=Error('denied');e.apiError={status:403};throw e;});assert.equal(denied.code,'baseline_failed');assert.equal(denied.results.length,0);
 const before=calls;await assert.rejects(probe(s,p,['temperature'],async()=>{calls++;}),/探测参数/);assert.equal(calls,before);
});

test('saving Matrix parameters retains editing selection without switching active model',async t=>{
 const file=fixture(t),svc=require('../src/service.cjs').createService(file),boot=svc.call('config:bootstrap');
 let s=(await svc.call('provider:add',{settings:boot.settings,id:'deepseek-v4-pro'})).settings;
 const id=s.api_profiles.find(p=>p.model==='deepseek-v4-pro').id;s=svc.call('pool:edit',{settings:s,id}).settings;
 s.__param_max_tokens='4096';const r=svc.call('config:save',{settings:s,expected_version:boot.version});
 assert(r.ok,r.errors?.join());assert.equal(r.settings.__matrix_model,id);assert.equal(r.settings.__pool_edit,id);assert.equal(r.settings.active_profile,boot.settings.active_profile);
});

test('Agent diagnostics preserves four native tool protocols and reports real cache fields',async()=>{
 const {diagnose,usage}=require('../src/model-diagnostics.cjs');assert.equal(usage({}).cache_hit_tokens,null);assert.equal(usage({usage:{prompt_tokens_details:{cached_tokens:0}}}).cache_hit_tokens,0);
 for(const protocol of ['responses','chat_completions','anthropic_messages','google_generate'])for(const extraTool of [false,true]){
  const s=pool.migrate({...spec.defaults(),api_key:'fake-diagnostic-key'}),p=s.api_profiles[0];p.adapter='openai';p.api_protocol=protocol;p.parameters.model_options={};
  let calls=0;const cachePrefixes=[];
  const response=(parts,tool=false)=>protocol==='responses'?{id:'r',status:'completed',output:parts,usage:{input_tokens:2000,input_tokens_details:{cached_tokens:1500}}}:protocol==='chat_completions'?{choices:[{finish_reason:tool?'tool_calls':'stop',message:parts}],usage:{prompt_tokens:2000,prompt_tokens_details:{cached_tokens:1500}}}:protocol==='anthropic_messages'?{id:'m',stop_reason:tool?'tool_use':'end_turn',content:parts,usage:{input_tokens:500,cache_read_input_tokens:1500}}:{candidates:[{finishReason:'STOP',content:{role:'model',parts}}],usageMetadata:{promptTokenCount:2000,cachedContentTokenCount:1500}};
  const textReply=value=>response(protocol==='responses'?[{type:'message',content:[{type:'output_text',text:value}]}]:protocol==='chat_completions'?{role:'assistant',content:value}:[{type:'text',text:value}]);
  const result=await diagnose(s,p.id,'all',async(_settings,body)=>{
   calls++;if(protocol==='responses')assert.equal(body.reasoning,undefined,'Unknown summary capability must not be requested');
   if(calls===1){const nonce=JSON.stringify(body).match(/with nonce ([a-f0-9]+)/)[1];const args={nonce};return response(protocol==='responses'?[{type:'function_call',call_id:'c',name:'verify_matrix',arguments:JSON.stringify(args)}]:protocol==='chat_completions'?{role:'assistant',tool_calls:[{id:'c',type:'function',function:{name:'verify_matrix',arguments:JSON.stringify(args)}}]}:protocol==='anthropic_messages'?[{type:'tool_use',id:'c',name:'verify_matrix',input:args}]:[{functionCall:{name:'verify_matrix',args}}],true);}
   if(calls===2){
    const value=protocol==='responses'?body.input.at(-1).output:protocol==='chat_completions'?body.messages.at(-1).content:protocol==='anthropic_messages'?body.messages.at(-1).content[0].content:body.contents.at(-1).parts[0].functionResponse.response.value;assert(value.length===24);const r=textReply(value);
    if(extraTool){if(protocol==='responses')r.output.push({type:'function_call'});else if(protocol==='chat_completions')r.choices[0].message.tool_calls=[{}];else if(protocol==='anthropic_messages')r.content.push({type:'tool_use'});else r.candidates[0].content.parts.push({functionCall:{}});}
    return r;
   }
   const system=protocol==='responses'?body.instructions||body.input[0]:protocol==='chat_completions'?body.messages[0]:protocol==='anthropic_messages'?body.system:body.systemInstruction;cachePrefixes.push(JSON.stringify(system));return textReply('OK');
  });
  assert.equal(result.ok,!extraTool,JSON.stringify(result));assert.equal(calls,5);assert.equal(new Set(cachePrefixes).size,1);assert(result.report.cache.every(r=>r.cache_hit_tokens===1500));
 }
});

test('setting tests carry OpenCode routing session and probes actually serialize each candidate',async t=>{
 const api=require('../src/api.cjs'),probe=require('../src/capability-probe.cjs').probe,old=global.fetch,requests=[];t.after(()=>global.fetch=old);
 global.fetch=async(url,options)=>{requests.push({url,headers:options.headers,body:JSON.parse(options.body)});return response({status:'completed',output:[]});};
 const s=pool.migrate({...spec.defaults(),api_key:'fake-route-key'}),p=s.api_profiles[0];p.adapter='openai';p.base_url='https://opencode.ai/zen/go/v1';p.parameter_specs=[{key:'max_tokens',type:'integer',min:1,max:4096},{key:'stream',type:'boolean'}];p.parameters.model_options={};p.output_limit=4096;
 await api.ping(pool.activate(s,p));assert(requests[0].headers['x-opencode-session']);
 p.model='fixture';p.parameter_specs.push({key:'reasoning_effort',type:'enum',values:['low','high']},{key:'reasoning_summary',type:'enum',values:['auto','concise']});
 const r=await probe(s,p,['reasoning_effort','reasoning_summary']);assert(r.ok);assert(r.results.every(r=>r.state==='request_accepted'));
 assert.equal(new Set(requests.slice(1).map(r=>r.headers['x-opencode-session'])).size,1);assert(requests[1].headers['x-opencode-session']);assert.notEqual(requests[0].headers['x-opencode-session'],requests[1].headers['x-opencode-session']);
 assert.equal(requests[2].body.reasoning.effort,'low');assert.equal(requests[3].body.reasoning.summary,'auto');assert(requests.every(r=>r.body.temperature===undefined&&r.body.top_p===undefined));
 const ds=pool.migrate({...spec.defaults(),api_key:'fake-deepseek-key'}),bodies=[];
 const d=await probe(ds,ds.api_profiles[0],['reasoning_effort'],async settings=>{bodies.push(spec.buildRequest(settings,[{role:'user',content:'synthetic'}],false));return {elapsedMs:1};});
 assert(d.ok);assert(bodies.every(b=>b.top_p===undefined));assert(bodies.some(b=>b.reasoning?.effort==='low'));assert(bodies.every(b=>b.model==='deepseek-flash'));
 p.api_protocol='anthropic_messages';p.parameter_specs.push({key:'reasoning_budget',type:'integer',min:1024,max:3072});
 const budgets=[];const b=await probe(s,p,['reasoning_budget'],async settings=>{budgets.push(spec.buildRequest(settings,[{role:'user',content:'synthetic'}],false));return {elapsedMs:1};});
 assert(b.ok);assert.equal(b.requests,2);assert.equal(b.results[0].state,'request_accepted');assert.equal(budgets[1].thinking.budget_tokens,1024);assert(budgets[1].max_tokens>1024);
});

test('Agent setting errors redact both saved credentials and nested supplied credentials',async t=>{
 const file=fixture(t),service=require('../src/service.cjs').createService(file),before=fs.readFileSync(file,'utf8');
 const incoming='fake-new-nested-key',r=await service.call('system:settings',{action:'connection_update',arguments:{provider:'openrouter',patch:{['fake-deepseek-key/'+incoming]:1,api_key:incoming}}});
 assert.equal(r.ok,false);assert(!JSON.stringify(r).includes('fake-deepseek-key'));assert(!JSON.stringify(r).includes(incoming));assert(r.errors[0].includes('[redacted]'));assert.equal(fs.readFileSync(file,'utf8'),before);
});
