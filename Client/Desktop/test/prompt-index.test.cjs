// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: root; goFiles
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/prompt-index.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 发行包只带索引里的提示词：代码用到却没登记，开发时正常，装上就读不到。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../../..');
function goFiles(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);return e.isDirectory()?goFiles(p):e.name.endsWith('.go')&&!e.name.endsWith('_test.go')?[p]:[];});}
test('代码用到的提示词都在索引里，文件也存在',()=>{
 const indexed=new Set(JSON.parse(fs.readFileSync(path.join(root,'Config/提示词索引.json'),'utf8')).resources.map(r=>r.file));
 const used=new Set(require('../../../Agent/official/definitions.cjs').promptReferences());for(const file of goFiles(path.join(root,'Core')))for(const m of fs.readFileSync(file,'utf8').matchAll(/runtimePrompt\("([^"]+)"\)/g))used.add(m[1]);
 assert.ok(used.size>100);
 const missing=[...used].filter(p=>!indexed.has(p));assert.deepEqual(missing,[],'没有登记进 Config/提示词索引.json');
 for(const p of used)assert.ok(fs.existsSync(require('../src/resources.cjs').promptPath(p,root)),'缺文件：'+p);
});
