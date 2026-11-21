// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: createStudio
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/canvas-studio.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const createStudio=require('../../../Program/official/workspace/studio.cjs');
const {createStudioDocuments}=require('../../../Program/official/workspace/desktop/work/studio-documents.cjs');
test('OS canvas document tools retain agent/user authorship, reject stale edits and export exact saved content',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-studio-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const documents=createStudioDocuments({projectById:id=>{assert.equal(id,'canvas');return {id,path:root};}}),mounts=[],events=[];
 const invoke=createStudio({studioDocuments:documents,renderer:async(action,args)=>{if(action==='images.context')return {ok:true,projectId:'canvas'};assert.equal(action,'documents.mount');mounts.push(args.document);return {ok:true};},notify:(...args)=>events.push(args)});
 const created=await invoke({action:'create',projectId:'canvas',title:'Original',text:'Original text',format:'md'});const id=created.document.id;
 assert.equal(mounts.length,1);assert.equal(created.document.spans[0].author,'agent');
 await documents.run({action:'edit',projectId:'canvas',id,expectedRevision:1,text:'Human revision'},'user');
 await assert.rejects(invoke({action:'patch',projectId:'canvas',id,expectedRevision:1,patches:[{oldText:'Original',text:'Replaced'}]}),/已变化/);
 const read=await invoke({action:'read',projectId:'canvas',id});assert.equal(read.document.text,'Human revision');assert.equal(read.document.spans[0].author,'user');
 const exported=await invoke({action:'export',projectId:'canvas',id,expectedRevision:2,format:'md'});
 assert.equal(fs.readFileSync(exported.path,'utf8'),'Human revision');assert.equal(exported.sha256,crypto.createHash('sha256').update(fs.readFileSync(exported.path)).digest('hex'));
 assert.equal(events[0][0],'documents');
});
