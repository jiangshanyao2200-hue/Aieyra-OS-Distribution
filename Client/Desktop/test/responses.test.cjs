// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; http; fs; os; path; spec; api; config
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/responses.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const spec=require('../src/spec.cjs');
const api=require('../src/api.cjs');
const config=require('../src/config.cjs');

test('Responses 默认字段、显式 Chat 兼容和配置保留',()=>{
 const s={...spec.defaults(),api_key:'sk-test',max_tokens:8192};
 const body=spec.buildRequest(s,[{role:'user',content:'question'}],true);
 assert.equal(body.reasoning.effort,spec.defaults().reasoning_effort);assert.equal(body.max_output_tokens,8192);assert.equal(body.input[0].content,'question');
 for(const field of ['messages','thinking','reasoning_effort','max_tokens','stream_options'])assert.equal(field in body,false);
 const chat=spec.buildRequest({...s,api_protocol:'chat_completions'},[{role:'user',content:'question'}],true);
 assert.equal(chat.max_tokens,8192);assert.equal(chat.messages[0].content,'question');assert.equal(chat.stream_options.include_usage,true);
 assert.equal(api.endpointOf('https://api.deepseek.com/v1/responses'),'https://api.deepseek.com/responses');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-responses-'));
 try{const file=path.join(tmp,'config.json');fs.writeFileSync(file,JSON.stringify({custom_preserved:'retained'}));config.save(file,{...s,api_protocol:'chat_completions'});const loaded=config.load(file).settings;assert.equal(loaded.api_protocol,'chat_completions');assert.equal(loaded.custom_preserved,'retained');}finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('旧OpenCode摘要请求与CORE镜像一致，保留版本、协议、供应商和显式值边界',()=>{
 for(const [name,version,base,protocol,explicit,want] of [
  ['legacy',0,'https://opencode.ai/zen/go/v1','responses',undefined,'auto'],
  ['missing_version',undefined,'https://opencode.ai/zen/go/v1','responses',undefined,'auto'],
  ['provider_default',1,'https://opencode.ai/zen/go/v1','responses',undefined,undefined],
  ['legacy_explicit',0,'https://opencode.ai/zen/go/v1','responses','concise','concise'],
  ['v1_explicit',1,'https://opencode.ai/zen/go/v1','responses','detailed','detailed'],
  ['other_provider',0,'https://relay.example/v1','responses',undefined,undefined],
  ['similar_host',0,'https://opencode.ai.relay.example/v1','responses',undefined,undefined],
  ['chat',0,'https://opencode.ai/zen/go/v1','chat_completions',undefined,undefined],
 ]){
  const s={...spec.defaults(),adapter:'openai',model:'muse-spark-1.3-contributor',api_key:'sk-test',model_pool_version:version,base_url:base,api_protocol:protocol,model_options:{reasoning_effort:'high'}};
  if(explicit!==undefined)s.model_options.reasoning_summary=explicit;
  const before=structuredClone(s),body=spec.buildRequest(s,[{role:'user',content:'synthetic'}],true);
  assert.equal(body.reasoning?.summary,want,name);assert.deepEqual(s,before,name+' must not mutate configuration');
 }
});

test('测试连接按协议发出最小请求，拒绝失败的 Responses',async()=>{
 const requests=[];let status='completed';
 const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;requests.push({url:req.url,body:JSON.parse(body)});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/responses'?{id:'test-response',status,output:[]}:{choices:[{message:{role:'assistant',content:'hi'},finish_reason:'stop'}]}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const settings={...spec.defaults(),api_key:'sk-test',base_url:`http://127.0.0.1:${server.address().port}`};
  assert.equal((await api.ping(settings)).ok,true);
  assert.equal(requests[0].url,'/responses');assert.equal(requests[0].body.max_output_tokens,1);assert.equal(requests[0].body.reasoning.effort,'none');assert.equal(requests[0].body.stream,false);
  await api.ping({...settings,api_protocol:'chat_completions'});assert.equal(requests[1].url,'/chat/completions');assert.equal(requests[1].body.max_tokens,1);
  status='incomplete';assert.equal((await api.ping(settings)).ok,true);
  status='failed';await assert.rejects(api.ping(settings),/有效终止状态/);
  status='completed';await api.ping({...settings,adapter:'openai',model:'relay-model',model_context_window:128000});
  const generic=requests.at(-1).body;assert.equal(generic.max_output_tokens,1024);assert.equal('reasoning' in generic,false);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
