// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; pool
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/image-capabilities.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {supportsImages}=require('../src/image-capabilities.cjs');
const pool=require('../src/model-pool.cjs');
test('百炼图片能力只启用已识读的精确模型、协议及官方端点',()=>{
 const p={model:'qwen3.8-flash',base_url:'https://fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',api_protocol:'chat_completions',adapter:'openai',vision:false};
 const credentialed=new URL(p.base_url);credentialed.username='fixture';
 for(const base_url of [p.base_url,p.base_url+'/',p.base_url.replace('cn-beijing','ap-southeast-1'),'https://dashscope.aliyuncs.com/compatible-mode/v1','https://dashscope-intl.aliyuncs.com:443/compatible-mode/v1'])assert.equal(supportsImages({...p,base_url}),true,base_url);
 for(const patch of [{model:'qwen3.8-max',vision:true},{api_protocol:'responses'},{api_protocol:'anthropic_messages'},{adapter:'deepseek'},...[
  'http://fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  'https://fixture.cn-beijing.maas.aliyuncs.com.evil.test/compatible-mode/v1',
  'https://fixture.cn-beijing.maas.aliyuncs.com:8443/compatible-mode/v1',
  credentialed.href,
  'https://dashscope.aliyuncs.com/compatible-mode/v1?route=other',
  'https://dashscope.aliyuncs.com/compatible-mode/v1#other',
  'https://dashscope.aliyuncs.com/api/v1',
  'https://bad_region.maas.aliyuncs.com/compatible-mode/v1',
  'https://dashscope.aliyuncs.com/compatible-mode%2fv1'
 ].map(base_url=>({base_url}))])assert.equal(supportsImages({...p,...patch}),false,JSON.stringify(patch));
 assert.equal(pool.activate({api_profiles:[p]},p).model_vision,true);assert.equal(p.vision,false);
});
test('图片能力按实际模型/入口/协议识别，内存迁移不改原配置',()=>{
 for(const model of ['deepseek-v4-flash-vision-exp','mimo-v2.6-flash']){
  const p={id:'go',model,base_url:'https://opencode.ai/zen/go/v1',api_protocol:'chat_completions',adapter:'openai',vision:false};
  assert.equal(supportsImages(p),true);
  const input={model_pool_version:1,api_profiles:[p],matrix_profile:'muse',active_profile:'muse'};
  const migrated=pool.migrate(input);
  assert.equal(migrated.api_profiles[0].vision,true);assert.equal(p.vision,false);assert.equal(migrated.matrix_profile,'muse');
  assert.equal(pool.activate(input,p).model_vision,true);
  for(const patch of [{model:'Muse',vision:true},{api_protocol:'responses'},{api_protocol:'anthropic_messages'},{base_url:'https://opencode.ai/zen/v1'},{base_url:'http://127.0.0.1:9999'}])assert.equal(supportsImages({...p,...patch}),false);
 }
 assert.equal(supportsImages({model:'deepseek-flash',api_protocol:'responses',adapter:'deepseek'}),true);
 assert.equal(supportsImages({model:'deepseek-flash',api_protocol:'chat_completions',adapter:'deepseek'}),false);
});
