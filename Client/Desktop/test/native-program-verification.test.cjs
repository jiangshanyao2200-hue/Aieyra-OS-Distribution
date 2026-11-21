// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: catalog; item
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/native-program-verification.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const catalog=require('../../../Program/official/catalog.cjs');
const {createNativeProgramVerification}=require('../host/native-program-verification.cjs');
const item=own=>({manifest:structuredClone(own.manifest),directory:own.root,origin:'official',enabled:true,digest:own.id+'-verification-fixture'});

test('full Workspace byte verification performs no package reads on the caller thread',async t=>{
 const verifier=createNativeProgramVerification();t.after(()=>verifier.close());
 const own=catalog.find('workspace'),read=fs.readFileSync;let mainReads=0;
 t.mock.method(fs,'readFileSync',function(file,...args){if(String(file).startsWith(own.root))mainReads++;return read.call(this,file,...args);});
 await verifier.verify(item(own));assert.equal(mainReads,0);
});

test('worker admissions reject subsequent same-size tampering and linked installed files',async t=>{
 const own=catalog.find('center'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-verify-worker-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 for(const name of Object.keys(own.manifest.files)){const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(own.root,name),file);}
 const verifier=createNativeProgramVerification();t.after(()=>verifier.close());const row={...item(own),directory};
 await verifier.verify(row);
 const file=path.join(directory,'service.cjs'),bytes=fs.readFileSync(file),stat=fs.statSync(file),tampered=Buffer.from(bytes);tampered[0]^=1;
 fs.writeFileSync(file,tampered);fs.utimesSync(file,stat.atime,stat.mtime);
 await assert.rejects(verifier.verify(row),/内容已变化/);
 fs.writeFileSync(file,bytes);await verifier.verify(row);
 fs.linkSync(file,path.join(directory,'linked-service.cjs'));
 await assert.rejects(verifier.verify(row),/不能经过链接/);
});

test('revocation while asynchronous verification is pending rejects the late admission',async t=>{
 const row=item(catalog.find('center'));let release,entered;
 const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),effects=[];
 const native=require('../../../Program/runtime/native.cjs').createNativePrograms({resolve:async()=>row,verify:async()=>{entered();await gate;},adapters:{center:{close:()=>effects.push('closed')}}});
 t.after(()=>native.shutdown());
 const opening=native.run('center',()=>effects.push('opened')).then(value=>({value}),error=>({error}));
 await started;await native.reconcile([]);release();assert.equal((await opening).error.code,'PROGRAM_ADMISSION_CHANGED');assert.deepEqual(effects,[]);
});

test('worker failure rejects pending checks, retries with a fresh worker, and closes once',async()=>{
 const workers=[];
 class FixtureWorker extends EventEmitter{
  constructor(){super();workers.push(this);this.terminations=0;}
  ref(){}unref(){}postMessage(message){this.last=message;}
  terminate(){this.terminations++;return Promise.resolve(0);}
 }
 const verifier=createNativeProgramVerification({WorkerClass:FixtureWorker});
 const failed=verifier.verify({}).then(()=>null,error=>error);workers[0].emit('error',Error('fixture worker failed'));
 assert.match((await failed).message,/fixture worker failed/);assert.equal(workers[0].terminations,1);
 const next=verifier.verify({});assert.equal(workers.length,2);workers[1].emit('message',{id:workers[1].last.id,ok:true});await next;
 const pending=verifier.verify({}).then(()=>null,error=>error),one=verifier.close(),two=verifier.close();
 assert.equal(one,two);await one;assert.match((await pending).message,/已关闭/);assert.equal(workers[1].terminations,1);
 workers[1].emit('message',{id:workers[1].last.id,ok:true});await assert.rejects(verifier.verify({}),/已关闭/);
});
