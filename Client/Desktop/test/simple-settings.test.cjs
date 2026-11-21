// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: cfg; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/simple-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const cfg=require('../src/config.cjs'),spec=require('../src/spec.cjs'),{createSystemSettings}=require('../src/system-settings.cjs');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-settings-')),file=path.join(dir,'config.json'),calls=[];
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;calls.push({url:req.url,key:req.headers.authorization,body:body?JSON.parse(body):null});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.endsWith('/models')?{data:[{id:'gpt-6-astra'},{id:'gemini-3.8-flash'},{id:'grok-4.7'}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Connected.'}]}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 fs.writeFileSync(file,JSON.stringify({...spec.defaults(),model_pool_version:1}));return {file,calls,base:'http://127.0.0.1:'+server.address().port,service:createSystemSettings(file)};
}
test('human source caches persist without switching model and replace only their own key',async t=>{
 const f=await fixture(t),p={user_slot:'custom',base_url:f.base,api_key:'first-key',model:'gpt-6-astra'};
 await f.service.call('onboarding_catalog',p,'human');assert.equal(cfg.load(f.file).settings.active_profile,'');
 const restarted=createSystemSettings(f.file),draft=await restarted.call('onboarding_draft',{user_slot:'custom'});assert.equal(draft.has_key,true);assert.equal(draft.models.length,3);assert.equal(draft.base_url,f.base);assert.ok(!JSON.stringify(draft).includes('first-key'));
 let proof=await restarted.call('onboarding_test',{...p,api_key:'',parameters:{reasoning_effort:'high'}},'human');assert.equal(proof.ok,true,JSON.stringify(proof));
 let saved=await restarted.call('onboarding_save',{test_id:proof.test_id,expected_version:proof.version},'human');assert.equal(saved.ok,true,JSON.stringify(saved.errors));assert.equal(cfg.load(f.file).settings.api_key,'first-key');
 await restarted.call('onboarding_catalog',{...p,api_key:'new-key'},'human');assert.equal(cfg.load(f.file).settings.api_key,'first-key','fetching drafts cannot activate a replacement');
 proof=await restarted.call('onboarding_test',{...p,api_key:''},'human');saved=await restarted.call('onboarding_save',{test_id:proof.test_id,expected_version:proof.version},'human');assert.equal(saved.ok,true,JSON.stringify(saved.errors));
 const s=cfg.load(f.file).settings;assert.equal(s.api_key,'new-key');assert.deepEqual(s.provider_connections.find(c=>c.id==='user-custom').api_key_history,['new-key']);assert.equal(f.calls.at(-1).key,'Bearer new-key');
});
test('agent same-URL credentials stay independent through catalog, test, save and restart',async t=>{
 const f=await fixture(t);let state=await f.service.call('read');
 for(const id of ['team-a','team-b']){state=await f.service.call('connection_update',{connection_id:id,provider:'custom',patch:{name:id,base_url:f.base,api_key:id+'-secret'},expected_version:state.version});assert.equal(state.ok,true,JSON.stringify(state.errors));}
 const proofs=[];for(const id of ['team-a','team-b']){
  const catalog=await f.service.call('catalog',{connection_id:id,refresh:true});assert.equal(catalog.models.length,3);
  const p=await f.service.call('response_test',{connection_id:id,model:'gpt-6-astra'},'agent');assert.equal(p.ok,true);const s=await f.service.call('response_save',{test_id:p.test_id,expected_version:p.version,activate:false},'agent');assert.equal(s.ok,true,JSON.stringify(s.errors));proofs.push(s.model_id);
 }
 assert.notEqual(...proofs);const s=cfg.load(f.file).settings;assert.equal(s.active_profile,'');assert.equal(s.api_profiles.length,2);assert.deepEqual(s.api_profiles.map(m=>m.connection_id),['team-a','team-b']);assert.deepEqual(f.calls.filter(c=>c.url==='/responses').map(c=>c.key),['Bearer team-a-secret','Bearer team-b-secret']);
 const restarted=createSystemSettings(f.file),list=await restarted.call('connections');assert.equal(list.connections.length,2);assert.ok(!JSON.stringify(list).includes('-secret'));
 await assert.rejects(restarted.call('connection_remove',{connection_id:'team-a',expected_version:list.version}),/模型池/);
});
test('official provider connections can use two independent keys without collapsing IDs',async t=>{
 const f=await fixture(t);let state=await f.service.call('read');for(const id of ['go-personal','go-work'])state=await f.service.call('connection_update',{connection_id:id,provider:'opencode-go',patch:{api_key:id},expected_version:state.version});assert.equal(state.ok,true);
 const s=cfg.load(f.file).settings,p=require('../src/provider-settings.cjs').createProviderSettings(undefined,f.file);for(const id of ['go-personal','go-work']){const d=p.select(s,s,'opencode-go',id);assert.equal(d.__connection_id,id);assert.equal(d.api_key,id);assert.ok(p.prepare(s,d).provider_connections.some(c=>c.id===id&&c.api_key===id));}
});
test('GPT Gemini and Grok expose model-specific effort and map actual request bodies',()=>{
 const draft=require('../host/connection.cjs').draftProfile,caps=require('../src/model-capabilities.cjs');
 for(const [model,protocol,effort]of [['gpt-6-astra','responses','max'],['gemini-3.8-flash','google_generate','medium'],['grok-4.7','responses','xhigh']]){
  const p=draft({base_url:'https://relay.invalid/v1',model,api_protocol:protocol,parameters:{reasoning_effort:effort}}),body=spec.buildRequest({...spec.defaults(),...p.parameters,adapter:p.adapter,api_protocol:protocol,base_url:p.base_url,model},[{role:'user',content:'test'}],false);
  assert.equal(protocol==='google_generate'?body.generationConfig.thinkingConfig.thinkingLevel:body.reasoning.effort,protocol==='google_generate'?effort.toUpperCase():effort);
 }
 assert.ok(!caps.specs('custom',{id:'gpt-6-astra',api_protocol:'responses'}).find(f=>f.key==='reasoning_effort').values.includes('none'));
 // Pinned 2026-11-02 community reference adds xhigh; this is a selectable
 // reference value, not a default selection or relay semantic verification.
 assert.deepEqual(caps.specs('custom',{id:'grok-4.5',api_protocol:'responses'}).find(f=>f.key==='reasoning_effort').values,['low','medium','high','xhigh']);
 assert.equal(require('../src/model-catalog.cjs').nativeReference('grok-4.5').reference_source.kind,'community_reference');
 const stored=draft({base_url:'https://relay.invalid/v1',model:'grok-4.5',api_protocol:'responses'});stored.parameter_specs=[{key:'reasoning_effort',type:'enum',values:['low','medium','high']}];
 assert.deepEqual(caps.forProfile(stored).find(f=>f.key==='reasoning_effort').values,['low','medium','high']);
});
test('global login material never appears in Agent read results',async t=>{
 const f=await fixture(t),s=cfg.load(f.file);s.settings.official_account={user:{id:'1',name:'Fixture'},selected_token_id:'7',session_cookies:[{name:'session',value:'private-cookie',domain:'api.aieyra.cn'}]};cfg.save(f.file,s.settings,s.version);const r=await f.service.call('read');assert.equal(r.settings.official_account.has_session,true);assert.ok(!JSON.stringify(r).includes('private-cookie'));
});
