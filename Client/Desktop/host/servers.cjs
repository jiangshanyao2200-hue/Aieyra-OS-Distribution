// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: service
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/servers.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Legacy assembly retains the client's SSH dependency injection.
const service=require('../../../Program/official/servers/service.cjs');
module.exports={...service,createServers:options=>service.createServers({Client:()=>new (require('ssh2').Client)(),...options})};
