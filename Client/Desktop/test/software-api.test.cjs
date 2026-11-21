// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/software-api.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSoftwareAPI}=require('../host/software-api.cjs'),{MODULES}=require('../host/module-catalog.cjs');
function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-software-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let main=true,active='home',order=MODULES.map(s=>s.id);const rows=Object.fromEntries(order.map(id=>[id,{exists:id==='home',visible:id==='home',ready:id==='home',detached:false}])),calls=[];
 const runtime={get mainOpen(){return main;},state:()=>({main_open:main,modules:rows}),async action(p){calls.push(p);const r=rows[p.module];if(p.action==='close'){r.detached=false;r.visible=false;if(!main)r.exists=false;}else{r.exists=true;r.ready=true;r.visible=true;if(p.action==='dock'){main=true;r.detached=false;}else if(p.action==='detach'||!main)r.detached=true;active=p.module;}if(options.perform)await options.perform(p,r);}};
 const create=id=>createSoftwareAPI({sessionId:id,authorizeSession:options.authorizeSession,file:path.join(dir,id+'.json'),runtime:()=>runtime,observe:async()=>({active_page:active,modules:rows}),order:{read:()=>order,write:v=>order=v},navigate:async page=>{active=page;for(const row of Object.values(rows))if(!row.detached)row.visible=false;rows.home.visible=true;},timeout:40,pollMs:5});
 const api=create('owned');return {api,create,rows,calls,hideMain:()=>{main=false;},call:(p,signal)=>api.call(p,'owned',signal)};
}
test('discovery is catalog-based; invalid module, fields, owner and fixed home never touch adapters',async t=>{
 const f=fixture(t);assert.deepEqual((await f.call({action:'describe'})).catalog.map(x=>x.id),MODULES.map(x=>x.id));
 for(const p of [{action:'module',module:'home',operation:'detach'},{action:'module',module:'alien',operation:'open'},{action:'module',module:'browser',operation:'run'},{action:'modules',script:'x'}])await assert.rejects(f.call(p));
 await assert.rejects(f.api.call({action:'modules'},'other'),e=>e.code==='SESSION_CONFLICT');assert.equal(f.calls.length,0);
});
test('registered program callers have independent durable receipts and lose access after stopping',async t=>{
 let active=true;const f=fixture(t,{authorizeSession:async id=>active&&['canvas','settings'].includes(id)}),args={action:'module',module:'workspace',operation:'open',request_id:'same-local-id'};
 for(const id of ['canvas','settings']){
  assert.equal((await f.api.call({action:'modules'},id)).operation_session,id);
  const result=await f.api.call(args,id);assert.equal(result.ok,true);assert.equal(result.current.operation_session,id);
  assert.equal((await f.api.call(args,id)).replayed,true);
  assert.equal((await f.api.call({action:'receipt',request_id:args.request_id},id)).operation_session,id);
 }
 assert.equal(f.calls.length,2);active=false;
 await assert.rejects(f.api.call(args,'canvas'),e=>e.code==='SESSION_CONFLICT');
 assert.equal(f.calls.length,2);
});
test('UI changes invalidate stale versions; repeated requests preserve the original result and current state can be queried',async t=>{
 const f=fixture(t),old=await f.call({action:'modules'});f.rows.settings.exists=true;
 const stale=await f.call({action:'module',module:'browser',operation:'detach',request_id:'stale',expected_version:old.version});assert.equal(stale.code,'VERSION_CONFLICT');assert.equal(f.calls.length,0);
 const args={action:'module',module:'browser',operation:'detach',request_id:'one'};assert.equal((await f.call(args)).state,'completed');f.rows.browser.detached=false;
 assert.equal((await f.call(args)).replayed,true);assert.equal(f.calls.length,1);const receipt=await f.call({action:'receipt',request_id:'one'});assert.equal(receipt.current.modules.find(x=>x.id==='browser').placement,'attached');
});
test('module close retains attached state with OS, releases without OS, and docking a closed page reopens the host',async t=>{
 const f=fixture(t);await f.call({action:'module',module:'settings',operation:'detach',request_id:'detach'});
 let result=await f.call({action:'module',module:'settings',operation:'close',request_id:'close'});assert.equal(result.ok,true);assert.equal(result.current.modules.find(x=>x.id==='settings').placement,'attached');
 f.hideMain();await f.call({action:'module',module:'contacts',operation:'open',request_id:'open'});result=await f.call({action:'module',module:'contacts',operation:'close',request_id:'last'});assert.equal(result.current.modules.find(x=>x.id==='contacts').placement,'closed');
 result=await f.call({action:'module',module:'contacts',operation:'dock',request_id:'restore'});assert.equal(result.ok,true);assert.equal(result.current.main_open,true);
});
test('an acknowledged operation without the target visible state stays unknown, and a later operation is not poisoned',async t=>{
 const f=fixture(t,{perform:(p,row)=>{if(p.module==='browser')row.ready=false;}});
 const result=await f.call({action:'module',module:'browser',operation:'detach',request_id:'unconfirmed'});assert.equal(result.state,'unknown');assert.equal(result.ok,false);
 assert.equal((await f.call({action:'module',module:'settings',operation:'open',request_id:'next'})).ok,true);
});
test('docking a loaded background page completes without requiring foreground visibility or replaying the move',async t=>{
 const f=fixture(t,{perform:(p,row)=>{if(p.action==='dock')row.visible=false;}});
 await f.call({action:'module',module:'contacts',operation:'detach',request_id:'background-detach'});
 const args={action:'module',module:'contacts',operation:'dock',request_id:'background-dock'};
 const result=await f.call(args),page=result.current.modules.find(m=>m.id==='contacts');
 assert.equal(result.ok,true);assert.equal(result.state,'completed');assert.equal(page.placement,'attached');assert.equal(page.ready,true);assert.equal(page.visible,false);
 assert.equal((await f.call(args)).replayed,true);assert.equal(f.calls.filter(p=>p.action==='dock').length,1);
});
test('ordering uses the current shared version, enforces home first, and records the actual resulting order',async t=>{
 const f=fixture(t),state=await f.call({action:'modules'}),order=['home','settings','link','contacts','browser','coding','servers','workspace','center'];
 await assert.rejects(f.call({action:'order',order:order.slice().reverse(),expected_version:state.version,request_id:'bad'}));
 const result=await f.call({action:'order',order,expected_version:state.version,request_id:'order'});assert.deepEqual(result.current.order,order);assert.equal(result.state,'completed');
});

test('native failure after changing a window remains unknown and replay never repeats it',async t=>{
 const f=fixture(t,{perform:()=>{throw Error('native acknowledgement lost');}});
 const args={action:'module',module:'settings',operation:'detach',request_id:'partial'};
 const result=await f.call(args);assert.equal(result.state,'unknown');assert.equal(result.code,'OPERATION_UNCONFIRMED');assert.equal(f.rows.settings.detached,true);
 assert.equal((await f.call(args)).replayed,true);assert.equal(f.calls.length,1);
});

test('cancellation while queued prevents the second native action and leaves a queryable receipt',async t=>{
 let release;const gate=new Promise(r=>release=r),f=fixture(t,{perform:p=>p.module==='browser'?gate:undefined}),cancel=new AbortController();
 const first=f.call({action:'module',module:'browser',operation:'detach',request_id:'first'});
 const second=f.call({action:'module',module:'settings',operation:'detach',request_id:'queued'},cancel.signal);
 await new Promise(r=>setImmediate(r));cancel.abort();release();await first;
 const result=await second;assert.equal(result.ok,false);assert.equal(result.code,'CANCELLED');assert.equal(f.calls.length,1);
 assert.equal((await f.call({action:'receipt',request_id:'queued'})).state,'failed');
});

test('a new OS session can query and replay archived receipts but cannot issue new operations under an old owner',async t=>{
 const f=fixture(t),args={action:'module',module:'browser',operation:'detach',request_id:'durable'};
 await f.call(args);f.rows.browser.detached=false;const reopened=f.create('new-session');
 const query=await reopened.call({action:'receipt',request_id:'durable',operation_session:'owned'},'new-session');assert.equal(query.state,'completed');assert.equal(query.operation_session,'owned');assert.ok(query.current.receipt_sessions.includes('owned'));
 const replay=await reopened.call({...args,operation_session:'owned'},'new-session');assert.equal(replay.replayed,true);assert.equal(f.calls.length,1);
 await assert.rejects(reopened.call({...args,request_id:'new',operation_session:'owned'},'new-session'),e=>e.code==='ARCHIVED_SESSION');
 await assert.rejects(reopened.call({...args,operation_session:'../owned'},'new-session'),e=>e.code==='INVALID_OPERATION_SESSION');
 await assert.rejects(reopened.call({...args,operation_session:'absent'},'new-session'),e=>e.code==='UNKNOWN_OPERATION_SESSION');assert.equal(f.calls.length,1);
});
