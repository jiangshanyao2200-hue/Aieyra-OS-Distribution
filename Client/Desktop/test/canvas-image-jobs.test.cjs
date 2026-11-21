// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: scope; until; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/canvas-image-jobs.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCanvasImageJobs}=require('../../../Program/official/workspace/image-jobs.cjs');
const scope={projectId:'p',canvasProjectId:'p',conversationId:'program'};
async function until(fn){for(let n=0;n<1500;n++){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,10));}throw Error('job did not settle');}
function fixture(t,generate){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'os-canvas-jobs-'));
 const calls=[],commits=[],events=[],cancelled=[];let identity='same';
 const options={root,images:{generate:async p=>{calls.push(p);return generate?generate(p,calls.length):{assets:[{path:'image-'+calls.length+'.png'}]};},cancel:async id=>{cancelled.push(id);}},
  prepare:async a=>({identity,input:a.input,nodes:[],conversationId:'canvas-main'}),commit:async(job,partial)=>{commits.push(structuredClone({job,partial}));return {ok:true,outputs:job.actions.filter(a=>a.node.assets?.length).map(a=>({nodeId:a.toolRunId,assets:a.node.assets}))};},activity:v=>events.push(v)};
 const jobs=createCanvasImageJobs(options);t.after(async()=>{await jobs.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,jobs,calls,commits,events,cancelled,options,identity:v=>identity=v};
}
test('original finite batch cycles variants once, binds canvas owner, commits one container and deduplicates retries',async t=>{
 const f=fixture(t),args={operation:'start',count:7,concurrency:2,input:{prompt:'base'},variants:[{prompt:'red'},{prompt:'blue'}]};
 const started=await f.jobs.start(args,scope,'original-request',true);assert.equal(started.status,'running');
 await until(async()=> (await f.jobs.control({operation:'status',jobId:started.jobId},scope)).status==='completed');
 assert.deepEqual(f.calls.map(p=>p.prompt),['red','blue','red','blue','red','blue','red']);assert.equal(new Set(f.calls.map(p=>p.runId)).size,7);
 const status=await f.jobs.control({operation:'status',jobId:started.jobId},scope);assert.equal(status.outputs.length,1);assert.equal(status.outputs[0].assets.length,7);
 assert.equal(f.commits.at(-1).job.actions[0].node.imageProgress.stopped,false,'a completed container must not display stopped');
 assert.equal(f.commits.at(-1).job.conversationId,'canvas-main');assert.equal(f.commits.at(-1).job.reviewContext.matrixConversationId,'program');
 assert.equal((await f.jobs.start(args,scope,'original-request',true)).jobId,started.jobId);assert.equal(f.calls.length,7);
 await assert.rejects(f.jobs.start({...args,count:8},scope,'original-request',true),/参数/);
 await assert.rejects(f.jobs.control({operation:'status',jobId:started.jobId},{...scope,conversationId:'foreign'}),/不属于/);
 assert.equal(f.events.at(-1).active,false);
});
test('pause drains accepted work, resume never repeats completed slots and changed model refuses dispatch',async t=>{
 let release;const f=fixture(t,async(p,n)=>{if(n===1)await new Promise(r=>release=r);return {assets:[{path:'image-'+n+'.png'}]};});
 const start=await f.jobs.start({count:3,concurrency:1,input:{prompt:'one'}},scope,'pause',true);await until(()=>release);
 await f.jobs.control({operation:'pause',jobId:start.jobId},scope);release();await until(async()=> (await f.jobs.control({operation:'status',jobId:start.jobId},scope)).status==='paused');
 assert.equal(f.calls.length,1);f.identity('changed');await assert.rejects(f.jobs.control({operation:'resume',jobId:start.jobId},scope),/变化/);assert.equal(f.calls.length,1);
 f.identity('same');await f.jobs.control({operation:'resume',jobId:start.jobId},scope);await until(async()=> (await f.jobs.control({operation:'status',jobId:start.jobId},scope)).status==='completed');assert.equal(f.calls.length,3);
 assert.equal(f.commits.at(-1).job.actions[0].node.imageProgress.stopped,false,'resuming to completion clears the paused presentation');
});
test('continuous mode commits each hundred before advancing and stops explicitly without replay',async t=>{
 let release;const f=fixture(t,async(p,n)=>{if(n===101)await new Promise(r=>release=r);return {assets:[{path:'image-'+n+'.png'}]};});
 const start=await f.jobs.start({continuous:true,concurrency:1,input:{prompt:'one'}},scope,'continuous',true);
 await until(()=>release);assert.ok(f.commits.some(c=>c.partial&&c.job.actions[0].node.assets.length===100));
 const stopping=f.jobs.control({operation:'cancel',jobId:start.jobId},scope);await until(()=>f.cancelled.length);release();await stopping;
 assert.equal(f.calls.length,101);assert.ok(f.cancelled.length);assert.equal((await f.jobs.control({operation:'status',jobId:start.jobId},scope)).status,'cancelled');
});
test('unknown paid slot survives restart and resume is refused until explicitly reconciled',async t=>{
 const f=fixture(t,async()=>{throw Error('结果未确认 timeout');});const start=await f.jobs.start({count:2,concurrency:1,input:{prompt:'one'}},scope,'unknown',true);
 await until(async()=> (await f.jobs.control({operation:'status',jobId:start.jobId},scope)).status==='paused');
 // Copy only our owned records to model abrupt process loss, without executing a
 // second provider or mutating the first scheduler's in-memory state.
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'os-canvas-restarted-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.cpSync(f.root,root,{recursive:true});
 const reopened=createCanvasImageJobs({...f.options,root});t.after(()=>reopened.close());
 await assert.rejects(reopened.control({operation:'resume',jobId:start.jobId},scope),/未知/);assert.equal(f.calls.length,1);
 await reopened.control({operation:'recover',jobId:start.jobId},scope);assert.equal(f.calls.length,1);
});
test('simultaneous retries reserve one durable batch and submit each paid slot only once',async t=>{
 const f=fixture(t),args={count:2,concurrency:1,input:{prompt:'same'}};
 const [a,b]=await Promise.all([f.jobs.start(args,scope,'simultaneous',true),f.jobs.start(args,scope,'simultaneous',true)]);
 assert.equal(a.jobId,b.jobId);await until(async()=> (await f.jobs.control({operation:'status',jobId:a.jobId},scope)).status==='completed');assert.equal(f.calls.length,2);
 assert.equal(fs.readdirSync(path.join(f.root,'image-jobs')).length,1);
});
test('different image items keep their own pixels, quality, title and collection through a restart',async t=>{
 const f=fixture(t),input={operation:'variants',prompt:'same product',parentId:'source',count:2,generationMode:'parallel',items:[{title:'front',prompt:'front view',size:'1024x1024',quality:'max'},{title:'side',prompt:'side view',size:'768x1024',quality:'xhigh'}]};
 const started=await f.jobs.start({input},scope,'item-parameters');
 await until(async()=> (await f.jobs.control({operation:'status',jobId:started.jobId},scope)).status==='completed');
 assert.deepEqual(f.calls.map(p=>[p.prompt,p.size,p.quality,p.count]),[['front view','1024x1024','max',1],['side view','768x1024','xhigh',1]]);
 const collection=f.commits.at(-1).job.actions[0].node.imageCollection;assert.equal(collection.kind,'batch');assert.deepEqual(collection.items.map(i=>i.title),['front','side']);
 const reopened=createCanvasImageJobs(f.options);t.after(()=>reopened.close());await reopened.start({input},scope,'item-parameters');assert.equal(f.calls.length,2);
 await assert.rejects(reopened.start({input:{prompt:'changed',count:1}},scope,'item-parameters'),/参数/);
});
test('sequential image series waits for each actual result and preserves original series presentation',async t=>{
 let release;const f=fixture(t,async(p,n)=>{if(n===1)await new Promise(r=>release=r);return {assets:[{path:'image-'+n+'.png'}]};});
 const started=await f.jobs.start({input:{prompt:'story',count:3,generationMode:'sequential'}},scope,'series');await until(()=>release);assert.equal(f.calls.length,1);release();
 await until(async()=> (await f.jobs.control({operation:'status',jobId:started.jobId},scope)).status==='completed');
 assert.equal(f.calls.length,3);const n=f.commits.at(-1).job.actions[0].node;assert.equal(n.imageCollection.kind,'series');assert.equal(n.imageCollection.generationMode,'sequential');assert.equal(n.assets.length,3);
});
