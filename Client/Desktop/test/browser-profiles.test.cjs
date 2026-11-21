// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-profiles.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProfiles,profileId}=require('../src/browser-profiles.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'browser-identity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,store:createProfiles(dir,'Chromium/148')};}
test('identities persist across restart and alias capitalization cannot fork settings for one partition',t=>{const {dir,store}=fixture(t),first=store.ensure({profile:'WORK',locale:'en-US',timezone:'UTC'});assert.equal(first.id,'work');assert.deepEqual(createProfiles(dir,'Chromium/149').ensure({profile:'Work'}).fingerprint,first.fingerprint);assert.throws(()=>store.ensure({profile:'work',timezone:'Asia/Tokyo'}),/immutable/);assert.equal(store.list().length,1);});
test('new identities are independent and invalid settings never create saved profiles',t=>{const {store}=fixture(t),a=store.create({label:'工作'}),b=store.create({label:'个人'});assert.notEqual(a.id,b.id);assert.throws(()=>store.create({profile:'bad',timezone:'Not/AZone'}));assert.throws(()=>store.create({profile:'bad',width:12}));assert.throws(()=>store.create({profile:'bad',user_agent:'x\r\ny'}));assert.equal(store.list().length,2);for(const id of ['../default','CON.txt','','a/b','CON','com1'])assert.throws(()=>profileId(id));});
test('legacy profile files are read without changing stable settings',t=>{const {dir,store}=fixture(t);fs.mkdirSync(path.join(dir,'profiles'));fs.writeFileSync(path.join(dir,'profiles','Travel.json'),JSON.stringify({width:1000,height:700,device_scale_factor:1,locale:'ja-JP',timezone:'Asia/Tokyo',user_agent:'old browser'}));const saved=store.ensure({profile:'TRAVEL'});assert.equal(saved.fingerprint.user_agent,'old browser');assert.equal(saved.fingerprint.width,1000);assert.equal(store.list().length,1);assert.throws(()=>store.create({profile:'travel'}),/exists/);});
test('SOCKS5 profile credentials stay encrypted through unavailable storage and label edits',t=>{
 const {dir}=fixture(t);
 let available=true;
 const safeStorage={
  isEncryptionAvailable:()=>available,
  encryptString:value=>Buffer.from(Buffer.from(value).toString('base64')),
  decryptString:value=>Buffer.from(value.toString(),'base64').toString(),
 };
 const store=createProfiles(dir,'Chromium/148',safeStorage);
 const proxy='socks5://example.test:1080';
 store.create({profile:'work',proxy:'socks5://work-user:work-password@example.test:1080'});
 const file=path.join(dir,'profiles','work.json');
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(saved.proxy,proxy);
 assert.ok(saved.proxy_auth_encrypted);
 assert.ok(!JSON.stringify(saved).includes('work-password'));
 available=false;
 assert.equal(store.read('work').proxy_auth,null);
 assert.equal(store.list()[0].proxy_authenticated,true);
 assert.ok(!Object.hasOwn(store.list()[0],'proxy_auth_encrypted'));
 store.update('work',{label:'Renamed',proxy});
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).proxy_auth_encrypted,saved.proxy_auth_encrypted);
 available=true;
 assert.deepEqual(store.read('work').proxy_auth,{username:'work-user',password:'work-password'});
 store.update('work',{label:'Renamed',proxy,clear_proxy_auth:true});
 assert.equal(store.list()[0].proxy_authenticated,false);
 assert.throws(()=>store.create({profile:'s4',proxy:'socks4://user:pass@example.test:1080'}));
 assert.throws(()=>store.create({profile:'oversize',proxy:'socks5://'+encodeURIComponent('甲'.repeat(86))+':pass@example.test:1080'}));
});
