// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; watchSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/settings-watch.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
// UI saves, tools and external editors all trigger the same committed-file
// notifications. Stat polling does not reread unchanged documents.
function watchSettings(config,notify){
 const methods={'companion-profile.json':'saveProfile','os-appearance.json':'appearance',[path.basename(config)]:'onboard'};
 const bindings=Object.entries(methods).map(([name,method])=>{const file=path.join(path.dirname(config),name),fn=(next,prior)=>{if(next.mtimeMs!==prior.mtimeMs||next.ctimeMs!==prior.ctimeMs||next.size!==prior.size)notify({method});};fs.watchFile(file,{interval:500,persistent:false},fn);return [file,fn];});
 return ()=>{for(const [file,fn]of bindings)fs.unwatchFile(file,fn);};
}
module.exports={watchSettings};
