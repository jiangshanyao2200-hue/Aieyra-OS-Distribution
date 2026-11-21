// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; assert; fs; path; ui; walk
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/terminal-host.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ui=path.join(__dirname,'..','ui');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='vendor'?[]:e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.mjs')?[path.join(dir,e.name)]:[]);

test('终端只从 terminal-host 打开：内边距不会算进列数',()=>{
 const direct=walk(ui).filter(f=>path.basename(f)!=='terminal-host.mjs'&&/\bterm\.open\(/.test(fs.readFileSync(f,'utf8')));
 assert.deepEqual(direct,[]);
});
