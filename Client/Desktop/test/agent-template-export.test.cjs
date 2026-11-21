// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/agent-template-export.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {exportAgentTemplate}=require('../host/agent-template-export.cjs');
test('public template save checks Core receipt, preserves cancellation and writes only the selected path',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-export-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const target=path.join(dir,'chosen.zip'),bytes=Buffer.from('public fixture archive'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 const out={filename:'example.reviewer-1.0.0.zip',package:'mod:example.reviewer@digest',sha256,archive:bytes.toString('base64')};
 let cancel=true,picked=0;const parent={},core=async(action,p)=>{assert.equal(action,'workspace.agents');assert.deepEqual(p,{action:'export',id:'selected'});return out;};
 const dialog={showSaveDialog:async(p,options)=>{assert.equal(p,parent);assert.equal(options.defaultPath,out.filename);picked++;return {canceled:cancel,filePath:target};}};
 fs.writeFileSync(target,'existing user file');
 assert.equal((await exportAgentTemplate({core,dialog,parent,id:'selected'})).cancelled,true);assert.equal(fs.readFileSync(target,'utf8'),'existing user file');
 cancel=false;const saved=await exportAgentTemplate({core,dialog,parent,id:'selected'});assert.equal(saved.sha256,sha256);assert.deepEqual(fs.readFileSync(target),bytes);assert.deepEqual(fs.readdirSync(dir),['chosen.zip']);
 out.sha256='0'.repeat(64);await assert.rejects(exportAgentTemplate({core,dialog,parent,id:'selected'}),/校验失败/);assert.equal(picked,2);assert.deepEqual(fs.readFileSync(target),bytes);
 out.sha256=sha256;out.filename='../escape.zip';await assert.rejects(exportAgentTemplate({core,dialog,parent,id:'selected'}),/回执无效/);assert.equal(picked,2);
 out.filename='example.reviewer.zip';const alias=path.join(dir,'linked.zip');fs.linkSync(target,alias);await assert.rejects(exportAgentTemplate({core,dialog,parent,id:'selected'}),/链接/);assert.deepEqual(fs.readFileSync(target),bytes);
});
