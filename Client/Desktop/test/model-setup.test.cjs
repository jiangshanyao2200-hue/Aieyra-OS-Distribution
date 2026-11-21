// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: cfg; fixture; secret
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/model-setup.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 设置 · 模型（2026-10-14 轨 S）：供应商多 Key、按 Key 获取列表、两个模型池、模型连接四个新键。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const cfg=require('../src/config.cjs'),spec=require('../src/spec.cjs'),pool=require('../src/model-pool.cjs'),setup=require('../src/model-setup.cjs');
const {createSystemSettings}=require('../src/system-settings.cjs');
async function fixture(t,initial={},models=null){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-model-setup-')),file=path.join(dir,'config.json'),calls=[];
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;calls.push({url:req.url,key:req.headers.authorization,body:body?JSON.parse(body):null});res.setHeader('content-type','application/json');
  if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:models||[{id:'gpt-6-astra'},{id:'tool-model',tool_calls:true,context_length:128000},{id:'gpt-image-2'},{id:'models/plain-chat'}]}));
  if(body&&JSON.parse(body).model==='broken'){res.statusCode=500;return res.end('{}');}
  if(body&&JSON.parse(body).model==='missing-chat'){res.statusCode=404;return res.end('{}');}
  if(req.url.endsWith('/chat/completions'))return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Connected.'},finish_reason:'stop'}]}));
  res.end(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Connected.'}]}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 fs.writeFileSync(file,JSON.stringify({...spec.defaults(),model_pool_version:1,...initial}));
 const service=createSystemSettings(file),base='http://127.0.0.1:'+server.address().port;
 const call=(p,session='s')=>service.call('pool',p,session);
 return {file,calls,base,service,call};
}
const secret='sk-synthetic-provider-key-0001',second='sk-synthetic-provider-key-0002';

test('Grok video stores its media identity without a text call and cannot become a chat model',async t=>{
 const f=await fixture(t,{},[{id:'grok-imagine-video',kind:'video',output_modalities:['video']}]);
 let v=await f.call({op:'view'});v=await f.call({op:'key_add',preset:'custom',base_url:f.base,api_key:secret,expected_version:v.version});
 const connection_id=v.connections[0].id,list=await f.call({op:'catalog',connection_id,refresh:true});assert.equal(list.models[0].kind,'video');
 const before=f.calls.length;v=await f.call({op:'add',connection_id,model:'grok-imagine-video',expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));assert.equal(f.calls.length,before);assert.equal(v.models[0].kind,'video');
 const saved=cfg.load(f.file).settings;pool.validate(saved);assert.throws(()=>pool.setRole(saved,v.models[0].id,'main'),/媒体/);
 const repeated=await f.call({op:'add',connection_id,model:'grok-imagine-video',expected_version:v.version});assert.equal(repeated.models.length,1);assert.equal(f.calls.length,before);
 const tested=await f.call({op:'test',connection_id,model:'grok-imagine-video'});assert.equal(tested.skipped,true);assert.equal(f.calls.length,before);
});

test('adding stores even an unavailable model without a probe; only explicit testing calls its endpoint',async t=>{
 const f=await fixture(t,{},[{id:'gpt-6.1-sol',supported_endpoint_types:['openai']},{id:'missing-chat',supported_endpoint_types:['openai']}]);
 let v=await f.call({op:'view'});
 v=await f.call({op:'key_add',preset:'custom',name:'New API',base_url:f.base,api_key:secret,expected_version:v.version});
 const id=v.connections[0].id;
 const list=await f.call({op:'catalog',connection_id:id,refresh:true});assert.equal(list.ok,true);
 v=await f.call({op:'add',connection_id:id,model:'gpt-6.1-sol',expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 const saved=cfg.load(f.file).settings.api_profiles[0];assert.equal(saved.api_protocol,'chat_completions');assert.equal(saved.response_verified,false);assert.equal(saved.tool_validation,'not_tested');
 v=await f.call({op:'add',connection_id:id,model:'missing-chat',expected_version:v.version});assert.equal(v.ok,true);
 assert.equal(cfg.load(f.file).settings.api_profiles.length,2);assert.equal(f.calls.filter(c=>c.body).length,0);
 const tested=await f.call({op:'test',connection_id:id,model:'missing-chat'});assert.equal(tested.ok,false);
 assert.deepEqual(f.calls.filter(c=>c.body).map(c=>c.url),['/chat/completions']);
});

test('hover metadata keeps exact identities, unknown capacity and untested tools distinct',()=>{
 const unknown=setup.info({model:'grok-9-unreleased-fast',context_window:8192,output_limit:2048,context_window_source:'conservative_client_budget',tool_calls:false,tool_validation:'not_tested'});
 assert.equal(unknown.context_window,0);assert.equal(unknown.max_output,0);assert.equal(unknown.tool_calls,null);
 for(const model of ['unrelated/grok-4.7','openai/grok-4.7','GROK-4.7']){const i=setup.info({model});assert.equal(i.context_window,0,model);assert.equal(i.price,null,model);}
 const known=setup.info({model:'x-ai/grok-4.7'});assert.equal(known.context_window,500000);assert(known.source);
});

test('clear removes only the selected model pool, keeps credentials and atomically prunes roles',async t=>{
 const draft=require('../host/connection.cjs').draftProfile;
 const connections=[{id:'official',provider:'custom',base_url:setup.GATEWAY,api_key:secret,api_key_history:[secret],request_timeout_seconds:300},{id:'other',provider:'custom',base_url:'https://fixture.invalid/v1',api_key:second,api_key_history:[second],request_timeout_seconds:300}];
 const profiles=connections.map((c,i)=>({...draft({base_url:c.base_url,model:'fixture-'+i,api_protocol:'responses'}),id:'profile-'+i,connection_id:c.id,tool_calls:true,enabled:true}));
 const f=await fixture(t,{provider_connections:connections,api_profiles:profiles,matrix_profile:'profile-0',active_profile:'profile-0',matrix_alternates:['profile-1'],image_profiles:['profile-0'],image_generation_enabled:true,vision_profile:'profile-0',execution_profile:'profile-1'});
 let v=await f.call({op:'view'});const before=cfg.load(f.file).settings,oldVersion=v.version;
 v=await f.call({op:'clear',source:'aieyra',expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.deepEqual(v.models.map(m=>m.id),['profile-1']);assert.equal(v.roles.matrix_profile,'');assert.deepEqual(v.roles.image_profiles,[]);assert.equal(v.roles.image_generation_enabled,false);assert.equal(v.roles.vision_profile,'');assert.equal(v.roles.execution_profile,'profile-1');
 assert.deepEqual(cfg.load(f.file).settings.provider_connections,before.provider_connections);
 const bytes=fs.readFileSync(f.file);const conflict=await f.call({op:'clear',source:'provider',expected_version:oldVersion});assert.equal(conflict.code,'version_conflict');assert.deepEqual(fs.readFileSync(f.file),bytes);
 await assert.rejects(()=>f.call({op:'clear',source:'all',expected_version:v.version}));assert.deepEqual(fs.readFileSync(f.file),bytes);
 v=await f.call({op:'clear',source:'provider',expected_version:v.version});assert.equal(v.ok,true);assert.equal(v.models.length,0);assert.equal(v.roles.execution_profile,'');assert.deepEqual(v.roles.matrix_alternates,[]);
 v=await f.call({op:'clear',source:'provider',expected_version:v.version});assert.equal(v.ok,true);
 const restarted=createSystemSettings(f.file);assert.equal((await restarted.call('pool',{op:'view'})).models.length,0);
 assert.deepEqual(cfg.load(f.file).settings.provider_connections,before.provider_connections);assert.equal(f.calls.length,0);
});

test('defaults and sanitize carry the model-connection role keys', ()=>{
 const d=spec.defaults();
 assert.deepEqual([d.matrix_alternates,d.vision_profile,d.execution_profile,d.collaboration_enabled,d.image_profiles,d.image_generation_enabled],[[],'','',true,[],false]);
 assert.equal('workspace_profile' in d,false);
 const s=spec.sanitize({...d,matrix_alternates:'x',image_profiles:['a','a',3],vision_profile:7,execution_profile:null,collaboration_enabled:'no',workspace_profile:'old-iris',image_generation_enabled:'yes'});
 assert.deepEqual([s.matrix_alternates,s.image_profiles,s.vision_profile,s.execution_profile,s.collaboration_enabled,s.image_generation_enabled],[[],['a'],'','',true,true]);
 assert.equal('workspace_profile' in s,false);
});

test('legacy pool migrates without losing connections, keys, entries or roles', ()=>{
 const legacy={...spec.defaults(),model_pool_version:1,provider_connections:[{id:'deepseek',provider:'deepseek',base_url:spec.DEFAULT_BASE_URL,api_key:secret,api_key_history:[secret,'older-key-value-1234'],request_timeout_seconds:300}],
  api_profiles:[{id:'flash',name:'Flash',model:'deepseek-flash',connection_id:'deepseek',provider:'deepseek',base_url:spec.DEFAULT_BASE_URL,adapter:'deepseek',api_protocol:'responses',context_window:1000000,tool_calls:true,enabled:true,parameters:pool.parameters(spec.defaults())}],matrix_profile:'flash',active_profile:'flash',subconscious_profile:'flash'};
 delete legacy.matrix_alternates;delete legacy.image_profiles;delete legacy.vision_profile;delete legacy.execution_profile;delete legacy.collaboration_enabled;delete legacy.image_generation_enabled;
 const s=pool.synchronize(pool.migrate(legacy));pool.validate(s);
 assert.equal(s.provider_connections[0].api_key,secret);assert.deepEqual(s.provider_connections[0].api_key_history,[secret,'older-key-value-1234']);
 assert.equal(s.matrix_profile,'flash');assert.equal(s.subconscious_profile,'flash');
 const v=setup.view(s);assert.equal(v.models[0].source,'provider');assert.equal(v.models[0].kind,'chat');assert.equal(v.roles.matrix_profile,'flash');assert.deepEqual(v.roles.matrix_alternates,[]);
 assert.equal(v.connections[0].key_hint,'0001');assert.ok(!JSON.stringify(v).includes(secret));assert.ok(!JSON.stringify(v).includes('older-key'));
});

test('new role keys are validated and stale references are pruned', ()=>{
 const base={...spec.defaults(),model_pool_version:1,provider_connections:[],api_profiles:[]};
 assert.throws(()=>pool.validate({...base,matrix_alternates:'x'}),/matrix_alternates/);
 assert.throws(()=>pool.validate({...base,image_profiles:[1]}),/image_profiles/);
 assert.throws(()=>pool.validate({...base,image_generation_enabled:'on'}),/image_generation_enabled/);
 assert.throws(()=>pool.validate({...base,vision_profile:3}),/vision_profile/);
 assert.throws(()=>pool.validate({...base,execution_profile:{}}),/execution_profile/);
 assert.throws(()=>pool.validate({...base,collaboration_enabled:'on'}),/collaboration_enabled/);
 const s={...base,matrix_alternates:['gone'],vision_profile:'gone',execution_profile:'gone',image_profiles:['gone']};pool.validate(s);
 assert.deepEqual([s.matrix_alternates,s.vision_profile,s.execution_profile,s.image_profiles],[[],'','',[]]);
});

test('providers hold several keys; each key fetches its own list and feeds the provider pool', async t=>{
 const f=await fixture(t);let v=await f.call({op:'view'});assert.equal(v.ok,true);
 // 用户 2026-10-16：供应商只留 DeepSeek、阿里云百炼与自定义；官方两家只要 Key。
 assert.deepEqual(v.presets.map(p=>p.id),['deepseek','bailian','custom']);assert.deepEqual(v.presets.filter(p=>p.editable_base).map(p=>p.id),['custom']);
 v=await f.call({op:'key_add',preset:'custom',name:'Relay',base_url:f.base,api_key:secret,expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 v=await f.call({op:'key_add',preset:'custom',name:'Relay',base_url:f.base,api_key:second,expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 const dup=await f.call({op:'key_add',preset:'custom',name:'Relay',base_url:f.base,api_key:second,expected_version:v.version}).catch(e=>({ok:false,errors:[e.message]}));assert.equal(dup.ok,false);
 assert.equal(v.connections.length,2);assert.equal(new Set(v.connections.map(c=>c.group)).size,1);assert.deepEqual(v.connections.map(c=>c.key_hint),['0001','0002']);
 assert.ok(!JSON.stringify(v).includes(secret)&&!JSON.stringify(v).includes(second));
 const [a,b]=v.connections.map(c=>c.id);
 const list=await f.call({op:'catalog',connection_id:b,refresh:true});assert.equal(list.ok,true,JSON.stringify(list.errors));
 assert.equal(f.calls.at(-1).key,'Bearer '+second,'catalog uses the chosen key');
 assert.deepEqual(list.models.map(m=>m.id),['gpt-6-astra','tool-model','gpt-image-2','plain-chat']);
 assert.equal(list.models.find(m=>m.id==='gpt-image-2').kind,'image');
 // All additions commit configuration without generating a model response.
 let before=f.calls.length;v=await f.call({op:'add',connection_id:b,model:'tool-model',expected_version:list.version});assert.equal(v.ok,true,JSON.stringify(v.errors));assert.equal(f.calls.length,before);
 before=f.calls.length;v=await f.call({op:'add',connection_id:b,model:'gpt-6-astra',expected_version:v.version},'human');assert.equal(v.ok,true,JSON.stringify(v.errors));assert.equal(f.calls.length,before);
 v=await f.call({op:'add',connection_id:b,model:'gpt-image-2',expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.deepEqual(v.models.map(m=>[m.model,m.kind,m.source]),[['tool-model','chat','provider'],['gpt-6-astra','chat','provider'],['gpt-image-2','image','provider']]);
 before=f.calls.length;v=await f.call({op:'add',connection_id:a,model:'broken',expected_version:v.version},'human');assert.equal(v.ok,true);assert.equal(f.calls.length,before);assert.ok(!JSON.stringify(v).includes(secret));
 const fail=await f.call({op:'test',connection_id:a,model:'broken'},'human');assert.equal(fail.ok,false);assert.ok(!JSON.stringify(fail).includes(secret));
 const relisted=await f.call({op:'catalog',connection_id:b});assert.equal(relisted.models.find(m=>m.id==='tool-model').in_pool,true);
 const saved=cfg.load(f.file).settings;pool.validate(saved);assert.equal(saved.provider_connections.find(c=>c.id===b).api_key,second);
 // 移除一把 Key 时它的池条目一并移除，另一把 Key 不受影响。
 v=await f.call({op:'key_remove',connection_id:b,expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.deepEqual(v.models.map(m=>m.model),['broken']);assert.deepEqual(v.connections.map(c=>c.id),[a]);
 assert.ok(!JSON.stringify(cfg.load(f.file).settings).includes(second));
});

test('model connection page assigns main, alternates, subconscious, vision, execution and image models', async t=>{
 const f=await fixture(t);let v=await f.call({op:'view'});
 v=await f.call({op:'key_add',preset:'custom',base_url:f.base,api_key:secret,expected_version:v.version});const id=v.connections[0].id;
 for(const model of ['tool-model','gpt-6-astra','gpt-image-2']){v=await f.call({op:'add',connection_id:id,model,expected_version:v.version},'human');assert.equal(v.ok,true,JSON.stringify(v.errors));}
 const [tool,astra,image]=v.models.map(m=>m.id);
 await assert.rejects(f.call({op:'roles',matrix_profile:image,expected_version:v.version}),/生图模型/);
 v=await f.call({op:'roles',image_profiles:[tool],image_generation_enabled:false,expected_version:v.version});assert.deepEqual(v.roles.image_profiles,[tool]);assert.equal(v.roles.image_generation_enabled,true);
 await assert.rejects(f.call({op:'roles',image_profiles:[tool,image],expected_version:v.version}),/一个默认/);
 v=await f.call({op:'roles',matrix_profile:tool,matrix_alternates:[astra,tool],subconscious_profile:astra,vision_profile:astra,execution_profile:tool,collaboration_enabled:false,image_profiles:[image],image_generation_enabled:true,expected_version:v.version});
 assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.deepEqual(v.roles,{matrix_profile:tool,matrix_alternates:[astra],subconscious_profile:astra,vision_profile:astra,execution_profile:tool,collaboration_enabled:false,vision_enabled:null,execution_enabled:null,vision_tools:null,execution_tools:null,image_profiles:[image],image_generation_enabled:true,video_profile:''});
 await assert.rejects(f.call({op:'roles',vision_profile:image,expected_version:v.version}),/生图模型/);
 let s=cfg.load(f.file).settings;assert.equal(s.active_profile,tool);assert.equal(s.model,'tool-model');assert.deepEqual(s.image_profiles,[image]);
 // 换主模型时它从备选里退出；移除池条目时对应角色一起清空。
 v=await f.call({op:'roles',matrix_profile:astra,matrix_alternates:[astra,tool],expected_version:v.version});assert.deepEqual(v.roles.matrix_alternates,[tool]);
 v=await f.call({op:'remove',id:image,expected_version:v.version});assert.deepEqual(v.roles.image_profiles,[]);
 v=await f.call({op:'remove',id:astra,expected_version:v.version});
 assert.equal(v.roles.matrix_profile,'');assert.equal(v.roles.subconscious_profile,'');assert.equal(v.roles.vision_profile,'');assert.equal(v.roles.execution_profile,tool);assert.deepEqual(v.roles.matrix_alternates,[tool]);
 const stale=await f.call({op:'roles',vision_profile:tool,expected_version:'old'});assert.equal(stale.code,'version_conflict');
});

test('thinking is the only per-role parameter and is written into the pool entry', async t=>{
 const f=await fixture(t,{provider_connections:[{id:'deepseek',provider:'deepseek',base_url:spec.DEFAULT_BASE_URL,api_key:secret,api_key_history:[secret],request_timeout_seconds:300}],api_profiles:[{id:'flash',name:'Flash',model:'deepseek-flash',connection_id:'deepseek',provider:'deepseek',base_url:spec.DEFAULT_BASE_URL,adapter:'deepseek',api_protocol:'responses',context_window:1000000,tool_calls:true,enabled:true,parameters:pool.parameters(spec.defaults())}],matrix_profile:'flash',active_profile:'flash'});
 let v=await f.call({op:'view'});const t0=v.models[0].thinking;assert.ok(t0&&t0.values.length,'deepseek exposes thinking');
 const value=t0.values.find(x=>String(x)!==String(t0.value));
 v=await f.call({op:'thinking',id:'flash',key:t0.key,value,expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.equal(String(v.models[0].thinking.value),String(value));
 await assert.rejects(f.call({op:'thinking',id:'flash',key:t0.key,value:'not-a-level',expected_version:v.version}),/无效/);
});

test('selected Aieyra account key binds to user-aieyra without passing through the renderer', async t=>{
 const f=await fixture(t,{user_connection_drafts:{aieyra:{base_url:setup.GATEWAY,api_key:'sk-aieyra-synthetic-0009'}}});
 let v=await f.call({op:'view'});assert.equal(v.aieyra.pending,true);assert.ok(!JSON.stringify(v).includes('sk-aieyra-synthetic'));
 v=await f.call({op:'aieyra_bind',expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.equal(v.aieyra.connection_id,'user-aieyra');assert.equal(v.aieyra.key_hint,'0009');assert.equal(v.connections[0].source,'aieyra');
 const s=cfg.load(f.file).settings;pool.validate(s);assert.equal(s.provider_connections[0].api_key,'sk-aieyra-synthetic-0009');
 const image=setup.imageEntry(s.provider_connections[0],'gemini-3.1-flash-image',null);assert.equal(image.kind,'image');assert.equal(setup.isImageModel({id:'gemini-3.1-flash-image'}),true);assert.equal(setup.isImageModel({id:'gpt-6-astra'}),false);
});

// 用户 2026-10-16：每把 Key 可启用 / 禁用；禁用时它加进池子的模型一并移出，获取列表与加入都跳过它。
test('a disabled key empties its pool entries and refuses catalog, add and test', async t=>{
 const f=await fixture(t);let v=await f.call({op:'view'});
 v=await f.call({op:'key_add',preset:'custom',name:'Relay',base_url:f.base,api_key:secret,expected_version:v.version});
 const id=v.connections[0].id;assert.equal(v.connections[0].enabled,true);assert.equal(v.connections[0].key_mask,'sk-••••••0001');
 v=await f.call({op:'add',connection_id:id,model:'tool-model',expected_version:v.version});
 v=await f.call({op:'roles',matrix_profile:v.models[0].id,expected_version:v.version});assert.equal(v.models.length,1);
 v=await f.call({op:'key_enabled',connection_id:id,enabled:false,expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.equal(v.connections[0].enabled,false);assert.equal(v.models.length,0);assert.equal(v.roles.matrix_profile,'');
 const list=await f.call({op:'catalog',connection_id:id,refresh:true});assert.equal(list.ok,false);assert.match(list.errors[0],/禁用/);
 await assert.rejects(f.call({op:'add',connection_id:id,model:'tool-model',expected_version:v.version}),/禁用/);
 assert.equal((await f.call({op:'test',connection_id:id,model:'tool-model'})).ok,false);
 v=await f.call({op:'key_enabled',connection_id:id,enabled:true,expected_version:v.version});assert.equal(v.connections[0].enabled,true);
 pool.validate(cfg.load(f.file).settings);
});

test('a single model test answers ok or not without changing the configuration, and rapid repeats are refused', async t=>{
 const f=await fixture(t);let v=await f.call({op:'view'});
 v=await f.call({op:'key_add',preset:'custom',base_url:f.base,api_key:secret,expected_version:v.version});const id=v.connections[0].id;
 const before=cfg.load(f.file).version;
 const ok=await f.call({op:'test',connection_id:id,model:'gpt-6-astra'},'human');assert.equal(ok.ok,true,JSON.stringify(ok.errors));assert.ok(!JSON.stringify(ok).includes(secret));
 const again=await f.call({op:'test',connection_id:id,model:'gpt-6-astra'},'human');assert.equal(again.ok,false);assert.match(again.errors[0],/刚测过/);
 const bad=await f.call({op:'test',connection_id:id,model:'broken'},'human');assert.equal(bad.ok,false);assert.ok(!JSON.stringify(bad).includes(secret));
 const image=await f.call({op:'test',connection_id:id,model:'gpt-image-2'},'human');assert.equal(image.skipped,true);
 const parallel=await Promise.all(['m1','m2','m3','m4','m5','m6','m7','m8'].map(model=>f.call({op:'test',connection_id:id,model},'human')));
 assert.ok(parallel.some(r=>r.ok===false&&/太频繁/.test(r.errors?.[0]||'')),'more than six at once are refused');
 assert.equal(cfg.load(f.file).version,before);
});

test('each Aieyra account key is its own connection; only names and a truncated key reach the renderer', async t=>{
 const f=await fixture(t,{aieyra_key_drafts:{'11':{api_key:'sk-aieyra-synthetic-key-0011',name:'工作'},'12':{api_key:'sk-aieyra-synthetic-key-0012',name:'备用'}}});
 let v=await f.call({op:'view'});
 v=await f.call({op:'aieyra_key',token_id:'11',expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v.errors));
 v=await f.call({op:'aieyra_key',token_id:'12',expected_version:v.version});
 const keys=v.connections.filter(c=>c.source==='aieyra');
 assert.deepEqual(keys.map(c=>[c.id,c.key_name,c.token_id,c.key_mask]),[['user-aieyra-11','工作','11','sk-••••••0011'],['user-aieyra-12','备用','12','sk-••••••0012']]);
 assert.ok(!JSON.stringify(v).includes('synthetic-key'));
 await assert.rejects(f.call({op:'aieyra_key',token_id:'../x',expected_version:v.version}),/编号/);
 pool.validate(cfg.load(f.file).settings);
});

test('an Aieyra key lists only the models that key returned, never the bundled reference models', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-model-setup-gw-')),file=path.join(dir,'config.json');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(file,JSON.stringify({...spec.defaults(),model_pool_version:1,aieyra_key_drafts:{'21':{api_key:'sk-aieyra-synthetic-key-0021',name:'只开一个'}}}));
 const fetcher=async url=>new Response(JSON.stringify(String(url).endsWith('/models')?{data:[{id:'only-this-model'}]}:{}),{status:200,headers:{'content-type':'application/json'}});
 const service=createSystemSettings(file,()=>{},require('../src/provider-settings.cjs').createProviderSettings(fetcher,file));
 const r=await service.call('pool',{op:'catalog',token_id:'21',refresh:true},'s');
 assert.equal(r.ok,true,JSON.stringify(r.errors));
 assert.deepEqual(r.models.map(m=>m.id),['only-this-model']);
});

test('pool entries and catalog rows carry price and capability details for the hover card', ()=>{
 const i=setup.info({model:'qwen3.7-max'});
 assert.equal(i.price.currency,'USD');assert.ok(i.price.input>0&&i.price.output>0);assert.ok(i.context_window>0);
 const none=setup.info({model:'no-such-model-anywhere'});assert.equal(none.price,null);assert.equal(none.context_window,0);
});

for(const tools of [true,false])test('DeepSeek 添加时归一目录容量，压缩配置后置 '+tools,async t=>{
 const f=await fixture(t,{},[{id:'deepseek-v4-pro',context_length:1048576,tool_calls:tools,api_protocol:'responses'}]);
 let v=await f.call({op:'view'});
 v=await f.call({op:'key_add',preset:'custom',base_url:f.base,api_key:secret,expected_version:v.version});
 const connection_id=v.connections[0].id;
 const list=await f.call({op:'catalog',connection_id,refresh:true});assert.equal(list.ok,true);
 const before=f.calls.length;
 v=await f.call({op:'add',connection_id,model:'deepseek-v4-pro',expected_version:list.version});
 assert.equal(v.ok,true,JSON.stringify(v.errors));assert.equal(f.calls.length-before,0);
 const m=v.models[0];assert.equal(m.context_window,1000000);assert.equal(m.context_limit,1000000);assert(m.compact_at_tokens<=m.compact_limit);assert.equal(v.roles.matrix_profile,'');
 v=await f.call({op:'context',id:m.id,key:'compact_at_tokens',value:600000,expected_version:v.version});
 assert.equal(v.ok,true,JSON.stringify(v.errors));assert.equal(v.models[0].compact_at_tokens,600000);
 const saved=cfg.load(f.file).settings;pool.validate(saved);assert.equal(saved.api_profiles[0].context_window,1000000);
 await assert.rejects(f.call({op:'context',id:m.id,key:'context_window',value:1048576,expected_version:v.version}),/只读/);
});

test('video default is persisted through common roles CAS and cleared when its model is removed',async t=>{
 const profile={id:'video-default',name:'Video',model:'muse-video',kind:'image',enabled:true,provider:'openai',base_url:'https://fast.aieyra.cn/v1',api_key:'synthetic-video-key',connection_id:'video-connection'};
 const f=await fixture(t,{api_profiles:[profile],provider_connections:[{id:'video-connection',provider:'openai',base_url:profile.base_url,api_key:profile.api_key,request_timeout_seconds:300,enabled:true}]});
 let v=await f.call({op:'view'});assert.equal(v.models[0].video_verified,true);
 v=await f.call({op:'roles',video_profile:profile.id,expected_version:v.version});assert.equal(v.ok,true,JSON.stringify(v));assert.equal(v.roles.video_profile,profile.id);assert.equal(JSON.parse(fs.readFileSync(f.file)).video_profile,profile.id);
 await assert.rejects(f.call({op:'roles',video_profile:'missing',expected_version:v.version}),/加入模型池/);
 v=await f.call({op:'remove',id:profile.id,expected_version:v.version});assert.equal(v.roles.video_profile,'');
});
