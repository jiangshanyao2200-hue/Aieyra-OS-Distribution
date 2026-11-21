// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/tool-presentation.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('only clear single read commands use explore and compound shells remain terminal',async()=>{
 const {sceneKind}=await import('../ui/model.mjs'),{terminalSummary}=await import('../ui/experience.mjs');
 for(const [command,kind] of [['cat README.md','reader'],['Get-Content -LiteralPath "a b.txt"','reader'],['rg -n needle CORE','search'],['Get-ChildItem src','map'],['rg needle src; Remove-Item src','terminal'],['cat a | bash','terminal'],['rg needle && build','terminal'],['cat a\nwrite b','terminal'],['rg --pre python src','terminal'],['rg --pre=python src','terminal'],['cat $(build)','terminal'],['cat a > b','terminal'],['powershell -Command "Get-Content a"','terminal'],['find . -exec touch file','terminal'],['cat "unclosed','terminal']]){
  const item={tool:'exec_command',command,action:'search',presentation:{kind:'reader'}};
  assert.equal(sceneKind(item),kind,command);
  if(kind==='terminal')assert.match(terminalSummary(item),/^终端/,command);
 }
 assert.equal(sceneKind({tool:'write_stdin',action:'read',presentation:{kind:'reader'}}),'terminal');
 assert.equal(sceneKind({tool:'project',action:'search'}),'search');
 assert.equal(sceneKind({tool:'apply_patch'}),'editor');
});
