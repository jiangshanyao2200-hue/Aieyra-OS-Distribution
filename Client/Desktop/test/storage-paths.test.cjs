// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; paths
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/storage-paths.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const paths=require('../src/paths.cjs');
test('private storage maps canonical and explicit configurations without creating or mixing data',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'storage-contract-'));
 try{
  const portable=path.join(base,'Config','config.json'),isolated=path.join(base,'validation','config.json');
  assert.equal(paths.privatePath(portable,'memory'),path.join(base,'Data','memory'));
  assert.equal(paths.privatePath(isolated,'memory'),path.join(base,'validation','memory'));
  assert.equal(paths.privatePath(portable,'attachments'),path.join(base,'Data','runtime','attachments'));
  assert.equal(paths.privatePath(portable,'sessions'),path.join(base,'Data','sessions'));
  assert.throws(()=>paths.privatePath(portable,'../outside'),/Unknown private storage area/);
  assert.deepEqual(fs.readdirSync(base),[]);
  const shared=paths.privateStorage(portable).find(a=>a.id==='attachments');
  assert.equal(shared.cleanup,'shared-reference');shared.owner='changed';
  assert.equal(paths.privateStorage(portable).find(a=>a.id==='attachments').owner,'asset-service');
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
