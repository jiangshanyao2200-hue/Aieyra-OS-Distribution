// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/sdk-package-export.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {pack,exportPackage}=require('../../../SDK/tools/package.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-package-export-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const source=path.join(dir,'author');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'run.js'),'return 1;\n');fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({schema:'aieyra.mod/1',id:'example.export',version:'1.0.0'}));pack(source);return {dir,source,target:path.join(dir,'exported')};}
test('declared export preserves signed manifest and exact payload, omitting author-only files',t=>{
 const f=fixture(t),key=path.join(f.dir,'key.pem');fs.writeFileSync(key,crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}));pack(f.source,key);
 const manifest=fs.readFileSync(path.join(f.source,'manifest.json'));fs.writeFileSync(path.join(f.source,'author-notes.txt'),'not a package file');
 const result=exportPackage(f.source,f.target);assert.equal(result.signed,true);assert.deepEqual(fs.readFileSync(path.join(f.target,'manifest.json')),manifest);assert.deepEqual(fs.readdirSync(f.target).sort(),['manifest.json','run.js']);assert.deepEqual(fs.readFileSync(path.join(f.target,'run.js')),fs.readFileSync(path.join(f.source,'run.js')));
 assert.throws(()=>exportPackage(f.source,f.target),/already exists/);assert.throws(()=>exportPackage(f.source,path.join(f.source,'nested')),/outside/);
});
test('declared export refuses changed or missing payload before creating output',t=>{
 for(const kind of ['changed','missing']){const f=fixture(t);if(kind==='changed')fs.writeFileSync(path.join(f.source,'run.js'),'return 2;\n');else fs.unlinkSync(path.join(f.source,'run.js'));assert.throws(()=>exportPackage(f.source,f.target));assert.equal(fs.existsSync(f.target),false);}
});
test('declared export refuses traversal, case aliases and linked payload',t=>{
 for(const bad of ['../outside','/absolute','a//b','CON.txt','run.js/../other','MANIFEST.JSON']){const f=fixture(t),file=path.join(f.source,'manifest.json'),m=JSON.parse(fs.readFileSync(file));m.files[bad]=m.files['run.js'];fs.writeFileSync(file,JSON.stringify(m));assert.throws(()=>exportPackage(f.source,f.target),/path/);assert.equal(fs.existsSync(f.target),false);}
 const f=fixture(t);fs.renameSync(path.join(f.source,'run.js'),path.join(f.dir,'external.js'));fs.linkSync(path.join(f.dir,'external.js'),path.join(f.source,'run.js'));assert.throws(()=>exportPackage(f.source,f.target),/linked/);assert.equal(fs.existsSync(f.target),false);
});
test('all six compiled official tool exports retain their declared source bytes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-official-export-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const row of require('../../../Tool/catalog.json')){const source=path.resolve(__dirname,'../../../Tool',row.folder),dest=path.join(dir,row.name);exportPackage(source,dest);const manifest=JSON.parse(fs.readFileSync(path.join(dest,'manifest.json')));assert.equal(manifest.id,row.id);assert.deepEqual(fs.readFileSync(path.join(source,'manifest.json')),fs.readFileSync(path.join(dest,'manifest.json')));assert.equal(fs.existsSync(path.join(dest,'AGENTS.md')),false);}
});
