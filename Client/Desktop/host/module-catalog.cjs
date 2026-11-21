// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: entries; path; MODULES; moduleSpec
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/module-catalog.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Single product registry. Session menus and commands are not content modules.
const entries=[...require('./module-catalog.json')];
const path=require('node:path');
for(const {root,manifest,definition,summary,order,...row}of [...require('../../../Program/official/catalog.cjs').programs].sort((a,b)=>a.order-b.order)){
 // The owning Program package retains its original content and digest.
 if(row.host==='surface')row.page=path.relative(path.join(__dirname,'../ui'),path.join(root,definition.desktop.entry)).split(path.sep).join('/');
 entries.splice(order,0,row);
}
const MODULES=Object.freeze(entries.map(Object.freeze));
function moduleSpec(id){const spec=MODULES.find(row=>row.id===id);if(!spec)throw Error('未知模块：'+String(id));return spec;}
module.exports={MODULES,moduleSpec};
