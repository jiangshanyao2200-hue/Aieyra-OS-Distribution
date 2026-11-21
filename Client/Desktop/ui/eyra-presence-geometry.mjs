// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: presenceRingSize
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/eyra-presence-geometry.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Logical pixels, shared by the main page and every native module projection.
export function presenceRingSize(height,preferred=104){return height<=560?64:Math.min(144,Math.max(64,Number(preferred)||104));}
