// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/service-memory.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

 'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../src/service.cjs');
for(const legacy of [false,true])test(`settings process leaves memory ownership with Core (legacy=${legacy})`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-memory-owner-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config=path.join(root,'Config','config.json'),file=path.join(root,'Config','memory','eyra.sqlite');
 fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'{}');
 const bytes=Buffer.from('unopened legacy database fixture');
 if(legacy){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 const service=createService(config);
 try{
  assert.equal(service.methods.includes('agent:memory'),false);
  assert.throws(()=>service.call('agent:memory',{arguments:{action:'status'}}),/未知操作/);
  assert.equal(fs.existsSync(path.join(root,'Data','memory')),false);
  if(legacy)assert.deepEqual(fs.readFileSync(file),bytes);
 }finally{service.close();}
});
