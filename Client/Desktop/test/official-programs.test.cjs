// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/official-programs.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {programs,navigationSource}=require('../../../Program/official/catalog.cjs');
const {createNativePrograms}=require('../../../Program/runtime/native.cjs');
const {readPackage}=require('../host/mod-packages.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-native-program-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const rows=new Map(programs.map(p=>{const directory=path.join(root,p.id);for(const name of ['manifest.json',...Object.keys(p.manifest.files)]){const target=path.join(directory,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(p.root,name),target);}return [p.packageID,{manifest:structuredClone(p.manifest),directory,origin:'official',enabled:true,digest:p.id+'-digest'}];}));
 const effects=[],adapters=Object.fromEntries(programs.map(p=>[p.id,{open:()=>{effects.push('open:'+p.id);return {ok:true};},snapshot:()=>({ok:true}),invoke:(operation,args)=>{effects.push('invoke:'+p.id+':'+operation);return {ok:true,args};},close:()=>effects.push('close:'+p.id)}]));
 const resolve=async id=>{const row=rows.get(id);if(!row?.enabled)throw Error('not enabled');return row;};
 const native=createNativePrograms({resolve,readPackage,adapters});t.after(()=>native.shutdown());return {root,rows,effects,adapters,resolve,native};
}
test('a cancelled native call awaiting payload verification cannot enter its adapter',async t=>{
 const f=fixture(t),cancel=new AbortController();let release,entered;
 const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const native=createNativePrograms({resolve:async id=>{entered();await gate;return f.resolve(id);},readPackage,adapters:f.adapters});t.after(()=>native.shutdown());
 const pending=native.call(f.rows.get('aieyra.servers'),'invoke',{operation:'list',arguments:{}},{signal:cancel.signal}).then(value=>({value}),error=>({error}));
 await started;cancel.abort();release();assert.equal((await pending).error?.code,'CANCELLED');assert.deepEqual(f.effects,[]);
 await native.call(f.rows.get('aieyra.servers'),'invoke',{operation:'list',arguments:{}});assert.deepEqual(f.effects,['invoke:servers:list']);
});
test('concurrent native requests share verification but sequential requests still reject changed installed bytes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-admission-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const own=programs.find(p=>p.id==='servers'),directory=path.join(root,'servers');
 for(const name of ['manifest.json',...Object.keys(own.manifest.files)]){const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(own.root,name),file);}
 const row={manifest:structuredClone(own.manifest),directory,origin:'official',enabled:true,digest:'servers-concurrent'},effects=[];let resolveCalls=0,reads=0,release;
 const gate=new Promise(r=>{release=r;});
 const native=createNativePrograms({resolve:async()=>{resolveCalls++;await gate;return row;},readPackage:item=>{reads++;return readPackage(item);},adapters:{servers:{close:()=>effects.push('closed')}}});t.after(()=>native.shutdown());
 const pending=Array.from({length:8},(_,i)=>native.run('servers',()=>effects.push(i)));assert.equal(resolveCalls,1);release();await Promise.all(pending);assert.equal(reads,1);assert.equal(effects.length,8);
 await native.run('servers',()=>effects.push('next'));assert.equal(reads,2);assert.equal(resolveCalls,2);
 fs.appendFileSync(path.join(directory,'service.cjs'),'\n// changed after admission');await assert.rejects(native.run('servers',()=>effects.push('bypass')),/变化/);assert.equal(reads,3);assert.equal(effects.includes('bypass'),false);assert.equal(effects.at(-1),'closed');
});
test('native programs admit exact business payloads, revoke surfaces and preserve data',async t=>{
 const f=fixture(t);await f.native.reconcile([...f.rows.values()]);
 const row=f.rows.get('aieyra.servers'),data=path.join(f.root,'user-document.txt');fs.writeFileSync(data,'keep user edits');
 await f.native.call(row,'open');assert.deepEqual(f.effects,['open:servers']);
 await f.native.call(row,'invoke',{operation:'list',arguments:{path:'sample.txt'}});assert.equal(f.effects.at(-1),'invoke:servers:list');
 await assert.rejects(f.native.call(row,'invoke',{operation:'invented',arguments:{}}),/没有声明/);
 row.enabled=false;await f.native.reconcile([...f.rows.values()]);assert.equal(f.effects.at(-1),'close:servers');
 await assert.rejects(f.native.run('servers',()=>f.effects.push('bypass')),/not enabled/);assert.throws(()=>f.native.assert('servers'),/停用/);
 assert.equal(fs.readFileSync(data,'utf8'),'keep user edits');row.enabled=true;await f.native.run('servers',()=>f.effects.push('enabled'));assert.equal(f.effects.at(-1),'enabled');
});
test('native adapter cannot be obtained by local origin or tampered registered payload',async t=>{
 const f=fixture(t),row=f.rows.get('aieyra.servers');row.origin='local';await assert.rejects(f.native.call(row,'open'),/官方包/);assert.deepEqual(f.effects,[]);
 row.origin='official';fs.appendFileSync(path.join(row.directory,'service.cjs'),'\n// tampered');await assert.rejects(f.native.call(row,'open'),/变化/);assert.deepEqual(f.effects,[]);
});
test('a late resolve cannot reopen a program after revocation or shutdown',async t=>{
 const f=fixture(t);let release;const pending=new Promise(r=>{release=r;});
 const native=createNativePrograms({resolve:async id=>{await pending;return f.resolve(id);},readPackage,adapters:f.adapters});
 const result=native.run('servers',()=>f.effects.push('late-open'));await native.reconcile([]);release();await assert.rejects(result,/状态已变化/);assert.deepEqual(f.effects,[]);native.shutdown();
 await assert.rejects(native.admit('servers'),/已关闭/);
});
test('repeated installation snapshots do not invalidate an in-flight native program open',async t=>{
 const f=fixture(t);let release,hold=false;
 const native=createNativePrograms({resolve:async id=>{if(hold&&id==='aieyra.link'){hold=false;await new Promise(r=>{release=r;});}return f.resolve(id);},readPackage,adapters:f.adapters});t.after(()=>native.shutdown());
 const rows=[...f.rows.values()];await native.reconcile(rows);hold=true;
 const opening=native.run('link',()=>f.effects.push('opened-after-enable'));const settled=opening.then(()=>({ok:true}),error=>({ok:false,error:error.message}));
 await native.reconcile(rows);release();assert.deepEqual(await settled,{ok:true});assert.deepEqual(f.effects,['opened-after-enable']);
});
test('native discovery and renderer navigation are projected from the owner manifests',()=>{
 const {MODULES}=require('../host/module-catalog.cjs');
 for(const p of programs){const row=MODULES.find(m=>m.id===p.id);assert.equal(row.packageID,p.manifest.id);assert.equal(row.title,p.manifest.name);assert.equal(row.tab,p.definition.desktop.navigation.tab);}
 assert.equal(fs.readFileSync(path.resolve(__dirname,'../../../Program/official/navigation.mjs'),'utf8'),navigationSource());
});
test('native program API retains domain confirmation rules',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-native-permission-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const servers=require('../../../Program/official/servers/desktop.cjs').createServersProgram({dataDir:root,safeStorage:{isEncryptionAvailable:()=>false},configFiles:()=>[]});t.after(()=>servers.close());
 for(const action of ['add','probe','remove','vault_remove'])await assert.rejects(servers.agentCall({action}),/confirmed/);
});
test('a failing draft retention preserves the surface and retries before enabling',async t=>{
 const f=fixture(t);let attempts=0;
 f.adapters.servers.close=async()=>{if(++attempts===1)throw Error('draft storage unavailable');f.effects.push('surface-released');};
 await f.native.admit('servers');f.rows.get('aieyra.servers').enabled=false;
 await assert.rejects(f.native.reconcile([...f.rows.values()]),/storage unavailable/);assert.deepEqual(f.effects,[]);assert.throws(()=>f.native.assert('servers'),/停用/);
 await f.native.reconcile([...f.rows.values()]);assert.deepEqual(f.effects,['surface-released']);
});

test('native shutdown attempts every admitted program and retries only failed releases',async t=>{
 const f=fixture(t),failure=Error('retention fixture unavailable'),id=programs[0].id;let attempts=0;
 await f.native.reconcile([...f.rows.values()]);
 f.adapters[id].close=async()=>{f.effects.push('close:'+id);if(++attempts===1)throw failure;};
 const error=await f.native.shutdown().catch(error=>error);
 assert.deepEqual(f.effects,programs.map(p=>'close:'+p.id));
 assert(error instanceof AggregateError);assert.deepEqual(error.errors,[failure]);
 for(const p of programs)assert.throws(()=>f.native.assert(p.id),/停用/);
 await f.native.shutdown();assert.deepEqual(f.effects,[...programs.map(p=>'close:'+p.id),'close:'+id]);
});
test('concurrent native shutdown joins an already retiring adapter without duplicate closes',async t=>{
 const f=fixture(t);await f.native.reconcile([...f.rows.values()]);
 const id=programs[0].id;let release,entered;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 f.adapters[id].close=async()=>{f.effects.push('close:'+id);entered();await gate;};
 f.rows.get(programs[0].packageID).enabled=false;
 const retiring=f.native.reconcile([...f.rows.values()]);await started;
 const one=f.native.shutdown(),two=f.native.shutdown();release();
 await Promise.all([retiring,one,two]);assert.deepEqual(f.effects,programs.map(p=>'close:'+p.id));
});

test('a failed native revocation cannot skip other disabled programs or withdraw unaffected admissions',async t=>{
 const f=fixture(t),[first,second,...unchanged]=programs;await f.native.reconcile([...f.rows.values()]);let attempts=0;
 f.adapters[first.id].close=async()=>{f.effects.push('close:'+first.id);if(++attempts===1)throw Error('retention fixture unavailable');};
 f.rows.get(first.packageID).enabled=false;f.rows.get(second.packageID).enabled=false;
 const failure=await f.native.reconcile([...f.rows.values()]).catch(error=>error);
 assert.match(failure?.message||'',/retention fixture unavailable/);
 assert.deepEqual([...f.effects],['close:'+first.id,'close:'+second.id]);
 for(const p of unchanged)assert.doesNotThrow(()=>f.native.assert(p.id));
 await f.native.reconcile([...f.rows.values()]);assert.deepEqual(f.effects,['close:'+first.id,'close:'+second.id,'close:'+first.id]);
});

test('native Program invoke passes the stable receipt identity to Link',async t=>{
 const f=fixture(t);let seen;f.adapters.link.invoke=(operation,args,context)=>{seen={operation,args,context};return {ok:true};};
 await f.native.call(f.rows.get('aieyra.link'),'invoke',{operation:'post',arguments:{body:'text'},request_id:'stable-request'});
 assert.deepEqual(seen,{operation:'post',args:{body:'text'},context:{request_id:'stable-request'}});
});
test('process program presents its actual module entry while sandbox programs require HTML',()=>{
 const {descriptor}=require('../../../Program/runtime/desktop.cjs'),p=programs.find(p=>p.id==='link');
 const files=readPackage({manifest:p.manifest,directory:p.root});assert.equal(descriptor(p.manifest,files).desktop.entry,'ui/control.mjs');
 const changed=structuredClone(p.definition);delete changed.desktop.native;files['program.json']=Buffer.from(JSON.stringify(changed));assert.throws(()=>descriptor(p.manifest,files),/入口|导航/);
 changed.desktop.native='link';changed.desktop.entry='ui/index.html';files['ui/index.html']=Buffer.from('test');files['program.json']=Buffer.from(JSON.stringify(changed));assert.throws(()=>descriptor(p.manifest,files),/入口/);
});

test('historical native payload requires host synchronization before execution',async t=>{
 const f=fixture(t),row=f.rows.get('aieyra.browser'),prior=require('../../../Program/official/compatibility.json')['aieyra.browser'][0];
 row.digest=prior.digest;row.manifest.version='1.0.0';
 for(const [name,file]of Object.entries(prior.documentation)){fs.writeFileSync(path.join(row.directory,name),file.text);row.manifest.files[name]={sha256:file.sha256,size:file.size};}
 fs.writeFileSync(path.join(row.directory,'manifest.json'),JSON.stringify(row.manifest));
 await assert.rejects(f.native.run('browser',()=>f.effects.push('opened-old-browser')),/载荷与当前宿主不匹配/);
 assert.deepEqual(f.effects,[]);
});
