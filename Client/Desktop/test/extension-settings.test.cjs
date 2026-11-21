// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/extension-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createExtensionSettings}=require('../host/extension-settings.cjs');
test('Settings preserves local legacy migration without opening remote catalogue or publish actions',async()=>{
 const calls=[],changed=[],api=createExtensionSettings({resources:{call:async p=>{calls.push(p);return {ok:true};}},changed:()=>changed.push(true)});
 await api.call({action:'center_local'});await api.call({action:'center_migrate',id:'legacy.program',origin:'local',expected_sha256:'original'});
 assert.equal(calls[1].confirmed,true);assert.equal(calls[1].expected_sha256,'original');assert.equal(changed.length,1);
 await assert.rejects(api.call({action:'center_install'}),/未知/);await assert.rejects(api.call({action:'center_publish'}),/未知/);
});
test('Settings package management preserves registry identity and uses the actual user selection',async()=>{
 const calls=[],changes=[],parent={},sender={},api=createExtensionSettings({core:async(method,args)=>{calls.push({method,args});return {ok:true};},packages:{call:async(args,owner)=>{calls.push({args,owner});return {ok:true,revision:4};}},dialog:{showOpenDialog:async owner=>{assert.equal(owner,parent);return {filePaths:['selected.zip']};}},changed:()=>changes.push(true),exportAgent:p=>p,selectTask:id=>calls.push({selected:id})});
 const inspected=await api.call({action:'mod_pick_archive',source:'forged.zip'},{parent});assert.equal(inspected.source,'selected.zip');assert.equal(calls[0].args.source,'selected.zip');
 const grant={action:'mod_enable',id:'example.tool',request_id:'once',expected_revision:4,expected_digest:'abc',grants:[{capability:'files',scope:'workdir'}]};await api.call(grant);assert.deepEqual(calls[1].args,{...grant,confirmed:true});assert.equal(changes.length,1);
 await api.call({action:'mod_agent',request:{action:'list'}});assert.equal(calls[2].method,'workspace.agents');
 await api.call({action:'mod_theme_preview_close'},{sender});assert.equal(calls[3].owner,sender);
 await assert.rejects(api.call({action:'center_publish'}),/未知/);
});
test('Cancelled inspection and failed management do not report a registry change or open a task',async()=>{
 const changed=[],selected=[],api=createExtensionSettings({core:async()=>({ok:false,error:'missing'}),packages:{call:async()=>({ok:false,error:'revision conflict'})},dialog:{showOpenDialog:async()=>({canceled:true})},changed:()=>changed.push(true),selectTask:id=>selected.push(id)});
 assert.equal((await api.call({action:'mod_pick_directory'})).cancelled,true);assert.equal((await api.call({action:'mod_disable'})).ok,false);assert.equal((await api.call({action:'mod_agent_task',id:'missing'})).ok,false);assert.deepEqual(changed,[]);assert.deepEqual(selected,[]);
});
