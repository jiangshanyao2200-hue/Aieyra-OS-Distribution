// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: BUILTIN_THEMES
// Impact: python -B scripts/code-atlas.py show Theme/runtime/library-builtins.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {EFFECTS} from '../../Halo/official/effects.mjs';

// These are the previews actually bundled with OS. Do not manufacture nine
// designs, publication dates or community votes to fill the future UI grid.
export const BUILTIN_THEMES=Object.freeze([
 Object.freeze({id:'builtin.ui-default',category:'ui',title:'系统默认',previewKind:'ui'}),
 ...Object.entries(EFFECTS).map(([effect,title])=>Object.freeze({id:'builtin.halo-'+effect,category:'halo',title,previewKind:'halo',effect})),
]);
