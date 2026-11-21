// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: sharp
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/canvas-tools.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCanvasTools}=require('../../../Program/official/workspace/canvas-tools.cjs');
const sharp=require('../../../Program/official/workspace/node_modules/sharp');
test('multi-image viewing returns ordered numbered pixels, pagination and rejects foreign paths',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-view-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const paths=[];for(const [name,background]of [['red','#ff0000'],['blue','#0000ff']]){const file=path.join(root,name+'.png');await sharp({create:{width:24,height:24,channels:3,background}}).png().toFile(file);paths.push(file);}
 const tools=createCanvasTools({storage:()=>({readProjectList:()=>[],getProjectById:()=>({id:'p',kind:'image',path:root}),resolveReadableImageAsset:p=>paths.includes(p)?p:null}),renderer:async()=>({ok:true,projectId:'p',nodes:[{id:'A',assets:paths.map(path=>({path}))}]})});
 const result=await tools.view({input:{nodeId:'A'}},true);assert.deepEqual(result.images.map(i=>i.path),paths);assert.equal(result.nextOffset,null);assert.ok(fs.existsSync(result.model_image.path));
 const {data,info}=await sharp(fs.readFileSync(result.path)).removeAlpha().raw().toBuffer({resolveWithObject:true});let red=0,blue=0;for(let i=0;i<data.length;i+=info.channels){if(data[i]>200&&data[i+2]<50)red++;if(data[i+2]>200&&data[i]<50)blue++;}assert.ok(red>100&&blue>100,'both original colors are visible in the returned pixels');
 await assert.rejects(tools.view({input:{paths:['foreign.png']}},true),/不可读/);
 assert.equal((await tools.view({input:{nodeId:'A',offset:1}},true)).path,paths[1]);
});
test('workflow rejects ambiguous titles and stale canvas before mutation; experience revisions preserve original text',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-tools-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let writes=0;
 const tools=createCanvasTools({storage:()=>({readProjectList:()=>[],getProjectById:()=>({id:'p',kind:'image',path:root})}),renderer:async(action)=>{if(action!=='images.context'){writes++;return {ok:true};}return {ok:true,projectId:'p',canvasRevision:8,nodes:[{id:'A',title:'same',type:'image'},{id:'B',title:'same',type:'requirement'}]};}});
 await assert.rejects(tools.workflow({input:{operation:'delete_node',nodeTitle:'same'}},'request'),/不唯一/);
 await assert.rejects(tools.workflow({canvasRevision:7,input:{operation:'clear_canvas'}},'request'),/变化/);assert.equal(writes,0);
 const added=await tools.experience({input:{action:'add',text:'原文用户反馈',title:'构图'}});assert.equal(added.revision,1);
 await assert.rejects(tools.experience({input:{action:'replace',expectedRevision:0,text:'覆盖'} }),/更新/);
 const next=await tools.experience({input:{action:'compact',expectedRevision:1,summary:'保留构图反馈'}});assert.equal(next.revision,2);
 const saved=JSON.parse(fs.readFileSync(path.join(root,'.iiimage','experience.json'),'utf8'));assert.equal(saved.history[0].entries[0].text,'原文用户反馈');assert.equal(saved.entries[0].text,'保留构图反馈');
});
