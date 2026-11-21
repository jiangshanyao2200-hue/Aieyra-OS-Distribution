// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture; input
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-images.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCanvasImages}=require('../../../Program/official/workspace/images.cjs');
function fixture(t,call){const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-batch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let imports=0;
 const store={getProjectById:id=>id==='p'?{kind:'image'}:null,readProjectList:()=>[],resolveReadableImageAsset:p=>p,handlers:new Map([['aieyra:asset:import-local-images',async(_e,p)=>{imports++;return {ok:true,assets:p.paths.map(path=>({path}))};}]])};
 return {root,store,create:()=>createCanvasImages({root,call,storage:()=>store}),imports:()=>imports};}
const input={runId:'one',projectId:'p',prompt:'canvas',quality:'low',outputFormat:'webp',outputCompression:0,background:'transparent',inputFidelity:'high'};
test('canvas retains generation options, deduplicates concurrent calls and recovers paid images after import failure without submit',async t=>{
 const calls=[];let failImport=true;
 const f=fixture(t,async p=>{calls.push(p);return p.action==='create'?{ok:true,state:'prepared'}:{ok:true,state:'completed',model:'image',images:[{path:'/paid.png'}]};});
 const handler=f.store.handlers.get('aieyra:asset:import-local-images');f.store.handlers.set('aieyra:asset:import-local-images',async(...args)=>{if(failImport)throw Error('disk unavailable');return handler(...args);});
 const first=f.create();await assert.rejects(first.generate(input),/disk unavailable/);
 assert.equal(calls[0].output_compression,0);assert.equal(calls[0].background,'transparent');assert.match(calls[0].quality_reason,/用户/);
 failImport=false;const restarted=f.create(),results=await Promise.all([restarted.generate(input),restarted.generate(input)]);
 assert.deepEqual(results[0],results[1]);assert.equal(calls.filter(p=>p.action==='run').length,1);assert.equal(calls.filter(p=>p.action==='create').length,1);assert.equal(f.imports(),1);
 assert.equal(results[0].assets[0].runId,'one');await restarted.generate(input);assert.equal(f.imports(),1);
 await assert.rejects(restarted.generate({...input,prompt:'changed'}),/参数已变化/);
});
test('canvas cancellation during preparation prevents the later run and strips legacy manual run prefix',async t=>{
 let finish;const calls=[];const f=fixture(t,p=>{calls.push(p);if(p.action==='create')return new Promise(r=>finish=r);return Promise.resolve({ok:true});});
 const images=f.create(),task=images.generate(input);await new Promise(r=>setImmediate(r));
 await images.cancel('manual-image:one','p');finish({ok:true,state:'prepared'});await assert.rejects(task,/取消/);
 assert.equal(calls.some(p=>p.action==='run'),false);assert.equal(calls[0].request_id,calls[1].batch_id);
});
test('unknown paid outcome remains query-only after restart',async t=>{
 const calls=[];const f=fixture(t,async p=>{calls.push(p.action);return p.action==='create'?{ok:true,state:'prepared'}:{ok:true,state:'unknown'};});
 await assert.rejects(f.create().generate(input),/完整/);await assert.rejects(f.create().generate(input),/原图片任务/);assert.deepEqual(calls,['create','run','status']);
});
test('canvas drains a known large batch in bounded groups and imports every output',async t=>{
 const calls=[];let completed=0;
 const f=fixture(t,async p=>{calls.push(p);assert.equal(p.limit,100);if(p.action==='create')return {ok:true,state:'prepared'};
  assert.equal(p.action,'run');assert.ok(p.max_items<=20);completed=Math.min(45,completed+p.max_items);
  return {ok:true,state:completed===45?'completed':'partial',completed,items:Array.from({length:45},(_,i)=>({state:i<completed?'completed':'prepared'})),images:Array.from({length:completed},(_,i)=>({path:'/paid-'+i+'.png'}))};
 });
 const result=await f.create().generate({...input,count:45});assert.equal(result.assets.length,45);assert.equal(calls.filter(p=>p.action==='run').length,3);assert.equal(f.imports(),1);
});

test('stopping a single managed image with a self placement link cancels once and prevents submission after preparation',async t=>{
 let prepared;const calls=[];
 const f=fixture(t,async p=>{calls.push(p);if(p.action==='create')return new Promise(resolve=>prepared=resolve);return {ok:true};});
 const images=f.create(),task=images.generate({...input,placementRunId:input.runId,managedJob:input.runId});
 const stopped=assert.rejects(task,/取消/);await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await images.cancel('manual-image:'+input.runId,'p')).cancelled,true);
 prepared({ok:true,state:'prepared'});await stopped;
 assert.deepEqual(calls.map(p=>p.action),['create','cancel']);assert.equal(calls[0].request_id,calls[1].batch_id);
 const restarted=f.create();await restarted.cancel(input.runId,'p');
 assert.deepEqual(calls.map(p=>p.action),['create','cancel','cancel'],'reopening and stopping never recreates or runs the paid request');
});

test('legacy cyclic image groups cancel each owned receipt once and reject ambiguous canvas ownership',async t=>{
 const calls=[],f=fixture(t,async p=>{calls.push(p);return {ok:true};}),directory=path.join(f.root,'image-receipts');fs.mkdirSync(directory);
 const rows=[['parent','child','p'],['child','parent','p'],['leaf','child','p'],['foreign','parent','other']];
 for(const [i,[runId,placementRunId,projectId]]of rows.entries())fs.writeFileSync(path.join(directory,'canvas-'+i+'.json'),JSON.stringify({id:'canvas-'+i,runId,projectId,input:{placementRunId}}));
 const images=f.create();await assert.rejects(images.cancel('parent'),/多个画布/);assert.equal(calls.length,0);
 await images.cancel('parent','p');assert.equal(calls.length,3);assert.equal(new Set(calls.map(p=>p.batch_id)).size,3);
 const hash=require('node:crypto').createHash('sha256').update('other\nforeign').digest('hex').slice(0,40);
 assert.equal(calls.some(p=>p.batch_id==='canvas-'+hash),false,'the foreign canvas is never cancelled');
});
