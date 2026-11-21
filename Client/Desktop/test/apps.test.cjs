// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/apps.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApps}=require('../host/apps.cjs');
function fixture(t){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'os-apps-')),root=path.join(temp,'OS'),programs=path.join(temp,'Programs');fs.mkdirSync(root);
 const manager=createApps({root,programs,platform:'win32'});
 t.after(()=>{manager.close();fs.rmSync(temp,{recursive:true,force:true});});
 return {temp,root,programs,manager};
}
test('OS modules ignore old installations and preserve their data while refusing independent installs',async t=>{
 const f=fixture(t);
 for(const [id,name]of [['aieyra.link','Aieyra Link'],['aieyra.control','Aieyra Control']]){
  const legacy=path.join(f.programs,name);fs.mkdirSync(legacy,{recursive:true});fs.writeFileSync(path.join(legacy,'identity.json'),'personal');
  const state=await f.manager.call({action:'status',app_id:id});assert.equal(state.installed,false);assert.equal(state.installationSupported,false);
  for(const action of ['install','resolve','acquire'])await assert.rejects(f.manager.call({action,app_id:id}),/OS/);
  assert.equal(fs.readFileSync(path.join(legacy,'identity.json'),'utf8'),'personal');
 }
 const listed=await f.manager.call({action:'list'});assert.deepEqual(listed.apps.map(row=>row.app_id),['aieyra.link','aieyra.control']);
 assert.deepEqual(fs.readdirSync(f.root),[]);
});
test('module discovery keeps request validation and final shutdown boundaries',async t=>{
 const f=fixture(t);
 for(const p of [null,[],{action:'unknown'},{action:'status',extra:true},{action:'status',app_id:'other'},{action:'install',app_id:'aieyra.link',target_platform:'linux'}])await assert.rejects(f.manager.call(p));
 f.manager.close();await assert.rejects(f.manager.call({action:'status'}),/关闭/);
});
