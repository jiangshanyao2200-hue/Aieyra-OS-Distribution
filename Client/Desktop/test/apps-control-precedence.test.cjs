// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/apps-control-precedence.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApps,controlInterpreter}=require('../host/apps.cjs');
function fixture(t,platform='win32'){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'control-discovery-')),root=path.join(base,'OS'),python=path.join(base,'runtime',platform==='win32'?'python.exe':'python3');
 const write=(relative,value='fixture')=>{const file=path.join(base,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);return file;};
 write(path.relative(base,python));
 const manager=createApps({root,programs:path.join(base,'programs'),platform,env:{AIEYRA_CONTROL_PYTHON:python}});
 t.after(()=>{manager.close();fs.rmSync(base,{recursive:true,force:true});});
 return {root,base,write,python,manager,status:()=>manager.call({action:'status',app_id:'aieyra.control'})};
}
test('OS module is the only Control authority, using Python on all host platforms',async t=>{
 for(const platform of ['win32','linux','darwin']){
  const f=fixture(t,platform),entry=f.write('OS/Control/app/service/main.py'),legacy=f.write('Aieyra Control/Aieyra Control.exe','legacy');
  const result=await f.status();assert.equal(result.entry,entry);assert.equal(result.executable,f.python);assert.deepEqual(result.args,['-X','utf8',entry]);assert.equal(result.embedded,true);assert.equal(result.independent,false);assert.equal(result.installationSupported,false);assert.equal(fs.readFileSync(legacy,'utf8'),'legacy');
  for(const action of ['resolve','acquire','install'])await assert.rejects(f.manager.call({action,app_id:'aieyra.control'}),/随 Aieyra OS 构建与更新/);
 }
});
test('external and legacy Control are ignored when internal module is missing',async t=>{
 const f=fixture(t);f.write('Aieyra Control/Aieyra Control.exe');f.write('OS/CONTROL/desktop/main.cjs');
 assert.equal((await f.status()).installed,false);
 await assert.rejects(f.manager.call({action:'install',app_id:'aieyra.control'}),/OS/);
 for(const action of ['resolve','acquire'])await assert.rejects(f.manager.call({action,app_id:'aieyra.control'}),/OS/);
 assert.equal(fs.existsSync(path.join(f.base,'cache')),false);
});
test('redirected internal service cannot escape into external software',async t=>{
 const f=fixture(t);const external=path.dirname(f.write('external/service/main.py'));fs.mkdirSync(path.join(f.root,'Control'),{recursive:true});fs.symlinkSync(path.dirname(external),path.join(f.root,'Control','app'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(f.status,/应用路径不能经过链接/);
});

test('shared Control interpreter prefers bundled Python and validates explicit overrides',t=>{
 const f=fixture(t),relative='OS/Control/app/runtime/python/python.exe',bundled=f.write(relative);
 assert.equal(controlInterpreter({root:f.root,platform:'win32',env:{}}),bundled);
 assert.equal(controlInterpreter({root:f.root,platform:'win32',env:{AIEYRA_CONTROL_PYTHON:f.python}}),f.python);
 assert.throws(()=>controlInterpreter({root:f.root,platform:'win32',env:{AIEYRA_CONTROL_PYTHON:'python'}}),/绝对路径/);
 assert.throws(()=>controlInterpreter({root:f.root,platform:'win32',env:{AIEYRA_CONTROL_PYTHON:path.join(f.base,'missing.exe')}}));
 fs.rmSync(bundled);assert.equal(controlInterpreter({root:f.root,platform:'win32',env:{}}),'python');
 assert.equal(controlInterpreter({root:f.root,platform:'darwin',env:{}}),'python3');
});
