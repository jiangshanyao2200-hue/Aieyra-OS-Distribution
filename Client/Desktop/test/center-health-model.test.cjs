// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; fs; os; path; specs; writeJson; context
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/center-health-model.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {inspectJson,atomicWriteBytesAsync}=require('../host/json-storage.cjs');
const {createHealthModel}=require('../../../Program/official/center/health-model.cjs');

const specs={
 cpu_percent:{min:0,max:100,minSpread:1,direction:'high'},
 fps:{min:0,max:500,minSpread:2,direction:'low'}
};
const writeJson=(file,value)=>atomicWriteBytesAsync(file,JSON.stringify(value)+'\n');
const context=id=>({build_id:id.repeat(32),source:'eyra.center'});

test('calibration resists a spike and later anomalies leave the learned baseline intact',()=>{
 const model=createHealthModel({features:specs});
 assert.equal(model.report().state,'unobserved');
 for(let step=0;step<12;step++)model.observe({cpu_percent:step===4?91:10+step%3,fps:60});
 const before=model.report();
 assert.equal(before.state,'learning');
 assert.equal(before.features.cpu_percent.baseline,11);
 const spike=model.observe({cpu_percent:98,fps:14});
 assert.equal(spike.state,'attention');
 assert.equal(spike.quality.anomalous_now,2);
 for(const name of Object.keys(specs)){
  assert.equal(spike.features[name].baseline,before.features[name].baseline);
  assert.equal(spike.features[name].samples,12);
  assert.ok(spike.features[name].score>=4.5);
 }
 const recovery=model.observe({cpu_percent:12,fps:61});
 assert.equal(recovery.state,'learning');
 assert.equal(recovery.quality.anomalous_now,0);
 assert.equal(recovery.features.cpu_percent.samples,13);
 assert.ok(recovery.features.cpu_percent.baseline>before.features.cpu_percent.baseline);
});

test('missing and rejected features never become zeroes or stay fresh indefinitely',()=>{
 let time=1000;
 const model=createHealthModel({features:specs,clock:()=>time,staleAfterMs:100});
 const origin={build_id:'03d19dedb49d4ecb9a2b6220ab890430',source:'desktop-sampler',secret:'PRIVATE'};
 const first=model.observe({cpu_percent:0,fps:NaN,unconfigured:42},origin);
 assert.equal(first.state,'warming_up');
 assert.equal(first.features.cpu_percent.last,0);
 assert.equal(first.features.fps.last,null);
 assert.equal(first.quality.accepted,1);
 assert.equal(first.quality.rejected,2);
 assert.equal(first.quality.missing,1);
 assert.deepEqual(first.provenance,{build_id:origin.build_id,source:origin.source});
 time+=101;
 const stale=model.report();
 assert.equal(stale.state,'unobserved');
 assert.equal(stale.features.cpu_percent.last,null);
 assert.equal(stale.features.cpu_percent.samples,1);
 assert.equal(stale.quality.fresh,0);
});

test('valid checkpoints restore calibration without claiming previous samples as current',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'aieyra-center-health-'));
 const file=path.join(directory,'model.json');
 t.after(async()=>{await fs.rm(file,{force:true});await fs.rmdir(directory);});
 let time=2000;
 const options={features:specs,file,readJson:inspectJson,writeJson,clock:()=>time};
 const first=createHealthModel(options);
 for(let step=0;step<11;step++){time++;first.observe({cpu_percent:40+step%2});}
 const receipt=await first.close();
 assert.equal(receipt.storage.status,'ready');
 const saved=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(saved.features.cpu_percent.samples,11);
 assert.equal(saved.features.cpu_percent.last,undefined);
 const second=createHealthModel(options);
 assert.equal(second.report().storage.restored,true);
 assert.equal(second.report().state,'unobserved');
 assert.equal(second.report().features.cpu_percent.last,null);
 assert.equal(second.observe({cpu_percent:41}).features.cpu_percent.baseline,40.5);
 await second.close();
});

test('async checkpoint writes are throttled and closing waits for the latest generation',async()=>{
 let settle;
 const gate=new Promise(resolve=>{settle=resolve;});
 const values=[];
 const model=createHealthModel({file:'model.json',clock:()=>9000,readJson:()=>({status:'missing'}),
  async writeJson(_file,value){values.push(value);if(values.length===1)await gate;}});
 model.observe({cpu_percent:21});
 model.observe({cpu_percent:22});
 const closed=model.close();
 await Promise.resolve();
 assert.equal(values.length,1);
 assert.equal(values[0].features.cpu_percent.samples,1);
 settle();
 await closed;
 assert.equal(values.length,2);
 assert.equal(values[1].features.cpu_percent.samples,2);
 assert.equal(model.observe({cpu_percent:23}).features.cpu_percent.samples,2);
});

test('an invalid saved checkpoint remains untouched while the model observes in memory',async()=>{
 let writes=0;
 const model=createHealthModel({file:'model.json',readJson:()=>({status:'valid',value:{schema:'future/2'}}),
  writeJson:()=>{writes++;}});
 model.observe({fps:55});
 assert.equal((await model.close()).storage.status,'invalid');
 assert.equal(writes,0);
});

test('build changes, missing attribution and different samplers never borrow the current baseline',()=>{
 const model=createHealthModel({features:specs});
 for(let step=0;step<12;step++)model.observe({cpu_percent:20,fps:60},context('a'));
 const update=model.observe({cpu_percent:86},context('b'));
 assert.equal(update.state,'warming_up');
 assert.equal(update.baseline_scope,'build');
 assert.equal(update.features.cpu_percent.samples,1);
 assert.equal(update.features.fps.last,null);
 assert.deepEqual(update.retained_baselines[0].provenance,context('a'));
 const missing=model.observe({cpu_percent:97},{source:'eyra.center'});
 assert.equal(missing.baseline_scope,'unattributed');
 assert.equal(missing.features.cpu_percent.samples,1);
 const changedSampler=model.observe({cpu_percent:38},{...context('a'),source:'alternate-sampler'});
 assert.equal(changedSampler.features.cpu_percent.samples,1);
 const original=model.observe({cpu_percent:21},context('a'));
 assert.equal(original.state,'learning');
 assert.equal(original.features.cpu_percent.samples,13);
 assert.equal(original.features.fps.last,null);
 assert.deepEqual(original.training_provenance,context('a'));
});

test('48 simulated hours and two restarts preserve compatible learning and bounded recent build history',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'aieyra-center-health-history-'));
 const file=path.join(directory,'model.json');
 t.after(async()=>{await fs.rm(file,{force:true});await fs.rmdir(directory);});
 let time=1_000_000;
 const options={features:specs,file,readJson:inspectJson,writeJson,clock:()=>time};
 const first=createHealthModel(options);
 for(let minute=0;minute<1440;minute++){
  time+=60_000;
  first.observe({cpu_percent:20+minute%3,fps:60},context('a'));
 }
 await first.close();
 const second=createHealthModel(options);
 assert.equal(second.report().storage.restored,true);
 assert.equal(second.report().features.cpu_percent.samples,1440);
 assert.equal(second.report().features.cpu_percent.last,null);
 for(let minute=0;minute<1440;minute++){
  time+=60_000;
  second.observe({cpu_percent:21+minute%3,fps:60},context('a'));
 }
 assert.equal(second.report().features.cpu_percent.samples,2880);
 for(const id of ['b','c','d'])second.observe({cpu_percent:35},context(id));
 const recent=second.observe({cpu_percent:23},context('a'));
 assert.equal(recent.features.cpu_percent.samples,2881);
 second.observe({cpu_percent:45},context('e'));
 await second.close();
 const saved=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(saved.checkpoint_version,2);
 assert.equal(saved.retained.length,3);
 assert.ok(JSON.stringify(saved).length<128*1024);
 const third=createHealthModel(options);
 assert.equal(third.report().storage.restored,true);
 assert.deepEqual(third.report().training_provenance,context('e'));
 assert.equal(third.report().retained_baselines.some(row=>row.provenance.build_id===context('b').build_id),false);
 const returned=third.observe({cpu_percent:22},context('a'));
 assert.equal(returned.features.cpu_percent.samples,2882);
 assert.equal(returned.state,'learning');
 assert.ok(Math.abs(returned.features.cpu_percent.baseline-22)<.2);
 await third.close();
});

test('legacy checkpoints remain as history without assigning mixed training to the last tagged build',async()=>{
 const old={schema:'aieyra.health-model/1',algorithm:'median-mad-ewma',trained_at:500,
  provenance:context('a'),features:{cpu_percent:{samples:120,baseline:22,variance:1}}};
 let saved;
 const model=createHealthModel({file:'model.json',features:specs,readJson:()=>({status:'valid',value:old}),
  writeJson(_file,value){saved=value;}});
 assert.equal(model.report().storage.restored,true);
 assert.equal(model.report().baseline_scope,'legacy');
 assert.equal(model.report().features.cpu_percent.last,null);
 assert.equal(model.report().features.cpu_percent.samples,120);
 const fresh=model.observe({cpu_percent:84},context('a'));
 assert.equal(fresh.state,'warming_up');
 assert.equal(fresh.features.cpu_percent.samples,1);
 assert.equal(fresh.retained_baselines[0].scope,'legacy');
 await model.close();
 assert.deepEqual(saved.retained[0].features,old.features);
});
