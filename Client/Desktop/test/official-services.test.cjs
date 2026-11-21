// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; ROOT; official
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/official-services.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../../..');
const official=require('../../../Contracts/official-services.json');

test('official endpoints are written once and the renderer mirror matches the JSON',async()=>{
 const mirror=(await import('../../../Contracts/official-services.mjs')).default;
 assert.deepEqual({...mirror},official);
 const policy=JSON.parse(fs.readFileSync(path.join(ROOT,'scripts/public-privacy-policy.json'),'utf8'));
 for(const [key,value] of Object.entries(official)){
  if(['schema','note'].includes(key))continue;
  const url=new URL(value);assert.equal(url.protocol,'https:',key);
  assert.ok(policy.public_service_hosts.includes(url.hostname),key+' host must be a reviewed public host');
 }
});

test('production desktop, program and API code reads official hosts only from the contract',()=>{
 const roots=['Client/Desktop/host','Client/Desktop/src','Client/Desktop/ui','Program/official','API','Core'];
 const offenders=[];
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory()){if(!['node_modules','testdata','test','tests','runtime'].includes(entry.name))walk(full);continue;}
  if(!/\.(cjs|mjs|js|go)$/.test(entry.name)||/_test\.go$/.test(entry.name))continue;
  if(/aieyra\.cn/i.test(fs.readFileSync(full,'utf8')))offenders.push(path.relative(ROOT,full).split(path.sep).join('/'));
 }};
 for(const root of roots)walk(path.join(ROOT,root));
 assert.deepEqual(offenders,[]);
});
