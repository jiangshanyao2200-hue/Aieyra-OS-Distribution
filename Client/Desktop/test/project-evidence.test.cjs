// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/project-evidence.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {projectEvidence}=require('../../../Program/official/coding/ui/project-evidence.mjs');

test('project follows file mutations while investigation stays in the work surface',()=>{
 const rows=projectEvidence([
  {id:'patch',tool:'apply_patch',member:'cota',targets:['E:/fixtures/project/src/app.js'],revision:1,state:'completed'},
  {id:'read',tool:'terminal',member:'vaya',targets:['README'],revision:2,state:'completed'},
  {id:'write',tool:'project',action:'write',member:'vaya',targets:['notes.md'],revision:3,state:'completed'},
  {id:'search',tool:'web_search',member:'vaya',targets:['保留原搜索界面','src/search.js'],state:'failed'},
  {id:'browser',tool:'browser',member:'cota',targets:['https://example.com/app.js']},
  {id:'program',tool:'project',targets:['项目说明']}
 ],'E:/fixtures/project');
 assert.deepEqual(rows.map(r=>[r.path,r.member,r.operation]),[['notes.md','vaya','write'],['src/app.js','cota','patch']]);
});

test('project file evidence excludes targets outside the bound workspace',()=>{
 const rows=projectEvidence([{id:'patch',tool:'apply_patch',targets:['../private.txt','E:/fixtures/project-other/a.js','C:/fixtures/a.js','E:/fixtures/project/src/a.js']}],'E:/fixtures/project');
 assert.deepEqual(rows.map(r=>r.path),['src/a.js']);
});
