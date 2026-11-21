// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/opencode-os.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {observe}=require('../src/model-observation.cjs'),{keyFor}=require('../src/runtime-credential.cjs'),caps=require('../src/model-capabilities.cjs'),providers=require('../src/provider-settings.cjs'),spec=require('../src/spec.cjs'),pool=require('../src/model-pool.cjs');
test('OpenCode Chat transport omits names and retains tool identity and source messages',()=>{
 const s={...spec.defaults(),adapter:'openai',base_url:'https://opencode.ai/zen/go/v1',api_protocol:'chat_completions'},messages=[{role:'system',name:'matrix_assignment',content:'instructions'},{role:'tool',name:'exec_command',tool_call_id:'call-1',content:'result'}];
 const wire=spec.buildRequest(s,messages,false);assert.equal(wire.messages[0].name,undefined);assert.equal(wire.messages[1].tool_call_id,'call-1');assert.equal(messages[0].name,'matrix_assignment');
});
test('public thought, summary, encrypted-only and unknown usage remain distinct',async()=>{
 const r=observe('responses',{status:'completed',output:[{type:'reasoning',encrypted_content:'opaque',summary:[{type:'summary_text',text:'summary'}]},{type:'message',content:[{type:'output_text',text:'ok'}]}],usage:{output_tokens_details:{reasoning_tokens:0}}});assert.equal(r.visibility,'summary');assert.equal(r.reasoning_tokens,0);assert.equal(r.encrypted_items,1);assert.ok(!JSON.stringify(r).includes('opaque'));
 const a=observe('anthropic_messages',{stop_reason:'end_turn',content:[{type:'thinking',thinking:'public',signature:'private-signature'}],usage:{output_tokens_details:{thinking_tokens:12}}});assert.equal(a.thought_chars,6);assert.equal(a.reasoning_tokens,12);assert.equal(a.signature_items,1);
 assert.equal(observe('responses',{output:[{type:'reasoning',encrypted_content:'cipher'}]}).visibility,'encrypted_only');assert.equal(observe('chat_completions',{}).reasoning_tokens,null);
 const {observationLabel}=await import('../ui/observation.mjs');assert.match(observationLabel(r),/思考摘要/);assert.match(observationLabel(a),/公开思考文本/);
 const {usageSummary}=await import('../ui/status.mjs');const rows=[{usage:{samples:1,reported:1,complete:true,reasoning_tokens:12,reasoning_reported:1,reasoning_known:true}}];assert.equal(usageSummary(rows).reasoning,12);assert.equal(usageSummary(rows).reasoningComplete,true);rows.push({usage:{samples:1,reported:1,complete:true}});assert.equal(usageSummary(rows).reasoningComplete,false);
});
test('runtime credential requires matching enabled profile, endpoint, protocol and model',()=>{
 const s={active_profile:'p',base_url:'https://opencode.ai/zen/go/v1',api_protocol:'responses',model:'m',api_key:'placeholder'};s.api_profiles=[{id:'p',model:'m',base_url:s.base_url,api_protocol:s.api_protocol,enabled:true}];const env={AIEYRA_RUNTIME_PROFILE:'p',AIEYRA_RUNTIME_PROVIDER_IDENTITY:s.base_url+'|responses|m',AIEYRA_RUNTIME_API_KEY:'synthetic-secret'};
 assert.equal(keyFor(s,env),'synthetic-secret');for(const changed of [{model:'other'},{api_protocol:'chat_completions'},{base_url:'https://elsewhere.invalid'},{active_profile:'other'},{api_profiles:[{...s.api_profiles[0],enabled:false}]}])assert.equal(keyFor({...s,...changed},env),'placeholder');assert.ok(!JSON.stringify(s).includes('synthetic-secret'));
});
test('runtime credential includes the exact API adapter digest',()=>{
 const s={active_profile:'p',base_url:'https://example.test/v1',api_protocol:'responses',model:'m',api_key:'saved',api_profiles:[{id:'p',base_url:'https://example.test/v1',api_protocol:'responses',model:'m',adapter_package:{id:'example.gateway',digest:'a'.repeat(64)}}]};
 const env={AIEYRA_RUNTIME_PROFILE:'p',AIEYRA_RUNTIME_PROVIDER_IDENTITY:s.base_url+'|responses|m',AIEYRA_RUNTIME_API_KEY:'temporary'};
 assert.equal(keyFor(s,env),'saved');env.AIEYRA_RUNTIME_PROVIDER_IDENTITY+='|adapter:example.gateway@'+'a'.repeat(64);assert.equal(keyFor(s,env),'temporary');s.api_profiles[0].adapter_package.digest='b'.repeat(64);assert.equal(keyFor(s,env),'saved');
});

test('saved OpenCode draft reuses only its connection and does not expose the credential',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opencode-draft-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json'),base='https://opencode.ai/zen/go/v1';
 const s=pool.migrate({...spec.defaults(),api_key:'synthetic-deepseek'});s.provider_connections.push({id:'opencode-go',provider:'opencode-go',base_url:base,api_key:'synthetic-go',api_key_history:[],request_timeout_seconds:90});fs.writeFileSync(file,JSON.stringify(s));
 const service=require('../src/system-settings.cjs').createSystemSettings(file),r=await service.call('onboarding_draft',{provider:'opencode-go'},'test');assert.equal(r.connection_id,'opencode-go');assert.equal(r.has_key,true);assert.equal(r.base_url,base);assert.ok(!JSON.stringify(r).includes('synthetic-go'));
 const {savedConnection}=require('../host/connection.cjs');assert.equal(savedConnection(s,{connection_id:'opencode-go'},base).api_key,'synthetic-go');assert.throws(()=>savedConnection(s,{connection_id:'opencode-go'},'https://elsewhere.invalid'),/新地址/);assert.equal(savedConnection(s,{},base),undefined);
});
test('fresh public protocol metadata overrides bundle; OpenCode toggles map only on official host',()=>{
 const metadata=providers.convertMetadata({'opencode-go':{npm:'@ai-sdk/anthropic',models:{'gpt-5.6-luna':{id:'gpt-5.6-luna',limit:{context:100000,output:10000},tool_call:true}}}});assert.equal(metadata['opencode-go']['gpt-5.6-luna'].api_protocol,'anthropic_messages');
 providers.applyZenPublic(metadata,'<table><tr><td>GPT</td><td>gpt-5.6-luna</td><td>https://opencode.ai/zen/go/v1/responses</td></tr></table>','opencode-go');assert.equal(metadata['opencode-go']['gpt-5.6-luna'].api_protocol,'responses');
 const row=providers.normalizeCatalog('opencode-go',{data:[{id:'longcat-2.0'}]})[0];assert.ok(row.parameter_specs.some(f=>f.key==='reasoning_enabled'));
 for(const enabled of [true,false]){const s={adapter:'openai',base_url:'https://opencode.ai/zen/go/v1',api_protocol:'chat_completions',model_options:{reasoning_enabled:enabled}};assert.equal(caps.apply(s,{}).thinking.type,enabled?'enabled':'disabled');assert.equal(caps.apply({...s,base_url:'https://other.invalid'},{}).thinking,undefined);}
});
