// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/canvas-references.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCanvasReferences}=require('../../../Program/official/workspace/references.cjs');
const {validateProgramContext}=require('../../../Program/contract/reference-context.cjs');
const {createComposerDraft}=require('../host/composer-draft.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-ref-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const image=path.join(root,'original.png');fs.writeFileSync(image,'original pixels');
 const nodes=[{id:'node-1',title:'需求 A',requirement:'原始需求',assets:[{path:image}]}];let flushes=0;
 const options={root,context:async p=>{assert.equal(p.projectId,'project-A');const selected=p.all?nodes:nodes.filter(n=>p.nodeIds.includes(n.id));if(!p.all&&selected.length!==p.nodeIds.length)throw Error('引用已删除');return {projectId:p.projectId,revision:3,nodes:structuredClone(selected)};},projectList:async()=>({activeProjectId:'project-A',projects:[{id:'project-A',name:'画布 A',kind:'image'}]}),saved:()=>[],flush:async()=>{flushes++;},asset:f=>f===image?f:null};
 return {root,nodes,image,options,service:createCanvasReferences(options),flushes:()=>flushes};
}
test('shared canvas references freeze object text and image versions; retry reuses the prepared message after restart',async t=>{
 const f=fixture(t),listing=await f.service.options(),context={program:'workspace',references:listing.references};
 const input={id:'a'.repeat(32),request_id:'owned-request',message:'检查这个引用',attachments:[],context};
 const first=await f.service.prepare(input);assert.match(first.message,/原始需求/);assert.match(first.message,/contentHash/);
 f.nodes[0].requirement='后来的修改';fs.writeFileSync(f.image,'new pixels');
 const restored=createCanvasReferences(f.options);assert.equal((await restored.prepare(input)).message,first.message);
 await assert.rejects(()=>restored.prepare({...input,message:'不同内容'}),/另一条消息/);
 await assert.rejects(()=>restored.prepare({...input,request_id:'new-request'}),/引用对象已变化/);
 const fresh=await restored.options();const next=await restored.prepare({...input,request_id:'newer-request',context:{program:'workspace',references:fresh.references}});assert.match(next.message,/后来的修改/);
 f.nodes.splice(0);await assert.rejects(()=>restored.prepare({...input,request_id:'deleted'}),/已删除/);
});
test('canvas references preserve source project across draft and outbox persistence and reject invalid metadata',async t=>{
 const f=fixture(t),context={program:'workspace',references:(await f.service.options()).references};
 const config=path.join(f.root,'Config','config.json');fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'{}');
 const store=createComposerDraft(config,f.root,{sessionID:'b'.repeat(32)}),read=await store.sharedRead();
 const draft={value:'共享输入',pastes:'',attachments:[],context,outbox:[{session_id:'b'.repeat(32),request_id:'retry',text:'共享输入',attachments:[],context}]};
 await store.sharedSave({revision:read.revision,draft});await store.close();
 const loaded=await createComposerDraft(config,f.root,{sessionID:'b'.repeat(32)}).sharedRead();assert.deepEqual(loaded.draft.context,context);assert.deepEqual(loaded.draft.outbox[0].context,context);
 assert.throws(()=>validateProgramContext({...context,program:'settings'}),/无效/);
 assert.throws(()=>validateProgramContext({program:'workspace',references:[{...context.references[0],signature:''}]}),/版本不完整/);
 assert.throws(()=>validateProgramContext({program:'workspace',references:[context.references[0],context.references[0]]}),/重复/);
});
test('concurrent reference submissions resolve once and refuse different text using the same request',async t=>{
 const f=fixture(t),context={program:'workspace',references:(await f.service.options()).references},input={id:'a'.repeat(32),request_id:'parallel',message:'same',context};
 const [a,b]=await Promise.all([f.service.prepare(input),f.service.prepare(input)]);assert.equal(a.message,b.message);assert.equal(f.flushes(),2);
});
