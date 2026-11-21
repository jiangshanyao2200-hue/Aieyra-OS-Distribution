// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: origins
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-recovery-performance.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const origins=()=>require('../../../Program/official/workspace/src/image-origin.ts');
test('empty-project discovery skips large inactive canvases without reading their manifest or session',t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const {isEmptyManagedProject}=require('../../../Program/official/workspace/desktop/projects/project-lifecycle.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-empty-discovery-')),project={id:'large',kind:'image',path:path.join(root,'large')};project.sessionPath=path.join(project.path,'session.json');
 fs.mkdirSync(path.join(project.path,'.iiimage'),{recursive:true});
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const manifest=path.join(project.path,'.iiimage/project.json');
 fs.writeFileSync(manifest,JSON.stringify({format:'iiimage-project',project:{id:'large'},assets:['x'.repeat(300000)]}));
 fs.writeFileSync(project.sessionPath,JSON.stringify({nodes:[],messages:[]}));
 const read=fs.readFileSync;let reads=0;fs.readFileSync=function(...args){reads++;return read.apply(this,args);};
 try{assert.equal(isEmptyManagedProject(project,root),false);assert.equal(reads,0);
  fs.writeFileSync(manifest,JSON.stringify({format:'iiimage-project',project:{id:'large'},assets:[]}));
  fs.writeFileSync(project.sessionPath,JSON.stringify({nodes:[{id:'one',text:'x'.repeat(300000)}],messages:[]}));
  assert.equal(isEmptyManagedProject(project,root),false);assert.equal(reads,0);
 }finally{fs.readFileSync=read;}
});
test('empty-project discovery still preserves unknown content, mismatched identities and real canvas assets',t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const {isEmptyManagedProject}=require('../../../Program/official/workspace/desktop/projects/project-lifecycle.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-empty-safety-')),project={id:'small',kind:'image',path:path.join(root,'small')};project.sessionPath=path.join(project.path,'session.json');
 fs.mkdirSync(path.join(project.path,'.iiimage'),{recursive:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const manifest=path.join(project.path,'.iiimage/project.json'),metadata={format:'iiimage-project',project:{id:'small'},assets:[]},session={nodes:[],messages:[]};
 fs.writeFileSync(manifest,JSON.stringify(metadata));fs.writeFileSync(project.sessionPath,JSON.stringify(session));assert.equal(isEmptyManagedProject(project,root),true);
 for(const extra of [{futureContent:{text:'keep'}},{nodes:[{id:'node',type:'image'}]},{messages:[{role:'user',content:'keep'}]}]){fs.writeFileSync(project.sessionPath,JSON.stringify({...session,...extra}));assert.equal(isEmptyManagedProject(project,root),false);}
 fs.writeFileSync(project.sessionPath,JSON.stringify(session));fs.writeFileSync(manifest,JSON.stringify({...metadata,project:{id:'other'}}));assert.equal(isEmptyManagedProject(project,root),false);
 fs.writeFileSync(manifest,JSON.stringify(metadata));fs.writeFileSync(path.join(project.path,'image.png'),'retained image');assert.equal(isEmptyManagedProject(project,root),false);
 assert.equal(fs.readFileSync(path.join(project.path,'image.png'),'utf8'),'retained image');
});
test('batch image origin recovery preserves source titles, explicit origins and source order',()=>{
 const {preserveImageOriginsForNodes}=origins();
 const nodes=[{id:'source',type:'requirement',title:'original source'},{id:'source',type:'requirement',title:'later duplicate'},
  {id:'image',type:'image',title:'image title',parentId:'source',assets:[{path:'one.png'},{path:'two.png',origin:{nodeId:'retained',title:'retained title'}}]},
  {id:'group',type:'image',relationType:'grouped',parentId:'source',assets:[{path:'three.png'}]}];
 const result=preserveImageOriginsForNodes(nodes);assert.equal(result[0],nodes[0]);assert.equal(nodes[2].assets[0].origin,undefined);
 assert.equal(result[2].assets[0].origin.sourceTitle,'original source');assert.equal(result[2].assets[1],nodes[2].assets[1]);assert.equal(result[3].assets[0].origin.sourceNodeId,undefined);
});
test('large linked image origin recovery visits source IDs linearly without truncating nodes or assets',()=>{
 const {preserveImageOriginsForNodes}=origins();let reads=0;
 const nodes=Array.from({length:4000},(_,i)=>({get id(){reads++;return 'image-'+i;},type:'image',title:'image '+i,parentId:'image-'+((i+3999)%4000),assets:[{path:i+'.png'}]}));
 const result=preserveImageOriginsForNodes(nodes);assert.equal(result.length,4000);assert.equal(result[3999].assets[0].origin.sourceTitle,'image 3998');
 assert(reads<40000,'batch lookup should not scan the whole node list for every asset: '+reads);
});
test('health sampling stops while hidden, excludes hidden time and releases its timer',async()=>{
 const {createCanvasHealth}=await import('../../../Program/official/workspace/src/canvas-health.js');let now=0,tick=null;const events=[];
 const health=createCanvasHealth({now:()=>now,schedule:fn=>{tick=fn;return 1;},cancel:()=>{tick=null;},send:(stage,metrics)=>events.push({stage,...metrics})});
 health.visible(true);assert.equal(tick,null);health.ready();assert.equal(typeof tick,'function');
 for(let i=0;i<30;i++){now+=1000;tick();}assert.equal(events[0].samples,30);assert.equal(events[0].maxGapMs,1000);
 health.visible(false);assert.equal(tick,null);now+=600000;health.visible(true);now+=1000;tick();assert.equal(events.length,1);
 now+=3000;tick();assert.equal(events[1].maxGapMs,3000);health.close();assert.equal(tick,null);health.visible(true);assert.equal(tick,null);
});
