// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: installThemeRecovery
// Impact: python -B scripts/code-atlas.py show Theme/runtime/recovery.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// A native shortcut remains reachable even if an author made controls invisible.
function installThemeRecovery(app,store){
 const created=(_event,contents)=>{
  contents.on('before-input-event',(event,input)=>{
   if(input.type!=='keyDown'||input.key!=='F12'||!input.control||!input.shift||input.alt||input.meta)return;
   event.preventDefault();const current=store.read();if(current.ok)store.update({layout_theme:null,theme_css:''},current.version);
  });
 };
 app.on('web-contents-created',created);return ()=>app.removeListener('web-contents-created',created);
}
module.exports={installThemeRecovery};
