// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createSituationTicker
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/situation-ticker.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {createTicker} from './ticker.mjs';
export const createSituationTicker=(root,options={})=>createTicker(root,{...options,prefix:'st'});
