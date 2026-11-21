// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Halo/test/contract.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {validateHalo}=require('../contract/definition.mjs');
for(const row of require('../contract/cases.json'))test('Halo admission: '+row.name,()=>{if(row.valid)assert.doesNotThrow(()=>validateHalo(row.value));else assert.throws(()=>validateHalo(row.value));});
test('Halo selection CAS preserves unrelated config and keeps failed originals',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'halo-store-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const config=path.join(dir,'config.json');fs.writeFileSync(config,'PRIVATE_SENTINEL');
 let changes=0;const store=require('../runtime/settings.cjs').createHaloStore(config,{changed:()=>changes++});
 const selection={id:'example.halo-prism',digest:'a'.repeat(64),version:'1.0.0',name:'Prism',definition:require('../../SDK/examples/halo-prism/halo.json')};
 assert.deepEqual(store.public(),{ok:true,selection:null});assert.equal(store.update(selection,'missing').ok,true);assert.equal(changes,1);
 const before=fs.readFileSync(path.join(dir,'halo.json'));assert.equal(store.update(null,'missing').ok,false);assert.deepEqual(fs.readFileSync(path.join(dir,'halo.json')),before);
 assert.equal(fs.readFileSync(config,'utf8'),'PRIVATE_SENTINEL');
 const reopened=require('../runtime/settings.cjs').createHaloStore(config);assert.deepEqual(reopened.read().selection,selection);assert.equal(reopened.public().selection,null,'persisted definitions stay inactive until registry verification');
 store.publish(null);assert.equal(store.public().selection,null);assert.deepEqual(store.read().selection,selection,'fallback retains recoverable selection');
 fs.writeFileSync(path.join(dir,'halo.json'),'bad');assert.equal(store.read().ok,false);assert.equal(fs.readFileSync(path.join(dir,'halo.json'),'utf8'),'bad');
 fs.unlinkSync(path.join(dir,'halo.json'));fs.mkdirSync(path.join(dir,'halo.json'));assert.equal(store.read().ok,false);assert.equal(store.read().selection,null);assert.equal(store.update(null,store.read().version).ok,false);assert(fs.statSync(path.join(dir,'halo.json')).isDirectory());
});
