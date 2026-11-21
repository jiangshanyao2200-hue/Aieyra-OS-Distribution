// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/runtime-diagnostics.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
const {lineage}=require('../host/live-diagnostics.cjs');
test('live diagnostics ties public tool receipts to a generation without copying user content',()=>{
 const trace=lineage({session_id:'runtime',link:{scope:'durable'},core_epoch:2,revision:3,messages:[{id:'request-one',from:'user',generation:4,text:'private-message',api_key:'private-key'}],roles:[{role:'matrix',id:'agent-one',generation:4,state:'completed',request_model:'exact-model',activity:{items:[{id:'call-one',tool:'browser',action:'evaluate',generation:4,state:'completed',preview:{value:'private-page'}}]}}]});
 assert.equal(trace.scope,'durable');assert.equal(trace.messages[0].id,'request-one');assert.equal(trace.roles[0].tools[0].id,'call-one');assert.equal(trace.roles[0].generation,trace.messages[0].generation);assert(!JSON.stringify(trace).includes('private-'));
});
