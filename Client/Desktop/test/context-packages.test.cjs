// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/context-packages.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createModPackages}=require('../host/mod-packages.cjs');
test('Context package controls preserve source CAS and expose descriptions without originals or private state',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'context-mod-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const item={digest:'a'.repeat(64),manifest:{id:'example.context-project',version:'1.0.0',kind:'context',data:{schema:1}}};
 let source='source-one',enabled=true,mutations=0,selected={reference:{id:'aieyra.context.structured',version:'1.0.0',state_schema:1},name:'Built-in'};
 const view=()=>({ok:true,source,session_id:'session',busy:false,text:'PRIVATE ORIGINAL',checkpoint:{summary:'PRIVATE CHECKPOINT'},provider:{selected,available:[selected],ready:enabled,state:{namespaces:{private:'PRIVATE NAMESPACE'}}}});
 const service=createModPackages({dataDir,core:async(action,p)=>{
  if(action==='workspace.packages'){assert.equal(p.action,'resolve');assert.equal(p.id,item.manifest.id);if(!enabled)throw Error('not enabled');return {ok:true,item};}
  assert.equal(action,'workspace.context');if(p.action==='view')return view();
  assert.equal(p.action,'provider');if(p.source!==source)throw Error('stale source');
  mutations++;selected={reference:p.provider,name:'Selected'};source='source-'+mutations;return view();
 }});t.after(()=>service.close());
 const before=await service.call({action:'mod_context_view'});assert.equal(before.source,source);assert(!JSON.stringify(before).includes('PRIVATE'));
 const input={action:'mod_apply',id:item.manifest.id,expected_digest:item.digest,expected_source:source,provider:{id:'untrusted.override'}};
 await assert.rejects(service.call(input),/确认/);assert.equal(mutations,0);
 await assert.rejects(service.call({...input,confirmed:true,expected_digest:'b'.repeat(64)}),/版本/);assert.equal(mutations,0);
 const applied=await service.call({...input,confirmed:true});assert.deepEqual(applied.provider.selected.reference,{id:item.manifest.id,version:'1.0.0',state_schema:1,digest:item.digest});assert(!JSON.stringify(applied).includes('PRIVATE'));
 await assert.rejects(service.call({...input,confirmed:true}),/stale source/);assert.equal(mutations,1);
 enabled=false;
 const unavailable=await service.call({action:'mod_context_view'});assert.equal(unavailable.provider.ready,false);
 const restored=await service.call({action:'mod_context_reset',confirmed:true,expected_source:source});assert.equal(restored.provider.selected.reference.id,'aieyra.context.structured');assert.equal(mutations,2);assert(!JSON.stringify(restored).includes('PRIVATE'));
});
