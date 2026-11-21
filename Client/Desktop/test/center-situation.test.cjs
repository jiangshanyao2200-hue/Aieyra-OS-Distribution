// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; features; ready; row; health
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/center-situation.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCenterProgram}=require('../../../Program/official/center/service.cjs');
const {createHealthModel}=require('../../../Program/official/center/health-model.cjs');

const features={
 cpu_percent:{min:0,max:100,minSpread:3,direction:'high'},
 memory_percent:{min:0,max:100,minSpread:2,direction:'high'},
 disk_free_percent:{min:0,max:100,minSpread:2,direction:'low'},
};
const ready={
 readCore:()=>({ready:true,roles:[]}),
 readPrograms:()=>[],
 readBrowser:()=>({count:0}),
 readLink:()=>({available:true,checked_at:new Date().toISOString()}),
 readLinkBoard:()=>({seats:[],briefs_available:true}),
 updates:()=>({enabled:true,integrity:{phase:'checked',consistent:3,different:0,unknown:0}}),
};
const row=(situation,id)=>situation.dimensions.find(dimension=>dimension.id===id);
const health=async program=>(await program.user({action:'health'})).situation;

test('Center leaves missing data blank and expires even previously complete resource readings',async()=>{
 const unavailable=await health(createCenterProgram({}));
 assert.equal(unavailable.tone,'unknown');
 assert.ok(unavailable.dimensions.every(dimension=>dimension.value===null&&dimension.tone==='unknown'));

 let time=1000;
 const model=createHealthModel({features,clock:()=>time,staleAfterMs:100});
 const program=createCenterProgram({...ready,model});
 model.observe({cpu_percent:0});
 const warm=await health(program);
 assert.equal(row(warm,'cpu').value,100);
 assert.equal(row(warm,'cpu').tone,'online');
 assert.equal(row(warm,'memory').value,null);
 assert.equal(row(warm,'verification').value,null);
 assert.equal(warm.tone,'unknown');
 assert.equal(warm.message,'我的部分状态待确认');

 time+=101;
 const stale=await health(program);
 assert.equal(row(stale,'cpu').value,null);
 assert.equal(row(stale,'cpu').tone,'unknown');
 assert.equal(model.report().quality.observations,1);
});

test('Center gives known failures precedence over missing coverage and resource pressure',async()=>{
 const model=createHealthModel({features});
 model.observe({cpu_percent:97,memory_percent:94,disk_free_percent:6});
 let integrity={phase:'checked',consistent:2,different:1,unknown:1};
 const program=createCenterProgram({...ready,model,updates:()=>({enabled:true,integrity})});
 const result=await health(program);
 assert.equal(result.tone,'attention');
 assert.equal(result.message,'我的文件存在校验差异');
 assert.deepEqual(row(result,'integrity'),{
  id:'integrity',label:'文件完整性',value:50,tone:'attention',status:'上次校验 2/4 个模块一致 · 1 个待核实',
 });

 integrity={phase:'unavailable'};
 const pressure=await health(program);
 assert.equal(pressure.message,'我的存储余量偏低');
 assert.equal(row(pressure,'disk').value,6);
 assert.equal(row(pressure,'memory').value,6);
 assert.equal(row(pressure,'cpu').value,3);
});

test('Center reports a learned deviation only after the model has established a baseline',async()=>{
 const model=createHealthModel({features});
 const program=createCenterProgram({...ready,model});
 model.observe({cpu_percent:45});
 assert.equal(row(await health(program),'cpu').tone,'online');
 for(let sample=0;sample<12;sample++)model.observe({cpu_percent:10});
 model.observe({cpu_percent:45});
 const result=await health(program);
 assert.equal(result.tone,'attention');
 assert.equal(result.message,'我的处理器余量低于基线');
 assert.equal(row(result,'cpu').value,55);
});

test('user and Agent share the observed situation without invoking the independent sampler again',async t=>{
 let hostReads=0,coreReads=0;
 const model=createHealthModel();
 const program=createCenterProgram({...ready,model,
  readCore:()=>{coreReads++;return ready.readCore();},
  sampleHost:()=>{
   hostReads++;
   return {hardware:{cpu:{utilizationPercent:1},memory:{usedPercent:20},disk:{totalBytes:100,availableBytes:70}}};
  },
  readDiagnostics:()=>({verification:{
   background:{status:'passed',passed:5,total:5},
   foreground:{status:'failed',passed:3,total:4},
  }}),
 });
 t.after(()=>program.shutdown());

 const telemetry=await program.invoke('telemetry');
 const before=coreReads;
 const [user,agent]=await Promise.all([health(program),program.invoke('health')]);
 assert.equal(coreReads,before+1);
 assert.deepEqual(user,agent.situation);
 assert.deepEqual(user,telemetry.system.situation);
 assert.equal(user.message,'我的前台验证发现问题');
 assert.equal(row(user,'verification').value,88);
 assert.match(row(user,'verification').status,/8\/9 项通过/);
 assert.equal(hostReads,1);
 assert.equal(model.report().quality.observations,1);
});

test('Center waits for current Link observations and completed verification in both lanes',async t=>{
 const now=Date.now();
 const model=createHealthModel();
 let link={available:true,checked_at:new Date(now-120000).toISOString()};
 const program=createCenterProgram({...ready,model,readLink:()=>link,
  sampleHost:()=>({hardware:{cpu:{utilizationPercent:1},memory:{usedPercent:20},disk:{totalBytes:100,availableBytes:70}}}),
  readDiagnostics:()=>({verification:{
   background:{status:'passed',passed:5,total:5},
   foreground:{status:'stopped',passed:1,total:4},
  }}),
 });
 t.after(()=>program.shutdown());
 const {system:{situation}}=await program.invoke('telemetry');
 assert.equal(situation.tone,'unknown');
 assert.equal(row(situation,'link').value,null);
 assert.equal(row(situation,'verification').value,null);
 assert.match(row(situation,'verification').status,/前台 已停止/);

 link={available:false,installed:true,service_state:'offline',checked_at:new Date(now).toISOString()};
 const offline=await health(program);
 assert.equal(row(offline,'link').value,50);
 assert.equal(offline.message,'我的 Link 对外连接异常');
});
