// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: spec; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/adaptive-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const spec=require('../src/spec.cjs'),cfg=require('../src/config.cjs'),pool=require('../src/model-pool.cjs'),caps=require('../src/model-capabilities.cjs'),{createSystemSettings}=require('../src/system-settings.cjs');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-adaptive-')),file=path.join(dir,'config.json'),calls=[];
 let mode='good';
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;calls.push({url:req.url,body});res.setHeader('Content-Type','application/json');
  if(req.url==='/models'){res.end(JSON.stringify({data:[{id:'test-model',context_window:32768}]}));return;}
  if(mode==='error'){res.writeHead(400);res.end('{"error":{"message":"unsupported parameter"}}');return;}
  if(mode==='empty'){res.end('{"status":"completed","output":[]}');return;}
  if(req.url==='/responses')res.end(JSON.stringify({status:mode==='partial'?'incomplete':'completed',output:[{type:'message',content:[{type:'output_text',text:'Hello'}]}]}));
  else if(req.url==='/chat/completions')res.end('{"choices":[{"finish_reason":"stop","message":{"content":"Hello"}}]}');
  else if(req.url==='/messages')res.end('{"stop_reason":"end_turn","content":[{"type":"text","text":"Hello"}]}');
  else res.end('{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"Hello"}]}}]}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;fs.writeFileSync(file,JSON.stringify({...spec.defaults(),base_url:base,api_key:'synthetic-only',system_prompt:'keep personal prompt'}));
 return {file,calls,base,service:createSystemSettings(file),mode:value=>mode=value};
}
test('model list → actual response → versioned save uses one generation and no URL probe',async t=>{
 const {file,calls,base,service}=await fixture(t),draft={base_url:base,api_key:'synthetic-only',model:'test-model'};
 const catalog=await service.call('onboarding_catalog',draft,'one');assert.equal(catalog.models.length,1);
 const before=fs.readFileSync(file,'utf8'),result=await service.call('onboarding_test',draft,'one');assert.equal(result.ok,true);assert.equal(result.tool_roundtrip,false);assert.ok(result.elapsed_ms>=0);assert.equal(result.api_protocol,'responses');assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.deepEqual(calls.map(c=>c.url),['/models','/responses']);assert.equal(calls[1].body.tools,undefined);assert.ok(!JSON.stringify(calls[1].body).includes('keep personal prompt'));
 const wrong=await service.call('onboarding_save',{test_id:result.test_id,expected_version:result.version},'other');assert.equal(wrong.ok,false);
 const saved=await service.call('onboarding_save',{test_id:result.test_id,expected_version:result.version},'one');assert.equal(saved.ok,true,saved.errors?.join());assert.equal(calls.length,2);assert.equal(saved.settings.system_prompt,'keep personal prompt');
 const p=cfg.load(file).settings.api_profiles.find(p=>p.id===saved.model_id);assert.equal(p.response_verified,true);assert.equal(p.tool_calls,false);assert.equal(p.context_window,32768);assert.equal(p.tool_validation,'not_tested');
 const reloaded=createSystemSettings(file),view=await reloaded.call('connection_draft',{},'one');assert.equal(view.has_key,true);assert.equal(view.parameters.max_tokens,'');assert.ok(!JSON.stringify(view).includes('synthetic-only'));
 const connections=await reloaded.call('connections'),catalogAfter=await reloaded.call('catalog',{connection_id:connections.connections.find(c=>c.base_url===base).id});assert.equal(catalogAfter.models[0].id,'test-model');assert.equal(catalogAfter.total,1);
 const reuse=await reloaded.call('response_test',{profile_id:p.id,base_url:base,model:p.model,parameters:view.parameters},'one');assert.equal(reuse.ok,true);
 await assert.rejects(reloaded.call('response_test',{profile_id:p.id,base_url:base+'/other',model:p.model},'one'),/新地址/);
});
test('Matrix tests a catalog model with stored connection and adds it without switching the user model',async t=>{
 const f=await fixture(t),first=await f.service.call('response_test',{base_url:f.base,api_key:'synthetic-only',model:'first'},'matrix');
 const saved=await f.service.call('response_save',{test_id:first.test_id,expected_version:first.version},'matrix');assert.equal(saved.ok,true);
 const c=(await f.service.call('connections')).connections.find(c=>c.base_url===f.base);
 const proof=await f.service.call('response_test',{connection_id:c.id,model:'second'},'matrix');assert.equal(proof.ok,true);
 const added=await f.service.call('response_save',{test_id:proof.test_id,expected_version:proof.version,activate:false},'matrix');assert.equal(added.ok,true,added.errors?.join());
 assert.equal(added.settings.active_profile,saved.model_id);assert.equal(added.settings.matrix_profile,saved.model_id);assert.equal(added.settings.api_profiles.find(p=>p.id===added.model_id).response_verified,true);assert.equal(added.warning,undefined);
});
test('empty/incomplete replies and stale receipts never change configuration',async t=>{
 const f=await fixture(t),p={base_url:f.base,api_key:'synthetic-only',model:'test-model'};const before=fs.readFileSync(f.file,'utf8');
 for(const mode of ['empty','partial','error']){f.mode(mode);const r=await f.service.call('response_test',p,'one');assert.equal(r.ok,false);assert.equal(r.test_id,undefined);assert.equal(fs.readFileSync(f.file,'utf8'),before);}
 f.mode('good');const proof=await f.service.call('response_test',p,'one');fs.appendFileSync(f.file,'\n');const saved=await f.service.call('response_save',{test_id:proof.test_id,expected_version:proof.version},'one');assert.equal(saved.code,'version_conflict');assert.equal(f.calls.length,4);
});
test('Matrix can explicitly verify each supported fallback protocol',async t=>{
 const f=await fixture(t);for(const protocol of ['responses','chat_completions','anthropic_messages','google_generate']){const r=await f.service.call('response_test',{base_url:f.base,api_key:'synthetic-only',model:'test-model',api_protocol:protocol},'matrix');assert.equal(r.ok,true,protocol+JSON.stringify(r));assert.equal(r.api_protocol,protocol);}
 assert.deepEqual(f.calls.map(c=>c.url),['/responses','/chat/completions','/messages','/models/test-model:generateContent']);
});
test('new parameter is probed, persisted, updated and mapped after service restart',async t=>{
 const f=await fixture(t),proof=await f.service.call('response_test',{base_url:f.base,api_key:'synthetic-only',model:'test-model'},'matrix');let r=await f.service.call('response_save',{test_id:proof.test_id,expected_version:proof.version},'matrix');assert.equal(r.ok,true);
 const id=r.model_id,descriptor={key:'adaptive_depth',type:'integer',min:1,max:5,wire_path:['reasoning','adaptive_depth'],source:'synthetic test provider descriptor'};
 r=await f.service.call('parameters_probe',{id,expected_version:r.version,parameters:['adaptive_depth'],descriptors:[descriptor]},'matrix');assert.equal(r.ok,true,r.errors?.join());assert.equal(r.probe.requests,2);assert.equal(r.probe.semantic_support,'not_proven');assert.equal(f.calls.at(-1).body.reasoning.adaptive_depth,1);
 const restarted=createSystemSettings(f.file),read=await restarted.call('read',{},'matrix');r=await restarted.call('model_update',{id,parameters:{adaptive_depth:4},expected_version:read.version},'matrix');assert.equal(r.ok,true,r.errors?.join());const settings=cfg.load(f.file).settings;
 assert.equal(spec.buildRequest(settings,[{role:'user',content:'hello'}],false).reasoning.adaptive_depth,4);
 const bad={...descriptor,key:'injection',wire_path:['messages']};await assert.rejects(restarted.call('parameters_probe',{id,expected_version:r.version,parameters:['injection'],descriptors:[bad]},'matrix'),/映射/);
 assert.equal(f.calls.length,3,'rejected mapping must never send');
});
test('basic DeepSeek effort, sampling rules and evolving mappings stay independent',()=>{
 const {draftProfile,visibleParameters}=require('../host/connection.cjs');
 for(const model of ['deepseek-flash','deepseek-v4-pro']){const p=draftProfile({base_url:'https://api.deepseek.com',model});assert.deepEqual(caps.forProfile(p).find(f=>f.key==='reasoning_effort').values,['none','low','high','max']);assert.equal(visibleParameters(p).max_tokens,'');}
 const d=require('../src/parameter-descriptors.cjs');for(const wire_path of [['authorization'],['model'],['reasoning','effort'],['generationConfig','maxOutputTokens'],['text','format'],['__proto__','x']])assert.throws(()=>d.validate({key:'bad',type:'boolean',wire_path,source:'test source'}));
 for(const protocol of ['responses','chat_completions','anthropic_messages','google_generate']){
  const field={key:'adaptive_depth',type:'integer',min:1,max:5,wire_path:protocol==='google_generate'?['generationConfig','adaptiveDepth']:['thinking','adaptive_depth'],source:'test provider'};
  const p={id:'p',provider:'custom',adapter:'openai',api_protocol:protocol,model:'model',parameter_specs:[field],parameters:{model_options:{adaptive_depth:3}}};
  const s={...spec.defaults(),adapter:'openai',base_url:'https://example.test',api_protocol:protocol,active_profile:'p',api_profiles:[p],model_options:{adaptive_depth:3}};
  const body=spec.buildRequest(s,[{role:'user',content:'hello'}],false);assert.equal(field.wire_path.reduce((v,k)=>v[k],body),3);
 }
});
test('task commentary folds without losing final responses; crop remains within source bounds',async()=>{
 const {chatMessages,safeLink}=await import('../ui/markdown.mjs'),{cropBounds}=await import('../ui/avatar.mjs');
 const rows=[{from:'user',id:'1'},{from:'matrix',to:'user',state:'commentary',id:'2'},{from:'matrix',to:'user',state:'completed',id:'3'}];assert.deepEqual(chatMessages(rows).map(m=>m.id),['1','3']);assert.equal(rows.length,3);
 assert.equal(safeLink('javascript:alert(1)'),null);assert.equal(safeLink('file:///secret'),null);assert.match(safeLink('https://example.test/path'),/^https:/);
 for(const [w,h] of [[1200,400],[400,1200],[800,800]])for(const z of [1,2,4]){const b=cropBounds(w,h,z,1e5,-1e5);assert.ok(Object.values(b).every(Number.isFinite));}
});
