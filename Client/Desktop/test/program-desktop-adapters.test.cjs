// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/program-desktop-adapters.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createServersProgram}=require('../../../Program/official/servers/desktop.cjs');
test('servers program keeps user and agent policies and publishes successful changes from their shared service',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-program-servers-')),events=[];
 const program=createServersProgram({dataDir,safeStorage:null,configFiles:()=>[],pickImage:async()=>({canceled:true}),changed:e=>events.push(e)});
 t.after(()=>{program.close();fs.rmSync(dataDir,{recursive:true,force:true});});
 const added=await program.agentCall({action:'add',confirmed:true,name:'local example',host:'127.0.0.1',user:'fixture'});
 assert.equal((await program.user({action:'list'})).servers[0].id,added.server.id);
 assert.deepEqual(events,[{catalog:true,type:'servers_changed'}]);
 await assert.rejects(()=>program.user({action:'add',host:'127.0.0.2',user:'fixture'}),/未知/);
 await assert.rejects(()=>program.agentCall({action:'terminal_open',id:added.server.id}),/未知/);
 await assert.rejects(()=>program.agentCall({action:'add',confirmed:true,name:'same',host:'127.0.0.1',user:'fixture'}),/已经/);
 assert.equal(events.length,1);
 assert.deepEqual(await program.user({action:'image_pick'}),{ok:true,cancelled:true});
 await program.user({action:'rename',id:added.server.id,name:'user rename'});
 assert.equal((await program.agentCall({action:'list'})).servers[0].name,'user rename');
});
