// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Contracts/official-services.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Generated mirror of official-services.json for the renderer (its CSP blocks JSON modules).
// Edit the JSON; test/official-services.test.cjs fails when the two differ.
export default Object.freeze({
 "schema": "aieyra.official-services/1",
 "note": "The only place official client endpoints are written. Every host here is public by necessity (clients reach it); protection is CDN/WAF, origin allow-lists and rate limits. Internal relays, panels and origin addresses never appear in source.",
 "site": "https://aieyra.cn",
 "account": "https://api.aieyra.cn",
 "gateway": "https://fast.aieyra.cn/v1",
 "os": "https://os.aieyra.cn",
 "download": "https://os.aieyra.cn/os",
 "link_cloud": "https://os.aieyra.cn/link/cloud",
 "updates": "https://osupdate.aieyra.cn",
 "control": "https://ctrlupdate.aieyra.cn"
});
