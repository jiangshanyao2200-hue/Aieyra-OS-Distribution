// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; cfg; fixture; clean; childSave; windowsReader; afterActualDenial
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/config-atomic-save.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const cfg=require('../src/config.cjs'),spec=require('../src/spec.cjs');

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-config-replace-')),file=path.join(root,'Config','config.json');
 fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,JSON.stringify({...spec.defaults(),language:'zh-CN',future_setting:{keep:true}}));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return {root,file,before:fs.readFileSync(file),loaded:cfg.load(file)};
}
const clean=x=>assert.deepEqual(fs.readdirSync(path.dirname(x.file)),['config.json']);
function childSave(x,expected,language='en'){
 const script="const cfg=require(process.argv[1]);try{const r=cfg.load(process.argv[2]);cfg.save(r.file,{...r.settings,language:process.argv[4]},process.argv[3]);console.log(JSON.stringify({ok:true}));}catch(e){console.log(JSON.stringify({code:e.code}));}";
 const result=spawnSync(process.execPath,['-e',script,require.resolve('../src/config.cjs'),x.file,expected,language],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr||result.error?.message);return JSON.parse(result.stdout);
}

test('configuration replacement retries only rename under the same CAS lock and preserves unknown fields',t=>{
 const x=fixture(t),rename=fs.renameSync,stages=[];let attempts=0;
 fs.renameSync=function(from,to){
  if(to!==x.file)return rename.apply(this,arguments);
  stages.push(from);assert(fs.existsSync(x.file+'.write-lock'));
  if(attempts++<2){assert.deepEqual(fs.readFileSync(x.file),x.before);throw Object.assign(Error('transient reader'),{code:attempts===1?'EPERM':'EACCES'});}
  return rename.apply(this,arguments);
 };
 try{const saved=cfg.save(x.file,{...x.loaded.settings,language:'en'},x.loaded.version);assert.equal(saved.version,cfg.version(x.file));}
 finally{fs.renameSync=rename;}
 assert.equal(attempts,3);assert.equal(new Set(stages).size,1);
 const after=JSON.parse(fs.readFileSync(x.file));assert.equal(after.language,'en');assert.deepEqual(after.future_setting,{keep:true});clean(x);
});

test('a nontransient replacement failure preserves original bytes and removes only its own stage',t=>{
 const x=fixture(t),rename=fs.renameSync;let attempts=0;
 const stale=x.file+'.tmp.stale';fs.writeFileSync(stale,'unrelated prior stage');
 fs.renameSync=function(from,to){if(to!==x.file)return rename.apply(this,arguments);attempts++;throw Object.assign(Error('disk failure'),{code:'EIO'});};
 try{assert.throws(()=>cfg.save(x.file,{...x.loaded.settings,language:'en'},x.loaded.version),{code:'EIO'});}
 finally{fs.renameSync=rename;}
 assert.equal(attempts,1);assert.deepEqual(fs.readFileSync(x.file),x.before);assert.equal(fs.readFileSync(stale,'utf8'),'unrelated prior stage');
 fs.unlinkSync(stale);clean(x);
});

test('a real competing process cannot write or remove another writer CAS lock',t=>{
 const x=fixture(t);
 cfg.withWriteLock(x.file,x.loaded.version,()=>{
  assert.deepEqual(childSave(x,x.loaded.version),{code:'config_busy'});
  assert(fs.existsSync(x.file+'.write-lock'));assert.deepEqual(fs.readFileSync(x.file),x.before);
 });clean(x);
});

test('a stale CAS save cannot overwrite a completed save from a real competing process',t=>{
 const x=fixture(t);assert.deepEqual(childSave(x,x.loaded.version),{ok:true});
 const committed=fs.readFileSync(x.file);assert.equal(JSON.parse(committed).language,'en');
 assert.throws(()=>cfg.save(x.file,x.loaded.settings,x.loaded.version),{code:'version_conflict'});
 assert.deepEqual(fs.readFileSync(x.file),committed);clean(x);
});

async function windowsReader(x,{afterDenial=""}={}){
 const ready=path.join(x.root,'reader-ready'),release=path.join(x.root,'reader-release'),trigger=path.join(x.root,'reader-trigger'),done=path.join(x.root,'reader-done');
 const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const script=[
  '$ErrorActionPreference="Stop"',
  '$stream=[IO.File]::Open($env:AIEYRA_TEST_CONFIG,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)',
  'try {',
  ' [IO.File]::WriteAllText($env:AIEYRA_TEST_READY,"ready")',
  ' $timer=[Diagnostics.Stopwatch]::StartNew();$changed=$false',
  ' while($timer.ElapsedMilliseconds -lt 10000 -and -not [IO.File]::Exists($env:AIEYRA_TEST_RELEASE)){',
  '  if(-not $changed -and [IO.File]::Exists($env:AIEYRA_TEST_TRIGGER)){',
  '   if($env:AIEYRA_TEST_ACTION -eq "change"){[IO.File]::WriteAllText($env:AIEYRA_TEST_CONFIG,$env:AIEYRA_TEST_NEW_BYTES)}',
  '   if($env:AIEYRA_TEST_ACTION -eq "release"){$stream.Dispose()}',
  '   $changed=$true;[IO.File]::WriteAllText($env:AIEYRA_TEST_DONE,"done")',
  '  }',
  '  Start-Sleep -Milliseconds 5',
  ' }',
  '} finally {$stream.Dispose()}',
 ].join('\n');
 const bytes=JSON.stringify({...JSON.parse(x.before),language:'en',external_update:'preserve'});
 const child=spawn(shell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,AIEYRA_TEST_CONFIG:x.file,AIEYRA_TEST_READY:ready,AIEYRA_TEST_RELEASE:release,AIEYRA_TEST_TRIGGER:trigger,AIEYRA_TEST_DONE:done,AIEYRA_TEST_ACTION:afterDenial,AIEYRA_TEST_NEW_BYTES:bytes},stdio:['ignore','ignore','pipe']});
 let stderr='',failure;child.stderr.on('data',b=>stderr+=b);child.on('error',e=>failure=e);
 const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const start=Date.now();
 while(!fs.existsSync(ready)){
  if(failure||child.exitCode!==null||Date.now()-start>5000){child.kill();await ended;throw failure||Error('Windows reader did not open: '+stderr);}
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 return {bytes,afterDenial(){
  fs.writeFileSync(trigger,'actual rename was denied');const deadline=Date.now()+5000,pause=new Int32Array(new SharedArrayBuffer(4));
  while(!fs.existsSync(done)){if(Date.now()>deadline)throw Error('Windows reader did not acknowledge actual rename denial');Atomics.wait(pause,0,0,10);}
 },async close(){fs.writeFileSync(release,'release');const stop=setTimeout(()=>child.kill(),3000);try{const result=await ended;assert.equal(result.code,0,stderr);}finally{clearTimeout(stop);}}};
}

// Coordinate after a real denied rename. Wall-clock timers raced PowerShell's
// startup/JIT under the full suite and could expire before it serviced the action.
function afterActualDenial(x,reader,fn){
 const rename=fs.renameSync;let signalled=false;
 fs.renameSync=function(from,to){try{return rename.apply(this,arguments);}catch(error){
  if(to===x.file&&!signalled){assert(['EPERM','EACCES','EBUSY'].includes(error.code));signalled=true;reader.afterDenial();}throw error;
 }};
 try{fn();assert(signalled,'the filesystem must actually deny replacement first');}finally{fs.renameSync=rename;}
}

test('Windows temporary reader denial is recovered by actual filesystem replacement', {skip:process.platform!=='win32'},async t=>{
 const x=fixture(t),reader=await windowsReader(x,{afterDenial:'release'});
 try{afterActualDenial(x,reader,()=>cfg.save(x.file,{...x.loaded.settings,language:'en'},x.loaded.version));assert.equal(JSON.parse(fs.readFileSync(x.file)).language,'en');clean(x);}
 finally{await reader.close();}
});

test('Windows persistent reader denial fails without deleting original config or leaving a stage', {skip:process.platform!=='win32'},async t=>{
 const x=fixture(t),reader=await windowsReader(x);
 try{assert.throws(()=>cfg.save(x.file,{...x.loaded.settings,language:'en'},x.loaded.version),e=>['EPERM','EACCES','EBUSY'].includes(e.code));assert.deepEqual(fs.readFileSync(x.file),x.before);clean(x);}
 finally{await reader.close();}
});

test('Windows retry refuses an actual external file update even if that writer bypasses the CAS lock', {skip:process.platform!=='win32'},async t=>{
 const x=fixture(t),reader=await windowsReader(x,{afterDenial:'change'});
 try{afterActualDenial(x,reader,()=>assert.throws(()=>cfg.save(x.file,{...x.loaded.settings,language:'fr'},x.loaded.version),{code:'version_conflict'}));assert.equal(fs.readFileSync(x.file,'utf8'),reader.bytes);clean(x);}
 finally{await reader.close();}
});
