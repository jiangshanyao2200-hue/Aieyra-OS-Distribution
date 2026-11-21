// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/session-model.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../src/service.cjs'),spec=require('../src/spec.cjs'),cfg=require('../src/config.cjs'),selection=require('../src/session-model.cjs');
const {withLegacyProfiles}=require('./pool-fixture.cjs');
test('alpha: session switch survives restart without changing other sessions or default',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-alpha-session-')),file=path.join(dir,'config.json');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(file,JSON.stringify(withLegacyProfiles({...spec.defaults(),api_key:'sk-session-fixture'})));
 let service=createService(file);t.after(()=>service.close());
 const call=(session,action,arguments_={})=>service.call('system:settings',{session_id:session,action,arguments:arguments_});
 const before=fs.readFileSync(file,'utf8'),first=await call('a','read');
 const switched=await call('a','switch',{id:'deepseek-v4-pro',expected_version:first.version,expected_session_version:first.session_version});
 assert.equal(switched.ok,true,JSON.stringify(switched));assert.equal(switched.settings.model,'deepseek-v4-pro');
 assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal((await call('b','read')).settings.model,'deepseek-flash');
 assert.equal((await call('a','switch',{id:'deepseek-flash',expected_version:first.version,expected_session_version:first.session_version})).code,'version_conflict');
 service.close();service=createService(file);
 assert.equal((await call('a','read')).effective_profile,'deepseek-v4-pro');
 const disk=JSON.parse(fs.readFileSync(selection.filename(file,'a'),'utf8'));
 assert.deepEqual(Object.keys(disk).sort(),['profile_id','schema_version','updated_at']);
 const global=await call('','switch',{id:'deepseek-v4-pro',expected_version:cfg.version(file)});assert.equal(global.ok,true);
 let current=await call('a','read');
 const reset=await call('a','switch',{reset:true,expected_version:current.version,expected_session_version:current.session_version});
 assert.equal(reset.selection_scope,'default');
 await call('','switch',{id:'deepseek-flash',expected_version:cfg.version(file)});
 assert.equal((await call('a','read')).effective_profile,'deepseek-flash');
 current=await call('a','read');
 await call('a','switch',{id:'deepseek-v4-pro',expected_version:current.version,expected_session_version:current.session_version});
 await call('','pool_action',{operation:'toggle',id:'deepseek-v4-pro',expected_version:cfg.version(file)});
 const blocked=await call('a','read');assert.match(blocked.session_error,/禁用/);assert.equal(blocked.effective_profile,'deepseek-v4-pro');
 assert.equal((await call('b','read')).effective_profile,'deepseek-flash');
 assert(!JSON.stringify(blocked).includes('sk-session-fixture'));
 fs.writeFileSync(selection.filename(file,'a'),'{broken');
 assert.equal((await call('a','read')).ok,false);
 assert.equal((await call('b','read')).ok,true);
});
