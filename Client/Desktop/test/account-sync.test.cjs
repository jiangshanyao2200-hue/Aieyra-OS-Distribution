// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: cfg; oldKey; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/account-sync.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const cfg=require('../src/config.cjs'),spec=require('../src/spec.cjs'),pool=require('../src/model-pool.cjs'),setup=require('../src/model-setup.cjs');
const {createOfficialAccount,tokenMetadata,GATEWAY}=require('../host/official-account.cjs');
const oldKey='sk-fixture-old-key-123456789',newKey='sk-fixture-rotated-key-987654321';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-sync-')),file=path.join(dir,'config.json');
 fs.writeFileSync(file,JSON.stringify({...spec.defaults(),model_pool_version:1,provider_connections:[{id:'user-aieyra-7',token_id:'7',provider:'custom',base_url:GATEWAY,api_key:oldKey,api_key_history:[oldKey],enabled:false,key_name:'Old'}, {id:'other',provider:'deepseek',base_url:'https://other.invalid',api_key:'synthetic-other',enabled:true}],api_profiles:[]}));
 const cookies=new EventEmitter();let identity='19',rows=[{id:7,status:2,name:'Main',unlimited_quota:true}],fail=false,delay=null,key=newKey;const calls=[];
 const native={cookies,setPermissionRequestHandler(){},setPermissionCheckHandler(){},async clearStorageData(){},async fetch(url,opt){
  calls.push({url,method:opt.method});
  if(url.includes('/api/token/?'))return Response.json({data:{items:rows}});
  if(url.endsWith('/key')){if(delay)await delay;if(fail)return new Response('{}',{status:503});return Response.json({data:{key}});}
  return Response.json({success:true,data:{id:identity,status:1,username:'Fixture'}});
 }};
 const account=createOfficialAccount({config:file,session:{fromPartition:()=>native}});
 t.after(()=>{account.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {account,file,calls,cookies,setRows:v=>rows=v,setIdentity:v=>identity=v,setFail:v=>fail=v,setDelay:v=>delay=v,setKey:v=>key=v};
}
test('explicit sync refreshes cloud status and rotates bound credentials while preserving local disabled choice',async t=>{
 const f=fixture(t);await f.account.refresh();await f.account.keys();
 f.setRows([{id:7,status:1,name:'Renamed',unlimited_quota:true}]);
 const r=await f.account.keys({refresh:true}),saved=cfg.load(f.file).settings,c=saved.provider_connections.find(c=>c.id==='user-aieyra-7');
 assert.equal(r.tokens[0].usable,true);assert.equal(c.api_key,newKey);assert.equal(c.enabled,false);assert.equal(c.key_name,'Renamed');assert.equal(c.account_id,'19');
 assert.equal(saved.provider_connections.find(c=>c.id==='other').api_key,'synthetic-other');assert.equal(saved.aieyra_key_drafts['7'].account_id,'19');
 assert.ok(!JSON.stringify(r).includes(newKey));assert.ok(r.keysSyncedAt);assert.equal(f.calls.filter(c=>c.url.endsWith('/7/key')).length,1);
 setup.setKeyEnabled(saved,{connection_id:c.id,enabled:true});assert.equal(c.enabled,true);
});
test('failed sync preserves complete prior drafts and credentials and can retry immediately',async t=>{
 const f=fixture(t);f.setRows([{id:7,status:1,unlimited_quota:true}]);await f.account.refresh();await f.account.keys({refresh:true});
 const before=cfg.load(f.file).settings.aieyra_key_drafts;f.setFail(true);await assert.rejects(f.account.keys({refresh:true}),/503/);assert.deepEqual(cfg.load(f.file).settings.aieyra_key_drafts,before);
 f.setFail(false);f.setKey(oldKey);await f.account.keys({refresh:true});assert.equal(cfg.load(f.file).settings.provider_connections[0].api_key,oldKey);
});
test('logout during Key fetch cannot repopulate drafts and same-account login is not throttled by old cache',async t=>{
 const f=fixture(t);f.setRows([{id:7,status:1,unlimited_quota:true}]);await f.account.refresh();
 let release;f.setDelay(new Promise(r=>release=r));const pending=f.account.keys({refresh:true});await new Promise(r=>setTimeout(r,25));
 await f.account.logout();release();await assert.rejects(pending);assert.deepEqual(cfg.load(f.file).settings.aieyra_key_drafts,{});assert.deepEqual(f.account.status().keyMasks,{});
 f.setDelay(null);await f.account.refresh();assert.ok((await f.account.keys()).keyMasks['7']);
});
test('sync handles more than 32 Keys and coalesces repeated clicks',async t=>{
 const f=fixture(t);f.setRows(Array.from({length:40},(_,i)=>({id:i+1,status:1,unlimited_quota:true})));await f.account.refresh();
 const [a,b]=await Promise.all([f.account.keys({refresh:true}),f.account.keys({refresh:true})]);assert.equal(Object.keys(a.keyMasks).length,40);assert.deepEqual(a,b);assert.equal(f.calls.filter(c=>c.url.endsWith('/key')).length,40);
});
test('account switch does not expose old Key masks or bind another account draft',async t=>{
 const f=fixture(t);f.setRows([{id:7,status:1,unlimited_quota:true}]);await f.account.refresh();await f.account.keys();f.setIdentity('20');await f.account.refresh();
 assert.deepEqual(f.account.status().keyMasks,{});const s=cfg.load(f.file).settings;assert.throws(()=>setup.bindAieyraKey(s,{token_id:'7'}),/账号|同步/);
});
test('unusable reasons distinguish disabled, expired and exhausted cloud Keys',()=>{
 assert.equal(tokenMetadata({id:1,status:2,unlimited_quota:true}).unavailableReason,'云端已停用');
 assert.equal(tokenMetadata({id:1,status:1,expired_time:1,unlimited_quota:true}).unavailableReason,'已过期');
 assert.equal(tokenMetadata({id:1,status:1,remain_quota:0}).unavailableReason,'额度不足');
});
test('sync updates the active request credential without changing model roles or parameters',async t=>{
 const f=fixture(t),human=require('../src/user-connections.cjs');
 human.persist(f.file,s=>{s.provider_connections[0].enabled=true;s.api_profiles=[{id:'main',connection_id:'user-aieyra-7',model:'fixture-model',provider:'custom',base_url:GATEWAY,api_protocol:'responses',enabled:true,context_window:128000,output_limit:8192,parameters:pool.parameters(spec.defaults())}];s.matrix_profile=s.active_profile='main';return pool.synchronize(s);});
 const before=cfg.load(f.file).settings;assert.equal(before.api_key,oldKey);f.setRows([{id:7,status:1,unlimited_quota:true}]);await f.account.refresh();await f.account.keys({refresh:true});
 const after=cfg.load(f.file).settings;assert.equal(after.api_key,newKey);assert.equal(after.active_profile,'main');assert.equal(after.matrix_profile,'main');assert.deepEqual(after.api_profiles[0].parameters,before.api_profiles[0].parameters);assert.equal(after.api_profiles[0].context_window,before.api_profiles[0].context_window);
});
test('sync also rotates the selected legacy onboarding connection',async t=>{
 const f=fixture(t),human=require('../src/user-connections.cjs');f.setRows([{id:7,status:1,unlimited_quota:true}]);f.setKey(oldKey);await f.account.refresh();await f.account.select('7');
 human.persist(f.file,s=>{setup.bindAieyra(s);return s;});f.setKey(newKey);await f.account.keys({refresh:true});
 const after=cfg.load(f.file).settings;assert.equal(after.provider_connections.find(c=>c.id==='user-aieyra').api_key,newKey);assert.equal(after.user_connection_drafts.aieyra.api_key,newKey);assert.equal(after.official_account.selected_key_digest,require('node:crypto').createHash('sha256').update(newKey).digest('hex'));
});
test('same-account cookie change during sync cannot commit unverified credentials',async t=>{
 const f=fixture(t);f.setRows([{id:7,status:1,unlimited_quota:true}]);await f.account.refresh();
 let release;f.setDelay(new Promise(r=>release=r));const pending=f.account.keys();await new Promise(r=>setTimeout(r,20));f.cookies.emit('changed',{}, {domain:'.aieyra.cn'});release();await assert.rejects(pending,/账号已变化/);assert.equal(cfg.load(f.file).settings.provider_connections[0].api_key,oldKey);
});
test('more than 64 Keys report the batch bound and remaining Keys sync individually',async t=>{
 const f=fixture(t);f.setRows(Array.from({length:66},(_,i)=>({id:i+1,status:1,unlimited_quota:true})));await f.account.refresh();const first=await f.account.keys({refresh:true});assert.equal(Object.keys(first.keyMasks).length,64);assert.match(first.keysNotice,/64/);
 const target=await f.account.keys({token_id:'66'});assert.ok(target.keyMasks['66']);assert.equal(Object.keys(target.keyMasks).length,65);assert.equal(f.calls.filter(c=>c.url.endsWith('/66/key')).length,1);
});
