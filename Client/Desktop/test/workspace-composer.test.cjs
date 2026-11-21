// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-composer.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
test('canvas can append signed references without mounting legacy chat and preserves existing shared text, attachments and context',async t=>{
 const root=path.resolve(__dirname,'../../../Program/official/workspace'),ts=require(path.join(root,'node_modules/typescript'));
 const source=fs.readFileSync(path.join(root,'src/os-composer.ts'),'utf8'),file=path.join(root,'src/os-composer-test-instance.cjs');
 const previous=global.window;t.after(()=>{if(previous===undefined)delete global.window;else global.window=previous;});
 const ref=id=>({id,sourceProjectId:'canvas',sourceProjectName:'Canvas',sourceNodeIds:['node-'+id],title:id,count:1,revision:3,signature:'signature-'+id});
 let failure=true,saves=0,revision=1,stored={value:'Existing sidebar text',attachments:[{sha256:'existing',name:'Existing file',asset:'E:/fixtures/owned/existing.txt',mime:'text/plain',bytes:10}],context:{program:'workspace',references:[ref('old')],retainedMetadata:'keep'}};
 global.window={aieyraAgent:{coding:async p=>{
  if(p.operation==='draft_load'){if(failure)throw Error('original draft unreadable');return {ok:true,revision:String(revision),draft:structuredClone(stored)};}
  if(p.operation==='draft_save'){
   assert.equal(p.revision,String(revision));saves++;revision++;
   stored={value:p.prompt,attachments:p.files.map(f=>({sha256:f.contentHash,name:f.name,asset:f.path,mime:f.mimeType,bytes:f.size})),context:p.context};return {ok:true,revision:String(revision),draft:structuredClone(stored)};
  }
  throw Error('unexpected hidden chat operation: '+p.operation);
 }}};
 const instance=new Module(file,module);instance.filename=file;instance.paths=Module._nodeModulePaths(path.dirname(file));
 instance._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
 const {appendComposerDraft,flushComposerDrafts}=instance.exports;
 await assert.rejects(appendComposerDraft('canvas','conversation',{prompt:'must not replace original'}),/original draft unreadable/);assert.equal(saves,0);await flushComposerDrafts();assert.equal(saves,0);
 failure=false;await appendComposerDraft('canvas','conversation',{prompt:'Canvas addition',references:[ref('new')],files:[{id:'existing',contentHash:'existing',name:'Existing file',path:'E:/fixtures/owned/existing.txt',mimeType:'text/plain',size:10,kind:'other'}]});
 assert.equal(stored.value,'Existing sidebar text\n\nCanvas addition');assert.equal(stored.attachments.length,1);assert.deepEqual(stored.context.references.map(r=>r.id),['old','new']);assert.equal(stored.context.retainedMetadata,'keep');assert.equal(stored.context.references[1].signature,'signature-new');
 await appendComposerDraft('canvas','conversation',{references:[ref('new')],removeReferenceIds:['old']});assert.deepEqual(stored.context.references.map(r=>r.id),['new']);assert.equal(stored.value,'Existing sidebar text\n\nCanvas addition');
 await flushComposerDrafts();assert.equal(saves,2);
});
