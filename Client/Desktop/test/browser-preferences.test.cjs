// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: proxyInput
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-preferences.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createBrowserPreferences,searchEngines}=require('../src/browser-preferences.cjs'),navigation=require('../renderer/browser-navigation.js');
const {proxyAddress,createProfiles}=require('../../../Program/official/browser/service/browser-profiles.cjs');
const proxyInput=require('../../../Program/official/browser/ui/browser-proxy-input.js');
const {dropListURL,readDropList}=require('../../../Program/official/browser/service/browser-proxy-reputation.cjs');
test('new tab follows the homepage by default and preserves an explicit destination',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-new-tab-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'preferences.json'),JSON.stringify({search_engine:'bing',homepage:'https://example.test/'}));
 const prefs=createBrowserPreferences(dir);
 assert.equal(prefs.read().new_tab,'homepage');
 prefs.update({new_tab:'about:blank'});
 assert.equal(createBrowserPreferences(dir).read().new_tab,'about:blank');
 assert.equal(prefs.read().homepage,'https://example.test/');
 assert.throws(()=>prefs.update({new_tab:'file:///private'}));
});
test('browser proxy settings are scoped to a profile and reject credentials',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-browser-proxy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const profiles=createProfiles(dir,'test-agent');
 profiles.create({profile:'work',proxy:'socks5://127.0.0.1:1080'});
 assert.equal(profiles.read('work').proxy,'socks5://127.0.0.1:1080');
 assert.equal(profiles.ensure({profile:'default'}).proxy,'');
 for(const value of ['http://user:password@localhost:80','http://localhost:0','http://localhost:99999','http://localhost:80;DIRECT'])assert.throws(()=>proxyAddress(value));
});
test('proxy imports preview the same independently editable fields across supported formats',()=>{
 const expected={protocol:'http',host:'example.test',port:'8080',username:'user',password:'p:@%w'};
 for(const input of [
  'http://user:p%3A%40%25w@example.test:8080',
  'example.test:8080:user:p:@%w',
  'user:p:@%w@example.test:8080',
  'example.test:8080\r\nuser:p:@%w',
  'example.test:8080\nuser\np:@%w',
 ])assert.deepEqual(proxyInput.parse(input),expected);
 assert.equal(proxyInput.format(expected),'http://user:p%3A%40%25w@example.test:8080');
 assert.equal(proxyInput.format(proxyInput.parse('[::1]:1080','socks5')),'socks5://[::1]:1080');
 assert.equal(proxyInput.format(proxyInput.parse('https://example.test/')),'https://example.test:443');
 for(const input of ['http://host:0','http://host:99999','http://host/path','http://host?q=1','ftp://host:80','host:1000\n:password','host:1000\nuser\npassword\nextra'])assert.throws(()=>proxyInput.parse(input));
});
test('exit route data distinguishes CIDR membership and rejects incomplete or stale data',()=>{
 const timestamp=Math.floor(Date.now()/1000);
 const data=(cidr,meta)=>JSON.stringify({cidr})+'\n'+JSON.stringify({type:'metadata',timestamp,records:1,...meta})+'\n';
 const v4=readDropList(data('192.0.2.0/24'),4),v6=readDropList(data('2001:db8:1::/48'),6);
 assert.ok(v4.has('192.0.2.42'));
 assert.ok(!v4.has('198.51.100.42'));
 assert.ok(v6.has('2001:db8:1::42'));
 assert.ok(!v6.has('2001:db8:2::42'));
 assert.ok(dropListURL('192.0.2.42').endsWith('/drop_v4.json'));
 assert.throws(()=>readDropList(data('192.0.2.0/24',{records:2}),4));
 assert.throws(()=>readDropList(data('192.0.2.0/24',{timestamp:timestamp-8*86400}),4));
 assert.throws(()=>readDropList(data('192.0.2.0/33'),4));
});
test('homepage defaults to Baidu and migrates the legacy official site preference',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-home-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const home=require('../../../Contracts/official-services.json').os;
 let prefs=createBrowserPreferences(dir);assert.equal(prefs.read().homepage,'https://www.baidu.com/');
 fs.writeFileSync(path.join(dir,'preferences.json'),JSON.stringify({search_engine:'bing',homepage:home,new_tab:'https://www.baidu.com/'}));prefs=createBrowserPreferences(dir);assert.equal(prefs.read().homepage,'https://www.baidu.com/');assert.equal(prefs.read().new_tab,'homepage');assert.equal(prefs.read().search_engine,'bing');
 prefs.update({homepage:home,new_tab:'https://www.baidu.com/'});assert.equal(createBrowserPreferences(dir).read().homepage,new URL(home).href);assert.equal(createBrowserPreferences(dir).read().new_tab,'https://www.baidu.com/');
 prefs.update({homepage:'about:blank'});assert.equal(createBrowserPreferences(dir).read().homepage,'about:blank');assert.equal(prefs.read().search_engine,'bing');
 for(const homepage of ['file:///private','javascript:alert(1)','https://user:password@example.org'])assert.throws(()=>prefs.update({homepage}));
});
test('AI search preferences persist and feed the same human address parser without changing URLs',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-browser-prefs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let prefs=createBrowserPreferences(dir);assert.equal(prefs.read().search_engine,'auto');prefs.update({search_engine:'google'});prefs=createBrowserPreferences(dir);assert.equal(navigation.address('一 二',prefs.read().search_engine),'https://www.google.com/search?q=%E4%B8%80%20%E4%BA%8C');assert.equal(navigation.address('http://localhost:8032/',prefs.read().search_engine),'http://localhost:8032/');assert.throws(()=>prefs.update({search_engine:'evil',model:'other'}));assert.equal(prefs.read().search_engine,'google');});
test('malformed saved preferences are preserved instead of silently overwritten',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-browser-prefs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'preferences.json');fs.writeFileSync(file,'broken');const prefs=createBrowserPreferences(dir);assert.equal(prefs.read().search_engine,'auto');assert.ok(prefs.read().error);assert.throws(()=>prefs.update({search_engine:'google'}));assert.equal(fs.readFileSync(file,'utf8'),'broken');});
test('automatic browser search records reachable, fallback and failure without probing other engines',async()=>{
 for(const [choice,unreachable,expected,ok] of [
  ['auto',[],['www.google.com'],true],
  ['auto',['www.google.com'],['www.google.com','www.baidu.com'],true],
  ['auto',['www.google.com','www.baidu.com'],['www.google.com','www.baidu.com'],false],
  ['bing',['www.bing.com'],['www.bing.com'],false],
 ]){
  const visited=[];
  const result=await searchEngines('local fixture',choice,async (url,timeout)=>{
   const host=new URL(url).hostname;visited.push(host);assert.equal(timeout,10000);
   if(unreachable.includes(host))throw Object.assign(Error('fixture'),{code:'ERR_CONNECTION_REFUSED'});
   return {};
  },async()=>({ok:true,condition_met:true}));
  assert.deepEqual(visited,expected);assert.equal(result.ok,ok);
  assert.deepEqual(result.search_attempts.map(a=>a.state),expected.map(h=>unreachable.includes(h)?'unreachable':'reached'));
 }
 await assert.rejects(searchEngines('local fixture','auto',async()=>{throw Object.assign(Error('stop'),{code:'browser_navigation_cancelled'});}),/stop/);
});
