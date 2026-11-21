// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; assert
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/program-overlay-attachments.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test');
const assert=require('node:assert/strict');
const {createProgramOverlayBridge}=require('../host/program-agent-overlay.cjs');
test('program preview stays within the current binding and exposes no file staging',async()=>{
 const calls=[],bridge=createProgramOverlayBridge({conversation:async()=>({session:{id:'owned'}}),attachment:async p=>{calls.push(p);return {ok:true};},emit(){}});
 await bridge({program:'workspace',action:'attachment',task_id:'owned',id:'foreign',method:'imageLibrary',args:{action:'attachment'}});
 assert.deepEqual(calls,[{id:'owned',method:'imageLibrary',args:{action:'attachment'}}]);
 await assert.rejects(bridge({program:'workspace',action:'attachment',task_id:'foreign',method:'imageLibrary'}),/所属身份/);
 await assert.rejects(bridge({program:'workspace',action:'attachment',task_id:'owned',method:'stageFileBytes'}),/只允许预览/);
 assert.equal(calls.length,1);
});
