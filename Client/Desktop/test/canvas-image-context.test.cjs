// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/canvas-image-context.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createImageContext}=require('../../../Program/official/workspace/image-context.cjs');
const {runGoalTool}=require('../../../Program/official/workspace/desktop/agent/workspace-goals.cjs');
test('generation binds original goal image bytes and exact goal/model revisions before any provider call',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-image-goal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'reference.png');fs.writeFileSync(file,'original pixels');
 const node={id:'A',type:'image',assets:[{assetId:'original',path:file}]},nodes=[node],project={id:'p',kind:'image',path:root};let revision='config-one';
 const prepare=createImageContext({storage:()=>({readProjectList:()=>[],getProjectById:id=>id==='p'?project:null,resolveReadableImageAsset:p=>p===file&&p}),renderer:async()=>({ok:true,projectId:'p',conversationId:'main',nodes}),models:async()=>({configured:true,profile_id:'images',model:'chosen',revision})});
 const goal=runGoalTool(root,{operation:'start',objective:'保留原图人物',references:[{nodeId:'A'}]},{nodes,conversationId:'main'}).goal;
 const args={input:{prompt:'a portrait'},goalId:goal.id,goalRevision:goal.revision},scope={canvasProjectId:'p'};
 const first=await prepare(args,scope);assert.equal(first.input.referenceImages[0].path,file);assert.equal(first.input.parentId,'A');
 revision='new-credentials';assert.notEqual((await prepare(args,scope)).identity,first.identity);
 await assert.rejects(prepare({...args,goalRevision:goal.revision+1},scope),/更新/);
 fs.writeFileSync(file,'changed pixels');await assert.rejects(prepare(args,scope),/改变/);
 nodes.length=0;await assert.rejects(prepare(args,scope),/移除/);
});
test('exact source slot and reference roles survive framing; ambiguous edits and unsupported quality fail before dispatch',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-source-slot-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const assets=['first','second','style'].map(name=>{const file=path.join(root,name+'.png');fs.writeFileSync(file,name);return {assetId:name,path:file};});
 const nodes=[{id:'container',assets:assets.slice(0,2)},{id:'style',assets:[assets[2]]}];let model='gpt-image-2.5-flare';
 const prepare=createImageContext({storage:()=>({readProjectList:()=>[],getProjectById:()=>({kind:'image',path:root}),resolveReadableImageAsset:p=>assets.some(a=>a.path===p)&&p}),renderer:async()=>({ok:true,projectId:'p',nodes}),models:async()=>({configured:true,model,revision:'one'})});
 const args={input:{operation:'edit',prompt:'use the reference palette',parentId:'container',assetIndex:1,ratio:'3:4',resolution:'2K',quality:'max',referenceImages:[{nodeId:'style',purpose:'palette only',role:'reference'}]}};
 const a=await prepare(args,{canvasProjectId:'p'});assert.equal(a.input.editImage.path,assets[1].path);assert.equal(a.input.referenceImages.length,1);assert.equal(a.input.referenceImages[0].purpose,'palette only');assert.equal(a.input.size,'1536x2048');assert.equal(a.input.quality,'max');
 fs.writeFileSync(assets[1].path,'new source pixels');assert.notEqual((await prepare(args,{canvasProjectId:'p'})).identity,a.identity);
 await assert.rejects(prepare({input:{...args.input,assetIndex:2}},{canvasProjectId:'p'}),/序号/);
 await assert.rejects(prepare({nodeIds:['container'],input:{operation:'edit',prompt:'edit'}},{canvasProjectId:'p'}),/唯一原图/);
 model='gpt-image-1';await assert.rejects(prepare(args,{canvasProjectId:'p'}),/不支持画质/);
});
test('per-item ratio and quality match the original canvas presets and preserve explicit pixels',()=>{
 const {normalizeImageInput}=require('../../../Program/official/workspace/image-plan.cjs');
 const r=normalizeImageInput({prompt:'one product',model:'gpt-image-2.5-flare',items:[{prompt:'front',ratio:'3:4',resolution:'2K',quality:'max'},{prompt:'side',size:'1024x1024',quality:'xhigh'}]});
 assert.equal(r.count,2);assert.deepEqual(r.items.map(i=>[i.size,i.quality]),[['1536x2048','max'],['1024x1024','xhigh']]);assert.match(r.items[0].prompt,/one product\nfront/);
 assert.throws(()=>normalizeImageInput({operation:'layers',prompt:'legacy'}),/停用/);
 assert.throws(()=>normalizeImageInput({prompt:'base',count:1,items:[{prompt:'a'},{prompt:'b'}]}),/张数/);
});
