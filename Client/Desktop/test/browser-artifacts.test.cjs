// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-artifacts.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {artifactSource,createArtifactHandler,createArtifactOrigins}=require('../../../Program/official/browser/service/browser-artifacts.cjs');
test('authorized HTML origins serve real adjacent resources with stable identity and bounded paths',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aieyra-artifact-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'site');await fs.mkdir(root);await fs.writeFile(path.join(root,'中文.html'),'<h1>actual page</h1>');await fs.writeFile(path.join(root,'style.css'),'body{color:green}');await fs.writeFile(path.join(dir,'private.txt'),'outside-secret');
 const source=await artifactSource(path.join(root,'中文.html')),serve=createArtifactHandler(source),get=(name,method='GET')=>serve({url:source.origin+'/'+name,method});
 assert.equal((await artifactSource(path.join(root,'中文.html'))).origin,source.origin);
 const html=await get(encodeURIComponent('中文.html'));assert.equal(html.status,200);assert.match(await html.text(),/actual page/);assert.match(html.headers.get('content-security-policy'),/script-src 'self' 'unsafe-inline'/);
 const css=await get('style.css');assert.match(css.headers.get('content-type'),/text\/css/);assert.equal(await css.text(),'body{color:green}');assert.equal(await (await get('style.css','HEAD')).text(),'');
 assert.equal((await get('missing.css')).status,404);assert.equal((await get('style.css','POST')).status,403);
 for(const name of ['..%2Fprivate.txt','..%5Cprivate.txt','style.css%3Asecret','%00','style.css.'])assert.equal((await get(name)).status,403,name);
 assert.equal((await get('../private.txt')).status,404,'URL-normalized paths still resolve only within the authorized directory');
 assert.equal((await serve({url:'https://unrelated.invalid/style.css',method:'GET'})).status,403);
 await fs.symlink(dir,path.join(root,'escape'),process.platform==='win32'?'junction':'dir');assert.equal((await get('escape/private.txt')).status,403,'directory symlink cannot expose parent files');
 const large=await fs.open(path.join(root,'large.bin'),'w');await large.truncate(32*1024*1024+1);await large.close();assert.equal((await get('large.bin')).status,403);
 await fs.writeFile(path.join(root,'style.css'),'body{color:blue}');assert.equal(await (await get('style.css')).text(),'body{color:blue}','reloading reads actual updated bytes');
});
test('local artifact session handlers are reused and released without erasing persistent page data',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aieyra-artifact-session-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'index.html');await fs.writeFile(file,'page');
 const calls=[],ses={protocol:{handle:(scheme,fn)=>calls.push(['bind',scheme,fn]),unhandle:scheme=>calls.push(['unbind',scheme])},webRequest:{onBeforeRequest:fn=>calls.push(['request',fn])}};
 const origins=createArtifactOrigins(()=>ses);await origins.authorize(file);await origins.authorize(file);assert.equal(calls.filter(x=>x[0]==='bind').length,1);
 const filter=calls.find(x=>x[0]==='request')[1];let decision;filter({url:'file:///outside'},r=>decision=r);assert.equal(decision.cancel,true);
 origins.close();assert.equal(calls.filter(x=>x[0]==='unbind').length,1);assert.deepEqual(calls.at(-1),['request',null]);
});
