// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: setTestProfileCompact
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_fixture_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Pool fixtures now set the persistent per-profile trigger. Legacy globals
// remain covered separately by TestCatalogCompactMigrationAndProfileSwitch.
func setTestProfileCompact(s *Settings, tokens int) {
	if p := s.activePoolProfile(); p != nil {
		p.CompactAtTokens = &tokens
	}
}
