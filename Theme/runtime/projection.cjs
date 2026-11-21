// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: publicAppearance
// Impact: python -B scripts/code-atlas.py show Theme/runtime/projection.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
function publicAppearance(value){if(!value?.settings||!value.fields)return null;const {theme_profiles,theme_presets,...settings}=value.settings;return {settings,fields:value.fields,version:value.version};}
module.exports={publicAppearance};
