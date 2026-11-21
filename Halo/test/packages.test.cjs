// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Halo/test/packages.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createModPackages}=require('../../Client/Desktop/host/mod-packages.cjs'),{createHaloStore}=require('../runtime/settings.cjs');
test('Halo package apply, disable, re-enable, upgrade and corrupt restart use the shared registry',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'halo-packages-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'source');fs.cpSync(path.resolve(__dirname,'../../SDK/examples/halo-prism'),source,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));let enabled=true,digest='a'.repeat(64);
 const halo=createHaloStore(path.join(dir,'config.json')),item=()=>({manifest,directory:source,digest,enabled});
 const core=async(_name,p)=>{if(p.action==='list')return {ok:true,items:[item()]};if(p.action==='resolve'){if(!enabled)throw Error('disabled');return {ok:true,item:item()};}if(p.action==='disable')enabled=false;else if(p.action==='enable')enabled=true;else if(p.action==='install')digest='b'.repeat(64);else if(p.action==='rollback')digest='a'.repeat(64);else throw Error(p.action);return {ok:true};};
 const service=createModPackages({core,dataDir:dir,halo});t.after(()=>service.close());
 const call=action=>service.call({action:'mod_'+action,id:manifest.id,confirmed:true});
 await assert.rejects(service.call({action:'mod_apply',id:manifest.id}),/确认/);
 assert.equal((await call('apply')).ok,true);assert.equal(halo.public().selection.id,manifest.id);
 await call('disable');assert.equal(halo.public().selection,null);assert.equal(halo.read().selection.digest,'a'.repeat(64));
 await call('enable');assert.equal(halo.public().selection.id,manifest.id);
 await call('install');assert.equal(halo.public().selection,null,'new digest needs explicit apply');
 await call('rollback');assert.equal(halo.public().selection.id,manifest.id);
 fs.appendFileSync(path.join(source,'halo.json'),' ');await call('enable');assert.equal(halo.public().selection,null,'hash mismatch revokes drawing');
 await assert.rejects(call('apply'),/变化/);
});
test('late initial registry read cannot undo a newly applied Halo selection',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'halo-race-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../../SDK/examples/halo-prism'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),item={manifest,directory:source,digest:'a'.repeat(64),enabled:true};
 let release;const waiting=new Promise(r=>release=r),halo=createHaloStore(path.join(dir,'config.json'));
 const service=createModPackages({dataDir:dir,halo,core:async(_name,p)=>p.action==='list'?(await waiting,{ok:true,items:[]}):{ok:true,item}});t.after(()=>service.close());
 await service.call({action:'mod_apply',id:manifest.id,confirmed:true});release();await new Promise(r=>setImmediate(r));assert.equal(halo.public().selection.id,manifest.id);
});
