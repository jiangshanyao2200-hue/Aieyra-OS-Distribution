// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/official-account.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createOfficialAccount,tokenMetadata}=require('../host/official-account.cjs');
test('embedded login and profile reuse the official partition and never create a second portal',async t=>{
 const calls=[],native={cookies:new EventEmitter(),setPermissionRequestHandler(){},setPermissionCheckHandler(){}};
 const account=createOfficialAccount({session:{fromPartition:()=>native},BrowserWindow:class{constructor(){throw Error('unexpected portal');}},openInBrowser:async p=>calls.push(p)});t.after(()=>account.close());
 assert.equal(account.browserSession(),native);await account.login();await account.openSite('profile');await account.openSite('home');
 assert.deepEqual(calls.map(p=>p.url),['https://api.aieyra.cn/sign-in','https://api.aieyra.cn/profile/','https://aieyra.cn']);assert(calls.every(p=>p.profile==='aieyra-account'&&p.reuse));assert.equal(account.status().signedIn,false);
});
test('account uses cookie identity, metadata-only renderer and held key for settings',async()=>{
 const cookies=new EventEmitter(),seen=[],calls=[];let signed=true;
 const accountSession={cookies,setPermissionRequestHandler(){},setPermissionCheckHandler(){},async clearStorageData(){signed=false;},async fetch(url,opt){seen.push({url,opt});if(!signed)return new Response('{}',{status:401});let data;if(url.endsWith('/api/aieyra/session'))data={success:true,data:{id:19,status:1}};else if(url.endsWith('/api/user/self'))data={success:true,data:{id:19,status:1,username:'Fixture'}};else if(url.includes('/api/token/?'))data={data:{items:[{id:7,name:'test',status:1,expired_time:-1,unlimited_quota:true}]}};else if(url.endsWith('/7/key'))data={data:{key:'sk-fixture-abcdefghijklmnopqrstuvwxyz'}};else data={data:[{id:'fixture-model'}]};return Response.json(data);}};
 const account=createOfficialAccount({session:{fromPartition(name){assert.equal(name,'persist:aieyra-os-account');return accountSession;}},core:async(action,args)=>{calls.push(args);return args.action==='onboarding_catalog'?{ok:true,models:[{id:'fixture-model'}]}:{ok:true,test_id:'proof',version:'v1'};}});
 assert.equal((await account.refresh()).signedIn,true);
 const selection=await account.select('7');assert.equal(selection.selectedTokenId,'7');assert.ok(!JSON.stringify(selection).includes('sk-fixture'));assert.equal(seen.some(r=>r.url.endsWith('/models')),false);
 assert.equal(seen.find(r=>r.url.includes('/api/token/?')).opt.headers['New-Api-User'],'19');assert.equal(seen.at(-1).opt.redirect,'error');
 const catalog=await account.catalog();assert.equal(catalog.models[0].id,'fixture-model');assert.equal(calls[0].action,'onboarding_catalog');
 await account.connect({model:'fixture-model',protocol:'responses'});assert.equal(calls[1].action,'onboarding_test');assert.match(calls[1].api_key,/sk-fixture/);assert.equal(calls[2].action,'onboarding_save');
 await account.logout();assert.equal(account.status().signedIn,false);await assert.rejects(()=>account.connect({model:'fixture-model',protocol:'responses'}));account.close();
});
test('disabled, expired and exhausted keys stay unavailable',()=>{
 assert.equal(tokenMetadata({id:1,status:2,unlimited_quota:true}).usable,false);
 assert.equal(tokenMetadata({id:1,status:1,expired_time:1,unlimited_quota:true}).usable,false);
 assert.equal(tokenMetadata({id:1,status:1,remain_quota:0}).usable,false);
 assert.equal(tokenMetadata({id:'../',status:1}),null);
});
test('remote login epoch exists only after verification and changes on same-user cookie replacement',async t=>{
 const cookies=new EventEmitter(),changes=[];let delay=null;
 const native={cookies,setPermissionRequestHandler(){},setPermissionCheckHandler(){},async clearStorageData(){},async fetch(url){if(delay&&url.endsWith('/api/user/self'))await delay;return Response.json(url.includes('/api/token/?')?{data:{items:[]}}:{success:true,data:{id:19,status:1,username:'Fixture'}});}};
 const account=createOfficialAccount({session:{fromPartition:()=>native},onChange:value=>changes.push(value)});t.after(()=>account.close());
 assert.equal(account.status().remoteAccount,null);const initial=await account.refresh();assert.equal(initial.remoteAccount.userID,19);const key=initial.remoteAccount.sessionKey;assert.equal((await account.refresh()).remoteAccount.sessionKey,key);
 let release;delay=new Promise(r=>release=r);const pending=account.refresh();await new Promise(r=>setImmediate(r));cookies.emit('changed',{}, {domain:'.aieyra.cn'});
 assert.equal(account.status().remoteAccount,null);assert.equal(changes.at(-1).remoteAccount,null);release();assert.equal((await pending).remoteAccount,null,'stale verification cannot issue an epoch');
 delay=null;const verified=await account.refresh();assert.equal(verified.remoteAccount.userID,19);assert.notEqual(verified.remoteAccount.sessionKey,key);
 await account.logout();assert.equal(account.status().remoteAccount,null);account.close();assert.equal(cookies.listenerCount('changed'),0);
});
