// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; http; fs; os; path; spec
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/system-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createService} = require('../src/service.cjs');
const spec = require('../src/spec.cjs');
const {withLegacyProfiles}=require('./pool-fixture.cjs');

for (const protocol of ['responses', 'chat_completions']) test(`${protocol}: discovery, proof, configuration, switching, conflicts and redaction`, async t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aieyra-system-'));
 const file = path.join(dir, 'config.json');
 fs.writeFileSync(file, JSON.stringify(withLegacyProfiles({...spec.defaults(), api_key: 'sk-original-kept', custom: {keep: true}})));
 const requests = [];
 const server = http.createServer(async (req, res) => {
  requests.push(req.url);
  if (req.url === '/v1/models') return res.end(JSON.stringify({data: [{id: 'relay-test'}]}));
  if (req.url !== `/v1/${protocol === 'responses' ? 'responses' : 'chat/completions'}`) { res.writeHead(404); return res.end(); }
  let raw = ''; for await (const c of req) raw += c;
  const body = JSON.parse(raw); assert.equal(body.thinking, undefined); assert.equal(body.model, 'relay-test');
  const tools = body.tools; const fn = protocol === 'responses' ? tools[0] : tools[0].function;
  const token = fn.parameters.properties.token.enum[0];
  if (body.input?.at(-1)?.type === 'function_call_output' || body.messages?.at(-1)?.role === 'tool') {
   if (protocol === 'responses') { assert.equal(body.input.at(-1).call_id, 'probe-call'); return res.end(JSON.stringify({id:'response-2',status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: body.input.at(-1).output}]}]})); }
   assert.equal(body.messages.at(-1).tool_call_id, 'probe-call');
   return res.end(JSON.stringify({choices: [{message: {role: 'assistant', content: body.messages.at(-1).content}, finish_reason: 'stop'}]}));
  }
  if (protocol === 'responses') return res.end(JSON.stringify({id:'response-1',status: 'completed', output: [{type: 'function_call', call_id: 'probe-call', name: fn.name, arguments: JSON.stringify({token})}]}));
  return res.end(JSON.stringify({choices: [{message: {role: 'assistant', content: null, tool_calls: [{id: 'probe-call', type: 'function', function: {name: fn.name, arguments: JSON.stringify({token})}}]}, finish_reason: 'tool_calls'}]}));
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 t.after(async () => {server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(dir, {recursive: true, force: true});});
 const service = createService(file); const call = (action, args) => service.call('system:settings', {action, arguments: args});
 const original = await call('read');
 assert(!JSON.stringify(original).includes('sk-original-kept'));
 const probe = await call('probe', {base_url: `http://127.0.0.1:${server.address().port}`, api_key: 'sk-relay-private', model: 'relay-test'});
 assert.equal(probe.ok, true, JSON.stringify(probe)); assert.equal(probe.api_protocol, protocol); assert(probe.base_url.endsWith('/v1'));
 assert(!JSON.stringify(probe).includes('sk-relay-private'));
 assert.equal((await call('configure', {probe_id: 'invented', id: 'relay', expected_version: original.version})).ok, false);
 const saved = await call('configure', {probe_id: probe.probe_id, id: 'relay', name: 'Relay', context_window: 128000, expected_version: original.version});
 assert.equal(saved.ok, true, JSON.stringify(saved)); assert.equal(saved.settings.model, 'deepseek-flash'); assert.equal(saved.models.length, 3);
 assert(!JSON.stringify(saved).includes('sk-relay-private'));
 assert.equal((await call('switch', {id: 'relay', expected_version: original.version})).code, 'version_conflict');
 const switched = await call('switch', {id: 'relay', expected_version: saved.version}); assert.equal(switched.ok, true); assert.equal(switched.settings.model, 'relay-test'); assert.equal(switched.settings.adapter, 'openai');
 const disk = JSON.parse(fs.readFileSync(file)); assert.equal(disk.api_key, 'sk-relay-private'); assert.equal(disk.provider_connections.find(c=>c.id==='deepseek').api_key, 'sk-original-kept'); assert.deepEqual(disk.custom, {keep: true});
 const updated = await call('update', {patch: {language: 'en-US'}, expected_version: switched.version}); assert.equal(updated.ok, true);
 const boot = service.call('config:bootstrap'); assert.equal(boot.nativeFields.find(f => f.key === 'language').label, 'Interface language'); assert(!JSON.stringify(boot.nativeFields.map(f=>f.label)).match(/[\u4e00-\u9fff]/));
 assert(requests.includes('/v1/models')); assert(requests.filter(x => x.endsWith(protocol === 'responses' ? '/responses' : '/chat/completions')).length >= 2);
});

test('choice cancellation, stale selection and real selection', async t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aieyra-choice-')); const file = path.join(dir, 'config.json');
 t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
 fs.writeFileSync(file, JSON.stringify(withLegacyProfiles({...spec.defaults(), api_key: 'sk-choice-fake'})));
 const old = process.env.AIEYRA_SETTINGS_HOST; process.env.AIEYRA_SETTINGS_HOST = '1'; t.after(() => {if (old === undefined) delete process.env.AIEYRA_SETTINGS_HOST; else process.env.AIEYRA_SETTINGS_HOST = old;});
 const s = createService(file); const call = (action, args) => s.call('system:settings', {action, arguments: args,session_id:'session-a'});
 const answer = async (id,args) => {
  const claim=await s.call('system:choices',{action:'claim',request_id:id,claim:'host-1'}); assert.equal(claim.ok,true);
  assert.equal((await s.call('system:choices',{action:'claim',request_id:id,claim:'host-2'})).ok,false);
  return s.call('system:choices',{action:'answer',request_id:id,claim:'host-1',...args});
 };
 const one = await call('choose_model', {presentation:'interactive'}); assert.equal(one.state, 'pending');
 assert.equal((await s.call('system:settings',{action:'choice_result',arguments:{request_id:one.request_id},session_id:'session-b'})).state,'expired');
 await answer(one.request_id,{cancel:true});
 assert.equal((await call('choice_result', {request_id: one.request_id})).state, 'cancelled');
 const two = await call('choose_model', {presentation:'interactive'}); const baseline = await call('read');
 await call('update', {expected_version: baseline.version, patch: {language: 'en-US'}});
 assert.equal((await answer(two.request_id,{id:'deepseek-v4-pro'})).code, 'version_conflict');
 const three = await call('choose_model', {presentation:'interactive'});
 assert.equal((await answer(three.request_id,{id:'deepseek-v4-pro'})).ok, true);
 assert.equal(JSON.parse(fs.readFileSync(file)).model, 'deepseek-flash');
 assert.equal((await call('read')).settings.model, 'deepseek-v4-pro');
 assert.equal((await s.call('system:settings',{action:'read',session_id:'session-b'})).settings.model,'deepseek-flash');
 const restarted = createService(file);
 assert.equal((await restarted.call('system:settings',{action:'choice_result',arguments:{request_id:three.request_id},session_id:'session-a'})).state,'selected');
 const four=await call('choose_model'); await call('choice_cancel',{request_id:four.request_id});
 assert.equal((await call('choice_result',{request_id:four.request_id})).state,'cancelled');
});

test('display choices cannot claim or save; withdrawing an open choice revokes its stale answer', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-choice-mode-')),file=path.join(dir,'config.json');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(file,JSON.stringify(withLegacyProfiles({...spec.defaults(),api_key:'sk-fake'})));
 const old=process.env.AIEYRA_SETTINGS_HOST;process.env.AIEYRA_SETTINGS_HOST='1';
 t.after(()=>{if(old===undefined)delete process.env.AIEYRA_SETTINGS_HOST;else process.env.AIEYRA_SETTINGS_HOST=old;});
 const s=createService(file),call=(args)=>s.call('system:settings',{action:'choose_model',arguments:args,session_id:'owner'}),choice=(action,args={})=>s.call('system:choices',{action,...args});
 const request=await call({});assert.equal(request.presentation,'display');assert.equal((await choice('pending')).requests.length,0);
 assert.equal((await choice('claim',{request_id:request.request_id,claim:'old'})).ok,false);
 assert.equal((await call({presentation:'interactive'})).request_id,request.request_id);assert.equal((await choice('pending')).requests.length,1);
 assert.equal((await choice('claim',{request_id:request.request_id,claim:'old'})).ok,true);
 const before=fs.readFileSync(file,'utf8');await call({presentation:'display'});
 assert.equal((await choice('status',{request_id:request.request_id,claim:'old'})).state,'expired');
 assert.equal((await choice('answer',{request_id:request.request_id,claim:'old',id:'deepseek-v4-pro'})).ok,false);
 assert.equal(fs.readFileSync(file,'utf8'),before);
 await call({presentation:'interactive'});assert.equal((await choice('claim',{request_id:request.request_id,claim:'new'})).ok,true);
 assert.equal((await choice('answer',{request_id:request.request_id,claim:'old',cancel:true})).ok,false);
 assert.equal((await choice('answer',{request_id:request.request_id,claim:'new',id:'deepseek-v4-pro'})).ok,true);
});
