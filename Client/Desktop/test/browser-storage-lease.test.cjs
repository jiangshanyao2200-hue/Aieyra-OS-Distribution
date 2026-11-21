// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; storage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-storage-lease.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {acquireBrowserStorage}=require('../src/browser-storage-lease.cjs');
function storage(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-browser-lease-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,file:path.join(dir,'.browser-host.lock')};}
test('live browser storage owner excludes a second host and releases idempotently',t=>{
 const {dir,file}=storage(t),release=acquireBrowserStorage(dir),before=fs.readFileSync(file,'utf8');
 assert.throws(()=>acquireBrowserStorage(dir),/in use/);assert.equal(fs.readFileSync(file,'utf8'),before);release();release();assert(!fs.existsSync(file));
});
test('an exited host lease is recovered using its exact stale token',t=>{
 const {dir,file}=storage(t),child=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8',windowsHide:true});assert.equal(child.status,0);
 const pid=Number(child.stdout);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 fs.writeFileSync(file,JSON.stringify({pid,token:'a'.repeat(48)}));const release=acquireBrowserStorage(dir);const next=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(next.pid,process.pid);assert.notEqual(next.token,'a'.repeat(48));release();assert(!fs.existsSync(file));
});
test('malformed or unidentified owner locks remain untouched',t=>{
 const {dir,file}=storage(t);
 for(const value of ['{',JSON.stringify({pid:0,token:'a'.repeat(48)}),JSON.stringify({pid:2147483647}),JSON.stringify({pid:2147483647,token:''})]){
  fs.writeFileSync(file,value);assert.throws(()=>acquireBrowserStorage(dir),/unreadable|Invalid/);assert.equal(fs.readFileSync(file,'utf8'),value);
 }
});
test('an old release cannot remove a replacement owner token',t=>{
 const {dir,file}=storage(t),release=acquireBrowserStorage(dir),replacement=JSON.stringify({pid:process.pid,token:'b'.repeat(48)});
 fs.writeFileSync(file,replacement);release();assert.equal(fs.readFileSync(file,'utf8'),replacement);
});
