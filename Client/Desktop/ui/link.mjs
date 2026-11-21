// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupLink
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/link.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Shared desktop primitives are injected; Link presentation belongs to Program.
import {el} from './views.mjs';
import {setupLink as setup} from '../../../Program/official/link/ui/link.mjs';
export {linkSummary,staleOffice} from '../../../Program/official/link/ui/link.mjs';
export function setupLink(api,navigation,doc=document){return setup(api,navigation,doc,{el});}
