// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: closeSurface
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/surface-lifecycle.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Closing a detached surface returns it to its live owner. Application exit and
// deliberately standalone modules use shutdown; closing an attached view hides it.
function closeSurface({detached,ownerAvailable,quitting=false,dock,hide,shutdown}){
 if(quitting||!ownerAvailable)return shutdown();
 return detached?dock():hide();
}
module.exports={closeSurface};
