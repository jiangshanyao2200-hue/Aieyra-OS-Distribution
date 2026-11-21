// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture; exitedPID
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/draft-write-lock.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {acquireDraftWriteLock}=require('../host/draft-write-lock.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eyra-draft-lock-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return path.join(dir,'draft.write-lock');}
async function exitedPID(){const child=spawn(process.execPath,['-e',''],{windowsHide:true,stdio:'ignore'});const pid=child.pid;await once(child,'exit');return pid;}
test('legacy lock from an exited real process is recovered without changing the draft',async t=>{
 const file=await fixture(t),original=Buffer.from('用户正文\r\n🙂');await fs.writeFile(file+'.draft',original);
 await fs.writeFile(file,JSON.stringify({pid:await exitedPID(),created:Date.now()}));
 const release=await acquireDraftWriteLock(file);await release();
 await assert.rejects(fs.stat(file),{code:'ENOENT'});assert.deepEqual(await fs.readFile(file+'.draft'),original);
});
test('a living legacy owner is waited for and is never removed because of age',async t=>{
 const file=await fixture(t),bytes=JSON.stringify({pid:process.pid,created:1});await fs.writeFile(file,bytes);
 await assert.rejects(acquireDraftWriteLock(file,{timeout:90}),{code:'draft_busy'});assert.equal(await fs.readFile(file,'utf8'),bytes);
 const delayed=acquireDraftWriteLock(file);setTimeout(()=>{void fs.unlink(file);},65);const release=await delayed;await release();
});
test('unreadable or unidentified owner remains intact and release cannot erase replacement ownership',async t=>{
 const file=await fixture(t);
 for(const text of ['', '{broken', '{"pid":0}', '{"pid":"12"}']){
  await fs.writeFile(file,text);await assert.rejects(acquireDraftWriteLock(file,{timeout:40}),{code:'draft_busy'});assert.equal(await fs.readFile(file,'utf8'),text);await fs.unlink(file);
 }
 const release=await acquireDraftWriteLock(file);const replacement=JSON.stringify({pid:process.pid,token:'replacement'});await fs.writeFile(file,replacement);await release();assert.equal(await fs.readFile(file,'utf8'),replacement);
});
test('kernel gate survives an owner crash and serializes simultaneous stale-lock recovery',async t=>{
 const file=await fixture(t),helper=path.resolve(__dirname,'../host/draft-write-lock.cjs');
 const child=spawn(process.execPath,['-e',`require(process.argv[1]).acquireDraftWriteLock(process.argv[2]).then(()=>{process.stdout.write('held\\n');setInterval(()=>{},1000);});`,helper,file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&!child.killed)child.kill();});await once(child.stdout,'data');const ended=once(child,'exit');child.kill();await ended;
 await assert.rejects(fs.stat(file),{code:'ENOENT'});
 await fs.writeFile(file,JSON.stringify({pid:child.pid,created:Date.now()}));
 let simultaneous=0,max=0;
 await Promise.all(Array.from({length:6},async()=>{const release=await acquireDraftWriteLock(file);max=Math.max(max,++simultaneous);await new Promise(r=>setTimeout(r,15));simultaneous--;await release();}));
 assert.equal(max,1);await assert.rejects(fs.stat(file),{code:'ENOENT'});
});
