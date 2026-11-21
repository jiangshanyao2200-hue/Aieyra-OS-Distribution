// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; catalog; people
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/eyra-team.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const catalog=require('../../../Agent/program/catalog.json'),programs=catalog.map(p=>p.id);
const people=()=>[{id:'u1',name:'自建联系人'},{id:'eyra',builtin:'eyra',name:'Eyra'},...programs.map(p=>({id:'p-'+p,program:p,name:p})),{id:'vaya',builtin:'vaya',name:'Vaya'},{id:'cota',builtin:'cota',name:'Cota'},{id:'u2',name:'另一位'}];

test('built-in, program and custom contacts share the same flat directory',async()=>{
 const {createContactStore}=await import('../ui/contacts.mjs');
 const contacts=people();
 const store=createContactStore({conversation:async({action})=>action==='contacts'?contacts:[]},{doc:new EventTarget()});
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(store.people.map(row=>row.id),contacts.map(row=>row.id));
  for(const person of contacts)assert.equal(store.find(person.id),person);
 }finally{store.close();}
});
