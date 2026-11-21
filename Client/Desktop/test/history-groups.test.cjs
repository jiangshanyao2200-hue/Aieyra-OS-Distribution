// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/history-groups.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict');
test('history keeps body, thoughts and tools under one avatar until another speaker',async()=>{
 const {historyGroups}=await import('../ui/history-groups.mjs');
 const rows=[
  {id:'u',title:'user',kind:'message'},
  {id:'a',role:'matrix',kind:'message'},
  {id:'b',role:'matrix',kind:'thinking'},
  {id:'c',role:'matrix',kind:'tool'},
  {id:'d',role:'matrix',kind:'message',at:'2026-10-22'},
  {id:'s',role:'subconscious',kind:'thinking'},
  {id:'t',role:'subconscious',kind:'tool'},
  {id:'v',title:'subconscious',kind:'message'},
  {id:'w',title:'user',kind:'message'},
 ];
 const groups=historyGroups(rows);
 assert.deepEqual(groups.map(g=>[g.speaker,g.rows.map(r=>r.id)]),[['user',['u']],['matrix',['a','b','c','d']],['subconscious',['s','t','v']],['user',['w']]]);
 assert.deepEqual(groups.flatMap(g=>g.rows),rows);
});
test('system notices do not split dialogue or count as process steps; compaction remains readable',async()=>{
 const {historyGroups}=await import('../ui/history-groups.mjs');
 const rows=[{id:'one',role:'matrix',kind:'message'},{id:'notice',kind:'system',title:'需要留意'},{id:'runtime',role:'system',kind:'message'},{id:'compact',kind:'system',compaction:true},{id:'two',role:'matrix',kind:'message'}];
 assert.deepEqual(historyGroups(rows).map(g=>[g.speaker,g.rows.map(r=>r.id)]),[['matrix',['one','compact','two']]]);
});
