// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; temp; config; service
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/update-probe.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
const temp=process.argv[2];if(!temp)throw Error('Isolated probe directory required');
const config=path.join(temp,'config.json');
const service=require('./service.cjs').createService(config);
(async()=>{try{
 const result=await service.call('config:bootstrap');if(!result.settings||!result.nativeFields)throw Error('Configuration service failed');
 const html=fs.readFileSync(path.join(__dirname,'../ui/index.html'),'utf8');if(!html.includes('../host/entry.mjs')||!html.includes('id="desktop-dock"'))throw Error('Desktop entrypoint incomplete');
 require('../host/bridge.cjs');require('../host/official-account.cjs');require('../host/community.cjs');require('./managed-updates.cjs');
 await import('../ui/model.mjs');await import('../ui/status.mjs');
 process.stdout.write(JSON.stringify({ok:true,checks:['configuration','desktop-entrypoint','account-module','update-module','presentation-model']})+'\n');
 }finally{service.close();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
