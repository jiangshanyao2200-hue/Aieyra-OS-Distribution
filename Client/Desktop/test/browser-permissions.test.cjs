// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-permissions.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {permissionKeys}=require('../src/browser-permissions.cjs');
test('combined camera and microphone consent satisfies individual checks only at the approved site and profile',()=>{
 const grants=new Set(permissionKeys('main','media','https://example.test/login',{mediaTypes:['audio','video']}));
 for(const mediaType of ['audio','video'])assert(permissionKeys('main','media','https://example.test/',{mediaType}).every(key=>grants.has(key)));
 for(const [profile,site] of [['other','https://example.test'],['main','https://other.test']])assert(permissionKeys(profile,'media',site,{mediaType:'audio'}).every(key=>!grants.has(key)));
 assert.equal(permissionKeys('main','media','https://example.test',{mediaType:'unknown'}).length,0);
 assert.equal(permissionKeys('main','media','https://example.test',{}).length,0);
});
test('microphone consent does not grant camera access, and invalid origins have no grant keys',()=>{
 const grants=new Set(permissionKeys('p','media','https://example.test',{mediaTypes:['audio']}));
 assert(permissionKeys('p','media','https://example.test',{mediaType:'video'}).every(key=>!grants.has(key)));
 for(const site of ['invalid','file:///C:/test','data:text/plain,hi'])assert.deepEqual(permissionKeys('p','notifications',site),[]);
 assert.deepEqual(permissionKeys('p','notifications','https://example.test/a'),permissionKeys('p','notifications','https://example.test/b'));
});
