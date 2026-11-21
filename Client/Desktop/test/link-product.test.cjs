// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture; put
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/link-product.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {discoverLink,createLinkLauncher}=require('../host/link-product.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-link-module-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'OS'),product=path.join(root,'Link'),app=path.join(product,'app'),cli=path.join(app,'runtime/link',process.platform==='win32'?'aieyra-link.exe':'aieyra-link');fs.mkdirSync(root);return {dir,root,product,app,cli};}
function put(file){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture never executed');}
test('Link discovery accepts only the OS internal runtime and ignores old overrides',t=>{
 const f=fixture(t),external=path.join(f.dir,'Aieyra Link');put(path.join(f.root,'build/link/windows-x64/aieyra-link.exe'));put(path.join(external,'app/runtime/link/aieyra-link.exe'));assert.equal(discoverLink({root:f.root,env:{AIEYRA_LINK_ROOT:external}}).installed,false);
 put(f.cli);const found=discoverLink({root:f.root,env:{AIEYRA_LINK_ROOT:external}});assert.equal(found.executable,f.cli);assert.equal(found.embedded,true);assert.equal(found.independent,false);
});
test('internal Link runtime redirects are rejected',t=>{
 const f=fixture(t);put(f.cli);const displaced=path.join(f.dir,'displaced');fs.renameSync(f.product,displaced);fs.symlinkSync(displaced,f.product,process.platform==='win32'?'junction':'dir');assert.throws(()=>discoverLink({root:f.root}),/重定向/);
});
test('Link navigation uses the OS surface and cannot spawn an independent window',async()=>{
 const pages=[],launcher=createLinkLauncher({navigate:page=>{pages.push(page);return {ok:true,embedded:true,page};},spawnImpl:()=>{throw Error('independent spawn');}});
 assert.deepEqual(await launcher.open(),{ok:true,embedded:true,page:'link'});assert.deepEqual(pages,['link']);await assert.rejects(createLinkLauncher({}).open(),/Aieyra OS/);
});
