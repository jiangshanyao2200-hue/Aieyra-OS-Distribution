// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; fs; catalog; spec; GATEWAY; BAILIAN; messages; profile; wire; fixture; mockReply
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/model-catalog.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const catalog=require('../src/model-catalog.cjs'),caps=require('../src/model-capabilities.cjs');
const spec=require('../src/spec.cjs'),pool=require('../src/model-pool.cjs'),cfg=require('../src/config.cjs');
const {draftProfile}=require('../host/connection.cjs');
const {createService}=require('../src/service.cjs');
const GATEWAY='https://fast.aieyra.cn/v1';
const BAILIAN=require('../src/bailian.cjs').DEFAULT_BASE_URL;
const messages=[{role:'user',content:'synthetic catalog acceptance'}];
function profile(model='gemini-3.8-flash-high',protocol='responses',parameters={},row={}){
 return draftProfile({base_url:model.startsWith('gemini-')?GATEWAY:BAILIAN,model,api_protocol:protocol,parameters},row);
}
function wire(p,stream=false){
 const input={...spec.defaults(),model_pool_version:1,api_profiles:[p],active_profile:p.id,matrix_profile:p.id,provider_connections:[{id:pool.connectionID(p),base_url:p.base_url,api_key:'fake-catalog-key',api_key_history:['fake-catalog-key'],request_timeout_seconds:300}]};
 return spec.buildRequest(pool.activate(input,p),messages,stream);
}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-c1-catalog-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'config.json'),main=profile();main.id='main-fixture';main.connection_id='user-aieyra';
 const s=pool.synchronize({...spec.defaults(),model_pool_version:1,api_profiles:[main],active_profile:main.id,matrix_profile:main.id,provider_connections:[{id:main.connection_id,provider:'custom',base_url:GATEWAY,api_key:'fake-main-key',api_key_history:['fake-main-key'],request_timeout_seconds:300}]});
 fs.writeFileSync(file,JSON.stringify(s));
 const service=createService(file);
 return {file,service,call:(action,arguments_={},session='catalog-session')=>service.call('system:settings',{action,arguments:arguments_,session_id:session})};
}
function mockReply(t){
 const calls=[];t.mock.method(global,'fetch',async(url,options)=>{
  assert(!url.includes('models.dev'),'runtime must not fetch models.dev');
  const body=JSON.parse(options.body);calls.push({url,body});
  if(url.endsWith('/responses'))return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'synthetic greeting'}]}]});
  if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{role:'assistant',content:'synthetic greeting'},finish_reason:'stop'}]});
  throw Error('Unexpected provider request: '+url);
 });
 return calls;
}

test('automatic output stays uncapped on Chat and Responses while context retains a reservation',()=>{
 for(const protocol of ['responses','chat_completions']){
  const p=profile('qwen3.8-flash',protocol,{max_tokens:0});
  assert(catalog.outputReservation(p)>0);
  const body=wire(p);assert.equal(Object.hasOwn(body,'max_tokens'),false);assert.equal(Object.hasOwn(body,'max_output_tokens'),false);
  const bounded=wire(caps.edit(p,{max_tokens:8192}));assert.equal(bounded[protocol==='responses'?'max_output_tokens':'max_tokens'],8192);
 }
 assert.equal(spec.defaults().max_tokens,0);
});

test('Gemini conservative 8K placeholder reserves 2K and keeps a positive input budget',()=>{
 const p=profile();assert.equal(p.context_window,8192);assert.equal(p.output_limit,2048);
 assert.equal(p.tool_calls,true);assert.equal(catalog.outputReservation(p),2048);
 assert.equal(p.compact_at_tokens,200000);
 assert(p.context_window-catalog.outputReservation(p)-2048>0);
 const body=wire(p);assert.equal(body.max_output_tokens,undefined);assert.equal(body.reasoning,undefined); // Input reservation is not a wire output cap.
 assert.equal(catalog.describe(p).catalog_context_window,null);
 assert.equal(catalog.describe(p).catalog_vision,null);
});

test('reviewed migration retains provider ceilings, migrates user budgets and preserves explicit zero',()=>{
 const placeholder=profile('qwen3.8-flash','chat_completions');assert.equal(placeholder.context_window,1000000);
 for(const source of ['provider_catalog','user_config']){
  const p=profile('qwen3.8-flash','chat_completions',{}, {context_window:64000,context_window_source:source,output_limit:8000,tool_calls:true});
  const before=structuredClone(p);catalog.upgrade(p);assert.deepEqual(p,before);assert.equal(p.context_window,source==='provider_catalog'?64000:1000000);assert.equal(p.output_limit,8000);
 }
 const unknown=draftProfile({base_url:'https://relay.invalid/v1',model:'future-unknown',api_protocol:'responses',parameters:{}},{});
 assert.equal(unknown.context_window,8192);assert.equal(unknown.output_limit,2048);
 const legacy={...profile(),compact_at_tokens:undefined};catalog.initialize(legacy,{compact_percent:50,context_working_tokens:4000});assert.equal(legacy.compact_at_tokens,2000);
 catalog.initialize(legacy,{compact_percent:90,context_working_tokens:200000});assert.equal(legacy.compact_at_tokens,2000,'explicit legacy working target survives default changes');
 legacy.compact_at_tokens=0;catalog.initialize(legacy,{compact_percent:90});assert.equal(legacy.compact_at_tokens,0);
 for(const [window,want]of [[8192,6000],[1000000,750000],[1048576,786000],[16384,12000]])assert.equal(catalog.recommendedCompact(window,2048),want);
 const kimi=profile('kimi-k3','anthropic_messages');assert.equal(kimi.output_limit,1048576);assert.equal(catalog.outputReservation(kimi),8192);
});

test('context fields edit atomically, stay local, and enforce output and official ceilings',()=>{
 let p=profile('qwen3.8-flash','chat_completions');
 assert.throws(()=>caps.edit(p,{context_window:8192}),/只读/);
 p=profile('qwen3.8-flash','chat_completions',{}, {context_window:8192,context_window_source:'provider_catalog',output_limit:8192});
 p=caps.edit(p,{compact_at_tokens:6000,max_tokens:2048});
 assert.equal(p.context_window_source,'provider_catalog');assert.equal(p.compact_at_tokens,6000);
 const body=wire(p);assert.equal(body.max_tokens,2048);
 for(const name of ['context_window','compact_at_tokens','model_context_window'])assert(!JSON.stringify(body).includes(name));
 assert.equal(caps.edit(p,{max_tokens:4096}).compact_at_tokens,6000);
 p=caps.edit(p,{max_tokens:4096,compact_at_tokens:4000});assert.equal(p.parameters.max_tokens,4096);
 p=caps.edit(p,{compact_at_tokens:0});assert.equal(p.compact_at_tokens,0);
 p=caps.edit(p,{max_tokens:2048,compact_at_tokens:null});assert.equal(p.compact_at_tokens,6000,'reset respects the known 80% capacity ceiling');assert.equal(catalog.compactInputLimit(p),4096,'runtime still reserves the output and protocol margin');
 assert.throws(()=>caps.edit(p,{context_window:1000001}),/只读/);
 assert.throws(()=>caps.edit(p,{compact_at_tokens:2000001}),/compact_at_tokens/);
 assert(caps.fields(p,'zh-CN').filter(f=>f.local).every(f=>f.key.startsWith('__param_')));
});

test('reviewed provider/protocol mappings cannot be borrowed by another host or forged descriptor',()=>{
 const p=profile('gemini-3.8-flash-high','chat_completions'),f=caps.forProfile(p).find(f=>f.key==='reasoning_effort');
 assert(catalog.trustedSpec(p,f));
 for(const base_url of ['http://fast.aieyra.cn/v1','https://fast.aieyra.cn:8443/v1','https://user:pass@localhost/v1','https://fast.aieyra.cn/v2','https://fast.aieyra.cn/v1?x=1','https://fast.aieyra.cn.attacker.invalid/v1']){
  const foreign={...p,provider:'aieyra-gateway',base_url};assert.equal(catalog.rule(foreign),undefined);assert.equal(catalog.trustedSpec(foreign,f),false);
  assert.throws(()=>require('../src/parameter-descriptors.cjs').validate(f,foreign),/不可覆盖/);
 }
 assert.equal(catalog.trustedSpec({...p,api_protocol:'responses'},f),false);
 assert.equal(catalog.trustedSpec(p,{...f,values:[...f.values,'max']}),false);
 assert.equal(catalog.rule({...profile('qwen3.8-flash','chat_completions'),base_url:'https://dashscope.aliyuncs.com.attacker.invalid/compatible-mode/v1'}),undefined);
});

for(const protocol of ['chat_completions','responses','anthropic_messages']){
 test('Qwen3.8 '+protocol+' writes exact thinking paths without generic duplicates',()=>{
  let p=profile('qwen3.8-flash',protocol,{reasoning_effort:'xhigh'}),body=wire(p,true);
  if(protocol==='chat_completions'){assert.equal(body.enable_thinking,true);assert.equal(body.reasoning_effort,'xhigh');assert.equal(body.reasoning,undefined);}
  if(protocol==='responses'){assert.equal(body.enable_thinking,undefined);assert.deepEqual(body.reasoning,{effort:'xhigh'});assert.equal(body.reasoning_effort,undefined);}
  if(protocol==='anthropic_messages'){assert.equal(body.thinking.type,'enabled');assert.equal(body.output_config.effort,'xhigh');assert.equal(body.enable_thinking,undefined);}
  assert.equal(body.model_options,undefined);
  if(protocol==='chat_completions'){
   p=profile('qwen3.8-flash',protocol,{reasoning_budget:1024});body=wire(p,true);
   assert.equal(protocol==='chat_completions'?body.thinking_budget:body.thinking.budget_tokens,1024);
   assert.equal(protocol==='chat_completions'?body.reasoning_effort:body.output_config?.effort,undefined);
   assert.throws(()=>caps.edit(p,{reasoning_effort:'xhigh'}),/只设置一种/);
  }
 });
 test('Qwen3.5 '+protocol+' guard follows the actual wire stream flag',()=>{
  const p=profile('qwen3.5-plus',protocol,{stream:true});
  const off=wire(p,false),on=wire(p,true);
  assert.equal(protocol==='anthropic_messages'?off.thinking.type:off.enable_thinking,protocol==='anthropic_messages'?'disabled':false);
  assert.equal(protocol==='anthropic_messages'?on.thinking.type:on.enable_thinking,protocol==='anthropic_messages'?'enabled':true);
 });
 test('GLM5.3 '+protocol+' always thinks and ignores obsolete budget',()=>{
  const p=profile('glm-5.3',protocol);p.parameters.model_options.reasoning_budget=123456;
  caps.validate(p);const body=wire(p,true);
  if(protocol==='responses'){assert.equal(body.enable_thinking,undefined);assert.equal(body.reasoning.effort,'max');}
  else assert.equal(protocol==='anthropic_messages'?body.thinking.type:body.enable_thinking,protocol==='anthropic_messages'?'enabled':true);
  assert(!JSON.stringify(body).includes('123456'));
  assert.throws(()=>caps.edit(p,protocol==='anthropic_messages'?{thinking_mode:'disabled'}:protocol==='responses'?{reasoning_effort:'none'}:{reasoning_enabled:false}),protocol==='responses'?/无效/:/始终思考/);
 });
}

test('Kimi and MiniMax reviewed Chat/Messages controls map independently',()=>{
 const kimi=profile('kimi-k3','chat_completions',{reasoning_effort:'high'});assert.equal(wire(kimi).reasoning_effort,'high');
 for(const model of ['kimi-k3','MiniMax-M2.5']){
  const p=profile(model,'anthropic_messages');assert.equal(wire(p).thinking.type,'enabled');
  assert.equal(wire(p).reasoning_effort,undefined);
 }
 const mini=profile('MiniMax/MiniMax-M3','chat_completions');assert.equal(wire(mini).thinking.type,'adaptive');
 assert.equal(wire(caps.edit(mini,{thinking_mode:'disabled'})).thinking.type,'disabled');
 assert.equal(wire(mini).reasoning_effort,undefined);
});

test('offline catalog keeps unknown facts nullable, ranks entries, and detaches metadata',()=>{
 const gateway=catalog.rows({base_url:GATEWAY});assert.equal(gateway.length,21);
 const gemini=gateway.find(m=>m.id==='gemini-3.8-flash-high');assert.equal(gemini.catalog_context_window,null);assert.equal(gemini.catalog_vision,null);assert.equal(gemini.free,null);assert.equal(gemini.reference_only,true);assert.equal(gemini.available,true);
 const bailian=catalog.rows({provider:'bailian',base_url:BAILIAN});assert.equal(bailian.length,187);
 for(const rows of [gateway,bailian]){
  assert(rows.every(m=>[...m.summary_zh].length<=21));assert(rows.every(m=>m.parameter_specs&&m.context_fields));
  for(let i=1;i<rows.length;i++)assert(rows[i-1].rank<=rows[i].rank);
 }
 assert.equal(bailian.find(m=>m.id==='qwen3.8-flash').catalog_vision,true);
 gemini.thinking_rule.parameter_specs[0].values.push('forged');assert(!catalog.rows({base_url:GATEWAY}).find(m=>m.id===gemini.id).thinking_rule.parameter_specs[0].values.includes('forged'));
});

test('catalog and onboarding catalog expose reviewed data through the existing settings service',async t=>{
 const {call}=fixture(t),seen=[];
 t.mock.method(global,'fetch',async(url,options)=>{seen.push(url);assert(url.endsWith('/models'));assert.equal(options.headers.Authorization,'Bearer fake-main-key');return Response.json({data:[{id:'gemini-3.8-flash-high',api_protocol:'responses'}]});});
 const offline=await call('catalog',{connection_id:'user-aieyra',query:'gemini',limit:100});assert.equal(offline.ok,true);assert.equal(seen.length,0);assert(offline.models.every(m=>m.tier&&m.parameter_specs));
 const onboard=await call('onboarding_catalog',{user_slot:'aieyra',connection_id:'user-aieyra',base_url:GATEWAY});assert.equal(onboard.ok,true,onboard.errors?.join(';'));
 assert.equal(onboard.models.find(m=>m.id==='gemini-3.8-flash-high').catalog_context_window,null);assert.equal(seen.length,1);
});

test('one response receipt saves subconscious independently and survives reload without another generation',async t=>{
 const seen=mockReply(t),{file,call}=fixture(t);
 const proof=await call('onboarding_test',{base_url:BAILIAN,api_key:'fake-subconscious-key',model:'qwen3.8-flash',api_protocol:'responses',compact_at_tokens:40000,parameters:{max_tokens:2048,reasoning_effort:'xhigh'}});
 assert.equal(proof.ok,true,proof.errors?.join(';'));assert.equal(seen.length,1);assert.equal(seen[0].body.reasoning.effort,'xhigh');
 const wrongSession=await call('response_save',{test_id:proof.test_id,expected_version:proof.version,roles:['subconscious']},'other-session');assert.equal(wrongSession.ok,false);
 const saved=await call('onboarding_save',{test_id:proof.test_id,expected_version:proof.version,roles:['subconscious']});assert.equal(saved.ok,true,saved.errors?.join(';'));assert.equal(seen.length,1);
 assert.equal(saved.recovery_saved,false);assert.equal(saved.settings.active_profile,'main-fixture');assert.equal(saved.settings.matrix_profile,'main-fixture');assert.equal(saved.settings.subconscious_profile,saved.model_id);
 const disk=cfg.load(file).settings;assert.equal(disk.subconscious_profile,saved.model_id);assert.equal(disk.api_profiles.find(p=>p.id===saved.model_id).compact_at_tokens,40000);
 const reload=createService(file);const read=await reload.call('system:settings',{action:'read'});assert.equal(read.settings.subconscious_profile,saved.model_id);
 const sub=read.settings.api_profiles.find(p=>p.id===saved.model_id);assert.equal(sub.context_window,1000000);assert.equal(sub.parameters.max_tokens,2048);
 const used=await call('response_save',{test_id:proof.test_id,expected_version:proof.version,role:'main'});assert.equal(used.ok,false);
 assert(!JSON.stringify(saved).includes('fake-subconscious-key'));
});

test('role assignment, context edits and clearing use the versioned persistent settings contract',async t=>{
 const {file,call}=fixture(t),seen=mockReply(t);
 const proof=await call('response_test',{base_url:BAILIAN,api_key:'fake-sub-key',model:'qwen3.8-flash',api_protocol:'chat_completions'});
 assert.equal(proof.ok,true,proof.errors?.join(';'));
 let r=await call('response_save',{test_id:proof.test_id,expected_version:proof.version,roles:[]});assert.equal(r.ok,true,r.errors?.join(';'));const id=r.model_id;
 assert.equal(r.settings.active_profile,'main-fixture');
 const before=fs.readFileSync(file,'utf8');
 const conflict=await call('model_update',{id,expected_version:proof.version,role:'main'});assert.equal(conflict.code,'version_conflict');assert.equal(fs.readFileSync(file,'utf8'),before);
 const invalid=await call('model_update',{id,expected_version:r.version,role:'subconscious',roles:['main']});assert.equal(invalid.ok,false);assert.equal(fs.readFileSync(file,'utf8'),before);
 const capacityEdit=await call('model_update',{id,expected_version:r.version,context_window:8192});assert.equal(capacityEdit.ok,false);assert.match(capacityEdit.errors.join(';'),/只读/);assert.equal(fs.readFileSync(file,'utf8'),before);
 r=await call('model_update',{id,expected_version:r.version,roles:['main','subconscious'],compact_at_tokens:4000,parameters:{max_tokens:2048}});assert.equal(r.ok,true,r.errors?.join(';'));
 assert.equal(r.settings.api_profiles.find(p=>p.id===id).context_window,1000000);
 assert.equal(r.settings.active_profile,id);assert.equal(r.settings.matrix_profile,id);assert.equal(r.settings.subconscious_profile,id);
 r=await call('pool_action',{operation:'subconscious',id:'',expected_version:r.version});assert.equal(r.ok,true);assert.equal(cfg.load(file).settings.subconscious_profile,'');assert.equal(r.settings.active_profile,id);
 r=await call('pool_action',{operation:'subconscious',id,expected_version:r.version});assert.equal(r.ok,true);assert.equal(cfg.load(file).settings.subconscious_profile,id);
 r=await call('model_update',{id,expected_version:r.version,enabled:false});assert.equal(r.ok,true,r.errors?.join(';'));assert.equal(cfg.load(file).settings.subconscious_profile,'');assert.equal(seen.length,1);
 const dangling=pool.migrate({...cfg.load(file).settings,subconscious_profile:'missing'});assert.equal(dangling.subconscious_profile,'');
});

test('a changed config invalidates a response receipt without writing or making another request',async t=>{
 const {file,call}=fixture(t),seen=mockReply(t);
 const proof=await call('response_test',{base_url:GATEWAY,connection_id:'user-aieyra',model:'gemini-3.8-flash-high',api_protocol:'responses'});assert.equal(proof.ok,true);
 const changed=JSON.parse(fs.readFileSync(file,'utf8'));changed.show_reasoning=false;fs.writeFileSync(file,JSON.stringify(changed));const before=fs.readFileSync(file,'utf8');
 const result=await call('response_save',{test_id:proof.test_id,expected_version:proof.version,role:'main'});assert.equal(result.code,'version_conflict');assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(seen.length,1);
});
