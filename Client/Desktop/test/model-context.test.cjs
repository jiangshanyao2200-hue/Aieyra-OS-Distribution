// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/model-context.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 连接与账号 · 模型（E1）：列表短注只写确认过的事；上下文拉条的数值规则与后端（src/model-catalog.cjs）一致。
const test=require('node:test'),assert=require('node:assert/strict');

test('manual compact slider spans 10K through 1M with usable 20K position',async()=>{
 const m=await import('../ui/model-context.mjs');assert.equal(m.compactValue(0),10000);assert.equal(m.compactValue(1000),1000000);assert.equal(m.compactPosition(10000),0);assert.equal(m.compactPosition(1000000),1000);assert.equal(m.compactValue(m.compactPosition(20000)),20000);
 let previous=0;for(let p=0;p<=1000;p++){const v=m.compactValue(p);assert(v>=previous&&v>=10000&&v<=1000000);previous=v;}
});

test('tokens read as K/M and sliders snap to two-digit even or five values, stopping on official values', async()=>{
 const m=await import('../ui/model-context.mjs');
 assert.deepEqual([8192,131072,200000,600000,1000000,1048576,2097152,6144].map(m.formatTokens),['8K','128K','200K','600K','1M','1M','2M','6K']);
 assert.deepEqual([868576,2192,4260000].map(m.formatTokens),['869K','2K','4.26M']);
 assert.deepEqual([6800,7400,9000,13600,600400,4600,131000,812345,4262000].map(m.snapNice),[6000,8000,8000,14000,600000,5000,140000,820000,4200000]);
 assert.equal(m.snapCompact(0,{max:796000}),0);assert.equal(m.snapCompact(1000,{max:796000}),796000);
 assert.equal(m.snapCompact(754,{max:796000,magnets:[600000]}),600000);
});

test('model notes only state confirmed facts; unknown catalog values stay silent', async()=>{
 const m=await import('../ui/model-context.mjs');
 const unknown={id:'gemini-3-flash',tier:'主流',context_window:8192,context_window_source:'conservative_client_budget',tool_calls:false,catalog_context_window:null,catalog_tool_calls:null,catalog_vision:null,reference_only:true,summary_zh:'网关Gemini模型，协议与思考参数待验证'};
 assert.equal(m.modelNote(unknown),'参考');assert.equal(m.officialWindow(unknown),null);
 assert.match(m.modelFacts(unknown),/^网关Gemini模型.*离线参考资料/);assert.doesNotMatch(m.modelFacts(unknown),/工具|看图|上下文/);
 const known={id:'qwen',tier:'主流',catalog_context_window:1000000,catalog_max_output:65536,catalog_tool_calls:true,catalog_vision:true,summary_zh:'旗舰'};
 assert.equal(m.modelNote(known),'1M · 工具 · 看图');assert.equal(m.modelFacts(known),'旗舰 · 上下文上限 1M · 最多输出 64K · 能调用工具 · 能看图');
 // 没有目录资料的供应商（例如 DeepSeek 官方列表）：供应商自己声明的窗口和工具调用算确认过的。
 assert.equal(m.modelNote({id:'deepseek-v4-flash',context_window:1000000,tool_calls:true,free:true}),'1M · 工具 · 免费');
 // 有档次的行：供应商列表自己声明的窗口也算确认过的（Aieyra 网关的 /models 会给）。
 assert.equal(m.officialWindow({id:'gemini-3-flash',tier:'主流',context_window:1048576,catalog_context_window:null}),1048576);
 assert.equal(m.officialWindow({context_window:128000,context_limit:128000,catalog_context_window:1048576}),128000);
 assert.equal(m.officialWindow({context_window:64000,context_limit:null,context_window_source:'user_config',catalog_context_window:null}),null);
});

test('every 1K target survives logarithmic position round trips without a save jump',async()=>{
 const m=await import('../ui/model-context.mjs');for(let value=10000;value<=1000000;value+=1000)assert.equal(m.compactValue(m.compactPosition(value)),value);
});

test('manual track clamps display positions without changing capacity-based presets',async()=>{
 const m=await import('../ui/model-context.mjs');assert.equal(m.compactPosition(0),0);assert.equal(m.compactPosition(2000000),1000);
 for(const context_limit of [8192,128000,1000000,4000000]){
  const presets=m.contextPresets({context_limit});assert.equal(presets.at(-1).value,Math.min(2000000,Math.floor(context_limit*.8/1000)*1000));
  assert(presets.every(p=>p.value<=context_limit*.8));
  assert.equal(m.compactValue(0),10000);assert.equal(m.compactValue(1000),1000000);
 }
});
