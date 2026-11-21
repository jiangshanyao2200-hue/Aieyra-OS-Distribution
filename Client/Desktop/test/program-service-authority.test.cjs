// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/program-service-authority.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProgramServiceAuthority}=require('../host/program-service-authority.cjs');
const {createDesktopTools}=require('../host/desktop-tools.cjs');
test('desktop program tools retain their durable caller and recheck the real Core binding',async()=>{
 let rows=[{program:'workspace',sessions:[{id:'canvas-session',state:'running'}]}];const requests=[],seen=[];
 const authorizeSession=createProgramServiceAuthority(async p=>{requests.push(p);return rows;});
 const tools=createDesktopTools({sessionId:'os',authorizeSession,modPackages:{call:async p=>{seen.push(p);return {ok:true,model_image:{path:'owned.png'}};}},softwareAPI:{call:async(p,caller)=>({ok:true,caller})}});
 const request={action:'program',operation:'invoke',arguments:{id:'aieyra.workspace',operation:'images.view_many',request_id:'original'}};
 assert.equal((await tools.call(request,'canvas-session')).ok,true);
 assert.equal((await tools.call({action:'modules'},'canvas-session')).caller,'canvas-session');
 rows.push({program:'center',program_session:{id:'nova-session',state:'running'}});
 assert.equal((await tools.call({action:'modules'},'nova-session')).caller,'nova-session');
 rows[1].program_session.deletion_pending=true;
 await assert.rejects(tools.call({action:'modules'},'nova-session'),e=>e.code==='SESSION_CONFLICT');
 assert.equal(seen[0].action,'mod_invoke');assert.equal(seen[0].request_id,'original');
 await assert.rejects(tools.call(request,'ordinary-chat'),e=>e.code==='SESSION_CONFLICT');
 rows[0].sessions[0].state='completed';await assert.rejects(tools.call(request,'canvas-session'),e=>e.code==='SESSION_CONFLICT');
 rows=[{name:'workspace',sessions:[{id:'canvas-session',state:'running'}]}];await assert.rejects(tools.call(request,'canvas-session'),e=>e.code==='SESSION_CONFLICT');
 assert.equal(seen.length,1);assert.ok(requests.every(p=>p.action==='programs'));
});
