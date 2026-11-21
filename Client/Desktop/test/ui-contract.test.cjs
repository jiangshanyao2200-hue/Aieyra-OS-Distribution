// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: BASELINE
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/ui-contract.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// UI 协约只准收紧：违规数不能超过基线。修掉一批就把 BASELINE 调低。见 docs/UI协约.md。
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
const BASELINE=414;
test('UI 协约违规数不增加',t=>{
 const python=process.platform==='win32'?'python':'python3',root=path.join(__dirname,'../../..');
 const r=spawnSync(python,['-X','utf8','-B',path.join(root,'scripts/ui-contract/check.py')],{encoding:'utf8',maxBuffer:1<<26,windowsHide:true});
 if(r.error){t.skip('没有 Python，跳过');return;}
 const count=r.stdout.split('\n').filter(line=>line.startsWith('  ')).length;
 assert.ok(count>0,'检查器没有输出：'+r.stderr.slice(-300));
 assert.ok(count<=BASELINE,`UI 协约违规 ${count} 条，超过基线 ${BASELINE}；运行 scripts/ui-contract/check.py 查看`);
});
