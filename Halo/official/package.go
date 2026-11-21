// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: manifest; definition; ClassicPackage
// Impact: python -B scripts/code-atlas.py show Halo/official/package.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package official owns the classic Halo's shipped package bytes. The host can
// bind their identity into its trusted catalog without trusting an import path.
package official

import _ "embed"

//go:embed classic/manifest.json
var manifest []byte

//go:embed classic/halo.json
var definition []byte

func ClassicPackage() map[string][]byte {
	return map[string][]byte{
		"manifest.json": append([]byte(nil), manifest...),
		"halo.json":     append([]byte(nil), definition...),
	}
}
