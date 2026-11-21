// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: path; electronPath
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/runtime-paths.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const path=require('node:path');
function electronPath(root=path.resolve(__dirname,'../../..'),platform=process.platform){
 const name=platform==='win32'?'electron.exe':platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron';
 return path.join(root,'Client/Desktop/node_modules/electron/dist',name);
}
module.exports={electronPath};
