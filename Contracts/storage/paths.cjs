// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: path; definition; areas; root; describe
// Impact: python -B scripts/code-atlas.py show Contracts/storage/paths.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const path=require('node:path');
const definition=require('./areas.json'),profile=require('./profile.cjs');
if(definition.schema!==1||!Array.isArray(definition.areas))throw Error('Invalid storage contract');
const areas=new Map();
for(const source of definition.areas){
 const a=Object.freeze({...source});
 if(!a.id||areas.has(a.id)||!a.owner||!a.cleanup||!a.relative||a.relative==='.'||path.posix.normalize(a.relative)!==a.relative||a.relative.startsWith('/')||/[\\:]/u.test(a.relative)||a.relative.split('/').includes('..'))throw Error('Invalid storage area');
 for(const value of [a.relative,a.profile_relative])if(typeof value!=='string'||!value||value==='.'||path.posix.normalize(value)!==value||value.startsWith('/')||/[\\:]/u.test(value)||value.split('/').includes('..'))throw Error('Invalid storage layout');
 areas.set(a.id,a);
}
// A mapping is neither a filesystem permission nor a grant to delete its root.
function root(data,area){const a=areas.get(area);if(!a)throw Error('Unknown private storage area: '+area);return path.join(data,...(profile.rootBound(data)?a.profile_relative:a.relative).split('/'));}
function describe(data){return [...areas.values()].map(a=>({...a,path:root(data,a.id)}));}
module.exports={root,describe};
