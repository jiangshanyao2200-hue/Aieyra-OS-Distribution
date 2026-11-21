// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/runtime-env.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {linkEnvironment}=require('../host/runtime-env.cjs');
const {prepareLinkEnvironment}=require('../host/runtime-env.cjs');

test('Link uses Config for settings and Data for runtime state',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'beta-env-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const env=linkEnvironment({PATH:'p'},path.join(dir,'Config'));
 assert.equal(env.AIEYRA_CONTROL_PORT,String(require('../src/resources.cjs').read('运行参数.json').control_port));
 assert.equal(env.AIEYRA_CONTROL_DATA,path.join(dir,'Data','link','control'));
 assert.equal(env.AIEYRA_CONTROL_STORAGE,path.join(dir,'Config','link','control-storage.json'));
 assert.equal(env.AIEYRA_LINK_DATA_DIR,path.join(dir,'Data','link','hub'));
 assert.equal(env.AIEYRA_OS_CONFIG_DIR,path.join(dir,'Data'));
 assert.ok(fs.statSync(env.AIEYRA_CONTROL_DATA).isDirectory()&&fs.statSync(env.AIEYRA_LINK_DATA_DIR).isDirectory());
 assert.equal(env.PATH,'p');
});

test('unified profiles have separate runtime, stable ports and reject occupied foreign offices',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-office-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 function profile(name){const root=path.join(dir,name),cfg=path.join(root,'Config');fs.mkdirSync(cfg,{recursive:true});fs.writeFileSync(path.join(cfg,'config.json'),'{}');fs.writeFileSync(path.join(root,'.aieyra-userdata.json'),JSON.stringify({schema:'aieyra.user-data/1',id:'b'.repeat(32),state:'ready',config:'Config/config.json'}));return cfg;}
 const a=profile('a'),b=profile('b'),one=await prepareLinkEnvironment({},a),two=await prepareLinkEnvironment({},b);
 assert.notEqual(one.AIEYRA_CONTROL_SCOPE,two.AIEYRA_CONTROL_SCOPE);assert.notEqual(one.AIEYRA_CONTROL_RUNTIME,two.AIEYRA_CONTROL_RUNTIME);
 assert.equal((await prepareLinkEnvironment({},a)).AIEYRA_CONTROL_PORT,one.AIEYRA_CONTROL_PORT);
 const server=require('node:http').createServer((_req,res)=>res.end(JSON.stringify({service:'aieyra-control',profile_scope:two.AIEYRA_CONTROL_SCOPE})));
 await new Promise(resolve=>server.listen(Number(one.AIEYRA_CONTROL_PORT),'127.0.0.1',resolve));
 try{
  const moved=await prepareLinkEnvironment({},a);assert.notEqual(moved.AIEYRA_CONTROL_PORT,one.AIEYRA_CONTROL_PORT);assert.equal(moved.AIEYRA_CONTROL_SCOPE,one.AIEYRA_CONTROL_SCOPE);
  const instance=path.join(a,'link','instance.json'),port=Number(one.AIEYRA_CONTROL_PORT),scope=one.AIEYRA_CONTROL_SCOPE;
  fs.writeFileSync(instance,JSON.stringify({schema:1,scope,port}));
  fs.writeFileSync(path.join(a,'link','together-owner.json'),JSON.stringify({schema:1,owner:'together',scope,port}));
  assert.equal((await prepareLinkEnvironment({},a)).AIEYRA_CONTROL_PORT,one.AIEYRA_CONTROL_PORT);
  assert.equal(JSON.parse(fs.readFileSync(instance,'utf8')).port,port);
 }
 finally{await new Promise(resolve=>server.close(resolve));}
 const pinned=await prepareLinkEnvironment({AIEYRA_CONTROL_PORT:'45678'},a);assert.equal(pinned.AIEYRA_CONTROL_PORT,'45678');
});

test('explicit isolated test values are kept',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'beta-env-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const given={AIEYRA_CONTROL_PORT:'45678',AIEYRA_CONTROL_DATA:path.join(dir,'c'),AIEYRA_LINK_DATA_DIR:path.join(dir,'h')};
 const env=linkEnvironment(given,path.join(dir,'cfg'));
 assert.equal(env.AIEYRA_CONTROL_PORT,'45678');assert.equal(env.AIEYRA_CONTROL_DATA,given.AIEYRA_CONTROL_DATA);assert.equal(env.AIEYRA_LINK_DATA_DIR,given.AIEYRA_LINK_DATA_DIR);
 assert.equal(given.AIEYRA_CONTROL_STORAGE,undefined,'input object is not mutated');
});
