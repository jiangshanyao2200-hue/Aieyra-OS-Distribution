// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: f; fixture; crashFixture; childBootstrap; until
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/managed-update-bootstrap.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const f=require('../src/managed-update-files.cjs'),{promoteBootstrap}=require('../src/managed-update-bootstrap.cjs');
function fixture(t,{legacy=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'os-bootstrap-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const keys=crypto.generateKeyPairSync('ed25519');
 const put=(name,bytes)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
 const sign=p=>{const b=Buffer.from(JSON.stringify(p));return {algorithm:'Ed25519',payload:b.toString('base64'),signature:crypto.sign(null,b,keys.privateKey).toString('base64')};};
 const files={},texts={},bootstrap=[];
 for(const [current,destination]of Object.entries(f.BOOTSTRAP)){
  const source=legacy?current.replace(/^Client\//,''):current;
  const value=source.endsWith('cli.exe')?Buffer.from([77,90,0,1,2,3]):Buffer.from('signed '+destination+'\n');
  put(source,value);files[source]={sha256:f.hash(value),size:value.length};bootstrap.push({source,destination,...files[source]});
  if(!source.endsWith('.exe'))texts[source]=value.toString();
 }
 const payload={schema:'aieyra-os-baseline-v1',product:'aieyra-os',version:'0.2.28',sequence:14,files,texts,bootstrap};
 const envelope=sign(payload);put('Config/official-baseline.json',JSON.stringify(envelope));
 const release='os-0.2.28-14',plan={phase:'committed',release,root,version:payload.version,sequence:payload.sequence};
 function commit(){put('.aieyra-updates/transaction.json',JSON.stringify({release,phase:'committed'}));put('.aieyra-updates/'+release+'/apply.json',JSON.stringify(plan));}
 const run=ioHooks=>promoteBootstrap({root,publicKey:keys.publicKey,ioHooks});
 return {root,put,sign,payload,envelope,keys,run,commit,plan,release};
}
function crashFixture(x,row=x.payload.bootstrap[0]){
 const temp=row.destination+'.bootstrap-'+'a'.repeat(32)+'.tmp';
 x.put(temp,fs.readFileSync(path.join(x.root,row.source)));fs.linkSync(path.join(x.root,temp),path.join(x.root,row.destination));
 x.put('.aieyra-updates/bootstrap.json',JSON.stringify({identity:f.hash(x.envelope.payload),temporary:{destination:row.destination,temp}}));
 return temp;
}
test('relocated reader restores an original signed bootstrap after a committed full-package migration',async t=>{
 const x=fixture(t,{legacy:true}),before=JSON.stringify(x.envelope);
 const parsed=f.verifySigned(x.envelope,x.keys.publicKey,'baseline');
 assert.equal(parsed.texts.LICENSE,'signed LICENSE\n');assert.equal(JSON.stringify(x.envelope),before);
 assert.equal((await x.run()).phase,'deferred');x.commit();
 const result=await x.run();assert.equal(result.phase,'complete');assert.equal(result.installed.length,4);
 for(const row of x.payload.bootstrap)assert.deepEqual(fs.readFileSync(path.join(x.root,row.destination)),fs.readFileSync(path.join(x.root,row.source)));
 const bad=structuredClone(x.payload),row=bad.bootstrap[0],alias='Client/'+row.source;
 bad.files[alias]=bad.files[row.source];bad.bootstrap[1]={...row,source:alias};
 assert.throws(()=>f.verifySigned(x.sign(bad),x.keys.publicKey,'baseline'),/映射/);
 const tampered=structuredClone(x.payload);tampered.bootstrap[0].sha256='0'.repeat(64);
 assert.throws(()=>f.verifySigned(x.sign(tampered),x.keys.publicKey,'baseline'),/摘要/);
});
function childBootstrap(x,hold=false){
 const script=`const {promoteBootstrap}=require(process.argv[1]);promoteBootstrap({root:process.argv[2],publicKey:process.argv[3],ioHooks:{beforePublish:async()=>{if(${hold}){process.stdout.write('LOCKED\\n');await new Promise(()=>{});}}}}).then(value=>process.stdout.write(JSON.stringify(value)+'\\n'),error=>{process.stderr.write(error.stack);process.exitCode=1;});`;
 // 空悬 Promise 不维持进程；仅被模拟崩溃的子进程需要存活心跳。
 const child=spawn(process.execPath,['-e',(hold?'setInterval(()=>{},1000);':'')+script,require.resolve('../src/managed-update-bootstrap.cjs'),x.root,x.keys.publicKey.export({type:'spki',format:'pem'})],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='',error='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>error+=part);
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal,output,error}));});
 return {child,done,output:()=>output};
}
async function until(predicate){
 const deadline=Date.now()+5000;
 while(!predicate()){if(Date.now()>deadline)throw Error('Timed out waiting for bootstrap child');await new Promise(resolve=>setTimeout(resolve,10));}
}
test('signed bootstrap expands fixed file and text inventory without altering the signed envelope',t=>{
 const x=fixture(t),before=JSON.stringify(x.envelope),p=f.verifySigned(x.envelope,x.keys.publicKey,'baseline');
 assert.equal(Object.keys(p.files).length,8);assert.equal(Object.keys(x.payload.files).length,4);
 assert.equal(p.texts.LICENSE,x.payload.texts['Client/Desktop/update-bootstrap/LICENSE']);assert.equal(JSON.stringify(x.envelope),before);
 for(const mutate of [p=>p.bootstrap.pop(),p=>p.bootstrap[0].destination='scripts/anything.ps1',p=>p.bootstrap[0].sha256='0'.repeat(64),p=>p.bootstrap[1]=p.bootstrap[0],p=>p.files.LICENSE=p.files['Client/Desktop/update-bootstrap/LICENSE'],p=>p.texts['Client/Desktop/update-bootstrap/LICENSE']='changed']){
  const invalid=structuredClone(x.payload);mutate(invalid);assert.throws(()=>f.verifySigned(x.sign(invalid),x.keys.publicKey,'baseline'));
 }
});
test('health window, rollback and stale committed identity never promote files',async t=>{
 const x=fixture(t);assert.equal((await x.run()).phase,'deferred');x.commit();x.put('.aieyra-updates/pending.json','{}');assert.equal((await x.run()).reason,'update_pending');
 fs.unlinkSync(path.join(x.root,'.aieyra-updates/pending.json'));x.put('.aieyra-updates/transaction.json',JSON.stringify({release:x.release,phase:'rolled_back'}));assert.equal((await x.run()).phase,'deferred');
 x.commit();x.put('.aieyra-updates/'+x.release+'/apply.json',JSON.stringify({...x.plan,sequence:13}));assert.equal((await x.run()).phase,'deferred');
 for(const dest of Object.values(f.BOOTSTRAP))assert.equal(fs.existsSync(path.join(x.root,dest)),false);
});
test('committed old update promotes exact complete bytes once and preserves personal data',async t=>{
 const x=fixture(t);x.commit();x.put('Prompt/自我.txt','personal');x.put('Client/Desktop/config.json','private');
 const result=await x.run({beforePublish(row,temp){assert.equal(fs.existsSync(path.join(x.root,row.destination)),false);assert.equal(f.fileHash(temp),row.sha256);}});
 assert.equal(result.phase,'complete');assert.equal(result.installed.length,4);
 for(const row of x.payload.bootstrap)assert.equal(f.fileHash(path.join(x.root,row.destination)),row.sha256);
 const second=await x.run();assert.equal(second.phase,'complete');assert.equal(second.installed.length,0);
 assert.equal(fs.readFileSync(path.join(x.root,'Prompt/自我.txt'),'utf8'),'personal');assert.equal(fs.readFileSync(path.join(x.root,'Client/Desktop/config.json'),'utf8'),'private');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(x.root,'Config/official-baseline.json'))),x.envelope);
});
test('fresh full package is a no-op without any update receipt',async t=>{
 const x=fixture(t);for(const row of x.payload.bootstrap)x.put(row.destination,fs.readFileSync(path.join(x.root,row.source)));
 assert.deepEqual(await x.run(),{phase:'complete',installed:[],conflicts:[]});assert.equal(fs.existsSync(path.join(x.root,'.aieyra-updates')),false);
});
test('different existing and racing local files are retained',async t=>{
 const x=fixture(t);x.commit();x.put('LICENSE','local license');
 const result=await x.run({beforePublish(row){if(row.destination==='Aieyra CLI.exe')x.put(row.destination,'local executable');}});
 assert.equal(result.phase,'conflict');assert.deepEqual(new Set(result.conflicts),new Set(['LICENSE','Aieyra CLI.exe']));
 assert.equal(fs.readFileSync(path.join(x.root,'LICENSE'),'utf8'),'local license');assert.equal(fs.readFileSync(path.join(x.root,'Aieyra CLI.exe'),'utf8'),'local executable');
});
test('invalid signature and changed staged bytes fail before any destination write',async t=>{
 const x=fixture(t);x.commit();x.put('Client/Desktop/update-bootstrap/LICENSE','tamper');await assert.rejects(()=>x.run(),/签名不一致/);
 assert.equal(fs.existsSync(path.join(x.root,'Aieyra CLI.exe')),false);
 x.put('Config/official-baseline.json',JSON.stringify({...x.envelope,signature:Buffer.alloc(64).toString('base64')}));await assert.rejects(()=>x.run(),/签名/);
});
test('write failure can resume partial promotion with no incomplete final name',async t=>{
 const x=fixture(t);x.commit();let calls=0;
 await assert.rejects(()=>x.run({beforePublish(){if(++calls===2)throw Error('synthetic interruption');}}),/synthetic interruption/);
 assert.equal(fs.existsSync(path.join(x.root,'Aieyra CLI.exe')),true);assert.equal(fs.existsSync(path.join(x.root,'LICENSE')),false);
 assert.equal((await x.run()).phase,'complete');
 assert.equal(fs.readdirSync(x.root).some(n=>n.includes('.bootstrap-')),false);
});
test('new pending transaction appearing during copy prevents publication',async t=>{
 const x=fixture(t);x.commit();let original,temp;
 assert.equal((await x.run({beforePublish(row,temporary){temp=temporary;original=fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json'));x.put('.aieyra-updates/pending.json','{}');}})).reason,'update_changed');
 assert.equal(fs.existsSync(path.join(x.root,'Aieyra CLI.exe')),false);assert.equal(fs.existsSync(temp),true);assert.deepEqual(fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json')),original);
 fs.unlinkSync(path.join(x.root,'.aieyra-updates/pending.json'));assert.equal((await x.run()).phase,'complete');assert.equal(fs.existsSync(temp),false);
});
test('crash immediately after exclusive publish recovers temporary hard link',async t=>{
 const x=fixture(t);x.commit();const row=x.payload.bootstrap[0],temp=crashFixture(x,row);
 assert.equal((await x.run()).phase,'complete');assert.equal(fs.existsSync(path.join(x.root,temp)),false);assert.equal(fs.statSync(path.join(x.root,row.destination)).nlink,1);
});
test('script crash recovery validates real signed parents before removing the temporary hard link',async t=>{
 const x=fixture(t);x.commit();const row=x.payload.bootstrap.find(row=>row.destination==='scripts/create-launchers.ps1'),temp=crashFixture(x,row);
 assert.equal((await x.run()).phase,'complete');assert.equal(fs.existsSync(path.join(x.root,temp)),false);assert.equal(fs.statSync(path.join(x.root,row.destination)).nlink,1);
 assert.equal(f.fileHash(path.join(x.root,row.destination)),row.sha256);
});
test('pending or rolled back updates leave crash recovery files and journal untouched',async t=>{
 const x=fixture(t);x.commit();const row=x.payload.bootstrap[2],temp=crashFixture(x,row),journal=fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json'));
 x.put('.aieyra-updates/pending.json','{}');assert.equal((await x.run()).reason,'update_pending');
 fs.unlinkSync(path.join(x.root,'.aieyra-updates/pending.json'));x.put('.aieyra-updates/transaction.json',JSON.stringify({release:x.release,phase:'rolled_back'}));
 assert.equal((await x.run()).reason,'awaiting_committed_update');assert.deepEqual(fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json')),journal);
 assert.equal(fs.statSync(path.join(x.root,temp)).nlink,2);assert.equal(fs.statSync(path.join(x.root,row.destination)).nlink,2);
 x.commit();assert.equal((await x.run()).phase,'complete');assert.equal(fs.existsSync(path.join(x.root,temp)),false);
});
test('transaction changes during copy retain the exact recovery journal until a commit',async t=>{
 const x=fixture(t);x.commit();let original,temp;
 const result=await x.run({beforePublish(row,temporary){temp=temporary;original=fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json'));x.put('.aieyra-updates/transaction.json',JSON.stringify({release:x.release,phase:'rolled_back'}));}});
 assert.equal(result.reason,'update_changed');assert.equal(fs.existsSync(temp),true);assert.deepEqual(fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json')),original);
 assert.equal(fs.existsSync(path.join(x.root,'Aieyra CLI.exe')),false);x.commit();assert.equal((await x.run()).phase,'complete');assert.equal(fs.existsSync(temp),false);
});
test('same-process and separate hosts defer without touching an active promotion',async t=>{
 const x=fixture(t);x.commit();let entered,continueFirst;
 const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>continueFirst=resolve);
 const first=x.run({async beforePublish(){entered();await gate;}});await Promise.race([ready,first.then(()=>{throw Error('Promotion ended before the concurrency checkpoint');})]);
 try{
  const before=fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json'));
  assert.deepEqual(await x.run(),{phase:'deferred',reason:'bootstrap_busy'});
  const second=childBootstrap(x);t.after(()=>second.child.kill());const result=await second.done;
  assert.equal(result.code,0,result.error);assert.deepEqual(JSON.parse(result.output),{phase:'deferred',reason:'bootstrap_busy'});
  assert.deepEqual(fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json')),before);
 }finally{continueFirst();}
 assert.equal((await first).phase,'complete');assert.equal((await x.run()).phase,'complete');
});
test('a killed host automatically releases exclusion and leaves recoverable complete temporary bytes',async t=>{
 const x=fixture(t);x.commit();const first=childBootstrap(x,true);t.after(()=>first.child.kill());
 await until(()=>first.output().includes('LOCKED'));
 assert.equal((await x.run()).reason,'bootstrap_busy');
 const journal=JSON.parse(fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json'))),temporary=path.join(x.root,journal.temporary.temp);
 assert.equal(fs.existsSync(temporary),true);first.child.kill();await first.done;
 assert.equal((await x.run()).phase,'complete');assert.equal(fs.existsSync(temporary),false);
 for(const row of x.payload.bootstrap)assert.equal(f.fileHash(path.join(x.root,row.destination)),row.sha256);
});
test('staged and destination hardlinks are rejected without writing through them',async t=>{
 const x=fixture(t);x.commit();x.put('external','personal');fs.linkSync(path.join(x.root,'external'),path.join(x.root,'LICENSE'));
 await assert.rejects(()=>x.run(),/链接/);assert.equal(fs.readFileSync(path.join(x.root,'external'),'utf8'),'personal');
 fs.unlinkSync(path.join(x.root,'LICENSE'));fs.unlinkSync(path.join(x.root,'Client/Desktop/update-bootstrap/LICENSE'));fs.linkSync(path.join(x.root,'external'),path.join(x.root,'Client/Desktop/update-bootstrap/LICENSE'));await assert.rejects(()=>x.run(),/链接/);
});
test('forged recovery paths and redirected script parents cannot remove unrelated files',async t=>{
 const x=fixture(t);x.commit();const row=x.payload.bootstrap[2],temp=crashFixture(x,row),journal=JSON.parse(fs.readFileSync(path.join(x.root,'.aieyra-updates/bootstrap.json')));
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'os-bootstrap-recovery-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 for(const mutation of [{identity:'0'.repeat(64)},{temporary:{destination:row.destination,temp:'../outside'}},{temporary:{destination:'scripts/anything.ps1',temp:'scripts/anything.ps1.bootstrap-'+'a'.repeat(32)+'.tmp'}}]){
  x.put('.aieyra-updates/bootstrap.json',JSON.stringify({...journal,...mutation}));await assert.rejects(()=>x.run(),/签名不一致/);assert.equal(fs.existsSync(path.join(x.root,temp)),true);
 }
 x.put('.aieyra-updates/bootstrap.json',JSON.stringify(journal));fs.renameSync(path.join(x.root,'scripts'),path.join(x.root,'saved-scripts'));
 fs.writeFileSync(path.join(outside,path.basename(temp)),'unrelated');fs.symlinkSync(outside,path.join(x.root,'scripts'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(()=>x.run(),/链接/);assert.equal(fs.readFileSync(path.join(outside,path.basename(temp)),'utf8'),'unrelated');
});
test('symlink parent and transaction directory cannot redirect installation',async t=>{
 const x=fixture(t);x.commit();const outside=fs.mkdtempSync(path.join(os.tmpdir(),'os-bootstrap-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 fs.symlinkSync(outside,path.join(x.root,'scripts'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>x.run(),/链接/);assert.deepEqual(fs.readdirSync(outside),[]);
 fs.unlinkSync(path.join(x.root,'scripts'));fs.renameSync(path.join(x.root,'.aieyra-updates'),path.join(x.root,'saved-updates'));fs.symlinkSync(outside,path.join(x.root,'.aieyra-updates'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>x.run(),/链接/);
});
