// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: f; crcTable; zip; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/managed-updates.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const f=require('../src/managed-update-files.cjs'),{extractArchive}=require('../src/managed-update-archive.cjs'),{createManagedUpdates}=require('../src/managed-updates.cjs');
test('dual entry updater allows only named launchers and product files',()=>{
 for(const n of ['scripts/build-provenance.py','scripts/development-docs.py','Install.bat','scripts/sync-cli-entry.ps1','API/videos/client.go','API/videos/media.go'])assert.equal(f.safeName(n),n);
 for(const n of ['Program/runtime/desktop.cjs','Program/go.mod','Contracts/product-layout.json','SDK/examples/program-notebook/manifest.json','Aieyra OS.exe','Aieyra CLI.exe','LICENSE','scripts/create-launchers.ps1','scripts/CLI-README.md','Aieyra Browser.exe','Aieyra Link.exe','Control/app/service/main.py','Control/app/runtime/python/python.exe','Link/app/runtime/link/aieyra-link.exe','Prompt/Matrix/默认/边界.txt','Config/运行参数.json'])assert.equal(f.safeName(n),n);
 for(const n of ['Program/third-party/example/private.txt','Program/local/example/main.js','SDK/examples/private.sqlite','scripts/arbitrary.ps1','Control/app/config/private.json','Control/app/Data/private.txt','Prompt/Matrix/边界.txt','scripts/../config.json','Aieyra Other.exe','Client/Desktop/config.json'])assert.throws(()=>f.safeName(n));
});
test('public documents and declared history/cloud sources update without opening private trees',t=>{
 const layout=require('../../../Contracts/development-documents.json');
 const sources=['Agent/context/history/policy.go','Link/cloud/client/remote-link.mjs','Link/cloud/desktop_owner.py','Link/cloud/protocol.py'];
 for(const name of [...layout.documents,...Object.keys(layout.templates),...sources])assert.equal(f.safeName(name),name);
 for(const name of ['docs/private.md','docs/CURRENT.md','AIDEBUG/evidence/AGENTS.md','AIDEBUG/AGENTS.md/extra','Core/docs/AGENTS.md','Control/app/cloud/private.py','Link/cloud/private.py','Link/cloud/client/private.mjs','Core/cloud/client.go','Agent/context/history/history/private.go','Agent/context/history/Data/private.go','Agent/context/History/policy.go','Core/history/policy.go','scripts/PUBLIC-AGENTS.md'])assert.throws(()=>f.safeName(name),name);
 const {root,put}=fixture(t);for(const name of sources)put(name,'public source');
 put('Agent/context/history/history/private.go','private history');
 assert.deepEqual([...new Set(f.sourceNames(root))].sort(),sources.sort());
});
test('insufficient disk space keeps installed files and never starts archive extraction',async t=>{
 const {root,put}=fixture(t);put('Core/unchanged.txt','installed original');
 const archive=path.join(root,'download.zip'),destination=path.join(root,'incoming');
 fs.writeFileSync(archive,zip({'Core/unchanged.txt':'incoming version'}));
 const stats=t.mock.method(fs,'statfsSync',()=>({bavail:0n,bsize:4096n}));
 assert.throws(()=>f.requireSpace(root,100),/磁盘空间不足/);
 await assert.rejects(()=>extractArchive(archive,destination),/磁盘空间不足/);
 assert.equal(fs.existsSync(destination),false);assert.equal(fs.readFileSync(path.join(root,'Core/unchanged.txt'),'utf8'),'installed original');
 stats.mock.mockImplementation(()=>({bavail:1024n*1024n,bsize:4096n}));
 assert.deepEqual(await extractArchive(archive,destination),['Core/unchanged.txt']);
 assert.equal(fs.readFileSync(path.join(destination,'Core/unchanged.txt'),'utf8'),'incoming version');
 assert.equal(fs.readFileSync(path.join(root,'Core/unchanged.txt'),'utf8'),'installed original');
});
test('public conversation and image templates update without accepting private child prompts',()=>{
 for(const name of ['提示词','Eyra会话','对话','看图'])assert.equal(f.safeName('Prompt/子代/模板/'+name+'.txt'),'Prompt/子代/模板/'+name+'.txt');
 for(const name of ['Prompt/子代/private/提示词.txt','Prompt/子代/模板/用户.txt'])assert.throws(()=>f.safeName(name));
});
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
test('update inventory excludes memory and database sidecars but retains rebuild sources',t=>{
 const {root,put}=fixture(t);
 const privateNames=['Core/memory/export.txt','Client/Desktop/Memory/nested/data','Core/eyra.sqlite','Core/eyra.sqlite-wal','Client/Desktop/eyra.SQLITE3-SHM','Client/Desktop/data.db-journal','Core/data.db'];
 const sourceNames=['Core/memoryservice/schema.sql','Core/memoryservice/store.go','Client/Desktop/test/fixtures/legacy-memory-store.cjs'];
 for(const name of [...privateNames,...sourceNames])put(name,'fixture');
 for(const name of privateNames)assert.throws(()=>f.safeName(name),/个人数据/);
 assert.deepEqual(f.sourceNames(root).sort(),sourceNames.sort());
 for(const name of privateNames)assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'fixture');
});
function zip(files){const local=[],central=[];let offset=0;for(const [name,value]of Object.entries(files)){const b=Buffer.from(value),n=Buffer.from(name);let crc=0xffffffff;for(const c of b)crc=crcTable[(crc^c)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;const h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);local.push(h,n,b);central.push(c,n);offset+=h.length+n.length+b.length;}const dir=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(central.length/2,8);e.writeUInt16LE(central.length/2,10);e.writeUInt32LE(dir.length,12);e.writeUInt32LE(offset,16);return Buffer.concat([...local,dir,e]);}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'os-updates-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const keys=crypto.generateKeyPairSync('ed25519');const sign=p=>{const b=Buffer.from(JSON.stringify(p));return {algorithm:'Ed25519',payload:b.toString('base64'),signature:crypto.sign(null,b,keys.privateKey).toString('base64')};};const put=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};return {root,keys,sign,put};}
test('a retired update event stream cannot reconnect after a rapid sign-out and sign-in',async t=>{
 const {root,keys}=fixture(t);let online=true,changed;const streams=[];
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const manager=createManagedUpdates({root,publicKey:keys.publicKey,signedIn:()=>online,subscribe:fn=>{changed=fn;return()=>{};},fetchImpl:async(url,options)=>{
  if(!url.endsWith('/events'))throw Error('offline release feed');
  let finish;const done=new Promise(resolve=>{finish=resolve;});streams.push({finish,signal:options.signal});
  return {ok:true,body:{async *[Symbol.asyncIterator](){await done;}}};
 }});t.after(()=>{manager.close();for(const stream of streams)stream.finish();});
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 manager.start();await flush();assert.equal(streams.length,1);
 online=false;changed();online=true;changed();await flush();assert.equal(streams.length,2);assert.equal(streams[0].signal.aborted,true);
 streams[0].finish();await flush();t.mock.timers.tick(31000);await flush();
 assert.equal(streams.length,2,'only the current login owns a notification connection');
 streams[1].finish();await flush();t.mock.timers.tick(31000);await flush();
 assert.equal(streams.length,3,'the current connection still reconnects normally');
});
test('release notifications wait for a user update before checking the feed',{timeout:3000},async t=>{
 const {root,keys,sign}=fixture(t);
 const envelope=sign({product:'aieyra-os',id:'background-check',version:'0.2.3',sequence:3,channel:'stable',publishedAt:new Date().toISOString(),artifacts:[{kind:'portable',name:'next.zip',size:1,sha256:'a'.repeat(64)}]});
 let checks=0,emitEvent,closeStream,releaseManual,manualReached,queuedReached;
 const manualChecked=new Promise(resolve=>{manualReached=resolve;});
 const queuedChecked=new Promise(resolve=>{queuedReached=resolve;});
 const manager=createManagedUpdates({root,publicKey:keys.publicKey,signedIn:()=>true,fetchImpl:async url=>{
  if(url.endsWith('/events')){
   const event=new Promise(resolve=>{emitEvent=resolve;}),closed=new Promise(resolve=>{closeStream=resolve;});
   return {ok:true,body:{async *[Symbol.asyncIterator](){await event;yield Buffer.from('event: release\n\n');await closed;}}};
  }
  checks++;if(checks===3)queuedReached();return Response.json(envelope);
 }});
 t.after(()=>{manager.close();closeStream?.();});
 manager.start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(checks,1);
 const holding=new Promise(resolve=>{releaseManual=resolve;});
 const manual=manager.withManualChecks(async()=>{
  emitEvent();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(checks,1);
  await manager.call({action:'check'});manualReached();await holding;
 });
 await Promise.race([manualChecked,manual]);assert.equal(checks,2);
 releaseManual();await manual;
 await queuedChecked;assert.equal(checks,3);
});
test('closing the update service cancels an in-flight check without writing or notifying',async t=>{
 const {root,keys,sign}=fixture(t);let release,signal,notices=0;
 const envelope=sign({product:'aieyra-os',id:'closed-check',version:'0.2.3',sequence:3,channel:'stable',publishedAt:new Date().toISOString(),artifacts:[{kind:'portable',name:'next.zip',size:1,sha256:'a'.repeat(64)}]});
 const manager=createManagedUpdates({root,publicKey:keys.publicKey,signedIn:()=>true,notify:async()=>{notices++;return true;},fetchImpl:async(_url,options)=>{signal=options.signal;await new Promise(resolve=>{release=resolve;});return Response.json(envelope);}});
 const result=manager.call({action:'check'});const rejected=assert.rejects(result,/关闭|中断|取消/);
 manager.close();release();await rejected;
 assert.equal(signal.aborted,true);assert.equal(notices,0);assert.equal(fs.existsSync(path.join(root,'.aieyra-updates/state.json')),false);
 await assert.rejects(()=>manager.call({action:'check'}),/关闭/);
});
test('manual checks cannot cross a login boundary even when automatic watching was never started',async t=>{
 const {root,keys,sign}=fixture(t);let online=true,changed,release,signal;
 const envelope=sign({product:'aieyra-os',id:'login-check',version:'0.2.3',sequence:3,channel:'stable',publishedAt:new Date().toISOString(),artifacts:[{kind:'portable',name:'next.zip',size:1,sha256:'a'.repeat(64)}]});
 const manager=createManagedUpdates({root,publicKey:keys.publicKey,signedIn:()=>online,subscribe:fn=>{changed=fn;return()=>{};},fetchImpl:async(_url,options)=>{signal=options.signal;await new Promise(resolve=>{release=resolve;});return Response.json(envelope);}});t.after(()=>manager.close());
 const pending=manager.call({action:'check'}),rejected=assert.rejects(pending,/中断/);
 online=false;changed();online=true;changed();release();await rejected;
 assert.equal(signal.aborted,true);assert.equal(manager.status().release,null);assert.equal(manager.status().operation,null);
});
test('a delayed notification acknowledgment belongs to its original release only',async t=>{
 const {root,keys,sign,put}=fixture(t);let finish;
 put('.aieyra-updates/state.json',JSON.stringify({schema:1,phase:'available',sequence:2,release:{id:'old-notice',version:'0.2.2',sequence:2}}));
 const envelope=sign({product:'aieyra-os',id:'new-notice',version:'0.2.3',sequence:3,channel:'stable',publishedAt:new Date().toISOString(),artifacts:[{kind:'portable',name:'next.zip',size:1,sha256:'a'.repeat(64)}]});
 const manager=createManagedUpdates({root,publicKey:keys.publicKey,signedIn:()=>true,fetchImpl:async()=>Response.json(envelope),notify:release=>release.id==='old-notice'?new Promise(resolve=>{finish=resolve;}):false});t.after(()=>manager.close());
 const old=manager.notifyPending();await Promise.resolve();
 await manager.call({action:'check'});finish(true);await old;
 assert.equal(manager.status().release.id,'new-notice');assert.equal(manager.status().notified,false,'old acknowledgment cannot suppress the new notice');
});
test('late helper success becomes visible and releases the next version without restarting the service',async t=>{
 const {root,put,keys,sign}=fixture(t),name='Core/owned.txt';put(name,'installed');
 const envelope=sign({product:'aieyra-os',id:'next',version:'0.2.3',sequence:3,channel:'stable',publishedAt:new Date().toISOString(),artifacts:[{kind:'portable',name:'next.zip',size:1,sha256:'a'.repeat(64)}]});
 put('Config/official-baseline.json',JSON.stringify(sign({product:'aieyra-os',schema:'aieyra-os-baseline-v1',version:'0.2.2',sequence:2,files:{[name]:{sha256:f.hash('installed'),size:9}}})));
 put('.aieyra-updates/state.json',JSON.stringify({schema:1,phase:'prepared',sequence:2,release:{id:'just-applied',version:'0.2.2',sequence:2}}));
 const manager=createManagedUpdates({root,publicKey:keys.publicKey,signedIn:()=>true,fetchImpl:async()=>Response.json(envelope)});t.after(()=>manager.close());
 assert.equal(manager.status().phase,'prepared');
 for(const invalid of [null,[],{},'incomplete']){put('.aieyra-updates/transaction.json',JSON.stringify(invalid));assert.equal(manager.status().phase,'prepared');}
 put('.aieyra-updates/transaction.json',JSON.stringify({release:'different',phase:'committed',at:'old'}));assert.equal(manager.status().phase,'prepared');
 put('.aieyra-updates/transaction.json',JSON.stringify({release:'just-applied',phase:'committed',reason:'healthy',at:'new'}));
 assert.equal(manager.status().phase,'committed');assert.equal(manager.status().lastResult.phase,'committed');
 const next=await manager.call({action:'check'});assert.equal(next.phase,'available');assert.equal(next.release.id,'next');assert.equal(next.nextRelease,null);assert.equal(next.lastResult.phase,'committed');
});
test('late rollback is consumed before a retry and its persisted receipt cannot undo that new review',async t=>{
 const {root,put,keys,sign}=fixture(t),name='Core/owned.txt',meta=text=>({[name]:{sha256:f.hash(text),size:Buffer.byteLength(text)}});
 const baseline=(sequence,text)=>sign({product:'aieyra-os',schema:'aieyra-os-baseline-v1',version:'0.2.'+sequence,sequence,files:meta(text),texts:{[name]:text}});
 put(name,'base');put('Config/official-baseline.json',JSON.stringify(baseline(1,'base')));
 const archive=zip({[name]:'incoming','Config/official-baseline.json':JSON.stringify(baseline(2,'incoming'))});
 const release={product:'aieyra-os',id:'retry',version:'0.2.2',sequence:2,channel:'stable',publishedAt:new Date().toISOString(),artifacts:[{kind:'portable',name:'retry.zip',size:archive.length,sha256:f.hash(archive)}]},envelope=sign(release);
 put('.aieyra-updates/state.json',JSON.stringify({schema:1,phase:'prepared',sequence:2,release,envelope}));
 const options={root,publicKey:keys.publicKey,signedIn:()=>true,fetchImpl:async url=>url.includes('/downloads/')?new Response(archive):Response.json(envelope)};
 const manager=createManagedUpdates(options);t.after(()=>manager.close());
 put('.aieyra-updates/transaction.json',JSON.stringify({release:'retry',phase:'rolled_back',reason:'startup failed',at:'now'}));
 // No intervening status read: check/review must observe the late receipt too.
 const review=await manager.call({action:'review'});assert.equal(review.phase,'reviewed');assert.equal(review.lastResult.phase,'rolled_back');
 assert.equal(manager.status().phase,'reviewed');manager.close();
 const reopened=createManagedUpdates(options);try{assert.equal(reopened.status().phase,'reviewed');assert.equal(reopened.status().lastResult.phase,'rolled_back');}finally{reopened.close();}
});
test('frequent release notifications retain the reviewed baseline and conflict decisions across reopening',async t=>{
 const {root,keys,sign,put}=fixture(t),name='Client/Desktop/current.txt';
 const base=(sequence,text)=>sign({schema:'aieyra-os-baseline-v1',product:'aieyra-os',version:`0.2.${sequence}`,sequence,files:{[name]:{sha256:f.hash(Buffer.from(text)),size:Buffer.byteLength(text)}},texts:{[name]:text}});
 put(name,'local growth');put('Config/official-baseline.json',JSON.stringify(base(1,'original')));
 const bytes=zip({[name]:'incoming','Config/official-baseline.json':JSON.stringify(base(2,'incoming'))});
 const release=sequence=>sign({product:'aieyra-os',id:`release-${sequence}`,version:`0.2.${sequence}`,sequence,channel:'stable',publishedAt:'2026-11-07T00:00:00Z',artifacts:[{kind:'portable',name:'update.zip',size:bytes.length,sha256:f.hash(bytes)}]});
 let feed=release(2),downloads=0;
 const options={root,signedIn:()=>true,platform:'win32',publicKey:keys.publicKey,fetchImpl:async url=>{if(url.includes('/downloads/')){downloads++;return new Response(bytes);}return Response.json(feed);}};
 const manager=createManagedUpdates(options);t.after(()=>manager.close());
 const review=await manager.call({action:'review'});assert.equal(review.conflicts,1);
 await manager.call({action:'resolve_file',review_digest:review.reviewDigest,path:name,choice:'local',reason:'retain verified local behavior'});
 const repeated=await manager.call({action:'review'});assert.equal(repeated.conflicts,0);assert.equal(repeated.reviewDigest,review.reviewDigest);assert.ok(repeated.checkedAt);
 const stateFile=path.join(root,'.aieyra-updates/state.json'),original=JSON.parse(fs.readFileSync(stateFile));
 for(const sequence of [3,4,4]){
  feed=release(sequence);const value=await manager.call({action:'check'});
  assert.equal(value.phase,'reviewed');assert.equal(value.release.sequence,2);assert.equal(value.nextRelease.sequence,sequence);
  assert.equal(value.conflicts,0);assert.equal(value.reviewDigest,review.reviewDigest);
  const saved=JSON.parse(fs.readFileSync(stateFile));for(const field of ['rows','resolutions','localDigest','reviewDigest','envelope'])assert.deepEqual(saved[field],original[field],field);
 }
 manager.close();const reopened=createManagedUpdates(options);t.after(()=>reopened.close());
 assert.equal(reopened.status().nextRelease.sequence,4);assert.equal(reopened.status().release.sequence,2);
 await reopened.call({action:'check'});assert.equal(downloads,1);assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'local growth');
 const payload=JSON.parse(Buffer.from(feed.payload,'base64'));feed=sign({...payload,id:'rewritten-four'});
 await assert.rejects(()=>reopened.call({action:'check'}),/内容发生变化/);
 feed=release(4);await reopened.call({action:'decide',decision:'defer',reason:'review the newest available version'});
 const adopted=await reopened.call({action:'check'});assert.equal(adopted.release.sequence,4);assert.equal(adopted.lastResult.version,'0.2.2');assert.equal(adopted.lastResult.phase,'deferred');assert.equal(adopted.phase,'available');assert.equal(adopted.reviewDigest,'');assert.equal(adopted.nextRelease,null);
});
test('three-way selection includes additions, deletion and divergence',()=>{const a={sha256:'a',size:1},b={sha256:'b',size:1},c={sha256:'c',size:1};const rows=f.compare({'Core/same':a,'Core/local':a,'Core/remote':a,'Core/conflict':a,'Core/deleted':a},{'Core/same':a,'Core/local':b,'Core/remote':a,'Core/conflict':b},{'Core/same':a,'Core/local':a,'Core/remote':b,'Core/conflict':c,'Core/deleted':a,'Core/new':b});assert.deepEqual(Object.fromEntries(rows.map(r=>[r.name,r.choice])),{'Core/conflict':'conflict','Core/deleted':'local','Core/local':'local','Core/new':'incoming','Core/remote':'incoming','Core/same':'local'});});
test('archive checks paths, duplicate case, corruption and cleans partial output',async t=>{const {root}=fixture(t);for(const files of [{'../outside':'bad'},{'Client/Desktop/../outside':'bad'},{'Prompt/system.txt':'bad'},{'Client/Desktop/A.cjs':'a','Client/Desktop/a.cjs':'b'},{'Client/Desktop/a':'file','Client/Desktop/a/b':'nested'}]){const file=path.join(root,'bad.zip');fs.writeFileSync(file,zip(files));await assert.rejects(()=>extractArchive(file,path.join(root,'out')));assert.equal(fs.existsSync(path.join(root,'out')),false);}const good=zip({'Client/Desktop/a.cjs':'module.exports=1;','Core/b.txt':'hello'});const archive=path.join(root,'good.zip');fs.writeFileSync(archive,good);assert.deepEqual(await extractArchive(archive,path.join(root,'out')),['Client/Desktop/a.cjs','Core/b.txt']);fs.writeFileSync(archive,Buffer.from(good));const corrupt=fs.readFileSync(archive);corrupt[42]^=1;fs.writeFileSync(archive,corrupt);await assert.rejects(()=>extractArchive(archive,path.join(root,'corrupt')));assert.equal(fs.existsSync(path.join(root,'corrupt')),false);});
test('async inventory rechecks file identity on equal-length edits and rejects links',async t=>{
 const {root,put}=fixture(t),name='Core/file.txt',file=path.join(root,name),cache=new Map();
 put(name,'old content');
 const before=fs.statSync(file);
 const first=await f.inventoryAsync(root,[name,'Core/missing.txt'],{cache});
 assert.deepEqual(first,f.inventory(root,[name]));
 put(name,'new content');fs.utimesSync(file,before.atime,before.mtime);
 const changed=await f.inventoryAsync(root,[name],{cache});
 assert.equal(changed[name].size,first[name].size);
 assert.equal(changed[name].sha256,f.hash('new content'));
 fs.linkSync(file,path.join(root,'Core/alias.txt'));
 await assert.rejects(f.inventoryAsync(root,[name],{cache}),/没有链接的普通文件/);
});
test('signed releases preserve growth, resolve against current review, invalidate stale state',async t=>{
 const {root,keys,sign,put}=fixture(t),old={'Client/Desktop/a.cjs':'module.exports="base";','Client/Desktop/remove.txt':'remove','Client/Desktop/local.txt':'old'},incoming={'Client/Desktop/a.cjs':'module.exports="official";','Client/Desktop/local.txt':'old','Client/Desktop/new.txt':'new'};
 const meta=files=>Object.fromEntries(Object.entries(files).map(([n,text])=>[n,{sha256:f.hash(Buffer.from(text)),size:Buffer.byteLength(text)}]));
 const baseline=(sequence,files)=>sign({schema:'aieyra-os-baseline-v1',product:'aieyra-os',version:'0.2.'+(10+sequence),sequence,files:meta(files),texts:files});
 for(const [n,text]of Object.entries(old))put(n,text);put('Config/official-baseline.json',JSON.stringify(baseline(1,old)));put('Client/Desktop/a.cjs','module.exports="growth";');put('Client/Desktop/local.txt','my local growth');
 put('Prompt/自我.txt','personal prompt');put('Client/Desktop/config.json','personal config');
 const archive=zip({...incoming,'Config/official-baseline.json':JSON.stringify(baseline(2,incoming))});let envelope=sign({product:'aieyra-os',id:'0.2.12',version:'0.2.12',sequence:2,channel:'stable',publishedAt:new Date().toISOString(),artifacts:[{kind:'portable',name:'os.zip',size:archive.length,sha256:f.hash(archive)}]});
 const manager=createManagedUpdates({root,signedIn:()=>true,platform:'win32',publicKey:keys.publicKey,fetchImpl:async url=>url.includes('/downloads/')?new Response(archive):Response.json(envelope)});t.after(()=>manager.close());
 const review=await manager.call({action:'review'});assert.equal(review.conflicts,1);assert.equal((await manager.call({action:'read_file',path:'Client/Desktop/a.cjs',side:'base'})).text,old['Client/Desktop/a.cjs']);
 await assert.rejects(()=>manager.call({action:'prepare'}),/未解决/);
 await manager.call({action:'resolve_file',path:'Client/Desktop/a.cjs',choice:'merged',text:'module.exports="growth and official";',reason:'Combine actual behavior',review_digest:review.reviewDigest});
 const prepared=await manager.call({action:'prepare'});assert.equal(prepared.phase,'prepared');assert.equal(fs.readFileSync(path.join(prepared.candidatePath,'Client/Desktop/local.txt'),'utf8'),'my local growth');assert.equal(fs.existsSync(path.join(prepared.candidatePath,'Client/Desktop/remove.txt')),false);assert.equal(fs.existsSync(path.join(prepared.candidatePath,'Prompt')),false);
 const candidateFile=path.join(prepared.candidatePath,'Client/Desktop/new.txt');
 fs.writeFileSync(candidateFile,'bad');
 await assert.rejects(()=>manager.call({action:'verify'}),/临时文件已变化/);
 fs.writeFileSync(candidateFile,incoming['Client/Desktop/new.txt']);
 // 只模拟启动检查后的状态，定向核对应用决策；保留真实文件摘要和签名校验。
 const stateFile=path.join(root,'.aieyra-updates/state.json'),state=JSON.parse(fs.readFileSync(stateFile));state.phase='validated';fs.writeFileSync(stateFile,JSON.stringify(state));
 const ready=createManagedUpdates({root,signedIn:()=>true,platform:'win32',publicKey:keys.publicKey});
 try{
  await assert.rejects(()=>ready.call({action:'decide',decision:'apply',candidate_digest:'stale'}),/摘要/);
  const temporaryFile=path.join(prepared.candidatePath,'Client/Desktop/new.txt'),original=fs.readFileSync(temporaryFile);fs.writeFileSync(temporaryFile,'tampered');
  await assert.rejects(()=>ready.call({action:'decide',decision:'apply',candidate_digest:prepared.candidateDigest}),/变化/);fs.writeFileSync(temporaryFile,original);
  assert.equal((await ready.call({action:'decide',decision:'apply',candidate_digest:prepared.candidateDigest})).phase,'waiting_idle');
 }finally{ready.close();}
 put('Client/Desktop/local.txt','newer growth');await assert.rejects(()=>manager.call({action:'prepare'}),/本地内容已变化/);assert.equal(manager.status().reviewDigest,'');
 const p=JSON.parse(Buffer.from(envelope.payload,'base64'));envelope=sign({...p,id:'different-id'});await assert.rejects(()=>manager.call({action:'check'}),/内容发生变化/);
 assert.equal(fs.readFileSync(path.join(root,'Prompt/自我.txt'),'utf8'),'personal prompt');assert.equal(fs.readFileSync(path.join(root,'Client/Desktop/config.json'),'utf8'),'personal config');
 await manager.call({action:'decide',decision:'defer',reason:'Wait for verification'});assert.equal(manager.status().phase,'deferred');
});
test('invalid signatures and file paths fail closed',t=>{const {root,keys,sign,put}=fixture(t);put('Core/ok','good');for(const n of ['../x','Client/Desktop/config.json','Core/a:stream','Core/NUL.txt','Core/a.','Core//b','Core/a\\b'])assert.throws(()=>f.safeName(n));assert.equal(f.plainPath(root,'Client/Desktop/new/file',true),path.join(root,'Client/Desktop/new/file'));const e=sign({product:'aieyra-os',version:'0.2.12',sequence:2,channel:'stable',id:'x',publishedAt:new Date().toISOString(),artifacts:[{name:'x.zip',size:1,sha256:'a'.repeat(64)}]});e.payload+='!';assert.throws(()=>f.verifySigned(e,keys.publicKey,'release'));});
test('current review prefers full signed archive while legacy portable remains first',async t=>{
 const {root,keys,sign,put}=fixture(t),files={'Client/Desktop/a.txt':'previous'},meta=values=>Object.fromEntries(Object.entries(values).map(([n,v])=>[n,{sha256:f.hash(Buffer.from(v)),size:Buffer.byteLength(v)}]));
 put('Client/Desktop/a.txt',files['Client/Desktop/a.txt']);put('Config/official-baseline.json',JSON.stringify(sign({product:'aieyra-os',schema:'aieyra-os-baseline-v1',version:'0.2.24',sequence:13,files:meta(files)})));
 const next={'Client/Desktop/a.txt':'new'},bootstrap=[];
 for(const [source,destination]of Object.entries(f.BOOTSTRAP)){next[source]='signed '+destination;bootstrap.push({source,destination,...meta({[source]:next[source]})[source]});}
 const baseline=sign({product:'aieyra-os',schema:'aieyra-os-baseline-v1',version:'0.2.28',sequence:14,files:meta(next),bootstrap});
 const expanded={...next};for(const row of bootstrap)expanded[row.destination]=next[row.source];
 const legacy=zip({...next,'Config/official-baseline.json':JSON.stringify(baseline)}),full=zip({...expanded,'Config/official-baseline.json':JSON.stringify(baseline)}),requests=[];
 const artifacts=[{name:'AieyraOS-0.2.28-windows-legacy-update.zip',bytes:legacy},{name:'AieyraOS-0.2.28-windows-x64.zip',bytes:full}];
 const release=sign({product:'aieyra-os',version:'0.2.28',sequence:14,id:'os-0.2.28-14',channel:'stable',publishedAt:new Date().toISOString(),artifacts:artifacts.map(({name,bytes})=>({kind:'portable',platform:'win32',arch:'x64',name,size:bytes.length,sha256:f.hash(bytes)}))});
 const manager=createManagedUpdates({root,signedIn:()=>true,platform:'win32',arch:'x64',publicKey:keys.publicKey,fetchImpl:async url=>{if(!url.includes('/downloads/'))return Response.json(release);requests.push(url);return new Response(artifacts.find(a=>url.endsWith(a.name)).bytes);}});t.after(()=>manager.close());
 const review=await manager.call({action:'review'});assert.equal(review.conflicts,0);assert.equal(requests.length,1);assert.match(requests[0],/windows-x64.zip$/);assert.ok(review.files.some(f=>f.path==='Aieyra CLI.exe'));
 const prepared=await manager.call({action:'prepare'});assert.equal(fs.readFileSync(path.join(prepared.candidatePath,'Aieyra CLI.exe'),'utf8'),next['Client/Desktop/update-bootstrap/cli.exe']);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(prepared.candidatePath,'Config/official-baseline.json'))),baseline);
});

test('retained native changes in API Agent Tool Halo and Client require all four launchers',async t=>{
 for(const name of ['API/request/native.go','Agent/official/Cota/native.go','Tool/runtime/native.go','Halo/runtime/native.go','Client/CLI/native.go']){
  const {root,keys,sign,put}=fixture(t),meta=value=>({[name]:{sha256:f.hash(Buffer.from(value)),size:Buffer.byteLength(value)}});
  const base=sign({schema:'aieyra-os-baseline-v1',product:'aieyra-os',version:'0.2.11',sequence:1,files:meta('base'),texts:{[name]:'base'}});
  const next=sign({schema:'aieyra-os-baseline-v1',product:'aieyra-os',version:'0.2.12',sequence:2,files:meta('base'),texts:{[name]:'base'}});
  put(name,'local growth');put('Config/official-baseline.json',JSON.stringify(base));
  const archive=zip({[name]:'base','Config/official-baseline.json':JSON.stringify(next)});
  const release=sign({product:'aieyra-os',id:'0.2.12',version:'0.2.12',sequence:2,channel:'stable',publishedAt:new Date().toISOString(),artifacts:[{kind:'portable',name:'os.zip',size:archive.length,sha256:f.hash(archive)}]});
  const manager=createManagedUpdates({root,signedIn:()=>true,platform:'win32',publicKey:keys.publicKey,fetchImpl:async url=>url.includes('/downloads/')?new Response(archive):Response.json(release)});t.after(()=>manager.close());
  await manager.call({action:'review'});const result=await manager.call({action:'prepare'});
  assert.equal(result.phase,'needs_build',name);assert.deepEqual(result.requiredArtifacts,['Aieyra OS.exe','Aieyra CLI.exe','Aieyra Link.exe','Aieyra Browser.exe']);assert.match(result.requiredBuild,/Core\/build\.ps1/);
  assert.equal(fs.readFileSync(path.join(result.candidatePath,name),'utf8'),'local growth');assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'local growth');
 }
});
