// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-video-adapter.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCanvasVideoProgram}=require('../../../Program/official/workspace/video-program.cjs');

test('video picker requires the actual user and rejects a late selection after canvas change',async()=>{
 let projectId='a',choose,imports=0;
 const adapter=createCanvasVideoProgram({assertActive(){},scope:async()=>({projectId}),media:{call:async()=>{imports++;return {ok:true};}},renderer:async()=>({ok:true}),electron:{dialog:{showOpenDialog:()=>new Promise(resolve=>{choose=resolve;})}}});
 await assert.rejects(adapter.invoke('pick',{},{}),/用户/);
 const pending=adapter.invoke('pick',{}, {human:true});await new Promise(resolve=>setImmediate(resolve));
 projectId='b';choose({filePaths:['chosen.mp4']});await assert.rejects(pending,/画布已改变/);assert.equal(imports,0);
});

test('completed video placement survives a lost renderer and is acknowledged only after durable commit',async()=>{
 const job={id:'once',projectId:'a',state:'completed',assetId:'asset'},asset={id:'asset'},commits=[];let unavailable=true,encodes=0;
 const media={call:async(_project,action)=>{if(action==='list')return {ok:true,jobs:[structuredClone(job)],assets:[asset]};if(action==='status')return {ok:true,job:structuredClone(job),asset};encodes++;throw Error('unexpected encode');},placed(project,id){assert.equal(project,'a');assert.equal(id,'once');job.placed=true;}};
 const adapter=createCanvasVideoProgram({assertActive(){},scope:async()=>({projectId:'a'}),media,renderer:async(action,args)=>{assert.equal(action,'videos.commit');if(unavailable)throw Error('renderer unavailable');commits.push(args);return {ok:true,nodeId:'node'};}});
 await assert.rejects(adapter.invoke('list'),/unavailable/);assert.equal(job.placed,undefined);
 unavailable=false;await adapter.invoke('list');assert.equal(job.placed,true);await adapter.invoke('list');await adapter.invoke('status',{requestId:'once'});
 assert.equal(commits.length,1);assert.equal(encodes,0);
});

test('generated video only enters the canvas after a real download receipt supplies a local file',async()=>{
 let result={request_id:'original',state:'queued',task_id:'provider-task'},imports=[],commits=[];
 const adapter=createCanvasVideoProgram({assertActive(){},scope:async()=>({projectId:'a'}),videoCall:async request=>{assert.equal(request.request_id,'original');assert.equal(request.projectId,undefined);return result;},media:{importFile:async(project,file,options)=>{imports.push({project,file,options});return {id:'asset'};}},renderer:async(_,args)=>{commits.push(args);return {ok:true};}});
 await adapter.invoke('task',{projectId:'a',action:'query',request_id:'original'});assert.equal(imports.length,0);assert.equal(commits.length,0);
 result={...result,state:'completed',path:'owned-video.mp4',sha256:'actual-digest'};
 await adapter.invoke('task',{projectId:'a',action:'download',request_id:'original'});
 assert.equal(imports[0].file,'owned-video.mp4');assert.equal(imports[0].options.provenance.requestId,'original');assert.equal(commits.length,1);
});
