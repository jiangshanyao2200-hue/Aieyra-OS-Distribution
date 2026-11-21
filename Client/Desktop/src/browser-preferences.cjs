// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: service
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/browser-preferences.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const service=require('../../../Program/official/browser/service/browser-preferences.cjs');
module.exports={...service,createBrowserPreferences:storage=>service.createBrowserPreferences(storage,{atomicWriteJson:require('../host/json-storage.cjs').atomicWriteJson,legacyHome:require('../../../Contracts/official-services.json').os})};
