// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: cfg; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/account-persistence.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const cfg=require('../src/config.cjs'),spec=require('../src/spec.cjs'),human=require('../src/user-connections.cjs');
const {createOfficialAccount,GATEWAY}=require('../host/official-account.cjs');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-account-')),file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify({...spec.defaults(),model_pool_version:1}));
 const cookies=new EventEmitter(),jar=[],writes=[],coreCalls=[],accounts=[];let user='19',valid=true,rows=[{id:7,status:1,name:'Fixture',unlimited_quota:true}],delaySet=null;
 cookies.get=async()=>jar.map(c=>({...c}));cookies.set=async c=>{if(delaySet)await delaySet();writes.push(c);jar.push(c);};
 const native={cookies,setPermissionRequestHandler(){},setPermissionCheckHandler(){},async clearStorageData(){jar.length=0;valid=false;},async fetch(url){
  if(!valid)return new Response('{}',{status:401});
  if(url.endsWith('/api/aieyra/session')||url.endsWith('/api/user/self'))return Response.json({success:true,data:{id:user,status:1,username:'Fixture'}});
  if(url.includes('/api/token/?'))return Response.json({data:{items:rows}});
  return Response.json({data:{key:'sk-aieyra-test-token'}});
 }};
 const make=(options={})=>{const account=createOfficialAccount({config:file,session:{fromPartition:()=>native},core:async(_,p)=>{coreCalls.push(p);return p.action==='onboarding_catalog'?{ok:true,models:[{id:'fixture'}]}:{ok:true,test_id:'proof',version:'v1'};},...options});accounts.push(account);return account;};
 t.after(()=>{for(const a of accounts)a.close();fs.rmSync(dir,{recursive:true,force:true});});
 const signIn=()=>{const cookie={name:'session',value:'synthetic-login',domain:'api.aieyra.cn',path:'/'};jar.push(cookie);cookies.emit('changed',{},cookie);};
 return {file,jar,writes,coreCalls,make,signIn,setUser:v=>user=v,setRows:v=>rows=v,setDelay:fn=>delaySet=fn,setValid:v=>valid=v};
}
test('global login restores only allowed cookie properties and saved Key identity',async t=>{
 const f=await fixture(t),account=f.make();f.jar.push({name:'session',value:'synthetic-cookie',domain:'api.aieyra.cn',path:'/'});
 await account.refresh();await account.select('7');const saved=cfg.load(f.file).settings.official_account;assert.equal(saved.selected_token_id,'7');account.close();f.jar.length=0;
 human.persist(f.file,s=>({...s,official_account:{...saved,session_cookies:[{...saved.session_cookies[0],url:'https://elsewhere.invalid'}, {name:'bad',value:'synthetic',domain:'elsewhere.invalid'}]}}));
 const restored=f.make();const result=await restored.refresh();assert.equal(result.selectedTokenId,'7');assert.equal(f.writes.length,1);assert.equal(f.writes[0].url,'https://api.aieyra.cn');assert.ok(!JSON.stringify(result).includes('synthetic-cookie'));
 assert.equal(f.coreCalls.length,0,'restore performs no model request');
});
test('anonymous refresh is quiet and a sign-in tab cookie verifies the account',async t=>{
 const f=await fixture(t),opened=[];
 let notify;
 const verified=new Promise(resolve=>{notify=resolve;});
 const account=f.make({openInBrowser:async args=>{opened.push(args);return {ok:true};},onChange:state=>{if(state.signedIn)notify(state);}});
 const before=cfg.load(f.file).version;
 const anonymous=await account.refresh();
 assert.equal(anonymous.signedIn,false);assert.ok(!anonymous.error);
 await account.refresh();assert.equal(cfg.load(f.file).version,before);
 await account.login();
 assert.deepEqual(opened,[{url:'https://api.aieyra.cn/sign-in',profile:'aieyra-account',reuse:true}]);
 f.signIn();const state=await verified;
 assert.equal(state.remoteAccount.userID,19);
 f.jar.length=0;assert.equal((await account.refresh()).signedIn,false);
});
test('clearing selection and removed Keys cannot silently reappear on refresh',async t=>{
 const f=await fixture(t),a=f.make();f.signIn();await a.refresh();await a.select('7');await a.select('');assert.equal(cfg.load(f.file).settings.official_account.selected_token_id,'');assert.equal((await a.refresh()).selectedTokenId,'');
 await a.select('7');await a.catalog();await a.test({model:'fixture'});f.setRows([]);assert.equal((await a.refresh()).selectedTokenId,'');assert.equal(cfg.load(f.file).settings.official_account.selected_token_id,'');await assert.rejects(a.save({test_id:'proof'}),/测试/);
 f.setRows([{id:7,status:1,unlimited_quota:true}]);assert.equal((await a.refresh()).selectedTokenId,'');
});
for(const event of ['logout','expired session','account switch']){
 test(event+' removes the Aieyra API pool and preserves third-party models',async t=>{
  const f=await fixture(t),account=f.make(),pool=require('../src/model-pool.cjs'),{draftProfile}=require('../host/connection.cjs');
  f.signIn();await account.refresh();await account.select('7');await account.keys();
  const officialKey='sk-aieyra-test-token',providerKey='sk-other-test-token';
  const connection=(id,base_url,api_key)=>({id,provider:'custom',base_url,api_key,api_key_history:[api_key],request_timeout_seconds:300});
  const official=connection('user-aieyra-7',GATEWAY,officialKey);
  const legacy=connection('legacy-aieyra',GATEWAY,officialKey);
  const provider=connection('other', 'https://fixture.invalid/v1',providerKey);
  const profiles=[official,legacy,provider].map(c=>({
   ...draftProfile({base_url:c.base_url,model:'fixture-'+c.id,api_protocol:'responses'}),
   id:'profile-'+c.id,connection_id:c.id,tool_calls:true,enabled:true,
  }));
  const [first,second,third]=profiles.map(p=>p.id),providerActive=event==='expired session';
  human.persist(f.file,s=>pool.synchronize({...s,provider_connections:[official,legacy,provider],api_profiles:profiles,
   matrix_profile:providerActive?third:first,active_profile:providerActive?third:first,
   matrix_alternates:providerActive?[second]:[second,third],subconscious_profile:first,
   image_profiles:[first],video_profile:second,vision_profile:second,execution_profile:third,
   user_connections:{aieyra:official.id,custom:provider.id},
   user_connection_drafts:{...s.user_connection_drafts,custom:{base_url:provider.base_url,api_key:providerKey}},
  }));
  if(event==='logout')assert.equal((await account.logout()).signedIn,false);
  else if(event==='expired session'){
   f.setValid(false);assert.equal((await account.refresh()).signedIn,false);
  }else{
   f.setUser('20');
   const state=await account.refresh();assert.equal(state.user.id,'20');assert.equal(state.selectedTokenId,'');
  }
  const saved=cfg.load(f.file).settings;
  assert.deepEqual(saved.provider_connections,[provider]);
  assert.deepEqual(saved.api_profiles.map(p=>p.id),[third]);
  assert.equal(saved.active_profile,providerActive?third:'');
  assert.equal(saved.matrix_profile,providerActive?third:'');
  assert.equal(saved.api_key,providerActive?providerKey:'');
  assert.deepEqual(saved.matrix_alternates,providerActive?[]:[third]);
  assert.equal(saved.subconscious_profile,'');
  assert.deepEqual(saved.image_profiles,[]);
  assert.equal(saved.image_generation_enabled,false);
  assert.equal(saved.video_profile,'');
  assert.equal(saved.vision_profile,'');
  assert.equal(saved.execution_profile,third);
  assert.deepEqual(saved.user_connections,{custom:provider.id});
  assert.equal(human.draft(saved,'custom').api_key,providerKey);
  assert.equal(human.draft(saved,'aieyra'),undefined);
  assert.deepEqual(saved.aieyra_key_drafts,{});
  assert.equal(saved.official_account.user?.id,event==='account switch'?'20':undefined);
  assert.ok(!JSON.stringify(saved).includes(officialKey));
  if(event!=='account switch')assert.equal(human.disconnectOfficialAccount(pool.migrate(saved)),undefined);
 });
}
test('logout waits for an in-flight cookie restore then clears it',async t=>{
 const f=await fixture(t);human.persist(f.file,s=>({...s,official_account:{session_cookies:[{name:'session',value:'synthetic-cookie',domain:'api.aieyra.cn'}]}}));
 let release,entered;const started=new Promise(r=>entered=r);f.setDelay(()=>{entered();return new Promise(r=>release=r);});
 const a=f.make(),refresh=a.refresh();await started;const logout=a.logout();release();await Promise.all([refresh,logout]);assert.equal(f.jar.length,0);assert.deepEqual(cfg.load(f.file).settings.official_account,{});assert.equal(a.status().signedIn,false);
});
test('legacy renderer saves preserve global login and do not expose cookies',async t=>{
 const f=await fixture(t);human.persist(f.file,s=>({...s,user_connection_drafts:{custom:{base_url:'https://fixture.invalid',api_key:'synthetic-cached-key'}},official_account:{user:{id:'19'},session_cookies:[{name:'session',value:'synthetic-private-cookie',domain:'api.aieyra.cn'}]}}));
 const service=require('../src/service.cjs').createService(f.file);t.after(()=>service.close());const bootstrap=await service.call('config:bootstrap');assert.ok(!JSON.stringify(bootstrap).includes('synthetic-private-cookie'));
 const result=await service.call('config:save',{settings:bootstrap.settings,expected_version:bootstrap.version});assert.equal(result.ok,true,JSON.stringify(result.errors));assert.ok(!JSON.stringify(result).includes('synthetic-private-cookie'));assert.equal(cfg.load(f.file).settings.official_account.session_cookies[0].value,'synthetic-private-cookie');
 const reset=await service.call('config:reset',result.settings),saved=await service.call('config:save',{settings:reset.settings,expected_version:result.version});assert.equal(saved.ok,true,JSON.stringify(saved.errors));assert.equal(cfg.load(f.file).settings.user_connection_drafts.custom.api_key,'synthetic-cached-key');assert.equal(cfg.load(f.file).settings.official_account.session_cookies[0].value,'synthetic-private-cookie');
});
