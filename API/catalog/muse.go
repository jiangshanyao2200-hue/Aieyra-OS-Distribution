// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/catalog/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MuseKind
// Impact: python -B scripts/code-atlas.py show API/catalog/muse.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package catalog

// These proxy capability IDs are distinct from OpenCode's similarly named
// Muse versions. Evidence never crosses the exact endpoint/model boundary:
// only the official gateway carries them.
func MuseKind(base, model string) string {
	if !VerifiedGateway(base) {
		return ""
	}
	switch model {
	case "muse-spark":
		return "chat"
	case "muse-image":
		return "image"
	case "muse-video":
		return "video"
	}
	return ""
}
