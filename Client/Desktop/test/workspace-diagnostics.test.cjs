// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-diagnostics.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCanvasDiagnostics}=require('../../../Program/official/workspace/diagnostics.cjs');
test('canvas diagnostics persist across reopen, rotate and retain call sites without copying error bodies or URL credentials',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-diagnostics-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const error={name:'RangeError',message:'PRIVATE_USER_TEXT',code:'JSON_STORAGE_READ_FAILED',stack:'RangeError: PRIVATE_API_KEY\n    at restore (E:\\private\\canvas-storage.cjs:71:9)\n    at render (https://host.invalid/app.js?key=PRIVATE_API_KEY:2:3)\n    at entry (file:///E:/fixtures/workspace/main-CANVAS.js:33:5)'};
 const file=path.join(root,'diagnostics','workspace-events.jsonl');let log=createCanvasDiagnostics({root,maxBytes:600});
 log.record('restore',error);const first=JSON.parse(fs.readFileSync(file,'utf8').trim());assert.equal(first.name,'RangeError');assert.equal(first.code,error.code);assert.deepEqual(first.frames.map(f=>f.file),['canvas-storage.cjs','main-CANVAS.js']);assert.equal(first.frames[0].line,71);
 log=createCanvasDiagnostics({root,maxBytes:600});log.record('gone',{reason:'oom',exitCode:9});assert.equal(fs.readFileSync(file,'utf8').trim().split('\n').length,2,'reopening does not erase the earlier failure');
 for(let i=0;i<14;i++)log.record('render',error);
 const all=fs.readdirSync(path.dirname(file)).map(name=>fs.readFileSync(path.join(path.dirname(file),name),'utf8')).join('');assert.ok(fs.existsSync(file+'.1'));assert.ok(!all.includes('PRIVATE_'));assert.ok(!all.includes('https://'));assert.ok(!all.includes('E:\\private'));assert.ok(fs.readdirSync(path.dirname(file)).length<=3);
});
test('one host run correlates navigation attempts, phase timing and bounded numeric metrics',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-trace-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const log=createCanvasDiagnostics({root});log.record('navigating');log.record('session-loaded',{metrics:{durationMs:21,nodeCount:1800,secret:'PRIVATE_TEXT',heapMB:Infinity}});log.record('first-frame',{metrics:{nodeCount:1800,domNodes:16}});log.record('navigating');log.record('gone',{reason:'oom',exitCode:9});
 const rows=fs.readFileSync(path.join(root,'diagnostics','workspace-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,5);assert.match(rows[0].run,/^[a-f0-9]{32}$/);assert(rows.every(r=>r.run===rows[0].run&&Number.isFinite(r.elapsedMs)&&Number.isFinite(r.hostRssMB)));
 assert.equal(rows[0].attempt,1);assert.equal(rows[4].attempt,2);assert.equal(rows[1].metrics.nodeCount,1800);assert.equal(rows[1].metrics.durationMs,21);assert.equal(rows[1].metrics.secret,undefined);assert.equal(rows[1].metrics.heapMB,undefined);assert.equal(rows[4].reason,'oom');
});
test('diagnostic floods cannot suppress native crash evidence, navigation identity or product work',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-critical-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const log=createCanvasDiagnostics({root,report(){throw Error('sink failed');}});
 for(let i=0;i<60;i++)log.record('loaded');log.record('navigating');log.record('gone',{reason:'crashed',exitCode:1});
 for(let i=0;i<60;i++)log.record('error',{name:'RangeError'});log.record('navigating');log.record('gone',{reason:'oom',exitCode:9});
 const rows=fs.readFileSync(path.join(root,'diagnostics','workspace-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse),faults=rows.filter(r=>r.stage==='gone');
 assert.deepEqual(faults.map(r=>[r.attempt,r.reason]),[[1,'crashed'],[2,'oom']]);assert(rows.length<=120,'each diagnostic lane stays bounded');
 const blocked=path.join(root,'blocked');fs.writeFileSync(blocked,'keep');assert.doesNotThrow(()=>createCanvasDiagnostics({root:blocked,report(){throw null;}}).record('gone'));
});
