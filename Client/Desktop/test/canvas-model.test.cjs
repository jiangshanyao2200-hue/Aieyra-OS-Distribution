// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/canvas-model.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path');
const {createWorkspaceProgram}=require('../../../Program/official/workspace/service.cjs');
test('canvas connection and transcript follow the effective OS session model without starting or configuring a model',async()=>{
 let current='session-choice',configured=true;const calls=[];
 const canvas=createWorkspaceProgram({dataRoot:path.join(os.tmpdir(),'canvas-read-only-model'),electron:{},images:{models:async()=>({configured:false})},conversation:async p=>{
  calls.push(p);
  if(['program','program_open'].includes(p.action))return {ok:true,configured,contact:{id:'contact',name:'Canvas',model_name:configured?'contact-default':''},session:configured?{id:'canvas-session'}:null};
  if(p.action==='snapshot')return {ok:true,agent:{id:p.id,state:'idle'},messages:[]};
  if(p.action==='session_usage')return {ok:true,sessions:[{id:'foreign',model_name:'foreign-model'},{id:'canvas-session',model_id:'effective-id',model_name:current}]};
  throw Error('Unexpected mutation: '+p.action);
 }});
 assert.equal((await canvas.call('aieyra:connection:status')).connection.agentModel,current);
 assert.equal((await canvas.call('aieyra:coding:execute',{operation:'status'})).model,current);
 current='new-session-choice';assert.deepEqual((await canvas.call('aieyra:connection:status')).connection.agentModelPool,[current]);
 configured=false;
 const unconfigured=await canvas.call('aieyra:connection:status');assert.equal(unconfigured.connection.aiReady,false);assert.deepEqual(unconfigured.connection.agentModelPool,[]);
 assert.equal(calls.some(p=>['send','session_model','contact_update'].includes(p.action)),false);
 await canvas.close();
});

test('canvas preferences restore without querying absent models, accounts or updates',async t=>{
 const fs=require('node:fs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-startup-'));let probes=0;
 const unavailable=()=>{probes++;throw Error('optional OS service is not configured');};
 const canvas=createWorkspaceProgram({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},images:{models:unavailable,list:()=>[]},conversation:unavailable,account:unavailable,updates:unavailable});
 t.after(async()=>{await canvas.close();fs.rmSync(root,{recursive:true,force:true});});
 const settings=await canvas.call('aieyra:config:load-settings');assert.equal(settings.ok,true,settings.error);
 const projects=await canvas.call('aieyra:project:list');assert.equal(projects.ok,true,projects.error);
 const session=await canvas.call('aieyra:config:load-session',{projectId:projects.activeProjectId});assert.equal(session.ok,true,session.error);
 assert.equal(probes,0,'optional services cannot block or recurse through local restore');
});

test('the local startup snapshot ignores broken optional job history and refuses corrupted canvas bytes without replacing them',async t=>{
 const fs=require('node:fs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-local-startup-'));let probes=0;
 const unavailable=()=>{probes++;throw Error('optional service unavailable');};
 const job=path.join(root,'image-jobs','matrix-image-11111111-1111-1111-1111-111111111111.json');fs.mkdirSync(path.dirname(job),{recursive:true});fs.writeFileSync(job,'BROKEN_JOB_HISTORY');
 const canvas=createWorkspaceProgram({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},imageCall:unavailable,conversation:unavailable,account:unavailable,updates:unavailable});
 t.after(async()=>{await canvas.close();fs.rmSync(root,{recursive:true,force:true});});
 const restored=await canvas.call('aieyra:canvas:load');assert.equal(restored.ok,true);assert.ok(restored.settings);assert.ok(restored.activeProjectId);assert.ok(restored.session);
 assert.equal(probes,0);assert.equal(fs.readFileSync(job,'utf8'),'BROKEN_JOB_HISTORY');
 const file=restored.project.sessionPath,original=fs.readFileSync(file);
 fs.writeFileSync(file,'{"nodes":[{"id":"KEEP_ORIGINAL"}');const broken=fs.readFileSync(file);
 await assert.rejects(canvas.call('aieyra:canvas:load'),/原文件已保留/);assert.deepEqual(fs.readFileSync(file),broken);
 const rejected=await canvas.call('aieyra:config:save-session',{projectId:restored.activeProjectId,nodes:[],sessionRevision:100}).catch(error=>({ok:false,error:error.message}));
 assert.equal(rejected.ok,false);assert.deepEqual(fs.readFileSync(file),broken,'saving cannot reset a corrupted original');
 fs.writeFileSync(file,original);assert.equal((await canvas.call('aieyra:canvas:load')).ok,true);assert.equal(probes,0);
 const events=fs.readFileSync(path.join(root,'diagnostics','workspace-events.jsonl'),'utf8');assert.match(events,/"stage":"restore"/);assert.ok(!events.includes('KEEP_ORIGINAL'));
});

test('a reloaded canvas rejects stale renderer results and preserves unknown mutation receipts without replay',async t=>{
 const fs=require('node:fs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-renderer-')),requests=[],wc={id:11,isDestroyed:()=>false};
 const canvas=createWorkspaceProgram({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},images:{list:()=>[]},rendererContents:()=>wc,ensureRenderer:async()=>wc.id,broadcast:(channel,p)=>{if(channel==='aieyra:matrix:request')requests.push(p);},conversation:async p=>{
  assert.equal(p.action,'program_open');return {ok:true,configured:true,contact:{id:'canvas-contact'},session:{id:'canvas-session'}};
 }});t.after(async()=>{await canvas.close();fs.rmSync(root,{recursive:true,force:true});});
 const restored=await canvas.call('aieyra:canvas:load'),projectId=restored.activeProjectId;
 canvas.rendererEvent({type:'navigating',senderID:wc.id});await canvas.call('aieyra:canvas:ready',{},wc);
 const running=canvas.invoke('nodes.create',{projectId,title:'Original request'},{request_id:'retained-mutation'}),failed=assert.rejects(running,/页面已中断/);
 for(let i=0;i<100&&!requests.length;i++)await new Promise(r=>setTimeout(r,2));assert.equal(requests.length,1);
 canvas.rendererEvent({type:'gone',senderID:wc.id,reason:'crashed',exitCode:2});await failed;
 await assert.rejects(canvas.call('aieyra:matrix:reply',{id:requests[0].id,result:{ok:true}},wc),/过期/);
 canvas.rendererEvent({type:'navigating',senderID:wc.id});await canvas.call('aieyra:canvas:ready',{},wc);
 await assert.rejects(canvas.invoke('nodes.create',{projectId,title:'Original request'},{request_id:'retained-mutation'}),/未确认/);assert.equal(requests.length,1,'the original mutation must not be replayed after reload');
 const observing=canvas.invoke('observe',{projectId});for(let i=0;i<100&&requests.length<2;i++)await new Promise(r=>setTimeout(r,2));assert.equal(requests.length,2);
 await assert.rejects(canvas.call('aieyra:matrix:reply',{id:requests[0].id,result:{ok:true}},wc),/过期/);
 await canvas.call('aieyra:matrix:reply',{id:requests[1].id,result:{ok:true,activeProjectId:projectId}},wc);assert.equal((await observing).activeProjectId,projectId);
});
