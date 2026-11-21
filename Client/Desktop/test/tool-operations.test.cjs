// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: setup; collidingIDs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/tool-operations.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createToolOperations}=require('../host/tool-operations.cjs'),{atomicWriteJson}=require('../host/json-storage.cjs');
function setup(t,options={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-operations-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'receipt.json');return {file,create:extra=>createToolOperations({file,scope:'owned',...options,...extra})};}
test('concurrent same IDs execute once, argument order is canonical, and persisted replay does not repeat effects',async t=>{
 const f=setup(t),store=f.create();let calls=0,release;const gate=new Promise(r=>release=r),work=async()=>{calls++;await gate;return {ok:true,value:7};};
 const first=store.execute('one',{operation:'open',module:'browser'},work),second=store.execute('one',{module:'browser',operation:'open'},work);
 await new Promise(r=>setImmediate(r));assert.equal(store.query('one').state,'running');release();assert.deepEqual(await first,await second);assert.equal(calls,1);
 const replay=await f.create().execute('one',{module:'browser',operation:'open'},()=>{throw Error('must not run');});assert.equal(replay.replayed,true);assert.equal(replay.value,7);
 await assert.rejects(store.execute('one',{module:'settings'},work),e=>e.code==='REQUEST_ID_CONFLICT');
});
test('interrupted transactions become unknown and cannot be retried by replaying their ID',async t=>{
 const f=setup(t),store=f.create();let release;const pending=store.execute('interrupted',{operation:'detach'},()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));
 const reopened=f.create();assert.equal(reopened.query('interrupted').state,'unknown');let executed=false;const result=await reopened.execute('interrupted',{operation:'detach'},()=>{executed=true;return {ok:true};});assert.equal(result.state,'unknown');assert.equal(executed,false);release({ok:true});await pending;
});
test('before-dispatch cancellation, persistence failure and corrupted storage prevent effects',async t=>{
 const f=setup(t),abort=new AbortController();abort.abort();let calls=0;const work=()=>{calls++;return {ok:true};};
 await assert.rejects(f.create().execute('cancel',{},work,{signal:abort.signal}),e=>e.code==='CANCELLED');
 await assert.rejects(f.create({write(){throw Error('disk full');}}).execute('disk',{},work),e=>e.code==='RECEIPT_SAVE_FAILED');
 fs.writeFileSync(f.file,'broken');await assert.rejects(f.create().execute('broken',{},work),e=>e.code==='RECEIPT_STORE_UNAVAILABLE');assert.equal(fs.readFileSync(f.file,'utf8'),'broken');assert.equal(calls,0);
});
test('failed final receipt persistence reports unknown and failed archival preserves the original pending record',async t=>{
 const f=setup(t);let writes=0;const store=f.create({limit:1,write(file,data){if(++writes>1)throw Error('disk full');atomicWriteJson(file,data);}});
 const result=await store.execute('save',{},async()=>({ok:true}));assert.equal(result.state,'unknown');assert.equal(result.ok,false);assert.equal(f.create().query('save').state,'unknown');
 await assert.rejects(store.execute('new',{},async()=>({ok:true})),e=>e.code==='RECEIPT_ARCHIVE_FAILED');
 assert.equal(f.create().query('save').state,'unknown');assert.equal(f.create().query('new').state,'not_found');
});

test('a completed tool receipt preserves its original nested result independently of live module state',async t=>{
 const f=setup(t),store=f.create(),live={ok:true,current:{windows:[{id:'browser',visible:true}],selection:{id:'first'}}};
 await store.execute('original',{operation:'open'},async()=>live);const persisted=f.create().query('original');
 live.current.windows[0].visible=false;live.current.windows.push({id:'settings'});live.current.selection.id='second';
 assert.deepEqual(store.query('original'),persisted);
 let calls=0;const replay=await store.execute('original',{operation:'open'},()=>{calls++;return {ok:true};});
 assert.deepEqual(replay,{...persisted,replayed:true});assert.equal(calls,0);
});
test('an unretainable tool result reports unknown after the effect and never replays it',async t=>{
 const f=setup(t),store=f.create();let calls=0;
 const result=await store.execute('unretainable',{},async()=>{calls++;return {ok:true,value:()=>42};});
 assert.equal(result.ok,false);assert.equal(result.state,'unknown');assert.equal(result.code,'INVALID_RESULT');
 const replay=await f.create().execute('unretainable',{},()=>{calls++;return {ok:true};});assert.equal(replay.state,'unknown');assert.equal(calls,1);
});
test('a damaged terminal receipt cannot be replayed as success or authorize another effect',async t=>{
 const f=setup(t);await f.create().execute('saved',{operation:'open'},async()=>({ok:true,value:7}));const original=JSON.parse(fs.readFileSync(f.file,'utf8'));
 const damage=[row=>{delete row.result;},row=>{row.result.ok=false;},row=>{row.result.request_id='another-request';},row=>{row.arguments.operation='changed';}];
 for(const mutate of damage){
  const saved=structuredClone(original);mutate(saved.rows[0]);const bytes=JSON.stringify(saved);fs.writeFileSync(f.file,bytes);
  const store=f.create();let calls=0;assert.throws(()=>store.query('saved'),e=>e.code==='RECEIPT_STORE_UNAVAILABLE');
  await assert.rejects(store.execute('new',{},()=>{calls++;return {ok:true};}),e=>e.code==='RECEIPT_STORE_UNAVAILABLE');
  assert.equal(calls,0);assert.equal(fs.readFileSync(f.file,'utf8'),bytes);
 }
});
test('a legacy unknown receipt saved by a later operation remains queryable without repeating either effect',async t=>{
 const f=setup(t);let writes=0,calls=0;
 const store=f.create({write(file,data){if(++writes===2)throw Error('disk full');atomicWriteJson(file,data);}});
 const first=await store.execute('uncertain',{},()=>{calls++;return {ok:true};});assert.equal(first.state,'unknown');
 await store.execute('next',{},()=>{calls++;return {ok:true};});
 const saved=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.equal(saved.rows[0].result.operation_session,undefined);
 const reopened=f.create(),replay=await reopened.execute('uncertain',{},()=>{calls++;return {ok:true};});
 assert.equal(replay.state,'unknown');assert.equal(replay.code,'RECEIPT_SAVE_FAILED');assert.equal(replay.operation_session,'owned');assert.equal(reopened.query('next').state,'completed');assert.equal(calls,2);
});
test('null and undefined rejections still produce durable terminal receipts and never repeat the operation',async t=>{
 const f=setup(t),store=f.create();let calls=0;
 for(const [id,reason]of [['null-error',null],['undefined-error',undefined]]){
  const result=await store.execute(id,{operation:id},async()=>{calls++;throw reason;});
  assert.equal(result.ok,false);assert.equal(result.state,'failed');assert.equal(result.code,'OPERATION_FAILED');assert.equal(result.error,String(reason));
  const replay=await f.create().execute(id,{operation:id},()=>{calls++;return {ok:true};});assert.equal(replay.replayed,true);assert.equal(replay.state,'failed');assert.equal(replay.error,String(reason));
 }
 assert.equal(calls,2);
});
test('receipt rollover retains original results, conflicts and deduplication across reopen',async t=>{
 const f=setup(t,{limit:3});let store=f.create(),calls=0;
 for(let i=0;i<18;i++){
  await store.execute('long-'+i,{i},()=>{calls++;return {ok:true,nested:{value:i}};});
  if(i%4===0)store=f.create();
 }
 store=f.create();
 for(let i=0;i<18;i++){
  assert.equal(store.query('long-'+i).nested.value,i);
  assert.equal((await store.execute('long-'+i,{i},()=>{calls++;return {ok:true};})).replayed,true);
 }
 await assert.rejects(store.execute('long-0',{i:99},()=>{calls++;return {ok:true};}),e=>e.code==='REQUEST_ID_CONFLICT');
 assert.equal(calls,18);assert(JSON.parse(fs.readFileSync(f.file,'utf8')).rows.length<=3);
});
test('archive and index persistence failures retain old IDs and prevent the new effect',async t=>{
 const f=setup(t,{limit:1});await f.create().execute('old',{},()=>({ok:true,value:1}));const original=fs.readFileSync(f.file);let effects=0;
 for(const phase of ['archive','index']){
  const store=f.create({write(file,data){if(phase==='archive'&&file!==f.file||phase==='index'&&file===f.file)throw Error('disk full');atomicWriteJson(file,data);}});
  await assert.rejects(store.execute('new',{},()=>{effects++;return {ok:true};}),e=>['RECEIPT_SAVE_FAILED','RECEIPT_ARCHIVE_FAILED'].includes(e.code));
  assert.equal(store.query('old').value,1);assert.deepEqual(fs.readFileSync(f.file),original);
 }
 assert.equal(effects,0);assert.equal((await f.create().execute('new',{},()=>({ok:true}))).ok,true);
 assert.equal(f.create().query('old').value,1);
});
test('byte rollover archives completed results before the active index becomes unreadable',async t=>{
 const f=setup(t,{limit:20,maxBytes:2400});const store=f.create();
 for(let i=0;i<8;i++)assert.equal((await store.execute('sized-'+i,{i},()=>({ok:true,text:'X'.repeat(450)}))).ok,true);
 assert(fs.statSync(f.file).size<=2400);
 const reopened=f.create();for(let i=0;i<8;i++)assert.equal(reopened.query('sized-'+i).text.length,450);
});
test('a missing declared archive fails closed for its ID instead of repeating the effect',async t=>{
 const f=setup(t,{limit:1});const store=f.create();await store.execute('archived',{},()=>({ok:true}));await store.execute('hot',{},()=>({ok:true}));
 const archive=f.file+'.archive';const files=fs.readdirSync(archive,{recursive:true}).filter(n=>n.endsWith('.json'));assert(files.length);
 for(const name of files)fs.unlinkSync(path.join(archive,name));
 let calls=0;const reopened=f.create();assert.throws(()=>reopened.query('archived'),e=>e.code==='RECEIPT_STORE_UNAVAILABLE');
 await assert.rejects(reopened.execute('archived',{},()=>{calls++;return {ok:true};}),e=>e.code==='RECEIPT_STORE_UNAVAILABLE');assert.equal(calls,0);
});
test('running calls are never archived and an interrupted ID stays unknown after other rollovers',async t=>{
 const f=setup(t,{limit:2});const store=f.create();let release;const first=store.execute('pending',{},()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));
 for(let i=0;i<6;i++)await store.execute('other-'+i,{i},()=>({ok:true}));
 assert.equal(store.query('pending').state,'running');assert.equal(f.create().query('pending').state,'unknown');
 let replayed=false;assert.equal((await f.create().execute('pending',{},()=>{replayed=true;return {ok:true};})).state,'unknown');assert.equal(replayed,false);
 release({ok:true});await first;assert.equal(f.create().query('pending').state,'completed');
});
function collidingIDs(count){
 const crypto=require('node:crypto'),groups=new Map();
 for(let i=0;i<10000;i++){const id='bucket-'+i,prefix=crypto.createHash('sha256').update(id).digest('hex').slice(0,2),ids=groups.get(prefix)||[];ids.push(id);groups.set(prefix,ids);if(ids.length===count)return ids;}
 throw Error('collision fixture unavailable');
}
test('replacing an existing archive commits its index before retiring the old bucket',async t=>{
 const f=setup(t,{limit:1}),ids=collidingIDs(3);let store=f.create(),calls=0;
 for(const id of ids.slice(0,2))await store.execute(id,{id},()=>{calls++;return {ok:true,value:id};});
 const before=fs.readFileSync(f.file),index=JSON.parse(before),prefix=Object.keys(index.archives)[0],oldFile=path.join(f.file+'.archive',prefix,index.archives[prefix]+'.json'),oldBytes=fs.readFileSync(oldFile);
 store=f.create({write(file,data){if(file===f.file)throw Error('index commit failed');atomicWriteJson(file,data);}});
 await assert.rejects(store.execute(ids[2],{id:ids[2]},()=>{calls++;return {ok:true};}),e=>e.code==='RECEIPT_SAVE_FAILED');
 assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(oldFile),oldBytes);
 store=f.create();for(const id of ids.slice(0,2))assert.equal(store.query(id).value,id);
 await store.execute(ids[2],{id:ids[2]},()=>{calls++;return {ok:true,value:ids[2]};});
 assert.equal(fs.existsSync(oldFile),false);store=f.create();
 for(const id of ids)assert.equal((await store.execute(id,{id},()=>{calls++;return {ok:true};})).value,id);
 assert.equal(calls,3);
});
test('a full archive bucket rejects new effects while retaining every prior result',async t=>{
 const f=setup(t,{limit:1,maxBytes:2200}),ids=collidingIDs(3),store=f.create();let calls=0;
 for(const id of ids.slice(0,2))assert.equal((await store.execute(id,{id},()=>{calls++;return {ok:true,text:'X'.repeat(900)};})).ok,true);
 const before=fs.readFileSync(f.file);
 await assert.rejects(store.execute(ids[2],{id:ids[2]},()=>{calls++;return {ok:true};}),e=>e.code==='RECEIPT_LIMIT');
 assert.equal(calls,2);assert.deepEqual(fs.readFileSync(f.file),before);
 const reopened=f.create();for(const id of ids.slice(0,2))assert.equal(reopened.query(id).text.length,900);assert.equal(reopened.query(ids[2]).state,'not_found');
});
test('an altered archive cannot authorize replay or a new effect with that ID',async t=>{
 const f=setup(t,{limit:1}),store=f.create();await store.execute('old',{},()=>({ok:true,value:1}));await store.execute('hot',{},()=>({ok:true}));
 const index=JSON.parse(fs.readFileSync(f.file)),prefix=Object.keys(index.archives)[0],file=path.join(f.file+'.archive',prefix,index.archives[prefix]+'.json');
 const altered=fs.readFileSync(file,'utf8').replace('"value": 1','"value": 9');fs.writeFileSync(file,altered);let calls=0;
 const reopened=f.create();assert.throws(()=>reopened.query('old'),e=>e.code==='RECEIPT_STORE_UNAVAILABLE');
 await assert.rejects(reopened.execute('old',{},()=>{calls++;return {ok:true};}),e=>e.code==='RECEIPT_STORE_UNAVAILABLE');
 assert.equal(calls,0);assert.equal(fs.readFileSync(file,'utf8'),altered);assert.equal(reopened.query('hot').state,'completed');
});
